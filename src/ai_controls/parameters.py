"""Parameter registry, configuration files, and keyed parameter sampling.

Three layers are kept apart, as the model specification requires:

* ``parameters``: the analyst's uncertainty about how the world works. Each entry has a
  name, definition, units, status (observed / estimated / elicited / illustrative), value,
  uncertainty range, source and date.
* actor beliefs: parameters in the ``Beliefs`` group describe what the Chinese and US
  governments believe, which need not match the analyst's values.
* ``weights``: the analyst's normative weights, applied only when payoff vectors are
  aggregated.
"""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from . import rng
from .state import STREAM_FACTOR0, STREAM_PARAM0

STATUSES = ("observed", "estimated", "elicited", "illustrative")


@dataclass
class Param:
    name: str
    group: str
    definition: str
    units: str
    status: str
    value: float
    low: float | None = None
    high: float | None = None
    dist: str = "triangular"
    factor: str | None = None
    loading: float = 0.0
    source: str = ""
    last_updated: str = ""
    ui: bool = False
    sampled: bool = False  # set by the configuration's sampling mode

    @property
    def has_range(self) -> bool:
        return self.low is not None and self.high is not None and self.high > self.low


@dataclass
class Config:
    name: str
    label: str
    description: str
    start_year: int
    end_year: int
    reference_policy: str
    sampling: str
    factors: list[str]
    params: dict[str, Param]
    policies: dict[str, dict[str, Any]]
    status_quo: list[float]
    weights: dict[str, dict[str, Any]]
    stances: dict[str, dict[str, Any]]
    scenarios: dict[str, dict[str, Any]] = field(default_factory=dict)
    sources: dict[str, dict[str, Any]] = field(default_factory=dict)
    china_objective: dict[str, Any] = field(default_factory=dict)
    china_beliefs: dict[str, Any] = field(default_factory=dict)
    notes: str = ""

    @property
    def n_years(self) -> int:
        return self.end_year - self.start_year + 1

    @property
    def years(self) -> list[int]:
        return list(range(self.start_year, self.end_year + 1))

    def values(self) -> dict[str, float]:
        return {k: p.value for k, p in self.params.items()}

    def with_overrides(self, overrides: dict[str, Any], name: str | None = None) -> "Config":
        """Return a copy with parameter overrides (number, or {value, low, high})."""
        params = {k: Param(**asdict(p)) for k, p in self.params.items()}
        _apply_overrides(params, overrides, self.sampling)
        return Config(**{**self.__dict__, "params": params, "name": name or self.name})


def _apply_overrides(params: dict[str, Param], overrides: dict[str, Any], sampling: str) -> None:
    """A plain number fixes a parameter. A mapping may set value/low/high/status/source;
    giving both ``low`` and ``high`` makes the parameter sampled unless sampling is off."""
    for key, ov in (overrides or {}).items():
        if key not in params:
            raise KeyError(f"Override for unknown parameter '{key}'")
        p = params[key]
        if not isinstance(ov, dict):
            p.value = float(ov)
            p.sampled = False
            continue
        for attr in ("value", "low", "high"):
            if attr in ov:
                setattr(p, attr, float(ov[attr]))
        for attr in ("status", "source"):
            if attr in ov:
                setattr(p, attr, ov[attr])
        if "low" in ov and "high" in ov and sampling != "none":
            p.sampled = True
        if ov.get("fixed"):
            p.sampled = False


