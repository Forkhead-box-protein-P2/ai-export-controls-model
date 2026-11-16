"""Tension, interdependence, and the hazard of great-power war.

China's political claim on Taiwan sits in the baseline hazard (``th0`` and the
world-type shock). Export controls change the hazard only at the margin, through
channels with opposing signs, so the marginal effect can be stabilising or destabilising.
"""
from __future__ import annotations

import numpy as np

from .compute import sigmoid

WAR_TYPES = ("deny", "capture", "limited")
WAR_SEVERITY = {"deny": 1.0, "capture": 1.9, "limited": 0.3}


def taiwan_dependence(t, P):
    """US dependence on Taiwanese leading-edge fabrication, falling as capacity moves onshore."""
    return P.dep_tw0 * np.exp(-P.dep_tw_decay * t)


def war_logit_parts(T, I, b_cn, dep_tw, xc_eff, lag_years, P):
    """Policy-dependent contributions to the war logit, one per channel.

    * provocation: tension above its 2026 level;
    * strategic denial: China's incentive to deny the US Taiwanese chips, which needs a
      belief that AI is decisive, US dependence on Taiwan, and China's own exclusion
      from those chips;
    * deterrence: a US capability lead raises China's expected costs;
    * interdependence: trade ties raise the cost of confrontation.
    """
    part_T = P.th_T * (T - P.T0)
    part_sdi = P.th_sdi * b_cn * dep_tw * xc_eff
    part_det = -P.th_det * np.tanh(np.maximum(lag_years, 0.0) / P.det_tau)
    part_I = -P.th_I * (I - P.I0)
    return part_T, part_sdi, part_det, part_I


def war_hazard(th0, parts, shock):
    return sigmoid(th0 + parts[0] + parts[1] + parts[2] + parts[3] + shock)


def update_tension(T, R, y_ret, P):
    target = np.clip(P.t_floor + P.t_R * R + P.t_ret * y_ret, 0.0, 1.0)
    return T + P.t_adj * (target - T)


def update_interdependence(I, R, P):
    target = P.i_max * (1.0 - P.i_R * R)
    return I + P.i_adj * (target - I)


def war_type(u, P):
    """0 = deny US access (blockade or strike), 1 = capture operating fabs, 2 = limited clash."""
    return np.where(u < P.war_p_deny, 0, np.where(u < P.war_p_deny + P.war_p_capture, 1, 2))


def fab_loss(war, t, t_war, wtype, dep_tw_at_war, P):
    """Fraction of Western accelerator output lost while Taiwanese fabs are offline."""
    recovering = np.maximum(1.0 - (t - t_war) / P.fab_recovery, 0.0)
    hit = war & (wtype != 2) & (t >= t_war)
    return np.where(hit, P.war_fab_loss * dep_tw_at_war * recovering, 0.0)
