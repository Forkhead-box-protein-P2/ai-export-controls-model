# Debate context

The model was built to make a public disagreement about US AI export controls precise. The exchange began in November 2026 under a Substack post that asked why it would be bad for people in China to buy leading US AI chips. Prosperity, export sales and scientific progress have value, and generic reasons to want China poorer do not single out chips over soybeans or phones. A possible exception is if the *marginal* capability mainly produced military rather than civilian benefit. Two commenters then took up opposing positions.

This page summarises the propositions. It does not reproduce the thread. Numbers attributed to a participant are only the ones they stated as their own forecasts.

## The case for strong controls (Erich Grunewald)

- A large US lead is better for the world, not only for the US. It gives developers and the government room to test and secure frontier systems and to avoid panicked decisions. It also keeps frontier development mostly within a pluralistic society with checks and balances.
- AGI/ASI is, in expectation, a very big deal and fairly likely to be decisive. It could lock in a long-lasting advantage, and badly handled development could be catastrophic.
- **Stated forecast:** the controls are more likely than not to produce a substantial US compute advantage. That advantage is roughly 10× or more for the next decade and 2× or more through the 2040s. It would be much smaller if chip, HBM and SME controls were eased. *These are forecasts, not observations, and the metric behind "compute advantage" is not pinned down.*
- The stakes are asymmetric. Keeping a large lead in decisive worlds matters more than the trade, tension and open-model costs in non-decisive worlds, and decisive worlds are more likely.
- Chinese leaders appear less focused on AGI than relevant Americans. Given nuclear and other deterrence, China is unlikely to escalate militarily merely to stop a US lead unless the regime feels threatened. Some Taiwan scenarios remain a worry.
- Beijing will secure a captive market for domestic chipmakers whether or not controls stay. Easing HBM and SME controls would let them produce more and so learn faster. The net effect on domestic production of easing chip controls specifically is small or unclear.
- China's electricity advantage matters little. Without chips, power does not help, and energy is a small share of AI cost.

## The case for caution (fox)

- AGI arriving and AI being strategically decisive are different things. Improvement, diffusion, specialisation, competition and institution-building can continue for decades, even if AI systems become largely independent economic principals. The relevant strategic horizon is therefore long, and a policy optimised for the next few years can be very costly if the world in 25 years still works roughly normally. Sharp transitions by about 2030 are taken seriously, but as a matter of probability and payoff.
- Competitive *useful* AI need not require parity across the whole semiconductor stack. Chip volume, energy, deployment, algorithms, architecture, utilisation, networking and software partly substitute for one another, within limits.
- The costs exceed ordinary losses from restricted trade. Chinese open-weight models are a major competitive pressure on closed US providers. Controls may weaken openness, diffusion, downstream entrepreneurship and user autonomy.
- Controls may modestly raise the marginal risk of great-power war, by making Taiwan a more important point of denial. This is not China's underlying reason for wanting Taiwan, which belongs in the baseline risk. Tension, mistrust and decoupling are costly even without war.
- Forcing Chinese labs, clouds and builders onto domestic hardware creates a captive market for learning by doing. That could speed domestic know-how even while equipment controls cut output.
- A market is less captive when buyers *can* choose better US chips. Mandates and subsidies preserve some demand under either policy, but they are not equivalent to banning superior substitutes.
- Beijing's beliefs may differ from Washington's. That is a coherent asymmetry, but US behaviour can signal how strategic Washington thinks AI is, and beliefs can change. Deterrence and regime security push the other way, and the model should test these effects rather than assume them.
- The right limiting principle is technology-specific cost–benefit analysis. Controls on predominantly military technologies can pass that test when controls on general-purpose AI chips do not.

## What the model takes from this

Each claim became a mechanism with a parameter, so that its strength can be varied rather than assumed:

| Claim | Where it lives |
|---|---|
| Arrival is not decisiveness; decisiveness is not durability | separate draws for arrival, decisiveness, capture and persistence (`p_tai_2035`, `p_high_dec`, `lead_conv`, `p_persist10`) |
| A lead buys safety | `lead_safety`, `race_risk` |
| Pluralism of the leading society | `p_adverse_us`, `p_adverse_cn`, `adverse_cost` |
| Compute advantage of about 10× for a decade and 2× through the 2040s | emergent from the industrial module; reported against the stated forecast |
| Captive market regardless of controls, or less captive with US chips available | `mandate_erosion`, `pref_dq`, `lab_sens`, `learn_soft` |
| Easing HBM/SME speeds Chinese production and learning | equipment access in capacity growth and in R&D returns (`eta_sme`, `rd_tool_dep`, `spill_k`) |
| Power cannot replace missing chips, but substitutes at the margin | power caps usable stock; algorithms partly substitute for compute (`alpha_T`, `diff_rate`) |
| Open-model competition and user autonomy | open-model pressure `O`, provider markups, the liberty index |
| Taiwan as a point of denial, deterrence, interdependence, signalling | four war-logit channels plus China's belief update (`th_sdi`, `th_det`, `th_I`, `th_T`, `sig_eta`) |
| Beliefs differ between capitals | China's beliefs and objective in the strategic game (`china_beliefs`, `china_objective`) |
