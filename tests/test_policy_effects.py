"""Direct effects have the required signs; long-run effects can take either sign."""
from types import SimpleNamespace

import numpy as np

from ai_controls import analysis as A
from ai_controls import compute, industry, policies
from ai_controls.parameters import load_config, sample_params


def _P(cfg):
    return SimpleNamespace(**cfg.values())


def test_tighter_chip_controls_never_raise_imports_directly(base_cfg):
    P = _P(base_cfg)
    D, Q, W, pref = np.full(1, 40.0), np.full(1, 10.0), np.full(1, 190.0), np.full(1, 0.5)
    prev = None
    for xc in np.linspace(0, 1, 21):
        x = np.array([[xc, 0.9, 0.85, 0.4, 0.6]])
        acc = 1.0 - policies.effective(x, np.full(1, 0.5), P)[0]
        imports = compute.market(D, Q, W, pref, acc, P)[1]
        if prev is not None:
            assert imports[0] <= prev + 1e-12
        prev = imports[0]


def test_easier_inputs_never_lower_feasible_output(base_cfg):
    P = _P(base_cfg)
    one = np.ones(1)
    args = dict(L=one * 30, H=one * 4, HS=one * 3, Pk=one * 50, K_logic=one * 0.35, K_hbm=one * 0.3, cu_chip=one)
    prev_q, prev_a, prev_g = -1, -1, -1
    for x in np.linspace(1, 0, 21):  # easing
        q = industry.output(xh_eff=one * x, P=P, **args)["Q_dom"][0]
        a = industry.sme_access(one * x, one * 0.3)[0]
        L_new = industry.expand(one * 30, one * 4, one * 50, one * a, one, one * 1e6, one * 1, one * 1, one, 0.3, P)[0][0]
        assert q >= prev_q - 1e-12 and a >= prev_a - 1e-12 and L_new >= prev_g - 1e-12
        prev_q, prev_a, prev_g = q, a, L_new


def test_controls_can_raise_or_lower_chinese_capability(root):
    cfg = load_config(root / "configs" / "stress_tests.yaml")
    signs = []
    for name in ("controls_build_china", "controls_hold_china_back"):
        c = cfg.with_overrides(cfg.scenarios[name]["overrides"], name=name)
        run = A.run_config(c, 300, 3, policies=["maintain", "broad_relax"])
        i = c.years.index(2040)
        k = lambda pol: run.results[pol].series["K_sme"][i].mean() + run.results[pol].series["K_logic"][i].mean()
        signs.append(np.sign(k("maintain") - k("broad_relax")))
    assert signs == [1, -1]


def test_conflict_effect_can_take_either_sign(root):
    cfg = load_config(root / "configs" / "stress_tests.yaml")
    out = []
    for name in ("controls_build_china", "controls_hold_china_back"):
        c = cfg.with_overrides(cfg.scenarios[name]["overrides"], name=name)
        run = A.run_config(c, 600, 3, policies=["maintain", "broad_relax"])
        out.append(A.war_decomposition(run, "maintain", "broad_relax")["marginal_pp"])
    assert out[0] > 0 > out[1]


def test_arrival_does_not_force_a_winner(root):
    cfg = load_config(root / "configs" / "stress_tests.yaml")
    c = cfg.with_overrides(cfg.scenarios["arrival_without_lock_in"]["overrides"])
    e = A.run_config(c, 400, 3, policies=["maintain"]).results["maintain"].events
    assert e["arrived"].mean() > 0.9
    assert np.isin(e["regime"], ["us_durable", "cn_durable"]).mean() < 0.05


def test_china_can_arrive_first(root):
    cfg = load_config(root / "configs" / "stress_tests.yaml")
    c = cfg.with_overrides(cfg.scenarios["china_ahead_in_algorithms"]["overrides"])
    e = A.run_config(c, 300, 3, policies=["maintain"]).results["maintain"].events
    assert (e["arrived"] & (e["leader"] == 2)).mean() > 0.2


def test_inherited_2026_state_is_policy_independent(base_run):
    """Every policy starts from the same 2026 regime; a policy knob cannot undo history."""
    ref = base_run.results["maintain"].series
    for res in base_run.results.values():
        for name in ("x_chips", "x_sme", "C_cn", "K_logic", "dom_share", "h"):
            assert np.allclose(res.series[name][0], ref[name][0])


def test_china_can_lead_in_central_worlds(base_cfg):
    """The intrinsic gap is a world type, so even central parameters leave some worlds in
    which China's own methods and enough compute put it ahead. With no spread, a 10x
    compute deficit and the follower floor keep China behind in every world."""
    pols = ["maintain", "broad_relax"]
    wide = A.run_config(base_cfg, 400, 3, policies=pols)
    none = A.run_config(base_cfg.with_overrides({"intrinsic_sd": 0.0}), 400, 3, policies=pols)
    ahead = lambda run, p: float((run.results[p].series["lag_years"] < 0).any(axis=0).mean())
    assert ahead(wide, "broad_relax") > 0
    assert ahead(wide, "broad_relax") >= ahead(wide, "maintain")
    assert ahead(none, "maintain") == 0
