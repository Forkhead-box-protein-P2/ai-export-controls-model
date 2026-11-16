"""Parity and causal accounting checks for the independent game atlas."""
import copy
import json
import shutil
import subprocess

import pytest

from ai_controls import atlas


@pytest.fixture(scope="module")
def config():
    return atlas.load()


def test_finite_tree_browser_parity(config):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is required for browser parity")
    # Compare every displayed quantity, including annual branch probabilities and values.
    code = """
const c = require('./web/atlas_params.js'), m = require('./web/model.js').atlas;
const rows = [];
for (const s of Object.values(c.scenarios)) {
  for (const policy of Object.keys(c.policies)) {
    const branches = m.simulate(c, policy, s);
    rows.push(branches.map(p => p.weight));
    for (const year of [0, 14, 24]) {
      for (const response of [null, ...Object.keys(c.responses)]) rows.push(m.snapshot(branches, year, response));
    }
  }
}
console.log(JSON.stringify({config:c, rows}));
"""
    output = json.loads(subprocess.check_output([node, "-e", code], cwd=atlas.ROOT))
    assert output["config"] == config
    rows = iter(output["rows"])
    for settings in config["scenarios"].values():
        for policy in config["policies"]:
            branches = atlas.simulate(config, policy, settings)
            assert next(rows) == pytest.approx([p["weight"] for p in branches], abs=1e-11)
            for t in (0, 14, 24):
                for response in (None, *config["responses"]):
                    assert next(rows) == pytest.approx(atlas.snapshot(branches, t, response), abs=1e-10)
    assert next(rows, None) is None


def test_probability_mass_and_hazards(config):
    for settings in config["scenarios"].values():
        for policy in config["policies"]:
            paths = atlas.simulate(config, policy, settings)
            assert sum(p["weight"] for p in paths) == pytest.approx(1)
            for path in paths:
                last_war = last_cat = 0
                for row in path["rows"]:
                    mass = [row[k] for k in config["outcomes"]]
                    assert min(mass) >= 0
                    assert sum(mass) == pytest.approx(1)
                    assert last_war <= row["warRisk"] <= 1
                    assert last_cat <= row["catRisk"] <= 1
                    assert row["warRisk"] == pytest.approx(last_war + (1-last_war) * row["warHazard"])
                    assert 0 <= row["adoption"] <= 1
                    assert row["domestic"] <= row["output"]
                    last_war, last_cat = row["warRisk"], row["catRisk"]


def test_rentals_and_stock_accounting(config):
    c = copy.deepcopy(config)
    world, settings = c["worlds"][1], c["scenarios"]["contested"]
    def path():
        return atlas.trajectory(c, "strict", "route", world, settings)[1]
    c["industry"]["cloudShare"] = 0
    without = path()
    c["industry"]["cloudShare"] = 0.25
    with_rental = path()
    for before, after in zip(without, with_rental):
        assert before["cnStock"] == after["cnStock"]
        assert before["usStock"] == after["usStock"]
        assert after["cnCompute"] - before["cnCompute"] == pytest.approx(after["rental"])
        assert before["usCompute"] - after["usCompute"] == pytest.approx(after["rental"])


def test_arrival_can_be_shared_and_policy_ranking_can_reverse(config):
    no_lock = dict(config["scenarios"]["contested"], lock=0)
    r = atlas.snapshot(atlas.simulate(config, "strict", no_lock), 24)
    assert r["shared"] > 0 and r["us"] == r["cn"] == r["transient"] == 0
    deltas = []
    for scenario, lens in (("diffusion", "pluralist"), ("race", "national")):
        a, b = (atlas.snapshot(atlas.simulate(config, p, config["scenarios"][scenario]), 14)
                for p in ("strict", "broad"))
        deltas.append(sum(w*(a[k]-b[k]) for k,w in config["lenses"][lens].items() if k != "label"))
    assert deltas[0] < 0 < deltas[1]


def test_no_hardware_or_new_experience(config):
    c = copy.deepcopy(config)
    c["initial"].update(usStock=0, localStock=0, importStock=0)
    c["industry"].update(chipFlow=0, fabFlow=0, rdGain=0, knowledgeDecay=0)
    rows = atlas.trajectory(c, "adaptive", "build", c["worlds"][0], c["scenarios"]["race"])[1]
    for row in rows:
        assert row["cnCompute"] == row["usCompute"] == row["rental"] == 0
        assert row["knowledge"] == c["initial"]["knowledge"]
        assert row["ongoing"] == 1


def test_opposing_war_channels_and_learning_effects(config):
    def difference(settings, metric, baseline):
        a, b = (atlas.snapshot(atlas.simulate(config, p, settings), 24) for p in ("strict", baseline))
        return a[metric] - b[metric]
    settings = config["scenarios"]["contested"]
    assert difference(dict(settings, friction=-1), "warRisk", "broad") < 0
    assert difference(dict(settings, friction=1), "warRisk", "broad") > 0
    # Finished-chip denial and production-input denial have distinct effects.
    assert difference(settings, "knowledge", "chips") > 0
    assert difference(settings, "knowledge", "broad") < 0
