"""The catastrophe hazard is per developer, and its channels are live and separable."""
from types import SimpleNamespace

import numpy as np

from ai_controls import analysis as A
from ai_controls.ai_transition import catastrophe_hazard


def _P(**kw):
    base = dict(cat_base=0.02, safe_tau=1.5, lead_safety=0.4, slack_used=1.0, race_risk=0.5,
                open_risk=0.1, cat_mult_cn=2.0)
    base.update(kw)
    return SimpleNamespace(**base)


def test_reduces_to_single_frontier_hazard_when_china_is_far_behind():
    P = _P()
    lag, T, O, prox = np.array([1.2]), np.array([0.6]), np.array([0.7]), np.array([0.8])
    gap = 1.2
    slack, race = 1 - np.exp(-gap / 1.5), np.exp(-gap / 1.5) * (0.5 + 0.5 * 0.6)
    old = 0.02 * 0.8 * (1 - 0.4 * slack) * (1 + 0.5 * race) * (1 + 0.1 * 0.7)
    total, h_us, h_cn = catastrophe_hazard(prox, np.zeros(1), lag, T, O, P)
    assert np.isclose(total[0], old) and h_cn[0] == 0


def test_slack_only_helps_if_spent():
    lag, T, O, z = np.array([2.0]), np.array([0.5]), np.zeros(1), np.zeros(1)
    spent = catastrophe_hazard(np.ones(1), z, lag, T, O, _P(slack_used=1.0))[0]
    unspent = catastrophe_hazard(np.ones(1), z, lag, T, O, _P(slack_used=0.0))[0]
    assert spent < unspent
    assert np.isclose(unspent, catastrophe_hazard(np.ones(1), z, lag, T, O, _P(lead_safety=0.0))[0])


def test_chinese_developer_adds_risk_while_trailing():
    lag, T, O = np.array([0.5]), np.array([0.5]), np.zeros(1)
    near = catastrophe_hazard(np.ones(1), np.full(1, 0.6), lag, T, O, _P())
    far = catastrophe_hazard(np.ones(1), np.zeros(1), lag, T, O, _P())
    assert near[0] > far[0] and near[2][0] > 0


def test_nationality_multiplier_is_live(root):
    from ai_controls.parameters import load_config
    from ai_controls import payoffs
    cfg = load_config(root / "configs" / "erich_decisive.yaml")
    vals = []
    for m in (1.0, 3.0):
        run = A.run_config(cfg.with_overrides({"cat_mult_cn": m}), 400, 5, policies=["maintain", "relax_chips"], record=False)
        d = run.results["maintain"].comps - run.results["relax_chips"].comps
        vals.append(payoffs.aggregate(d, cfg.weights["global"]).mean())
    assert abs(vals[1] - vals[0]) > 1.0


def test_cat_decomposition_sums(base_run):
    d = A.cat_decomposition(base_run, "maintain", "relax_chips")
    parts = [v for k, v in d.items() if k.endswith("_pp") and k != "marginal_pp"]
    assert np.isclose(sum(parts), d["marginal_pp"])
    assert 0 <= d["cn_share_policy"] <= 1
