"""Capability, openness, the arrival of transformative AI, decisiveness and safety.

Arrival, first-mover lead, strategic decisiveness, persistence and safety are separate
objects. Arrival does not pick a winner: a transition can occur with no capture at all.
"""
from __future__ import annotations

import numpy as np

from . import rng

# Kumaraswamy shapes for the two decisiveness regimes (closed-form quantiles).
DEC_HIGH = (4.0, 1.2)   # mean about 0.77
DEC_LOW = (1.2, 5.0)    # mean about 0.19
ROW_API_GAP = 0.3       # nats by which closed-model access for third countries trails the frontier
PROX_SCALE = 1.0        # nats over which pre-arrival proximity ramps up
DURABLE_CAPTURE = 0.25  # capture share above which a lead counts as substantial
DURABLE_HALFLIFE = 10.0
TRANSIENT_CAPTURE = 0.08


def kumaraswamy(u, a, b):
    return (1.0 - (1.0 - u) ** (1.0 / b)) ** (1.0 / a)


def world_types(seed, sims, P, theta_med, U, Z):
    """Draw the world-type variables that are held fixed across policies."""
    u_none = U("no_threshold")
    theta = np.where(u_none < P.p_no_threshold, np.inf,
                     theta_med * np.exp(P.theta_sigma * Z("theta")))
    u_mix = U("dec_mix")
    u_val = U("dec_val")
    dec = np.where(u_mix < P.p_high_dec, kumaraswamy(u_val, *DEC_HIGH), kumaraswamy(u_val, *DEC_LOW))
    rho = P.dec_persist_corr
    z_p = rho * (-rng.invnorm(u_mix)) + np.sqrt(1.0 - rho * rho) * Z("persist")
    half_life = 10.0 * np.exp(P.persist_sigma * (z_p - rng.invnorm(1.0 - P.p_persist10)))
    return theta, dec, half_life


def capability(Tr_us, Tr_cn, Tr_us0, G_us, G_cn, P):
    """Frontier capability in nats above the 2026 US level.

    ``alpha_T`` is the capability return to training compute; G is algorithmic progress.
    A hardware ratio therefore maps to a capability gap only through alpha_T.

    China's algorithmic index is anchored to the lag observed in 2026, which is small for
    its compute deficit. Part of that efficiency is borrowed from the frontier (imitation,
    distillation, published research), and borrowed efficiency can keep a follower close
    but cannot carry it past the leader. So China's capability is its anchored value,
    held at least ``follow_floor`` behind the US, unless its intrinsic capability (US
    algorithms less ``intrinsic_gap``, at China's own compute) is higher.
    """
    logA_us = P.alpha_T * np.log(np.maximum(Tr_us, 1e-12) / Tr_us0) + G_us
    comp_cn = P.alpha_T * np.log(np.maximum(Tr_cn, 1e-12) / Tr_us0)
    anchored = np.minimum(comp_cn + G_cn, logA_us - P.follow_floor)
    intrinsic = comp_cn + G_us - P.intrinsic_gap
    return logA_us, np.maximum(anchored, intrinsic)


def openness(logA_us, logA_cn, T, b_cn, open_shock, P):
    """Open-weight frontier and the competitive-pressure index O in [0, 1].

    O combines US-origin and Chinese-origin open models: either one near the frontier
    raises it, and two independent sources raise it further. ``open_shock`` is a
    world-type draw for how far US-origin open models trail the closed frontier. Chinese
    labs release less openly as tension rises and as Beijing comes to see AI as decisive.
    """
    front = np.maximum(logA_us, logA_cn)
    open_us = logA_us - np.maximum(P.open_gap_us + open_shock, 0.0)
    open_cn = (logA_cn - P.open_lag_cn - P.open_lag_T * np.maximum(T - P.T0, 0.0)
               - P.open_lag_b * np.maximum(b_cn - P.b_cn0, 0.0))
    o_us = np.exp(-np.maximum(front - open_us, 0.0) / P.open_scale)
    o_cn = np.exp(-np.maximum(front - open_cn, 0.0) / P.open_scale)
    O = 1.0 - (1.0 - o_us) * (1.0 - o_cn)
    return front, np.maximum(open_us, open_cn), open_cn, O


