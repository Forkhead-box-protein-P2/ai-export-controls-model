"""Policy comparison, decomposition, break-even surfaces, sensitivity and the strategic game.

Three kinds of claim are kept distinct:

1. a *scenario* under the assumed Chinese response rule (``run_config``);
2. a *policy comparison* inside one causal model (``policy_table``, paired by simulation);
3. an *equilibrium* of a specified coarse game (``strategic_game``), reported with
   unilateral deviation gains and never as the solution of the real geopolitical game.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import payoffs
from .parameters import Config, sample_params
from .simulation import Calibration, SimResult, calibrate, simulate
from .state import COMPONENTS, GROUPS, REGIMES


@dataclass
class Run:
    cfg: Config
    n: int
    seed: int
    p: dict
    calib: Calibration
    results: dict  # policy name -> SimResult


def run_config(cfg: Config, n: int, seed: int, policies=None, stance=None,
               record: bool = True, lead_path=None) -> Run:
    """Simulate every policy on the same ``n`` worlds (common random numbers)."""
    p = sample_params(cfg, n, seed)
    calib = calibrate(cfg, p, n, seed)
    names = list(policies or cfg.policies)
    results = {name: simulate(cfg, p, cfg.policies[name], n, seed, calib, stance=stance,
                              record=record, lead_path=lead_path) for name in names}
    return Run(cfg, n, seed, p, calib, results)


def series_summary(res: SimResult, name: str) -> pd.DataFrame:
    a = res.series[name]
    q = np.quantile(a, [0.1, 0.5, 0.9], axis=1)
    return pd.DataFrame({"year": res.years, "mean": a.mean(axis=1), "p10": q[0], "p50": q[1], "p90": q[2]})


def group_values(comps: np.ndarray, w: dict) -> dict:
    """Weighted value of each component group, per simulation."""
    wv = payoffs.weight_vector(w)
    idx = {c: k for k, c in enumerate(COMPONENTS)}
    return {g: sum(wv[idx[c]] * comps[:, idx[c]] for c in members) for g, members in GROUPS.items()}


def policy_table(run: Run, ref: str | None = None) -> pd.DataFrame:
    """Expected value of each policy minus the reference, by weight set, with a decomposition.

    Differences are taken world by world before averaging, so the standard error reflects
    the paired design.
    """
    ref = ref or run.cfg.reference_policy
    base = run.results[ref].comps
    rows = []
    for wname, w in run.cfg.weights.items():
        for pol, res in run.results.items():
            d = res.comps - base
            v = payoffs.aggregate(d, w)
            row = {"config": run.cfg.name, "weights": wname, "policy": pol,
                   "delta_value": v.mean(), "se": v.std(ddof=1) / np.sqrt(run.n) if run.n > 1 else 0.0,
                   "p_better": float((v > 0).mean()) if pol != ref else 0.5}
            for g, gv in group_values(d, w).items():
                row[g] = gv.mean()
            rows.append(row)
    return pd.DataFrame(rows)


def outcome_probs(run: Run) -> pd.DataFrame:
    """Outcome probabilities by policy. War and catastrophe overlap the regimes."""
    yrs = run.cfg.years
    rows = []
    for pol, res in run.results.items():
        e = res.events
        row = {"config": run.cfg.name, "policy": pol}
        for r in REGIMES:
            row[r] = float((e["regime"] == r).mean())
        row["tai_by_2035"] = float((e["t_arr"] <= yrs.index(2035)).mean())
        row["us_first"] = float((e["arrived"] & (e["leader"] == 1) & ~e["near_sim"] & ~e["distributed"]).mean())
        row["cn_first"] = float((e["arrived"] & (e["leader"] == 2) & ~e["near_sim"] & ~e["distributed"]).mean())
        row["adverse_durable"] = float((e["adverse"] & np.isin(e["regime"], ["us_durable", "cn_durable"])).mean())
        row["war_by_2040"] = float((e["t_war"] <= yrs.index(2040)).mean())
        row["war_by_2050"] = float(e["war"].mean())
        row["catastrophe"] = float(e["cat"].mean())
        row["war_and_catastrophe"] = float((e["war"] & e["cat"]).mean())
        row["mean_lead_years"] = float(e["lead0"][e["arrived"]].mean()) if e["arrived"].any() else 0.0
        rows.append(row)
    return pd.DataFrame(rows)


def war_decomposition(run: Run, policy: str, ref: str | None = None, by: int = 2040) -> dict:
    """Marginal war risk of ``policy`` relative to ``ref`` and its channel shares.

    Cumulative incidence is 1 - prod(1 - h_t) along each path. The logit is linear in the
    four channels, so their mean logit differences split the marginal effect exactly in
    logit terms; the percentage-point attribution scales those shares to the total.
    """
    ref = ref or run.cfg.reference_policy
    i = run.cfg.years.index(by)
    a, b = run.results[policy].series, run.results[ref].series
    cum = lambda s: 1.0 - np.prod(1.0 - s["h_war"][: i + 1], axis=0)
    total = float((cum(a) - cum(b)).mean())
    names = {"war_T": "provocation", "war_sdi": "strategic denial", "war_det": "deterrence",
             "war_I": "interdependence"}
    dl = {lab: float((a[k][: i + 1] - b[k][: i + 1]).mean()) for k, lab in names.items()}
    tot_logit = sum(dl.values())
    out = {"policy": policy, "ref": ref, "by": by, "baseline": float(cum(b).mean()),
           "marginal_pp": 100 * total}
    for lab, v in dl.items():
        out[f"{lab}_logit"] = v
        out[f"{lab}_pp"] = 100 * total * v / tot_logit if abs(tot_logit) > 1e-12 else 0.0
    return out


def delta_value(cfg: Config, n: int, seed: int, pol_a: str, pol_b: str, weights: str) -> tuple[float, float]:
    """Mean and standard error of V(pol_a) - V(pol_b)."""
    run = run_config(cfg, n, seed, policies=[pol_a, pol_b], record=False)
    v = payoffs.aggregate(run.results[pol_a].comps - run.results[pol_b].comps, cfg.weights[weights])
    return float(v.mean()), float(v.std(ddof=1) / np.sqrt(n))


def break_even_surface(cfg: Config, n: int, seed: int, pol_a: str, pol_b: str, weights: str,
                       x: tuple[str, list], y: tuple[str, list], extra: dict | None = None) -> pd.DataFrame:
    """V(pol_a) - V(pol_b) over a grid of two parameters. The zero contour is the break-even line."""
    rows = []
    for xv in x[1]:
        for yv in y[1]:
            c = cfg.with_overrides({**(extra or {}), x[0]: xv, y[0]: yv})
            m, se = delta_value(c, n, seed, pol_a, pol_b, weights)
            rows.append({x[0]: xv, y[0]: yv, "delta_value": m, "se": se})
    return pd.DataFrame(rows)


def tornado(cfg: Config, n: int, seed: int, pol_a: str, pol_b: str, weights: str,
            names: list[str] | None = None) -> pd.DataFrame:
    """One-at-a-time sensitivity: V(pol_a) - V(pol_b) with each parameter at its low and high bound."""
    base, _ = delta_value(cfg, n, seed, pol_a, pol_b, weights)
    rows = []
    for name, p in cfg.params.items():
        if not p.has_range or (names and name not in names):
            continue
        lo, _ = delta_value(cfg.with_overrides({name: p.low}), n, seed, pol_a, pol_b, weights)
        hi, _ = delta_value(cfg.with_overrides({name: p.high}), n, seed, pol_a, pol_b, weights)
        rows.append({"parameter": name, "group": p.group, "low": p.low, "high": p.high,
                     "delta_at_low": lo, "delta_at_high": hi, "base": base,
                     "swing": abs(hi - lo), "sign_flip": (lo > 0) != (hi > 0)})
    return pd.DataFrame(rows).sort_values("swing", ascending=False).reset_index(drop=True)


def _bin_means(x: np.ndarray, y: np.ndarray, bins: int) -> tuple[np.ndarray, np.ndarray]:
    order = np.argsort(x, kind="stable")
    groups = np.array_split(order, bins)
    return np.array([y[g].mean() for g in groups]), np.array([len(g) for g in groups])


def global_sensitivity(run: Run, pol_a: str, pol_b: str, weights: str, bins: int = 20) -> pd.DataFrame:
    """Given-data first-order sensitivity and value of information.

    Requires a configuration with sampled parameters. For each sampled parameter:

    * ``first_order``: Var(E[dV | x]) / Var(dV), estimated by quantile bins (a first-order
      Sobol index that stays valid with correlated inputs as a correlation ratio);
    * ``evppi``: expected value of learning that parameter before choosing between the
      two policies, E[max(E[dV | x], 0)] - max(E[dV], 0), in the units of dV.
    """
    dv = payoffs.aggregate(run.results[pol_a].comps - run.results[pol_b].comps, run.cfg.weights[weights])
    var, mean = dv.var(), dv.mean()
    rows = []
    for name, p in run.cfg.params.items():
        x = run.p[name]
        if not isinstance(x, np.ndarray):
            continue
        m, cnt = _bin_means(x, dv, bins)
        wts = cnt / cnt.sum()
        rows.append({"parameter": name, "group": p.group,
                     "first_order": float(np.sum(wts * (m - mean) ** 2) / var) if var > 0 else 0.0,
                     "evppi": float(np.sum(wts * np.maximum(m, 0.0)) - max(mean, 0.0)),
                     "corr": float(np.corrcoef(x, dv)[0, 1])})
    out = pd.DataFrame(rows)
    return out.sort_values("first_order", ascending=False).reset_index(drop=True) if len(out) else out


def interaction(run: Run, pol_a: str, pol_b: str, weights: str, x: str, y: str, bins: int = 5) -> pd.DataFrame:
    """Mean dV on a two-parameter quantile grid, to expose interactions and non-monotone cases."""
    dv = payoffs.aggregate(run.results[pol_a].comps - run.results[pol_b].comps, run.cfg.weights[weights])
    qx = pd.qcut(run.p[x], bins, labels=False, duplicates="drop")
    qy = pd.qcut(run.p[y], bins, labels=False, duplicates="drop")
    df = pd.DataFrame({x: qx, y: qy, "dv": dv})
    return df.groupby([x, y])["dv"].mean().unstack()


def regret_table(tables: list[pd.DataFrame]) -> pd.DataFrame:
    """Regret of each policy in each (config, weights) cell, and its maximum across cells."""
    t = pd.concat(tables, ignore_index=True)
    t["cell"] = t["config"] + " / " + t["weights"]
    wide = t.pivot(index="policy", columns="cell", values="delta_value")
    regret = wide.max(axis=0) - wide
    regret["max_regret"] = regret.max(axis=1)
    regret["mean_regret"] = regret.drop(columns="max_regret").mean(axis=1)
    return regret.sort_values("max_regret")


def pareto_front(table: pd.DataFrame) -> pd.DataFrame:
    """Policies not dominated across weight sets within one configuration."""
    wide = table.pivot(index="policy", columns="weights", values="delta_value")
    vals = wide.to_numpy()
    keep = []
    for i in range(len(vals)):
        dominated = any(np.all(vals[j] >= vals[i]) and np.any(vals[j] > vals[i])
                        for j in range(len(vals)) if j != i)
        keep.append(not dominated)
    wide["pareto"] = keep
    return wide


def strategic_game(cfg: Config, n: int, seed: int, us_weights: str) -> dict:
    """A coarse normal-form game: US policies against Chinese stances.

    US payoffs come from the analyst's model under ``us_weights``. China's payoffs come
    from the same model with ``china_beliefs`` substituted, under ``china_objective``:
    China optimises against its own beliefs, not the analyst's. Each cell reports the
    gain either side could make by deviating alone; a cell where both gains are zero is a
    pure-strategy equilibrium *of this grid*. Best-response iteration is reported too,
    with no claim of existence, uniqueness or convergence.
    """
    pols, stances = list(cfg.policies), list(cfg.stances)
    cn_cfg = cfg.with_overrides(cfg.china_beliefs)
    U = np.zeros((len(pols), len(stances)))
    C = np.zeros_like(U)
    for j, st in enumerate(stances):
        stance = {k: float(cfg.stances[st][k]) for k in ("indig", "conf")}
        ru = run_config(cfg, n, seed, stance=stance, record=False)
        rc = run_config(cn_cfg, n, seed, stance=stance, record=False)
        for i, pol in enumerate(pols):
            U[i, j] = payoffs.aggregate(ru.results[pol].comps, cfg.weights[us_weights]).mean()
            C[i, j] = payoffs.aggregate(rc.results[pol].comps, cfg.china_objective).mean()
    i0, j0 = pols.index(cfg.reference_policy), stances.index("rule")
    U, C = U - U[i0, j0], C - C[i0, j0]
    us_gain = U.max(axis=0, keepdims=True) - U   # US gain from switching policy
    cn_gain = C.max(axis=1, keepdims=True) - C   # China's gain from switching stance
    path, i, j = [(pols[i0], stances[j0])], i0, j0
    for _ in range(12):
        j = int(C[i].argmax())
        i = int(U[:, j].argmax())
        step = (pols[i], stances[j])
        if step == path[-1]:
            break
        path.append(step)
    eq = [(pols[a], stances[b]) for a in range(len(pols)) for b in range(len(stances))
          if us_gain[a, b] < 1e-9 and cn_gain[a, b] < 1e-9]
    return {"policies": pols, "stances": stances, "us": U, "cn": C, "us_gain": us_gain,
            "cn_gain": cn_gain, "equilibria": eq, "path": path,
            "converged": len(path) < 13 and us_gain[i, j] < 1e-9 and cn_gain[i, j] < 1e-9}


def lead_paths(cfg: Config) -> dict:
    """Imposed US:China training-compute ratio paths for the reduced-form lead stress test."""
    t = np.arange(cfg.n_years)
    yr = np.array(cfg.years)
    return {
        "large_5y": np.where(yr <= 2031, 12.0, np.maximum(12.0 * 0.6 ** (yr - 2031), 1.5)),
        "ge10_to_2035": np.where(yr <= 2035, 10.0, np.maximum(10.0 * 0.75 ** (yr - 2035), 1.5)),
        "ge2_through_2040s": np.where(yr <= 2035, 10.0, np.maximum(10.0 * 0.85 ** (yr - 2035), 2.0)),
        "fast_erosion": np.maximum(8.0 * 0.7 ** t, 1.3),
    }


def lead_path_stress(cfg: Config, n: int, seed: int, policy: str, weights: str,
                     against: str = "fast_erosion") -> pd.DataFrame:
    """Value of each imposed lead path relative to the ``against`` path, holding policy fixed.

    This isolates how much a given compute-lead path is worth downstream, separately from
    whether any policy can produce it.
    """
    p = sample_params(cfg, n, seed)
    calib = calibrate(cfg, p, n, seed)
    paths = lead_paths(cfg)
    sims = {k: simulate(cfg, p, cfg.policies[policy], n, seed, calib, lead_path=v, record=False)
            for k, v in paths.items()}
    base = sims[against].comps
    rows = []
    for k, r in sims.items():
        v = payoffs.aggregate(r.comps - base, cfg.weights[weights])
        row = {"lead_path": k, "delta_value": v.mean(), "se": v.std(ddof=1) / np.sqrt(n)}
        row.update({g: gv.mean() for g, gv in group_values(r.comps - base, cfg.weights[weights]).items()})
        rows.append(row)
    return pd.DataFrame(rows)


def two_world_toy(p_decisive: float, du_decisive: float, du_nondecisive: float, common_cost: float) -> dict:
    """The teaching device: a world type held fixed across the two policies.

    It is not a decomposition of the full model, where policy changes arrival and outcomes.
    """
    ev = p_decisive * du_decisive + (1 - p_decisive) * du_nondecisive - common_cost
    denom = du_decisive - du_nondecisive
    return {"delta_ev": ev, "break_even_p": (common_cost - du_nondecisive) / denom if denom else float("nan")}


def calibration_report(run: Run) -> pd.DataFrame:
    """Emergent quantities set beside the calibration targets they should be compared with.

    These are outputs of the response, industrial and hazard modules. They are checks on
    the parameter choices, never imposed as effects.
    """
    cfg, yrs, R = run.cfg, run.cfg.years, run.results
    ref = cfg.reference_policy
    i30, i35, i40 = yrs.index(2030), yrs.index(2035), yrs.index(2040)
    med = lambda pol, k, i: float(np.median(R[pol].series[k][i]))
    mean = lambda pol, k, i: float(R[pol].series[k][i].mean())
    target = lambda k: float(np.mean(run.p[k]))
    rows = [
        ("P(transformative AI by 2035), reference policy", run.calib.p_tai_2035, target("p_tai_2035"), "target, solved"),
        ("P(first war by 2040), reference policy, event-free path", run.calib.war_2040, target("war_base_2040"), "target, solved"),
        ("US:China installed-capacity ratio 2027, reference (median)", med(ref, "ratio_stock", 1), "9 to 13", "IFP end-2026 to end-2027"),
        ("Capability lag 2026, years", mean(ref, "lag_years", 0), "0.5 to 0.6", "Epoch ECI, about 7 months"),
        ("Domestic share of Chinese additions 2026", mean(ref, "dom_share", 0), "0.5 to 0.65", "IDC and TrendForce shares"),
    ]
    if "relax_chips" in R:
        rows.append(("Extra domestic adoption 2030 from keeping chip controls, pp",
                     100 * (mean(ref, "dom_share", i30) - mean("relax_chips", "dom_share", i30)), "+20 (0 to +50)", "brief's exploratory target"))
        rows.append(("US:China training-compute ratio 2030: reference vs chips relaxed",
                     f"{med(ref, 'ratio_train', i30):.1f} vs {med('relax_chips', 'ratio_train', i30):.1f}", "", "emergent"))
    # Input channel in isolation: ease HBM and SME only, keep chip controls, so that the
    # captive demand for domestic chips is the same in both runs.
    sq = cfg.status_quo
    inputs_only = {"type": "fixed", "x": [sq[0], 0.1, 0.2, sq[3], sq[4]]}
    alt = simulate(cfg, run.p, inputs_only, run.n, run.seed, run.calib)
    rows.append(("Domestic output 2035 lost to SME/HBM limits, chip controls held fixed, %",
                 100 * (1 - mean(ref, "Q_dom", i35) / float(alt.series["Q_dom"][i35].mean())),
                 "40 (0 to 80)", "brief's exploratory target"))
    if "broad_relax" in R:
        w = lambda pol: float((R[pol].events["t_war"] <= i40).mean())
        rows.append(("Marginal cumulative war probability by 2040, controls vs broad relaxation, pp",
                     100 * (w(ref) - w("broad_relax")), "+0.5 (-2 to +4)", "brief's exploratory target"))
    for y in (2028, 2032, 2036, 2040, 2045, 2049):
        rows.append((f"US:China installed-capacity ratio {y}, reference (median)", med(ref, "ratio_stock", yrs.index(y)), "", "emergent"))
    for y in (2030, 2036, 2045):
        rows.append((f"US:China training-compute ratio {y}, reference (median)", med(ref, "ratio_train", yrs.index(y)), "", "emergent"))
    return pd.DataFrame(rows, columns=["quantity", "model", "target_or_anchor", "note"])
