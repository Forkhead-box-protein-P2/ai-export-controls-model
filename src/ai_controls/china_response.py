"""China's response y_t and its belief and memory updates.

This is an assumed behavioural rule, not a best response. ``analysis.strategic_game``
compares it with a coarse-grid optimising response.
"""
from __future__ import annotations

import numpy as np

H_REF = 0.5  # reference level of supply insecurity around which responses are centred


def respond(R, R_prev, h, b_cn, P, stance):
    """Return (procurement mandate, R&D and subsidy effort, retaliation, foreign-access effort).

    ``stance`` scales the indigenisation push and the confrontation level so that the
    strategic-game analysis can vary China's posture.
    """
    indig, conf = stance["indig"], stance["conf"]
    y_rd = np.maximum(1.0 + P.rd_h * (h - H_REF) + P.rd_b * (b_cn - P.b_cn0), 0.0) * indig
    m = np.clip((P.m_base + P.m_h * (h - H_REF)) * indig, 0.0, 1.0)
    y_ret = np.clip((P.ret_R * R + P.ret_dR * np.maximum(R - R_prev, 0.0)) * conf, 0.0, 1.0)
    y_fa = np.clip(P.fa_R * R, 0.0, 1.0)
    return m, y_rd, y_ret, y_fa


def update_memory(h, R, P):
    """Supply insecurity rises quickly when controls tighten and fades slowly when they ease."""
    rate = np.where(R > h, P.h_up, P.h_down)
    return h + rate * (R - h)


def update_belief_cn(b, R, prox, arrived, P):
    """Chinese belief that AI is strategically decisive.

    It moves with observed progress toward a transition and, through the signalling
    channel, with how hard the US works to protect its compute lead.
    """
    b = b + P.sig_eta * R * (1.0 - b) + P.prog_eta * prox * (1.0 - b)
    return np.where(arrived, 1.0, np.clip(b, 0.0, 1.0))
