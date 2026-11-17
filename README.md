# AI export controls: a strategic game model

**Newest and smallest:** [`lead/`](lead/README.md) rebuilds the question from scratch around one quantity, the months of frontier lead that controls buy, in four steps and one page of equations.

[Explore the independent Codex game map](https://forkhead-box-protein-p2.github.io/ai-export-controls-model/atlas.html) to trace six US policies through Chinese sourcing decisions and possible AI outcomes. [Equations and reproduction guide](docs/atlas.md).

A transparent, quantitative and editable model of US restrictions on AI chips, high-bandwidth memory (HBM), semiconductor manufacturing equipment (SME) and cloud compute access to China. It simulates the whole game year by year from 2026 to 2050:

- US policy;
- China's response;
- domestic adoption, know-how and output;
- compute and capability;
- the arrival, decisiveness and durability of a transformative AI transition;
- war and catastrophe hazards;
- a vector of payoffs weighted by explicit values.

**Interactive site:** https://forkhead-box-protein-p2.github.io/ai-export-controls-model/

The site leads with a **lean model**: fifteen outcome-level numbers covering the lead controls buy, when transformative AI arrives, what a lead is worth, and what controls cost each year. Each number has a slider, and the site shows the decomposition and break-even values. The full 190-parameter engine ([`engine.html`](engine.html)) is the derivation layer behind it. `ai-controls lean` runs the engine for each worldview and reduces it to the fifteen numbers. It then checks the lean formula against the engine's own policy comparisons and writes `web/lean_params.js` and `lean_validation.csv`. The value of a month of lead and the risk cut per month are calibrated on Maintain vs Relax chips only. On the other comparisons the lean formula has a median error of about 23% and gets the sign right in all 48 cells.

The question is not only whether controls delay China. It is whether the expected strategic benefit of the US lead they induce exceeds the direct and dynamic costs of keeping it, across plausible AI futures. The model does not declare a winner. Its job is to show which beliefs, causal mechanisms and value judgments make a policy look best, and which of them have evidence behind them.

> Most parameters are illustrative test inputs, not measured estimates. Every one carries a status (`observed`, `estimated`, `elicited`, `illustrative`), a range and a source. Results are conditional statements about the model, not forecasts.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m ai_controls.cli compare --configs configs/fox_continuous.yaml configs/erich_decisive.yaml configs/agnostic_wide.yaml --runs 10000 --seed 42
pytest
```

`compare` writes the following to `outputs/latest/` (change it with `--out`) and prints the main tables:

- a policy-by-worldview table of expected value under three value sets;
- decompositions by mechanism;
- outcome probabilities;
- marginal war risk split into channels;
- regret across worldviews;
- calibration checks;
- trajectory and indigenisation tables and plots;
- break-even surfaces;
- the lead-path stress test;
- a provenance table for every assumption.

Other commands:

| Command | What it does |
|---|---|
| `ai-controls provenance --config configs/baseline.yaml` | List every assumption with its status, range and source |
| `ai-controls tornado --config ... --versus relax_chips --weights global` | One-at-a-time sensitivity of a policy difference |
| `ai-controls sensitivity --config configs/agnostic_wide.yaml --runs 8000` | First-order global sensitivity and the expected value of perfect information for each parameter, plus the top interaction |
| `ai-controls stress` | Extreme but coherent counterfactuals, including both-positive and both-negative responses |
| `ai-controls game --config ... --weights us_interest` | Coarse game of US policies against Chinese stances, with deviation gains |
| `ai-controls export-web` | Regenerate `web/params.js` for the engine page from the YAML configs |
| `ai-controls lean` | Derive the lean model's defaults from the engine, validate the lean formula, write `web/lean_params.js` |

## Changing assumptions

All parameters live in [`configs/baseline.yaml`](configs/baseline.yaml) as one registry. Each entry gives a definition, units, status, value, range, sampling distribution, correlation factor and sources. Worldview files extend it and list only their departures:

- `fox_continuous.yaml`: long-horizon competition and diffusion, weaker lock-in, a market that is less captive when US chips are on offer, and costly openness losses. This is an illustrative operationalisation, **not** fox's elicited priors.
- `erich_decisive.yaml`: decisive worlds more likely than not, durable advantages, a captive market regardless of controls, deterrence, and lead-dependent safety. The only numbers that are Erich Grunewald's own are his stated forecasts of a US compute advantage of about 10× or more for a decade and 2× or more through the 2040s. Here they are *outputs* the Maintain path is checked against, never inputs.
- `agnostic_wide.yaml`: every uncertain parameter drawn across its range, with correlated clusters.
- `stress_tests.yaml`: named override sets for extreme cases.

Three layers are kept apart, so that empirical and ethical disagreements stay separable:

- **World model:** parameters.
- **Actor beliefs:** China's beliefs and objective, used in the strategic game.
- **Normative weights:** `us_interest`, `global` and `pluralist`.

On the site, any parameter can be edited in the Assumptions table or in the sliders behind each stage of the game. Then run `ai-controls export-web` after editing YAML.

## How it works

The model is a stochastic dynamic game simulated by Monte Carlo. Every policy is evaluated on the same simulated worlds (common random numbers). Each random draw is a hash of (seed, stream, world, year), so a policy that takes a different branch cannot shift anyone else's shocks. Policy comparisons are paired world by world.

- **Starting point.** The 2026 state is inherited and identical under every policy.
- **China's response** is an assumed behavioural rule, labelled as such.
- **Indigenisation** is three separate outcomes: adoption, know-how and output. Learning comes only from new experience.
- **Compute is not capability.** Installed stock, rented services, training compute and capability are distinct quantities.
- **Arrival, lead, decisiveness and persistence** are separate draws, so transformative AI does not imply a winner.
- **War and catastrophe** are hazards that overlap every branch. Calibration targets are solved once under the reference policy and never applied again as effects.
- **Payoffs** are a vector, aggregated only under explicit weights, and there is no "winner" jackpot.

See [`docs/model_spec.md`](docs/model_spec.md) for the equations. [`docs/assumptions_and_sources.md`](docs/assumptions_and_sources.md) covers sources and calibration, [`docs/debate_context.md`](docs/debate_context.md) the debate being modelled, and [`docs/limitations.md`](docs/limitations.md) what the model cannot tell you.

## Repository layout

```text
index.html                 lean front page (web/lean.js, web/lean_app.js, web/lean_params.js)
engine.html, web/          full engine explorer; GitHub Pages serves the repository root
  web/model.js             browser port of the simulator
  web/params.js            generated from configs/*.yaml
  web/app.js, style.css    the interface
src/ai_controls/           Python package: rng, parameters, policies, china_response, industry,
                           compute, ai_transition, geopolitics, payoffs, simulation, analysis, plots, cli
configs/                   parameter registry and worldview files
docs/                      specification, sources, debate context, limitations
tests/                     invariants from the specification, plus a JavaScript/Python parity test
```

The JavaScript engine reproduces the Python model to floating-point precision on the same seeds. `tests/test_web_parity.py` runs it under Node and checks calibration, trajectories, outcome probabilities and policy values against Python.

## What the model claims

There are three kinds of claim here.

1. A *scenario* runs under the assumed response rule.
2. A *policy comparison* holds inside one specified causal model.
3. An *equilibrium* belongs to a specified coarse game and is reported with unilateral deviation gains.

None of these is the true geopolitical equilibrium, and no result here is an empirically validated forecast.

## License

MIT for the code. Sources cited in the configs belong to their authors.