def capture_share(dec, lead_years, O, distributed, P):
    """Share of contestable future returns the first mover can durably capture."""
    k = dec * (1.0 - np.exp(-lead_years / P.lead_conv)) * (1.0 - P.open_erode * O)
    return np.where(distributed, 0.0, np.clip(k, 0.0, 1.0))


def proximity(arrived, yrs_since, theta, front, P):
    """Closeness to the transition: ramps up before arrival, decays after it."""
    pre = np.exp(-np.maximum(theta - front, 0.0) / PROX_SCALE)
    post = 0.5 ** (yrs_since / P.cat_window)
    return np.where(arrived, post, pre)


def developer_proximity(crossed, t_cross, t, theta, logA, P):
    """One developer's exposure: rises as its own capability nears the threshold and decays
    with half-life ``cat_window`` after it crosses. A trailing developer is exposed too."""
    pre = np.exp(-np.maximum(theta - logA, 0.0) / PROX_SCALE)
    post = 0.5 ** (np.maximum(t - t_cross, 0) / P.cat_window)
    return np.where(crossed, post, pre)


def catastrophe_hazard(prox_us, prox_cn, lag_years, T, O, P, slack_on=1.0, race_on=1.0,
                       nat_on=1.0, open_on=1.0):
    """Annual hazard of an AI catastrophe, summed over the US and Chinese frontier developers.

    Each developer contributes in proportion to its own proximity to the transformative
    threshold. The leader's contribution falls with the slack its lead buys, but only to the
    extent that slack is spent on safety (``slack_used``; US labs racing each other spend
    little of it). A close race under tension raises both. Chinese development carries the
    multiplier ``cat_mult_cn`` (1 = no nationality difference). The ``*_on`` switches turn a
    channel off for the decomposition. Returns (total, US part, Chinese part).

    With the Chinese developer far from the threshold (prox_cn = 0), ``slack_used`` = 1 and
    the US ahead, this is the single-frontier hazard of earlier versions.
    """
    gap = np.abs(lag_years)
    slack = 1.0 - np.exp(-gap / P.safe_tau)
    race = np.exp(-gap / P.safe_tau) * (0.5 + 0.5 * T)
    cut = slack_on * P.lead_safety * P.slack_used * slack
    us_leads = lag_years >= 0
    common = (P.cat_base * (1.0 + race_on * P.race_risk * race)
              * np.maximum(1.0 + open_on * P.open_risk * O, 0.0))
    h_us = common * prox_us * np.where(us_leads, 1.0 - cut, 1.0)
    h_cn = common * prox_cn * np.where(us_leads, 1.0, 1.0 - cut) * (1.0 + nat_on * (P.cat_mult_cn - 1.0))
    return np.clip(h_us + h_cn, 0.0, 1.0), h_us, h_cn


def classify(arrived, leader, near_sim, distributed, kcap, half_life):
    """Map each simulated path to one outcome regime (war and catastrophe overlap these)."""
    out = np.full(arrived.shape, "no_sharp", dtype=object)
    durable = (kcap >= DURABLE_CAPTURE) & (half_life >= DURABLE_HALFLIFE)
    transient = (kcap >= TRANSIENT_CAPTURE) & ~durable
    led = arrived & ~near_sim & ~distributed
    out[arrived] = "no_monopoly"
    out[arrived & near_sim] = "near_simultaneous"
    out[arrived & distributed] = "distributed"
    out[led & (leader == 1) & transient] = "us_transient"
    out[led & (leader == 2) & transient] = "cn_transient"
    out[led & (leader == 1) & durable] = "us_durable"
    out[led & (leader == 2) & durable] = "cn_durable"
    return out
