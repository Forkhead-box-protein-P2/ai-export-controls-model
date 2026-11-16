"""The lean, outcome-level model and the layer that derives its defaults from the engine.

Advantage of controls over an alternative policy, in present-value trillions of 2026
dollars under a chosen value set:

    lead     = p_dec * V_m * sum_t f(t) * dL(t)
    safety   = K_cat * (c0 / p_arrive) * sum_t f(t) * min(r * dL(t), 1)
    costs    = (y_cost + open_cost) * F
    war      = -(d_war / 100) * K_war
    net      = lead + safety - costs + war

* dL(t) = k * log10(m) * 2^(-(t-1)/max(H - b, 0.25)) months of extra US capability lead
  in year 2026 + t (t >= 1; controls bite from 2027);
* f(t) is the probability that the transition arrives in year 2026 + t, from
  P(arrival by 2035) and P(no sharp transition by 2050);
* F is the discounted number of years the yearly costs are paid (2027-2050 at 3%).

The engine (``simulation.py``) is the derivation layer. ``derive`` runs it for one
worldview and returns every lean number with the engine quantity it comes from.
World-level value scalars (V_m, r) are calibrated on Maintain vs Relax chips only;
``validate`` then checks the lean formula on the other policy pairs.
"""
from __future__ import annotations

import math

import numpy as np

from . import analysis as A
from . import payoffs
from .state import COMPONENTS

DISCOUNT = 0.03
YEARS = 25  # 2026..2050
F_YEARS = sum((1 + DISCOUNT) ** -t for t in range(1, YEARS))
PAIRS = (("maintain", "relax_chips"), ("maintain", "relax_chips_hbm"), ("maintain", "selective"),
         ("maintain", "broad_relax"), ("tighten", "maintain"))
REF_PAIR = PAIRS[0]
# Neutralises the captive-market channels: adoption, and therefore adoption-driven
# learning, no longer depend on whether US chips are on offer.
CAPTIVE_OFF = {"mandate_erosion": 0.0, "pref_dq": 0.0, "lab_sens": 0.0, "rev_rd": 0.0}

LEAN_PARAMS = (
    # name, label, units, block
    ("m", "Compute multiple controls buy", "×", "Lead bought"),
    ("k", "Months of capability lead per 10× compute", "months", "Lead bought"),
    ("H", "Half-life of the effect", "years", "Lead bought"),
    ("b", "Years of it lost to forced Chinese learning", "years", "Lead bought"),
    ("p35", "P(transformative AI by 2035)", "probability", "Timing"),
    ("p_none", "P(no sharp transition by 2050)", "probability", "Timing"),
    ("p_dec", "P(decisive)", "probability", "Worth of a lead"),
    ("V_m", "Value of a month of durable lead", "$tn", "Worth of a lead"),
    ("c0", "Base catastrophe probability", "probability", "Worth of a lead"),
    ("r", "Catastrophe risk cut per month of lead", "share", "Worth of a lead"),
    ("K_cat", "Cost of a catastrophe", "$tn", "Worth of a lead"),
    ("y", "Lost AI output, trade and integration per year", "$tn/yr", "Yearly cost of controls"),
    ("o", "Openness lost per year", "$tn/yr", "Yearly cost of controls"),
    ("d_war", "Change in war risk by 2050", "pp", "Yearly cost of controls"),
    ("K_war", "Cost of a great-power war", "$tn", "Yearly cost of controls"),
)


