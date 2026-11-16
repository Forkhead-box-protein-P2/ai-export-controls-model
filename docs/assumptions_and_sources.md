# Assumptions and sources

`configs/baseline.yaml` is the single registry of assumptions. Each parameter records its definition, units, status, value, range, sampling distribution, correlation factor and source keys. `ai-controls provenance` prints it, and `compare` writes `provenance_<config>.csv` for each configuration. The site's Assumptions table shows the same registry and can export it as CSV.

## Status labels

| Status | Meaning |
|---|---|
| observed | read directly from a dated source in the same units |
| estimated | anchored to a cited source; mapping the source's metric to this parameter is still a judgment |
| elicited | stated by a participant as their own number (none are used as inputs; see below) |
| illustrative | a test input chosen for exploration, not an empirical estimate |

Most parameters are illustrative. The estimated ones cover:

- the starting compute ratio;
- Chinese domestic output and HBM coverage;
- the observed capability lag;
- domestic market shares;
- depreciation;
- datacentre power: China's against the US's, US build-out growth, and Chinese chips' power per FLOP;
- the closest observed Chinese lag (the follower floor);
- smuggling leakage;
- GDP;
- war costs.

## Primitives versus calibration targets

Some quantities are outputs of the response, industrial and hazard modules. They are never imposed as separate effects:

| Quantity | Treatment |
|---|---|
| P(transformative AI by 2035) | target under the reference policy (Maintain); solves the threshold median |
| P(first great-power war by 2040) | target under Maintain; solves the war intercept via cumulative incidence \(1-\prod(1-h_t)\) |
| US:China compute ratio (10× for a decade, 2× through the 2040s) | emergent; reported against Erich Grunewald's stated forecast |
| extra domestic adoption from keeping chip controls (+20 pp in the brief) | emergent; reported in the calibration table |
| domestic output lost to SME/HBM limits (40% in the brief) | emergent, with chip controls held fixed so that captive demand is the same in both runs |
| marginal cumulative war risk (+0.5 pp in the brief) | emergent; decomposed into channels |

## Correlated uncertainty

In the agnostic configuration, parameters that share a factor are drawn through a Gaussian copula:

- **china_industry:** capacity growth, R&D catch-up, learning and know-how decay move together.
- **ai_decisive:** arrival, decisiveness, persistence, transition growth, contestable share, catastrophe base rate and progress-driven belief updates move together.
- **captive:** mandate erosion, quality sensitivity, demand discipline, revenue-funded R&D and software learning move together.

## Sources

All of these are research leads mapped onto parameters. Several are secondary reports or modelled estimates, and their definitions differ.

