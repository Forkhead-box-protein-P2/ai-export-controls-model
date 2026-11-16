import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ai_controls import analysis as A  # noqa: E402
from ai_controls.parameters import load_config  # noqa: E402


@pytest.fixture(scope="session")
def root():
    return ROOT


@pytest.fixture(scope="session")
def base_cfg():
    return load_config(ROOT / "configs" / "baseline.yaml")


@pytest.fixture(scope="session")
def base_run(base_cfg):
    return A.run_config(base_cfg, 400, 7)


@pytest.fixture(scope="session")
def wide_run():
    cfg = load_config(ROOT / "configs" / "agnostic_wide.yaml")
    return A.run_config(cfg, 400, 7)
