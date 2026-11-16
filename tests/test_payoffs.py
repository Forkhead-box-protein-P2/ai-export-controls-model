"""Payoffs are vectors with visible weights; no hidden jackpot."""
from types import SimpleNamespace

import numpy as np

from ai_controls import analysis as A
from ai_controls import payoffs
from ai_controls.state import COMPONENTS


def test_two_world_toy_break_even():
    out = A.two_world_toy(0.5, 50, -20, 5)
    assert abs(out["break_even_p"] - 25 / 70) < 1e-12


def test_default_weights_add_no_unmodelled_jackpot(base_cfg):
    for name in ("us_interest", "global"):
        wv = payoffs.weight_vector(base_cfg.weights[name])
        for k, c in enumerate(COMPONENTS):
            if c.startswith("advyrs"):
                assert wv[k] == 0


def test_us_interest_ignores_foreign_output(base_cfg):
    wv = payoffs.weight_vector(base_cfg.weights["us_interest"])
    for k, c in enumerate(COMPONENTS):
        if c.endswith("_cn") and c.split("_")[0] in ("ai", "trade", "open", "lead", "war", "cat"):
            assert wv[k] == 0


def test_components_finite_and_decomposition_sums(base_run):
    t = A.policy_table(base_run)
    for res in base_run.results.values():
        assert np.all(np.isfinite(res.comps))
    groups = ["Economics", "Openness", "Security", "Conflict", "AI safety", "Durable lead", "Integration"]
    assert np.allclose(t[groups].sum(axis=1), t["delta_value"], atol=1e-6)


def test_terminal_value_switch():
    P = SimpleNamespace(terminal_persist=0.9, discount_rate=0.03, terminal_years=0)
    assert payoffs.terminal_factor(P) == 0
    P.terminal_years = 25
    assert payoffs.terminal_factor(P) > 0


def test_fully_scarce_chips_earn_no_net_export_profit(base_cfg):
    """With fixed supply, a sale to China displaces a sale elsewhere: no net profit."""
    P = SimpleNamespace(**base_cfg.values())
    n = 1
    s = {k: np.ones(n) for k in ("gdp_us", "gdp_cn", "gdp_row", "cu_chip", "I", "lag_years")}
    s.update({k: np.zeros(n) for k in ("base_up_us", "base_up_cn", "base_up_row", "tai_up_us", "tai_up_cn",
                                       "tai_up_row", "O", "adv", "y_ret", "cn_exports", "k_mean")})
    s.update(T=np.full(n, P.t_floor), y_rd=np.ones(n), leader=np.zeros(n, int), adverse=np.zeros(n, bool),
             legal_imports=np.full(n, 50.0), scarcity_t=np.ones(n), in_war=np.zeros(n, bool),
             war_sev=np.ones(n), escalated=np.zeros(n, bool), p_cat=np.zeros(n), arrived=np.zeros(n, bool))
    f = payoffs.flows(s, P)
    assert abs(f["trade_us"][0]) < 1e-12
