"""Fixed seeds reproduce; paired policies share every world-type draw."""
import numpy as np

from ai_controls import analysis as A
from ai_controls import rng


def test_same_seed_same_results(base_cfg):
    a = A.run_config(base_cfg, 150, 5, policies=["maintain", "relax_chips"])
    b = A.run_config(base_cfg, 150, 5, policies=["maintain", "relax_chips"])
    for pol in a.results:
        assert np.array_equal(a.results[pol].comps, b.results[pol].comps)


def test_paired_policies_share_world_types(base_run):
    ref = base_run.results["maintain"].events
    for res in base_run.results.values():
        assert np.array_equal(res.events["dec"], ref["dec"])
        assert np.array_equal(res.events["half_life"], ref["half_life"])


def test_draws_are_keyed_not_sequential():
    """A draw depends only on its key, so a branch that skips draws cannot shift others."""
    full = rng.uniform(42, 22, np.arange(10), 7)
    assert np.array_equal(full[3:6], rng.uniform(42, 22, np.arange(3, 6), 7))
    assert not np.array_equal(rng.uniform(42, 22, np.arange(10), 8), full)
    assert not np.array_equal(rng.uniform(42, 23, np.arange(10), 7), full)


def test_sampled_parameters_paired(root):
    from ai_controls.parameters import load_config, sample_params
    cfg = load_config(root / "configs" / "agnostic_wide.yaml")
    a, b = sample_params(cfg, 50, 9), sample_params(cfg, 80, 9)
    for k, v in a.items():
        if isinstance(v, np.ndarray):
            assert np.allclose(v, b[k][:50])
