"""An independent, finite scenario tree for the Export Controls Game Atlas.

A Chinese sourcing strategy is selected with a bounded four-year planning rule.
Conditional on an industrial environment and strategy, first-arrival and event
probabilities are integrated annually. No random draws or fitted priors are used.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def load():
    return yaml.safe_load((ROOT / "configs/atlas.yaml").read_text())


def export_web():
    data = json.dumps(load(), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    (ROOT / "web/atlas_params.js").write_text(
        "// Generated from configs/atlas.yaml by ai_controls.atlas.\n"
        f"const ATLAS_CONFIG = {data};\n"
        "if (typeof module !== 'undefined') module.exports = ATLAS_CONFIG;\n")


def unit(x):
    return min(1, max(0, x))


def trajectory(c, policy, response, world, s):
    p, r = c["policies"][policy], c["responses"][response]
    i, b, tr, risk, v = (c[k] for k in ("industry", "behavior", "transition", "risk", "value"))
    start = c["initial"]
    us_stock, local, foreign, k, experience, ratio = (
        start[key] for key in ("usStock", "localStock", "importStock", "knowledge", "experience", "ratio"))
    pending, shared, temporary, us_lead, cn_lead, war, cat = 1, 0, 0, 0, 0, 0, 0
    row = {}
    rows = []
    plan_value = 0
    for t in range(c["end"] - c["start"] + 1):
        adaptive = unit((ratio - i["adaptiveThreshold"]) * i["adaptiveSlope"]) if policy == "adaptive" else 0
        chips = (p["chips"] + (1 - p["chips"]) * adaptive) * p["enforcement"]
        cloud = (p["cloud"] + (1 - p["cloud"]) * adaptive) * p["enforcement"]
        equipment, memory = p["tools"] * p["enforcement"], p["hbm"] * p["enforcement"]
        supply = i["chipFlow"] * (1 + i["chipGrowth"]) ** t
        demand = i["baseDemand"] + i["mandateDemand"] * r["mandate"] + i["scarcityDemand"] * chips
        fab = i["fabFlow"] * world["fab"] * (1 + i["fabGrowth"]) ** t * k
        output = fab * min(1 - i["equipmentDrag"] * equipment, 1 - i["memoryDrag"] * memory)
        domestic = min(output, supply * demand * k / (k + i["domesticQuality"]))
        offered = supply * i["exportShare"]
        permitted = offered * (1 - chips)
        imports = min(max(0, offered - domestic * r["mandate"]), permitted + offered * chips * i["diversionShare"] * r["bypass"])
        retain = 1 - i["retirement"]
        us_stock = retain * us_stock + supply - imports
        local = retain * local + domestic
        foreign = retain * foreign + imports
        power_growth = (1 + i["powerGrowth"]) ** t
        us_physical = min(us_stock, i["usPower"] * power_growth)
        cn_physical = min(local + foreign, i["cnPower"] * power_growth)
        rental = us_physical * i["cloudShare"] * (1 - cloud) * r["bypass"]
        us_compute, cn_compute = us_physical - rental, cn_physical + rental
        local_use = cn_physical * local / (local + foreign) if cn_physical else 0
        us_train = us_compute
        cn_train = cn_compute - local_use * (1 - i["localNetwork"]) / (1 + k)
        us_cap, own_cap = us_train ** i["computeElasticity"], cn_train ** i["computeElasticity"]
        cn_cap = own_cap + world["diffusion"] * i["openCatchup"] * max(0, us_cap - own_cap)
        ratio = cn_cap / us_cap if us_cap else (math.inf if cn_cap else 1)
        adoption = domestic / (domestic + imports) if domestic + imports else 0
        learning = math.log1p((output + local_use) / (i["experienceScale"] + experience))
        use_fraction = local_use / (output + local_use) if output + local_use else 0
        k = k * (1 - i["knowledgeDecay"]) + i["rdGain"] * r["investment"] + learning * (
            i["fabLearning"] * (1 - use_fraction) + i["useLearning"] * s["learning"] * use_fraction)
        experience += output + local_use
        exposure = (chips + equipment + memory + cloud) / 4
        belief = unit(b["strategicBelief"] + b["signal"] * exposure)
        spend = b["investmentCost"] * r["investment"] ** 2 + b["routeCost"] * r["bypass"] ** 2
        if t < b["lookahead"]:
            plan_value += (math.log1p(cn_compute) + b["sovereignty"] * k
                           + b["security"] * belief * adoption - spend) / b["lookahead"]

        frontier = max(us_cap, cn_cap) / tr["capabilityScale"]
        hazard = 1 - 0.5 ** (frontier ** tr["progressExponent"] / s["timing"])
        arrival = pending * hazard
        exclusive = unit(s["lock"] * (1 - tr["diffusionDrag"] * world["diffusion"]))
        durable = arrival * exclusive * tr["durability"]
        us_first = 1 / (1 + ratio ** tr["leadershipSensitivity"])
        retention = 0.5 ** (1 / s["persistence"])
        temporary += (us_lead + cn_lead) * (1 - retention) + arrival * exclusive * (1 - tr["durability"])
        us_lead = us_lead * retention + durable * us_first
        cn_lead = cn_lead * retention + durable * (1 - us_first)
        shared += arrival * (1 - exclusive)
        pending -= arrival

        provocation = risk["provocation"] * exposure * belief * (1 + s["friction"])
        deterrence = risk["deterrence"] * exposure * max(0, 1 - ratio) * (1 - s["friction"])
        war_h = unit(risk["baselineWar"] + provocation - deterrence)
        closeness = min(us_cap, cn_cap) / max(us_cap, cn_cap) if max(us_cap, cn_cap) else 0
        cat_h = unit(risk["baselineCat"] + risk["raceCat"] * closeness + risk["progressCat"] * (1 - pending))
        new_war, new_cat = (1 - war) * war_h, (1 - cat) * cat_h
        war += new_war
        cat += new_cat
        openness = math.log1p(cn_cap) * world["diffusion"] / (1 + exposure * belief)
        discount = (1 + v["discount"]) ** -t
        sales_share = imports / supply if supply else 0
        flows = {
            "usEconomy": math.log1p(us_cap) + v["salesSurplus"] * sales_share - v["enforcementCost"] * exposure,
            "cnEconomy": math.log1p(cn_cap) - spend,
            "spillovers": math.log1p((us_cap + cn_cap) / 2),
            "openness": openness, "lead": v["leadScale"] * (us_lead - cn_lead),
            "war": -v["warLoss"] * new_war, "catastrophe": -v["catLoss"] * new_cat,
        }
        row = {key: row.get(key, 0) + discount * x for key, x in flows.items()}
        rows.append(dict(row, ongoing=pending, shared=shared, transient=temporary, us=us_lead, cn=cn_lead,
                         warRisk=war, catRisk=cat, warHazard=war_h, provocation=provocation, deterrence=deterrence,
                         usStock=us_stock, cnStock=local + foreign, usCompute=us_compute, cnCompute=cn_compute,
                         usTrain=us_train, cnTrain=cn_train, usCap=us_cap, cnCap=cn_cap, adoption=adoption,
                         knowledge=k, output=output, domestic=domestic, imports=imports, rental=rental, chips=chips))
    return plan_value, rows


def simulate(c, policy, settings):
    branches = []
    for world in c["worlds"]:
        paths = {r: trajectory(c, policy, r, world, settings) for r in c["responses"]}
        peak = max(score for score, _ in paths.values())
        weights = {r: math.exp((score - peak) / c["behavior"]["temperature"]) for r, (score, _) in paths.items()}
        for r, (_, rows) in paths.items():
            branches.append({"response": r, "weight": world["weight"] * weights[r] / sum(weights.values()), "rows": rows})
    return branches


def snapshot(branches, t, response=None):
    paths = [p for p in branches if response is None or p["response"] == response]
    mass = sum(p["weight"] for p in paths)
    return {key: sum(p["weight"] * p["rows"][t][key] for p in paths) / mass for key in paths[0]["rows"][t]}


def main():
    c = load()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=c["scenarios"], default=c["defaults"]["scenario"])
    parser.add_argument("--year", type=int, choices=range(c["start"], c["end"] + 1), default=c["defaults"]["year"])
    parser.add_argument("--lens", choices=c["lenses"], default=c["defaults"]["lens"])
    parser.add_argument("--export-web", action="store_true")
    args = parser.parse_args()
    if args.export_web:
        export_web()
        return
    print(f"{args.year} | {args.scenario} | {args.lens} | illustrative model")
    print(f"{'Policy':22s} {'Value':>8s} {'US lead':>9s} {'CN lead':>9s} {'War':>8s} {'AI cat.':>8s}")
    for key, p in c["policies"].items():
        row = snapshot(simulate(c, key, c["scenarios"][args.scenario]), args.year - c["start"])
        total = sum(w * row[k] for k, w in c["lenses"][args.lens].items() if k != "label")
        print(f"{p['label']:22s} {total:8.2f} {row['us']:9.1%} {row['cn']:9.1%} {row['warRisk']:8.1%} {row['catRisk']:8.1%}")


if __name__ == "__main__":
    main()
