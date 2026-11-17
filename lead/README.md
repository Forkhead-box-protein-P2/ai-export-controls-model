# What is a month of AI lead worth?

A small decision model of US export controls on AI chips, chipmaking tools and memory. It follows one policy comparison (A against B) through four steps and reports the price at which the two policies tie.

Page: `lead/index.html` (served at `/lead/` on the project site). The whole model is `model.js`, about 250 lines with no dependencies. The browser page and the tests import the same file, so there is one implementation.

## Why it is built this way

The comparison turns on one intermediate quantity: the months of frontier lead that controls buy. Each step converts one thing into the next and can be argued about separately.

| Step | Converts | Main inputs |
|---|---|---|
| 1 | policy → US:China compute ratio | China's appetite, leakage, the captive market, its chip industry's growth and catch-up, the tool-control choke |
| 2 | compute ratio → months of US lead | months per tenfold of compute (IFP) |
| 3 | months of lead → outcome probabilities | chance and timing of a decisive window, the critical lead, loss-of-control risk, values |
| 4 | outcomes and standing costs → value | stakes, chip sales, third-country cost, open-model cost, war risk |

Three choices do most of the work.

**Decisiveness is a curve.** A "decisive window" is a period in which a lead can be converted into durable dominance. The critical lead `tau` is the lead at which the leader has an even chance of doing so. A few months means a sharp transition. Several years means almost no lead is convertible. Whether transformative AI arrives is a separate question from whether a lead can be converted, and the model only needs the second.

**Loss of control is scored the same whoever was ahead.** Nationality matters only on the branches where control is kept. Racing can still raise the risk: the contested case has its own probability.

**China responds.** Barred demand partly leaks back in. What foreign chips do not serve becomes a captive market for Chinese chipmakers, and Beijing reserves some of the market regardless. One drive term, the captive share less the choke from tool controls, sets how fast Chinese output grows and how fast each chip catches up. Chip controls push it up and tool controls push it down, and the net is an output. War risk rises in decisive worlds to the extent Beijing shares the belief that motivates the policy.

## The equations

```
1  foreign  = (1 − chips) + chips · leak · (1 − enforce)
   captive  = max(mandate, 1 − foreign)
   domestic = min(q · e, captive · appetite)
   flow     = domestic + min(foreign · appetite, appetite − domestic)
   c'       = (1 − turnover) · c + turnover · flow          R = 1 / c
   drive    = captive · (1 − choke · tools)
   q'       = q · (1 + growth · drive) / (1 + usGrowth)
   e'       = e + catchup · drive · (1 − e)

2  lead     = lead0 + beta · log10(R / R0)

3  P(window opens in year t) = pD · lognormal(t; median tMed)
   P(US clearly ahead)    = E[ x³ / (x³ + tau³) ],  x = lead + noise > 0
   P(China clearly ahead) = the same with −x;  otherwise contested
   score = Σ P(case) · (1 − q_case) · v_case / 100

4  strategic   = stakes · Σ_t P(window in t) · d_t · (score_A − score_B)
   lead value  = Σ_t d_t g_t · (bLead − bOpen) · (lead_A − lead_B)
   sales       = Σ_t d_t g_t · surplus · market · Δ(foreign chips bought / appetite)
   third       = −Σ_t d_t g_t · third · Δ(enforce · chips)
   war         = −warCost · Δ[ denial · w0 + denial at window · w1 · kappa · pD ]
```

`c` is China's compute stock over the US's. `q` is Chinese chip units over US unit purchases. `e` is the performance of a Chinese chip over the US frontier chip. A policy is three levers in [0, 1]: `chips`, `enforce`, `tools`. A policy can also carry a second set of levers that the US switches to when it has `warning` years' notice of a window.

## The numbers

`params.js` is the only place numbers live. There are 36: 4 read from a dated source, 6 fitted so the model reproduces a published figure, and 26 judgments with ranges. Sixteen are shown on the page by default; the rest sit under "More assumptions".

The compute step is anchored to two published projections, and `test/model.test.mjs` fails if the defaults drift from them:

| Published | Value | Model at defaults |
|---|---|---|
| IFP: ratio at end of 2027, controls kept | 13× | 11.4× |
| Forethought: ratio in 2029, controls kept | 12.4× | 12.7× |
| Forethought: ratio in 2029, chip controls fail from 2027 | 3.8× | 3.9× |
| Months bought in 2029 at IFP's 5.4 per tenfold | 2.7 | 2.8 |

The three belief presets (Middle, Continuous, Decisive) are illustrative encodings of two styles of argument. They are not numbers anyone has stated, with one exception: the Decisive preset's industry settings are chosen so that current controls keep the ratio at 10× or more for a decade and 2× or more through the 2040s, which is a forecast Erich Grunewald stated in the exchange summarised in `docs/debate_context.md`.

## Run it

```bash
node --test lead/test/model.test.mjs   # 11 tests
node lead/cli.mjs                      # headline tables for each preset
python3 -m http.server 8765            # then open http://localhost:8765/lead/
```

## What it leaves out

- China's yearly purchases are capped at its appetite, so faster indigenisation shortens the period in which controls bind but cannot push the ratio below what selling chips would produce.
- The compute stock turns over at a constant rate. At the default more than half is under a year old, which is why a late cut-off recovers most of the gap within two years. Slower growth or Chinese stockpiling would weaken that.
- The lead depends on the compute ratio alone. Algorithms, talent and concentration are held at today's levels.
- There is one window and one conversion curve. Nothing after the window is modelled.
- China's responses are response functions. A fuller game would derive them from Beijing's own payoffs.
- Third-country buyers switching to Chinese suppliers appear as a cost, not as demand that speeds China's industry.
