"""Chinese hardware market, hardware stocks, power, and compute services."""
from __future__ import annotations

import numpy as np

EPS = 1e-12
MAX_CHINA_SHARE = 0.4  # China cannot absorb more than this share of Western output
MAX_CN_EXPORT_SHARE = 0.3  # ceiling on Chinese chip exports, as a share of Western output


def sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


def preference(m, acc, h, q_imp, q_dom_eff, P):
    """Share of Chinese buyers who would choose domestic hardware if both were on offer.

    Procurement mandates bind less tightly when a superior import is actually available
    (``mandate_erosion``); buyers also weigh supply insecurity and relative quality.
    """
    z = (P.pref_a0 + P.pref_bm * m * (1.0 - P.mandate_erosion * acc) + P.pref_eh * h
         - P.pref_dq * np.log(np.maximum(q_imp, EPS) / np.maximum(q_dom_eff, EPS)))
    return sigmoid(z)


def update_access(acc, target, P):
    """Import access falls at once when controls tighten and recovers gradually when
    they ease (licensing, supplier relationships, datacentre build-out)."""
    return np.where(target < acc, target, acc + P.access_ramp * (target - acc))


def market(D, Q_dom, W, pref, acc, P):
    """Split Chinese demand for new capacity between domestic chips and imports.

    Blocked import demand partly spills onto domestic chips; a domestic shortfall is
    partly back-filled by imports when they are accessible. All quantities are capacity
    units per year. A chip is counted once, as domestic or imported.
    """
    desired_dom = pref * D
    desired_imp = (1.0 - pref) * D
    imp1 = desired_imp * acc
    blocked = desired_imp - imp1
    Dd = desired_dom + P.spill_dom * blocked
    dom_add = np.minimum(Dd, Q_dom)
    shortfall = Dd - dom_add
    imports = np.minimum(imp1 + shortfall * acc * P.backfill, MAX_CHINA_SHARE * W)
    unmet = np.maximum(D - dom_add - imports, 0.0)
    util_ratio = np.minimum(1.0, Dd / np.maximum(Q_dom, EPS))
    return dom_add, imports, unmet, util_ratio, Dd


def power_factor(need, capacity):
    """Fraction of a hardware stock that available datacentre power can run."""
    return np.minimum(1.0, capacity / np.maximum(need, EPS))


def services(C_us, C_dom, C_imp, remote, usab, pf_us, pf_cn, scarcity_t, P):
    """Usable compute services during the year.

    Rented remote capacity adds to Chinese services for this year only and is never
    added to the Chinese hardware stock. The share of it that would otherwise have
    served US users is removed from US services.
    """
    S_us = P.util * np.maximum(C_us * pf_us - scarcity_t * remote, 0.0)
    S_cn_local = P.util * pf_cn * (C_imp + C_dom * usab)
    S_cn = S_cn_local + P.util * remote
    Tr_us = P.train_share * S_us
    Tr_cn = P.train_share * (S_cn_local + P.cloud_train_discount * P.util * remote)
    return S_us, S_cn, Tr_us, Tr_cn
