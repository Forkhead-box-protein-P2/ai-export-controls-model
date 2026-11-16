# The export controls game

[Open the interactive game map](https://forkhead-box-protein-p2.github.io/ai-export-controls-model/atlas.html)

The US chooses how to license advanced chips, high-bandwidth memory (HBM), semiconductor manufacturing equipment (SME) and cloud compute. China then chooses how much to rely on domestic procurement, investment and alternative foreign sources. The question is how those choices change the benefits and costs of a US lead over time.

Policy Atlas is an independent finite scenario tree. Python and JavaScript evaluate the same equations from the same configuration. All coefficients, initial conditions, policy intensities, environment weights and preferences have **illustrative** status. The named scenarios express hypotheses. None represents an elicited forecast.

## Run the model

From the repository root with the project's Python dependencies installed:

```sh
PYTHONPATH=src python -m ai_controls.atlas --scenario contested --lens global --year 2040
PYTHONPATH=src python -m ai_controls.atlas --scenario race --lens national --year 2050
python -m pytest tests/test_atlas.py
```

Edit [the numerical assumptions](../configs/atlas.yaml) and run `PYTHONPATH=src python -m ai_controls.atlas --export-web` to rebuild the browser configuration. Open `atlas.html` directly or serve the repository with any static HTTP server. The page makes its calculations locally.

## Decision tree

1. The industrial environment determines domestic fabrication productivity and the extent of software diffusion. Difficult, middle and strong substitution have weights ¼, ½ and ¼. Policies face the same environments.
2. The US chooses one of six rules. Four continuous restrictions are multiplied by enforcement. Five policies commit to constant intensities. The adaptive rule increases chip and cloud restrictions when the previous year's China-to-US capability ratio exceeds its threshold.
3. In each environment China evaluates three persistent strategies over a four-year planning window. The score is mean log accessible compute plus weighted know-how and domestic adoption, less the costs of domestic investment and diversion. The adoption weight depends on China's own strategic belief and the signal it takes from US restrictions.
4. Response probabilities are proportional to `exp(score / temperature)`. Each response therefore has a probability within each industrial environment. These are bounded decision rules. The model assumes China knows its environment when scoring the options.
5. Firms turn the policy and sourcing choices into purchases, production, deployed stocks, learning and useful capability. The engine propagates transition probabilities each year. At each date it integrates over all nine environment–response paths for a policy.

The US ranking compares the six available commitments under the chosen values. It does not establish a game-theoretic equilibrium. For a selected response, the browser conditions on that response's probability in each environment. Selecting an AI outcome highlights its incoming paths. Technology trajectories and policy values always integrate over all responses.

## Industrial accounting

Each 2026 path inherits the same pre-decision installed stocks and know-how. The first point shown on the charts is **end-2026**, after the first decision and delivery. Stocks and flows use standardized accelerator capacity units. A year of service from one capacity unit supplies one standardized service unit at full use. Absolute indices have no physical FLOP calibration.

- Annual foreign chip supply grows geometrically. Finished-chip controls cap permitted exports. Diversion recovers part of restricted supply. Procurement mandates and available domestic chips can further reduce actual purchases. Supply retained outside China enters the US-side aggregate. Third-country hardware ownership is aggregated into this supply account.
- Domestic manufacturing output is fabrication potential times the tighter of the SME and memory factors. Fabrication potential grows with know-how and the industrial environment. Domestic deployment is capped by output and buyer demand, which responds to procurement mandates, scarcity and relative domestic quality. Production exceeding domestic deployment contributes manufacturing experience and stays outside the installed stock.
- For each region, installed stock equals surviving stock plus new deployments. New deliveries enter at the beginning of the modeled service interval. Usable physical services are capped by datacenter power. Foreign cloud rentals subtract from US services and add the same amount to Chinese services for the year.
- New manufacturing experience equals domestic output. New operating experience equals the domestic share of actual local services. The new learning increment is proportional to `log(1 + (output + domestic use) / (scale + prior experience))`. The coefficient averages fabrication and operational learning in proportion to their new experience. R&D and knowledge depreciation enter separately.
- Domestic networking inefficiency reduces frontier training services. Software and integration know-how reduce that penalty. Useful AI capability equals training services raised to the compute elasticity, with a share of positive US capability gains available for diffusion to China. The chart's aggregate relative lead divides the expected US quantity by the expected Chinese quantity. Shading shows the full range of the nine individual paths.

## Arrival and persistence

For reference frontier capability, the transition half-time is the number of years to 50% cumulative arrival if capability stays fixed. In year *t*, the first-arrival hazard is

```text
1 − 2 ^ (−(frontier capability / reference capability)^progress exponent / half-time).
```

Multiply this hazard by the probability still awaiting a first transition. A diffusion-adjusted share of new arrivals confers an exclusive lead. The rest enters the shared-frontier state. Among exclusive leads, only a fraction initially qualifies as durable. The US share of these leads is `1 / (1 + (China capability / US capability)^lead sensitivity)`. The remainder goes to China. Each subsequent year an existing durable lead survives with probability `2^(−1 / lead half-life)`.

The five AI states exhaust probability at each year-end. The temporary-lead state includes leads that never met the durability criterion and durable leads whose advantage has expired. The shared state combines near-simultaneous, distributed and rapidly diffused transitions. The model does not distinguish those institutional arrangements further.

## Conflict, catastrophe and value

Annual conflict hazard equals the baseline plus perceived provocation minus deterrence, bounded to [0, 1]. Both additions depend on effective restrictions. Provocation increases with China's own strategic belief. Deterrence increases with a US capability lead. The escalation–deterrence slider changes their relative strengths. The baseline subsumes territorial and other political motives. This model does not simulate a Taiwan invasion or fab capture.

AI catastrophe hazard increases with capability closeness and transition probability. For each event, first incidence this year equals its hazard times the surviving event-free mass. The map reports the cumulative marginal probability of each event. Either risk can coexist with any AI regime or the other risk. No joint event probability is estimated. Technology paths continue after either event, and each first event incurs a one-time modeled loss.

Annual utility has seven components:

| Component | Unweighted flow |
|---|---|
| US economic surplus | Log useful US capability plus surplus on actual foreign sales, minus enforcement cost |
| Chinese economic surplus | Log useful Chinese capability minus domestic investment and diversion cost |
| Third-country spillovers | Log of one plus average useful capability |
| Open access | Log of one plus useful Chinese capability, multiplied by diffusion and reduced by restrictions and perceived strategic stakes |
| Strategic discretion | Extra value of exclusive geopolitical discretion, proportional to the probability of a surviving US lead minus a surviving Chinese lead |
| Conflict losses | Negative severity times first-conflict incidence |
| Catastrophe losses | Negative severity times first-catastrophe incidence |

Both national surplus terms use `log(1 + capability)`. The lens applies a separate weight to each component. A zero discretion weight assigns equal value to either country's exclusive lead. A negative weight favors Chinese discretion. A positive weight favors US discretion. The model awards no first-arrival jackpot. Output and service indices are inputs to annual value and do not receive separate payoffs.

Annual flows are discounted at 3%, with end-2026 receiving unit weight. The selected horizon truncates value without a terminal continuation term. Ranking and decomposition are in arbitrary utility points relative to the comparison policy. Keeping other weights fixed, the break-even discretion weight is `−Δ(other weighted components) / Δ(discretion)`. Each sensitivity row recomputes the outcome probabilities at a different exclusivity assumption.

## Evidence and limits

The December 2024 BIS package covered semiconductor manufacturing equipment and high-bandwidth memory. It motivates offering separate controls for production inputs. [BIS announcement, December 2024](https://www.bis.gov/press-release/commerce-strengthens-export-controls-restrict-chinas-capability-produce-advanced-semiconductors-military)

The DeepSeek-V3 authors describe the hardware, precision and training methods used for one model. Their account motivates a distinction between installed hardware and training services. [DeepSeek-V3 technical report, December 2024](https://arxiv.org/abs/2412.19437)

The references identify mechanisms. Neither estimates the model's initial compute ratios, behavioral elasticities, risk hazards or institutional payoffs. The three environments provide structured sensitivity, not a fitted posterior. Other omissions include strategic bargaining, dynamic changes of Chinese strategy, explicit countries beyond the US and China, separate US/China institutional safety effects, and feedback from realized war or catastrophe. Cross-policy differences and break-even values should be interpreted conditional on these simplifications.

[Python calculation](../src/ai_controls/atlas.py) · [Browser calculation](../web/model.js) · [Configuration](../configs/atlas.yaml) · [Accounting and parity tests](../tests/test_atlas.py)