| Key | Source | Date | Used for |
|---|---|---|---|
| epoch_customs | Epoch AI chip-import data, as reported by OfficeChai | 2026-10-28 | US 72.2% / China 9.6% of cumulative compute since 2022 (about 7.5:1); US 78% of new compute in H1 2026 |
| epoch_clusters | Epoch AI, AI supercomputer performance share by country | 2025-06-05 | US about 75%, China about 15% of GPU-cluster performance |
| ifp_lead | IFP, *How to Increase America's AI Lead Over China* | 2026-10-19 | compute ratio about 9× rising to 13× by end-2027; Chinese domestic output; smuggling; HBM stockpile; lag per 10× compute |
| ifp_blackwell | IFP, *Should the US Sell Blackwell Chips to China?* | 2025-10-25 | modelled 2026 acquisitions under different export choices |
| epoch_huawei | Epoch AI, *Huawei's Roadmap to 2031* | 2026-09-04 | Huawei under 4% of Nvidia's 2026 compute output; three-to-four-year chip lag |
| idc_h1_2026 | IDC data via TechNode | 2026-10-14 | China accelerator market shares, H1 2026 |
| epoch_china_lag | Epoch AI, US vs China on ECI | 2026-01-02 | Chinese models trail by about seven months |
| epoch_open_gap | Epoch AI, open vs closed ECI gap | 2026-05-29 | open models trail by about four months |
| epoch_trends | Epoch AI, Trends | 2026-02-05 | training compute about 5× per year; price-performance about 49% per year |
| imf_weo | IMF WEO projections, via CEOWorld | 2026-11-05 | 2026 nominal GDP |
| bloomberg_taiwan | Bloomberg Economics, via Insurance Journal | 2026-02-12 | output cost of a Taiwan war or blockade |
| fortune_depreciation | Fortune | 2026-04-15 | accelerator useful lives |
| semianalysis_power, iea_energy_ai | SemiAnalysis via AI Weekly; IEA *Energy and AI* | 2026-10-08; 2025 | datacentre capacity and electricity |
| cnas_smuggling, epoch_smuggling | CNAS; Epoch AI | 2025-06-11; 2026-04-29 | chip smuggling ranges |
| covington_h200 | Covington on the BIS licence-review rule | 2026-01 | status of H200-class licensing |
| trendforce_sme, trendforce_duv, cxmt_hbm | TrendForce; Korea JoongAng Daily | 2026 | domestic equipment push, DUV testing, CXMT HBM3E |
| openrouter_soai | OpenRouter, *State of AI* | 2025 | Chinese open-model token share |
| semianalysis_cm384 | SemiAnalysis, *Huawei AI CloudMatrix 384* | 2025-04-16 | 2.5× worse power per FLOP than Nvidia's NVL72 (`ppw_gamma`); China limited by silicon, not power |
| lbnl_dc_2024 | LBNL *2024 US Data Center Energy Usage Report*, via DOE | 2024-12-20 | US datacentre electricity growth to 2028 (`g_e_us`) |
| ai_index_2025 | Stanford HAI, *2025 AI Index*, R&D chapter | 2025-04 | notable models by country, for the scale of `cn_spill` |
| armstrong_race | Armstrong, Bostrom and Shulman, *AI & Society* | 2016 | theory behind `race_risk`; no empirical size |
| kapoor_open, seger_open | Kapoor, Bommasani et al.; Seger et al. (GovAI) | 2024; 2023 | opposing views behind `open_risk`; central value zero |

The full URLs are in `configs/baseline.yaml` and on the site.

## Where sources disagree

- **US:China compute ratio.** Estimates run from about 5:1 (installed cluster performance, mid-2025) to about 7.5:1 (cumulative chip arrivals, Q2 2026) and about 9:1 (modelled, end-2026). These are different metrics.
- **Nvidia's 2026 China share.** IDC reports 34% of H1 2026 units. Other analysts forecast single digits.
- **Huawei's 2026 output.** Estimates differ between unit counts and H100-equivalents. HBM is the binding constraint in most accounts.
- **SMIC advanced-node capacity and yields.** Reports differ by a factor of three or more.
- **Chinese model lag.** Estimates run from 4 to 7 months depending on the benchmark, and an Arena-score gap is a different metric again. On Epoch's index the gap since 2023 has ranged from 4 to 14 months, averaging 7.
- **Whether power binds.** SemiAnalysis argues China has no power constraint and is limited by silicon. US datacentre build-out is widely reported as power-limited in the late 2020s. Published estimates of China's datacentre capacity differ widely.
- **Taiwan conflict probabilities.** Forecasting-platform snapshots vary widely. The baseline war target is an illustrative input, not a measured probability.
- **Points not confirmed against primary documents.** The October 2022 and October 2023 rule dates and the 2025 H20 timeline came from search summaries and were not re-verified.

## Empirical work still to do

- Replace secondary reports with primary data on accelerator deliveries, installed stock and usable training compute, with consistent definitions.
- Estimate HBM, packaging and equipment capacity paths, and the learning curves for forced substitution.
- Measure domestic-versus-imported chip use by Chinese labs, and performance per watt.
- Separate datacentre power from national generation.
- Measure the open-versus-closed frontier gap and downstream usage of open models.
- Find empirical work on first-mover persistence and diffusion speed in general-purpose technologies.
- Find estimates of each conflict channel, with both signs.
