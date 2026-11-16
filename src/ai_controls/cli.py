"""Command line interface.

    python -m ai_controls.cli compare --configs configs/fox_continuous.yaml \
        configs/erich_decisive.yaml configs/agnostic_wide.yaml --runs 10000 --seed 42

Every command writes into one output folder (``outputs/latest`` by default) and
overwrites what was there, so results never accumulate.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import analysis as A
from . import parameters, plots
from .parameters import load_config
from .state import COMPONENTS, GROUPS, REGIMES, REGIME_LABELS, SERIES, STREAMS, X_DIMS, R_WEIGHTS

TRAJECTORY_SERIES = ("ratio_stock", "ratio_train", "lag_years", "C_us", "C_cn", "S_us", "S_cn",
                     "logA_us", "logA_cn", "O", "T", "I", "h_war", "h_cat", "b_cn")
INDIGENISATION_SERIES = ("imports", "dom_add", "dom_share", "pref", "K_logic", "K_hbm", "K_sme",
                         "K_soft", "Q_dom", "remote", "C_cn")


def _out(path: str) -> Path:
    out = Path(path)
    out.mkdir(parents=True, exist_ok=True)
    return out


def _fmt(df: pd.DataFrame) -> str:
    with pd.option_context("display.width", 220, "display.max_columns", 40,
                           "display.float_format", lambda v: f"{v:,.2f}"):
        return df.to_string(index=False)


def _series_table(run: A.Run, names) -> pd.DataFrame:
    frames = []
    for pol, res in run.results.items():
        for name in names:
            s = A.series_summary(res, name)
            s.insert(0, "series", name)
            s.insert(0, "policy", pol)
            frames.append(s)
    out = pd.concat(frames, ignore_index=True)
    out.insert(0, "config", run.cfg.name)
    return out


def cmd_compare(args) -> None:
    out = _out(args.out)
    tables, probs, wars, runs = [], [], [], []
    for path in args.configs:
        cfg = load_config(path)
        run = A.run_config(cfg, args.runs, args.seed)
        runs.append(run)
        tables.append(A.policy_table(run))
        probs.append(A.outcome_probs(run))
        for pol in run.results:
            if pol != cfg.reference_policy:
                wars.append({"config": cfg.name, **A.war_decomposition(run, cfg.reference_policy, pol)})
        _series_table(run, TRAJECTORY_SERIES).to_csv(out / f"trajectories_{cfg.name}.csv", index=False)
        _series_table(run, INDIGENISATION_SERIES).to_csv(out / f"indigenisation_{cfg.name}.csv", index=False)
        A.calibration_report(run).to_csv(out / f"calibration_{cfg.name}.csv", index=False)
        A.pareto_front(tables[-1]).to_csv(out / f"pareto_{cfg.name}.csv")
        parameters.export_csv(cfg, out / f"provenance_{cfg.name}.csv")
        if not args.no_plots:
            plots.trajectories(run, out / f"trajectories_{cfg.name}.png")
        n_grid = min(args.runs, args.grid_runs)
        grid = A.break_even_surface(cfg, n_grid, args.seed, cfg.reference_policy, args.versus, args.weights,
                                    ("p_high_dec", [0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]),
                                    ("p_persist10", [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]))
        grid.to_csv(out / f"breakeven_{cfg.name}.csv", index=False)
        if not args.no_plots:
            plots.break_even(grid, "p_high_dec", "p_persist10",
                             f"{cfg.label}: {cfg.reference_policy} minus {args.versus} ({args.weights})",
                             out / f"breakeven_{cfg.name}.png")
        A.lead_path_stress(cfg, n_grid, args.seed, cfg.reference_policy, args.weights).to_csv(
            out / f"lead_paths_{cfg.name}.csv", index=False)

    table = pd.concat(tables, ignore_index=True)
    prob = pd.concat(probs, ignore_index=True)
    table.to_csv(out / "policy_table.csv", index=False)
    prob.to_csv(out / "outcome_probs.csv", index=False)
    pd.DataFrame(wars).to_csv(out / "war_decomposition.csv", index=False)
    regret = A.regret_table(tables)
    regret.to_csv(out / "regret.csv")
    labels = {k: v["label"] for k, v in runs[0].cfg.policies.items()}
    if not args.no_plots:
        plots.decomposition(table, labels, out / "decomposition.png")
        plots.outcomes(prob, labels, out / "outcomes.png")

    print(f"\nPolicy value minus '{runs[0].cfg.reference_policy}' ($tn present value, paired across {args.runs} worlds)")
    wide = table.pivot(index="policy", columns=["config", "weights"], values="delta_value")
    with pd.option_context("display.width", 240, "display.float_format", lambda v: f"{v:,.1f}"):
        print(wide.reindex(list(runs[0].cfg.policies)).to_string())
    print("\nDecomposition under weights =", args.weights)
    print(_fmt(table[table.weights == args.weights][["config", "policy", "delta_value", "se", *GROUPS]]))
    print("\nOutcome probabilities (war and catastrophe overlap the regimes)")
    print(_fmt(prob[["config", "policy", *REGIMES, "war_by_2040", "war_by_2050", "catastrophe"]]))
    print("\nMaximum regret across configs and weight sets ($tn)")
    print(_fmt(regret[["max_regret", "mean_regret"]].reset_index()))
    for run in runs:
        print(f"\nCalibration check: {run.cfg.label}")
        print(_fmt(A.calibration_report(run)))
    print(f"\nWrote tables, figures and provenance to {out.resolve()}")


def cmd_provenance(args) -> None:
    cfg = load_config(args.config)
    out = _out(args.out)
    parameters.export_csv(cfg, out / f"provenance_{cfg.name}.csv")
    parameters.export_json(cfg, out / f"provenance_{cfg.name}.json")
    df = pd.DataFrame(parameters.provenance_rows(cfg))
    print(_fmt(df[["name", "group", "value", "low", "high", "status", "source"]]))
    print("\nBy status:", df["status"].value_counts().to_dict())


def cmd_tornado(args) -> None:
    cfg = load_config(args.config)
    t = A.tornado(cfg, args.runs, args.seed, cfg.reference_policy, args.versus, args.weights)
    t.to_csv(_out(args.out) / f"tornado_{cfg.name}.csv", index=False)
    print(f"{cfg.reference_policy} minus {args.versus}, weights = {args.weights}; base = {t['base'].iloc[0]:.2f}")
    print(_fmt(t.head(args.top)))


def cmd_sensitivity(args) -> None:
    cfg = load_config(args.config)
    if not any(p.sampled for p in cfg.params.values()):
        raise SystemExit("Global sensitivity needs a configuration with sampled parameters (e.g. agnostic_wide.yaml).")
    run = A.run_config(cfg, args.runs, args.seed, policies=[cfg.reference_policy, args.versus], record=False)
    g = A.global_sensitivity(run, cfg.reference_policy, args.versus, args.weights)
    g.to_csv(_out(args.out) / f"sensitivity_{cfg.name}.csv", index=False)
    print(f"{cfg.reference_policy} minus {args.versus}, weights = {args.weights}")
    print(_fmt(g.head(args.top)))
    top = g["parameter"].head(2).tolist()
    if len(top) == 2:
        print(f"\nInteraction of {top[0]} and {top[1]} (mean value difference by quantile cell)")
        print(A.interaction(run, cfg.reference_policy, args.versus, args.weights, top[0], top[1]).round(1).to_string())


def cmd_game(args) -> None:
    cfg = load_config(args.config)
    g = A.strategic_game(cfg, args.runs, args.seed, args.weights)
    pols, st = g["policies"], g["stances"]
    out = _out(args.out)
    for key in ("us", "cn", "us_gain", "cn_gain"):
        pd.DataFrame(g[key], index=pols, columns=st).to_csv(out / f"game_{key}_{cfg.name}.csv")
    with pd.option_context("display.float_format", lambda v: f"{v:,.1f}"):
        print("US payoff (rows: US policy, columns: China's stance), relative to maintain/rule")
        print(pd.DataFrame(g["us"], index=pols, columns=st).to_string())
        print("\nChina's payoff under China's own beliefs and objective")
        print(pd.DataFrame(g["cn"], index=pols, columns=st).to_string())
    print("\nPure-strategy equilibria of this grid:", g["equilibria"] or "none")
    print("Best-response path from maintain/rule:", " -> ".join(f"{a}/{b}" for a, b in g["path"]), "(converged)" if g["converged"] else "(did not converge)")
    print("This is an equilibrium of a coarse, assumed game, not of the real one.")


def cmd_stress(args) -> None:
    cfg = load_config(args.config)
    rows = []
    for name, sc in cfg.scenarios.items():
        c = cfg.with_overrides(sc["overrides"], name=name)
        run = A.run_config(c, args.runs, args.seed, policies=["maintain", "relax_chips", "broad_relax"])
        i40 = c.years.index(2040)
        k = lambda pol, s: float(run.results[pol].series[s][i40].mean())
        war = lambda pol: float((run.results[pol].events["t_war"] <= i40).mean())
        e = run.results["maintain"].events
        rows.append({"scenario": name,
                     "dK_logic_2040_controls": k("maintain", "K_logic") - k("relax_chips", "K_logic"),
                     "dK_soft_2040_controls": k("maintain", "K_soft") - k("relax_chips", "K_soft"),
                     "dK_logic_2040_controls_vs_broad": k("maintain", "K_logic") - k("broad_relax", "K_logic"),
                     "dK_sme_2040_controls_vs_broad": k("maintain", "K_sme") - k("broad_relax", "K_sme"),
                     "dwar_2040_pp_controls_vs_broad": 100 * (war("maintain") - war("broad_relax")),
                     "p_arrival": float(e["arrived"].mean()),
                     "p_durable_lead": float(np.isin(e["regime"], ["us_durable", "cn_durable"]).mean()),
                     "p_cn_first": float((e["arrived"] & (e["leader"] == 2)).mean())})
    df = pd.DataFrame(rows)
    df.to_csv(_out(args.out) / "stress_tests.csv", index=False)
    print(_fmt(df))


def cmd_export_web(args) -> None:
    """Write web/params.js: the same registry, policies and weights the site runs on."""
    configs = {}
    for path in args.configs:
        cfg = load_config(path)
        configs[cfg.name] = {
            "label": cfg.label, "description": cfg.description, "sampling": cfg.sampling,
            "values": [p.value for p in cfg.params.values()],
            "low": [p.low for p in cfg.params.values()],
            "high": [p.high for p in cfg.params.values()],
            "sampled": [bool(p.sampled and p.has_range) for p in cfg.params.values()],
        }
    base = load_config(Path(args.configs[0]).parent / "baseline.yaml")
    data = {
        "start_year": base.start_year, "end_year": base.end_year,
        "reference_policy": base.reference_policy, "status_quo": base.status_quo,
        "factors": base.factors,
        "params": [{"name": p.name, "group": p.group, "def": p.definition, "units": p.units,
                    "status": p.status, "value": p.value, "low": p.low, "high": p.high,
                    "dist": p.dist, "factor": p.factor, "loading": p.loading,
                    "src": [s for s in p.source.split(",") if s], "ui": p.ui}
                   for p in base.params.values()],
        "policies": base.policies, "stances": base.stances, "weights": base.weights,
        "china_objective": base.china_objective, "china_beliefs": base.china_beliefs,
        "sources": base.sources, "configs": configs,
        "streams": STREAMS, "series": list(SERIES), "components": list(COMPONENTS),
        "groups": {k: list(v) for k, v in GROUPS.items()},
        "regimes": list(REGIMES), "regime_labels": REGIME_LABELS,
        "x_dims": list(X_DIMS), "r_weights": list(R_WEIGHTS),
    }
    target = Path(args.out)
    target.write_text("// Generated by `python -m ai_controls.cli export-web` from configs/*.yaml. Do not edit by hand.\n"
                      "var AIC_DATA = " + json.dumps(data, separators=(",", ":")) + ";\n"
                      "if (typeof window !== 'undefined') window.AIC_DATA = AIC_DATA;\n"
                      "if (typeof module !== 'undefined') module.exports = AIC_DATA;\n")
    print(f"Wrote {target} ({target.stat().st_size / 1024:.0f} kB)")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="ai-controls", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, config=True):
        if config:
            p.add_argument("--config", default="configs/baseline.yaml")
        p.add_argument("--runs", type=int, default=4000)
        p.add_argument("--seed", type=int, default=42)
        p.add_argument("--out", default="outputs/latest")
        p.add_argument("--weights", default="global", help="normative weight set for single-number summaries")
        p.add_argument("--versus", default="relax_chips", help="policy compared with the reference policy")
        p.add_argument("--top", type=int, default=20)

    p = sub.add_parser("compare", help="compare every policy under one or more worldview configs")
    p.add_argument("--configs", nargs="+", required=True)
    p.add_argument("--no-plots", action="store_true")
    p.add_argument("--grid-runs", type=int, default=2000, help="simulations per break-even grid cell")
    common(p, config=False)
    p.set_defaults(func=cmd_compare)

    for name, func, helptext in (
        ("provenance", cmd_provenance, "list every assumption with its status and source"),
        ("tornado", cmd_tornado, "one-at-a-time sensitivity of a policy difference"),
        ("sensitivity", cmd_sensitivity, "global sensitivity and value of information (sampled configs)"),
        ("game", cmd_game, "coarse US-policy by China-stance game with deviation gains"),
        ("stress", cmd_stress, "extreme but coherent counterfactuals"),
    ):
        p = sub.add_parser(name, help=helptext)
        common(p)
        p.set_defaults(func=func)
    sub.choices["stress"].set_defaults(config="configs/stress_tests.yaml")

    p = sub.add_parser("export-web", help="write web/params.js for the interactive site")
    p.add_argument("--configs", nargs="+", default=["configs/baseline.yaml", "configs/fox_continuous.yaml",
                                                    "configs/erich_decisive.yaml", "configs/agnostic_wide.yaml"])
    p.add_argument("--out", default="web/params.js")
    p.set_defaults(func=cmd_export_web)

    args = ap.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
