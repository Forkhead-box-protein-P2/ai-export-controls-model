"""Learning comes only from new experience, R&D or spillovers."""
from types import SimpleNamespace

import numpy as np

from ai_controls import industry


def test_zero_new_experience_gives_zero_learning():
    E = np.array([0.0, 1.0, 50.0, 1e6])
    assert np.all(industry.learning_increment(E, np.zeros(4), 3.0, 0.1) == 0)


def test_learning_is_positive_and_diminishing():
    a = industry.learning_increment(np.array([10.0]), np.array([5.0]), 3.0, 0.1)[0]
    b = industry.learning_increment(np.array([100.0]), np.array([5.0]), 3.0, 0.1)[0]
    assert a > b > 0


def test_no_growth_without_experience_rd_or_spillovers():
    P = SimpleNamespace(k_decay=0.0, spill_k=0.0, k_cap=1.0)
    K = np.array([0.2, 0.5, 0.9])
    learn = industry.learning_increment(np.full(3, 40.0), np.zeros(3), 3.0, 0.1)
    out = industry.update_knowhow(K, 0.0, np.ones(3), np.ones(3), learn, np.ones(3), P)
    assert np.allclose(out, K)
    P.k_decay = 0.05
    out = industry.update_knowhow(K, 0.0, np.ones(3), np.ones(3), learn, np.ones(3), P)
    assert np.all(out < K)


def test_knowhow_bounded(base_run):
    for res in base_run.results.values():
        for k in ("K_logic", "K_hbm", "K_sme", "K_soft"):
            assert np.all((res.series[k] >= 0) & (res.series[k] <= 1))