def arrival_density(p35: float, p_none: float) -> np.ndarray:
    """P(transition arrives in year 2026 + t), t = 0..24, from F(t) = A (1 - exp(-lam t)).

    F(10) = p35 (by end-2035) and F(25) = 1 - p_none (by end-2050). A negative lam gives
    a rising hazard when arrival is back-loaded.
    """
    p50 = max(1.0 - p_none, 1e-9)
    q = min(max(p35 / p50, 1e-6), 1.0 - 1e-9)
    g = lambda lam: (10.0 / 25.0 if abs(lam) < 1e-9 else (1 - math.exp(-10 * lam)) / (1 - math.exp(-25 * lam)))
    lo, hi = -2.0, 6.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if g(mid) < q:
            lo = mid
        else:
            hi = mid
    lam = 0.5 * (lo + hi)
    F = lambda t: p50 * (t / 25.0 if abs(lam) < 1e-9 else (1 - math.exp(-lam * t)) / (1 - math.exp(-25 * lam)))
    return np.array([F(t + 1) - F(t) for t in range(YEARS)])


def lead_path(p: dict) -> np.ndarray:
    """Extra months of US capability lead in each year 2026..2050."""
    L1 = p["k"] * math.log10(max(p["m"], 1e-9))
    He = max(p["H"] - p["b"], 0.25)
    t = np.arange(YEARS)
    return np.where(t >= 1, L1 * 0.5 ** ((t - 1) / He), 0.0)


def evaluate(p: dict) -> dict:
    """Net advantage of controls and its terms, in $tn."""
    f, dL = arrival_density(p["p35"], p["p_none"]), lead_path(p)
    p_arr = max(1.0 - p["p_none"], 1e-9)
    lead = p["p_dec"] * p["V_m"] * float((f * dL).sum())
    safety = p["K_cat"] * p["c0"] / p_arr * float((f * np.clip(p["r"] * dL, -1.0, 1.0)).sum())
    costs = (p["y"] + p["o"]) * F_YEARS
    war = -p["d_war"] / 100.0 * p["K_war"]
    return {"lead": lead, "safety": safety, "output": -p["y"] * F_YEARS, "openness": -p["o"] * F_YEARS,
            "war": war, "net": lead + safety - costs + war}


# ---------------------------------------------------------------- derivation layer
def _months(run, a, b):
    return 12.0 * (run.results[a].series["lag_years"] - run.results[b].series["lag_years"]).mean(axis=1)


def _half_life(path):
    pos = np.clip(path[1:], 0.0, None)
    peak = pos.max()
    return float(math.log(2) * pos.sum() / peak) if peak > 1e-9 else 0.0


def _cum(series, key, upto=None):
    h = series[key] if upto is None else series[key][: upto + 1]
    return float((1.0 - np.prod(1.0 - h, axis=0)).mean())