def load_config(path: str | Path) -> Config:
    path = Path(path)
    raw = yaml.safe_load(path.read_text())
    base_raw: dict[str, Any] = {}
    if raw.get("extends"):
        base_raw = yaml.safe_load((path.parent / raw["extends"]).read_text())
    merged = {**base_raw, **{k: v for k, v in raw.items() if k not in ("overrides", "extends")}}
    meta = {**base_raw.get("meta", {}), **raw.get("meta", {})}
    default_date = str(base_raw.get("meta", {}).get("last_updated", meta.get("last_updated", "")))

    params: dict[str, Param] = {}
    for entry in merged["parameters"]:
        e = dict(entry)
        f = e.pop("factor", None)
        p = Param(
            name=e["name"], group=e["group"], definition=e["def"], units=e.get("units", ""),
            status=e.get("status", "illustrative"), value=float(e["value"]),
            low=None if e.get("low") is None else float(e["low"]),
            high=None if e.get("high") is None else float(e["high"]),
            dist=e.get("dist", "triangular"),
            factor=f[0] if f else None, loading=float(f[1]) if f else 0.0,
            source=e.get("src", ""), last_updated=str(e.get("last_updated", default_date)),
            ui=bool(e.get("ui", False)),
        )
        if p.status not in STATUSES:
            raise ValueError(f"{p.name}: unknown status '{p.status}'")
        if p.has_range and not (p.low <= p.value <= p.high):
            raise ValueError(f"{p.name}: value {p.value} outside [{p.low}, {p.high}]")
        if p.name in params:
            raise ValueError(f"Duplicate parameter '{p.name}'")
        params[p.name] = p

    sampling = raw.get("sampling", merged.get("sampling", "none"))
    if sampling not in ("none", "listed", "all"):
        raise ValueError(f"Unknown sampling mode '{sampling}'")
    if sampling == "all":
        for p in params.values():
            p.sampled = p.has_range
    _apply_overrides(params, raw.get("overrides", {}), sampling)
    for p in params.values():
        if p.has_range:
            p.value = min(max(p.value, p.low), p.high) if p.sampled else p.value

    return Config(
        name=path.stem, label=meta.get("label", path.stem), description=meta.get("description", ""),
        start_year=int(merged["horizon"]["start_year"]), end_year=int(merged["horizon"]["end_year"]),
        reference_policy=merged["reference_policy"], sampling=sampling,
        factors=list(merged.get("factors", [])), params=params,
        policies=merged["policies"], status_quo=[float(v) for v in merged["status_quo"]],
        weights=merged["weights"], stances=merged["stances"],
        scenarios=raw.get("scenarios", {}), sources=merged.get("sources", {}),
        china_objective=merged.get("china_objective", {}),
        china_beliefs=merged.get("china_beliefs", {}),
        notes=meta.get("notes", ""),
    )


def _quantile(p: Param, u: np.ndarray) -> np.ndarray:
    lo, hi = p.low, p.high
    if p.dist == "uniform":
        return lo + u * (hi - lo)
    if p.dist == "loguniform":
        return np.exp(np.log(lo) + u * (np.log(hi) - np.log(lo)))
    mode = min(max(p.value, lo), hi)
    f = (mode - lo) / (hi - lo)
    left = lo + np.sqrt(u * (hi - lo) * (mode - lo))
    right = hi - np.sqrt((1.0 - u) * (hi - lo) * (hi - mode))
    return np.where(u < f, left, right)


def sample_params(cfg: Config, n: int, seed: int) -> dict[str, Any]:
    """Draw one parameter set per simulation.

    Draws are keyed by (seed, parameter index, simulation), so simulation ``i`` sees the
    same world under every policy. Parameters that share a ``factor`` are correlated
    through a Gaussian copula with the stated loading.
    """
    sims = np.arange(n)
    zf = {name: rng.normal(seed, STREAM_FACTOR0 + k, sims) for k, name in enumerate(cfg.factors)}
    out: dict[str, Any] = {}
    for j, (name, p) in enumerate(cfg.params.items()):
        if not (p.sampled and p.has_range):
            out[name] = float(p.value)
            continue
        u = rng.uniform(seed, STREAM_PARAM0 + j, sims)
        if p.factor and p.loading:
            rho = p.loading
            z = rho * zf[p.factor] + np.sqrt(1.0 - rho * rho) * rng.invnorm(u)
            u = rng.normcdf(z)
        out[name] = _quantile(p, u)
    return out


def provenance_rows(cfg: Config) -> list[dict[str, Any]]:
    rows = []
    for p in cfg.params.values():
        rows.append({
            "name": p.name, "group": p.group, "definition": p.definition, "units": p.units,
            "status": p.status, "value": p.value, "low": p.low, "high": p.high, "dist": p.dist,
            "sampled": p.sampled, "factor": p.factor or "", "loading": p.loading,
            "source": p.source, "last_updated": p.last_updated,
        })
    return rows


def export_csv(cfg: Config, path: str | Path) -> None:
    rows = provenance_rows(cfg)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def export_json(cfg: Config, path: str | Path) -> None:
    Path(path).write_text(json.dumps(provenance_rows(cfg), indent=1))
