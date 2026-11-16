"""China's domestic accelerator industry: output, capacity expansion, and learning.

Indigenisation is tracked as three separate things: adoption (``compute.market``),
know-how (the K indices updated here) and manufacturing output (``output``).
"""
from __future__ import annotations

import numpy as np

# Nominal constants used only to scale the initial stock of SME experience.
SME_EXP_GROWTH0 = 0.25
SME_EXP_SHARE0 = 0.8
HEADROOM = 1.2  # capacity that firms want relative to expected demand
OVERBUILD = 2.0  # extra capacity, as a multiple of demand, that a state-driven build-out tolerates


def sme_access(xs_eff, K_sme):
    """Share of desired equipment that fabs can obtain: foreign tools that are still
    permitted plus whatever domestic tools can substitute for the restricted ones."""
    return 1.0 - xs_eff * (1.0 - K_sme)


def yields(K, P):
    return P.yield_min + (P.yield_max - P.yield_min) * K


def chip_quality(K_logic, P):
    """Per-chip performance relative to the current Western frontier chip."""
    return np.exp(-P.q_gamma * (1.0 - K_logic))


def output(L, H, HS, Pk, K_logic, K_hbm, xh_eff, cu_chip, P):
    """Usable domestic accelerator supply.

    Every bottleneck is first expressed in chip-equivalents per year; final assembly
    yield is applied once; the result is converted to capacity units (standardised
    FLOP/s added per year) with the per-chip performance.
    """
    logic_out = L * yields(K_logic, P)
    hbm_dom = H * yields(K_hbm, P)
    hbm_gap = np.maximum(logic_out - hbm_dom, 0.0)
    hbm_imp = hbm_gap * (1.0 - xh_eff)
    hbm_draw = np.minimum(HS, np.maximum(hbm_gap - hbm_imp, 0.0))
    hbm_avail = hbm_dom + hbm_imp + hbm_draw
    chips = np.minimum(np.minimum(logic_out, hbm_avail), Pk) * P.final_yield
    q_chip = chip_quality(K_logic, P)
    return {
        "chips": chips, "Q_dom": chips * q_chip * cu_chip, "q_chip": q_chip,
        "logic_out": logic_out, "hbm_dom": hbm_dom, "hbm_draw": hbm_draw,
        "bind_hbm": (hbm_avail < np.minimum(logic_out, Pk)).astype(float),
    }


def expand(L, H, Pk, a_sme, y_rd, Dd, Q_dom, logic_out, hbm_dom, g_w, P):
    """Capacity growth for logic, HBM and packaging.

    Feasible growth is limited by equipment access and scaled by subsidy effort. Firms and
    the state build toward a capacity target that is a multiple of next year's expected
    demand for domestic chips: ``HEADROOM`` when investment is fully disciplined by demand
    (``util_pull`` = 1), rising to ``HEADROOM * (1 + OVERBUILD)`` when the state builds for
    strategic reasons regardless of sales (``util_pull`` = 0). HBM capacity follows the
    logic output it has to serve.
    """
    sub = np.maximum(y_rd, 1e-9) ** P.sub_beta
    feasible = a_sme ** P.eta_sme * sub
    target = HEADROOM * (1.0 + (1.0 - P.util_pull) * OVERBUILD) * Dd * np.exp(g_w)
    gL = np.minimum(P.g_cap_max * feasible, np.maximum(np.log(target / np.maximum(Q_dom, 1e-12)), 0.0))
    want_H = np.maximum(np.log(HEADROOM * logic_out * np.exp(gL) / np.maximum(hbm_dom, 1e-12)), 0.0)
    gH = np.minimum(P.g_hbm_max * feasible, want_H)
    return L * np.exp(gL), H * np.exp(gH), Pk * np.exp(P.g_pack * sub)


def learning_increment(E, new_E, E_scale, coeff):
    """Learning from cumulative experience. Zero new experience gives exactly zero."""
    return coeff * (np.log1p((E + new_E) / E_scale) - np.log1p(E / E_scale))


def update_knowhow(K, rd_coeff, rd_mult, tool, learn, spill_access, P):
    """K(t+1) = (1 - decay) K + R&D return + learning + spillovers, bounded to [0, k_cap].

    K is measured relative to a moving Western frontier, so decay is the frontier
    pulling away from a follower that stands still.
    """
    gap = 1.0 - K
    new = ((1.0 - P.k_decay) * K + rd_coeff * rd_mult * tool * gap + learn
           + P.spill_k * spill_access * gap)
    return np.clip(new, 0.0, P.k_cap)