def derive(cfg, n: int = 3000, seed: int = 42) -> dict:
    """Run the engine for one worldview and return the lean defaults and their sources."""
    run = A.run_config(cfg, n, seed)
    off = A.run_config(cfg.with_overrides(CAPTIVE_OFF), n, seed, policies=sorted({x for pr in PAIRS for x in pr}))
    P = {k: float(np.mean(v)) for k, v in run.p.items()}
    g_w = P["g_w_inf"] + (P["g_w0"] - P["g_w_inf"]) * 0.5 ** (4 / P["g_w_halflife"])
    k = 12.0 * P["alpha_T"] * math.log(10) / (P["alpha_T"] * g_w + P["g_alg"])
    ref = run.results[cfg.reference_policy]
    p_none = 1.0 - float(ref.events["arrived"].mean())
    world = {"k": k, "p35": run.calib.p_tai_2035, "p_none": p_none, "p_dec": P["p_high_dec"],
             "c0": _cum(ref.series, "cat_raw")}
    f = arrival_density(world["p35"], world["p_none"])
    pairs = {}
    for a, b in PAIRS:
        lr = np.log(run.results[a].series["ratio_train"] / run.results[b].series["ratio_train"]).mean(axis=1)
        m = float(math.exp(lr[1:].max()))  # peak multiple; the engine lead builds for years
        H_full, H_off = _half_life(_months(run, a, b)), _half_life(_months(off, a, b))
        d = run.results[a].comps - run.results[b].comps
        sa, sb = run.results[a].series, run.results[b].series
        pr = {"m": m, "H": H_off, "b": H_off - H_full, "d_war": 100 * (_cum(sa, "h_war") - _cum(sb, "h_war")),
              "engine_months": _months(run, a, b).tolist(), "dPcat": _cum(sa, "cat_raw") - _cum(sb, "cat_raw"),
              "by_weights": {}}
        for wn, w in cfg.weights.items():
            gv = {g: float(v.mean()) for g, v in A.group_values(d, w).items()}
            wv = payoffs.weight_vector(w)
            cat_idx = [i for i, c in enumerate(COMPONENTS) if c.startswith("cat_")]
            war_idx = [i for i, c in enumerate(COMPONENTS) if c.startswith("war_")]
            loss = lambda idx: -float((run.results[b].comps[:, idx] @ wv[idx]).mean())
            pcat_b, pwar_b = _cum(sb, "cat_raw"), _cum(sb, "h_war")
            pr["by_weights"][wn] = {
                "y": -(gv["Economics"] + gv["Integration"]) / F_YEARS, "o": -gv["Openness"] / F_YEARS,
                "K_cat": loss(cat_idx) / max(pcat_b, 1e-9), "K_war": loss(war_idx) / max(pwar_b, 1e-9),
                "engine": {"lead": gv["Durable lead"] + gv["Security"], "safety": gv["AI safety"],
                           "output": gv["Economics"] + gv["Integration"], "openness": gv["Openness"],
                           "war": gv["Conflict"], "net": float(sum(gv.values()))},
            }
        pairs[f"{a}|{b}"] = pr
    # World-level value scalars, calibrated on the reference pair only.
    refp = pairs["|".join(REF_PAIR)]
    S_ref = float((f * lead_path({**world, **refp})).sum())
    # r is calibrated on the safety value (global weights), not on the probability change
    # alone, so it absorbs the timing of catastrophes as well as their probability.
    gl = refp["by_weights"]["global"]
    denom = gl["K_cat"] * world["c0"] / max(1 - p_none, 1e-9) * S_ref
    world["r"] = gl["engine"]["safety"] / denom if abs(denom) > 1e-12 else 0.0
    world["V_m"] = {wn: refp["by_weights"][wn]["engine"]["lead"] / max(world["p_dec"] * S_ref, 1e-12)
                    for wn in cfg.weights}
    return {"config": cfg.name, "label": cfg.label, "world": world, "pairs": pairs, "n": n, "seed": seed}


def lean_params(d: dict, pair: str, weights: str) -> dict:
    w, pr = d["world"], d["pairs"][pair]
    bw = pr["by_weights"][weights]
    return {"m": pr["m"], "k": w["k"], "H": pr["H"], "b": pr["b"], "p35": w["p35"], "p_none": w["p_none"],
            "p_dec": w["p_dec"], "V_m": w["V_m"][weights], "c0": w["c0"], "r": w["r"], "K_cat": bw["K_cat"],
            "y": bw["y"], "o": bw["o"], "d_war": pr["d_war"], "K_war": bw["K_war"]}


def validate(d: dict) -> list[dict]:
    """Lean formula with derived defaults against the engine, per pair and weight set.

    The yearly-cost terms are taken from the engine per pair, so they match by
    construction; the test is whether the lead and safety terms, with value scalars
    calibrated on Maintain vs Relax chips, carry over to the other pairs.
    """
    rows = []
    for pair, pr in d["pairs"].items():
        for wn, bw in pr["by_weights"].items():
            le, en = evaluate(lean_params(d, pair, wn)), bw["engine"]
            rows.append({"config": d["config"], "pair": pair, "weights": wn, "calibration_pair": pair == "|".join(REF_PAIR),
                         "engine_net": en["net"], "lean_net": le["net"],
                         "engine_lead_safety": en["lead"] + en["safety"], "lean_lead_safety": le["lead"] + le["safety"],
                         "engine_war": en["war"], "lean_war": le["war"],
                         "rel_error": (le["net"] - en["net"]) / max(abs(en["net"]), 1e-9)})
    return rows
