"""The lean model: formula properties, browser parity, and agreement with the engine."""
import json
import shutil
import subprocess

import numpy as np
import pytest

from ai_controls import lean
from ai_controls.parameters import load_config

NODE = shutil.which("node")
BASE = dict(m=2.0, k=10.0, H=5.0, b=1.0, p35=0.6, p_none=0.1, p_dec=0.3, V_m=20.0, c0=0.1, r=0.01,
            K_cat=1000.0, y=1.0, o=0.5, d_war=1.0, K_war=500.0)


def test_arrival_density_matches_targets():
    f = lean.arrival_density(0.6, 0.1)
    assert np.isclose(f[:10].sum(), 0.6) and np.isclose(f.sum(), 0.9)
    back = lean.arrival_density(0.2, 0.2)  # back-loaded: rising hazard
    assert np.isclose(back[:10].sum(), 0.2) and np.isclose(back.sum(), 0.8)


def test_terms_sum_and_signs():
    e = lean.evaluate(BASE)
    assert np.isclose(e["net"], e["lead"] + e["safety"] + e["output"] + e["openness"] + e["war"])
    assert lean.evaluate({**BASE, "m": 1.0})["lead"] == 0
    assert lean.evaluate({**BASE, "b": 0.0})["lead"] > e["lead"]  # backfire shortens the lead
    assert lean.evaluate({**BASE, "d_war": -1.0})["war"] > 0       # stabilising controls add value


def test_calibration_pair_reproduces_engine():
    d = lean.derive(load_config("configs/baseline.yaml"), 600, 3)
    for row in lean.validate(d):
        if row["calibration_pair"] and row["weights"] == "global":
            assert abs(row["rel_error"]) < 0.1


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_lean_matches_python(root):
    js = json.loads(subprocess.run([NODE, str(root / "tests" / "lean_parity.cjs")], capture_output=True,
                                   text=True, check=True, cwd=root).stdout)
    data = json.loads((root / "web" / "lean_params.js").read_text().split("var AIC_LEAN = ", 1)[1].split(";\n", 1)[0])
    for key, v in js.items():
        c, pair, w = key.split("/")
        assert np.isclose(v, lean.evaluate(lean.lean_params(data["derived"][c], pair, w))["net"], rtol=1e-9, atol=1e-9)
