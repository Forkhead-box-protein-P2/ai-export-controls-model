"""The browser engine (web/model.js) reproduces the Python model on the same seeds."""
import json
import shutil
import subprocess

import numpy as np
import pytest

from ai_controls import analysis as A
from ai_controls import payoffs
from ai_controls.parameters import load_config

NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("config", ["baseline", "agnostic_wide", "erich_decisive"])
def test_js_matches_python(root, config):
    n, seed = 300, 42
    out = subprocess.run([NODE, str(root / "tests" / "js_parity.cjs"), config, str(n), str(seed)],
                         capture_output=True, text=True, check=True, cwd=root)
    js = json.loads(out.stdout)
    cfg = load_config(root / "configs" / f"{config}.yaml")
    run = A.run_config(cfg, n, seed)
    assert np.isclose(js["calib"]["theta_med"], run.calib.theta_med, rtol=1e-9)
    assert np.isclose(js["calib"]["th0"], run.calib.th0, rtol=1e-9)
    ref = run.results[cfg.reference_policy].comps
    for pol, res in run.results.items():
        j = js["policies"][pol]
        for s, vals in j["means"].items():
            py = [float(res.series[s][t].mean()) for t in (0, 4, 9, 24)]
            assert np.allclose(vals, py, rtol=1e-5, atol=1e-9), (pol, s)
        probs = A.outcome_probs(run).set_index("policy").loc[pol]
        for k in ("us_durable", "near_simultaneous", "distributed", "war_by_2050", "catastrophe"):
            assert abs(j["outcomes"][k] - probs[k]) < 1e-9, (pol, k)
        for w, v in j["delta"].items():
            py = payoffs.aggregate(res.comps - ref, cfg.weights[w]).mean()
            assert np.isclose(v, py, rtol=1e-6, atol=1e-6), (pol, w)
