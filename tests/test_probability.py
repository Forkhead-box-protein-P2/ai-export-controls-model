"""Probabilities and hazards are well formed; calibration targets are met once."""
import numpy as np

from ai_controls import analysis as A
from ai_controls import rng
from ai_controls.ai_transition import kumaraswamy
from ai_controls.state import REGIMES


def test_hazards_in_unit_interval(wide_run):
    for res in wide_run.results.values():
        for k in ("h_war", "h_cat", "dom_share", "pref", "acc", "O", "T", "I", "b_cn", "h"):
            v = res.series[k]
            assert np.all((v >= 0) & (v <= 1)), k


def test_regimes_partition_paths(base_run):
    probs = A.outcome_probs(base_run)
    assert np.allclose(probs[list(REGIMES)].sum(axis=1), 1.0)


def test_cumulative_incidence_matches_hazards(base_run):
    """Realised first-war frequency tracks 1 - prod(1 - h_t) along the simulated paths."""
    res = base_run.results["maintain"]
    i = base_run.cfg.years.index(2050)
    expected = (1 - np.prod(1 - res.series["h_war"][: i + 1], axis=0)).mean()
    assert abs(res.events["war"].mean() - expected) < 0.04


def test_calibration_targets_are_solved(base_run, base_cfg):
    assert abs(base_run.calib.p_tai_2035 - base_cfg.params["p_tai_2035"].value) < 1e-6
    assert abs(base_run.calib.war_2040 - base_cfg.params["war_base_2040"].value) < 1e-6


def test_calibration_is_shared_across_policies(base_cfg):
    a = A.run_config(base_cfg, 200, 11, policies=["maintain"])
    b = A.run_config(base_cfg, 200, 11, policies=["broad_relax", "maintain"])
    assert a.calib.theta_med == b.calib.theta_med and a.calib.th0 == b.calib.th0


def test_rng_and_transforms():
    u = rng.uniform(1, 2, np.arange(20000), 3)
    assert 0 < u.min() and u.max() < 1 and abs(u.mean() - 0.5) < 0.01
    z = np.linspace(-3, 3, 13)
    assert np.allclose(rng.invnorm(rng.normcdf(z)), z, atol=2e-6)
    k = kumaraswamy(u, 4.0, 1.2)
    assert np.all((k >= 0) & (k <= 1))
