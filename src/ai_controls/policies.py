"""US policy vectors x_t = [chips, HBM, SME, cloud, enforcement] and their effective bite."""
from __future__ import annotations

import numpy as np

from .state import R_WEIGHTS


def restrictiveness(x: np.ndarray) -> np.ndarray:
    """Perceived restrictiveness R_t: a weighted mean of the four restriction dimensions."""
    return sum(w * x[:, k] for k, w in enumerate(R_WEIGHTS))


def policy_vector(policy: dict, t: int, n: int, status_quo, prev_x: np.ndarray,
                  lag_obs: np.ndarray) -> np.ndarray:
    """Policy in year index ``t``.

    Year 0 (2026) is the inherited status quo under every policy, so a policy change
    cannot rewrite the starting state. ``fixed`` policies commit to one vector from year 1.
    ``adaptive`` policies move the chip and cloud dimensions toward a target capability
    lead, using last year's noisily observed lead.
    """
    if t == 0:
        return np.tile(np.asarray(status_quo, dtype=float), (n, 1))
    kind = policy.get("type", "fixed")
    if kind == "fixed":
        return np.tile(np.asarray(policy["x"], dtype=float), (n, 1))
    if kind == "adaptive":
        if t == 1:
            return np.tile(np.asarray(policy["x"], dtype=float), (n, 1))
        x = prev_x.copy()
        step = policy["gain"] * (policy["target_lag"] - lag_obs)
        for k in policy["dims"]:
            x[:, k] = np.clip(prev_x[:, k] + step, policy["min"][k], policy["max"][k])
        return x
    raise ValueError(f"Unknown policy type '{kind}'")


def effective(x: np.ndarray, y_fa: np.ndarray, P) -> tuple[np.ndarray, ...]:
    """Effective restriction after leakage (smuggling, diversion, shell buyers).

    Leakage falls with enforcement and rises with China's foreign-access effort.
    """
    slack = (1.0 - x[:, 4]) * (0.5 + 0.5 * y_fa)
    xc = x[:, 0] * (1.0 - P.leak_chips * slack)
    xh = x[:, 1] * (1.0 - P.leak_hbm * slack)
    xs = x[:, 2] * (1.0 - P.leak_sme * slack)
    xcl = x[:, 3] * (1.0 - P.leak_cloud * slack)
    return xc, xh, xs, xcl
