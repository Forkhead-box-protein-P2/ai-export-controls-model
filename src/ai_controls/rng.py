"""Keyed random numbers.

Every draw is a pure function of (seed, stream, simulation, year). No sequential
stream is consumed, so a policy that takes a different branch cannot shift the
shocks that later years or other shock types receive. Paired policy comparisons
therefore share every underlying draw (common random numbers).

The 32-bit hash is written so that the JavaScript port in ``web/model.js``
produces bit-identical uniforms.
"""
from __future__ import annotations

import numpy as np

_M32 = np.uint64(0xFFFFFFFF)
_S16, _S15 = np.uint64(16), np.uint64(15)
_C1, _C2 = np.uint64(0x7FEB352D), np.uint64(0x846CA68B)


def _mix(x):
    x = x ^ (x >> _S16)
    x = (x * _C1) & _M32
    x = x ^ (x >> _S15)
    x = (x * _C2) & _M32
    x = x ^ (x >> _S16)
    return x


def uniform(seed: int, stream: int, sim, t: int = 0) -> np.ndarray:
    """Uniform(0,1) draws keyed by seed, stream id, simulation index and year."""
    sim = np.asarray(sim, dtype=np.uint64)
    h = np.uint64((int(seed) ^ 0x9E3779B9) & 0xFFFFFFFF)
    h = _mix((h + np.uint64(((int(stream) + 1) * 0x85EBCA6B) & 0xFFFFFFFF)) & _M32)
    h = _mix((h + (((sim + np.uint64(1)) * np.uint64(0xC2B2AE35)) & _M32)) & _M32)
    h = _mix((h + np.uint64(((int(t) + 1) * 0x27D4EB2F) & 0xFFFFFFFF)) & _M32)
    return (h.astype(np.float64) + 0.5) / 4294967296.0


# Acklam's rational approximation to the inverse normal CDF (|error| < 1.2e-9).
_A = (-3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02,
      1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00)
_B = (-5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02,
      6.680131188771972e01, -1.328068155288572e01)
_C = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00,
      -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00)
_D = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00,
      3.754408661907416e00)
_PLOW = 0.02425


def invnorm(u) -> np.ndarray:
    u = np.clip(np.asarray(u, dtype=np.float64), 1e-12, 1 - 1e-12)
    out = np.empty_like(u)
    lo, hi = u < _PLOW, u > 1 - _PLOW
    mid = ~(lo | hi)
    q = np.sqrt(-2.0 * np.log(np.where(lo, u, 0.5)))
    tail = ((((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5])
            / ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0))
    out[lo] = tail[lo]
    q = np.sqrt(-2.0 * np.log(np.where(hi, 1.0 - u, 0.5)))
    tail = -((((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5])
             / ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1.0))
    out[hi] = tail[hi]
    q = u - 0.5
    r = q * q
    central = ((((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) * r + _A[5]) * q
               / (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) * r + 1.0))
    out[mid] = central[mid]
    return out


def normcdf(z) -> np.ndarray:
    """Standard normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation."""
    z = np.asarray(z, dtype=np.float64)
    x = np.abs(z) / np.sqrt(2.0)
    t = 1.0 / (1.0 + 0.3275911 * x)
    poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
            + 0.254829592) * t
    erf = 1.0 - poly * np.exp(-x * x)
    return np.where(z >= 0, 0.5 * (1.0 + erf), 0.5 * (1.0 - erf))


def normal(seed: int, stream: int, sim, t: int = 0) -> np.ndarray:
    return invnorm(uniform(seed, stream, sim, t))
