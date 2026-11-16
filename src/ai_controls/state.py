"""Shared names: policy dimensions, random streams, recorded series, payoff components."""
from __future__ import annotations

# Policy vector x_t = [chips, hbm, sme, cloud, enforcement], each in [0, 1].
X_DIMS = ("chips", "hbm", "sme", "cloud", "enforcement")
# Weights that collapse the four restriction dimensions into one perceived
# restrictiveness index R_t (enforcement scales leakage instead).
R_WEIGHTS = (0.40, 0.15, 0.30, 0.15)

# Random streams. Parameter draws use 1000 + parameter index; factor draws 900 + k.
STREAMS = {
    "no_threshold": 1, "theta": 2, "dec_mix": 3, "dec_val": 4, "persist": 5,
    "adverse": 6, "tw": 7, "war_type": 8, "war_escal": 9, "open_shock": 10, "dist": 11, "intrinsic": 12,
    "alg_common": 20, "alg_cn": 21, "war": 22, "cat": 23, "war_ar": 24, "obs": 25,
}
STREAM_FACTOR0 = 900
STREAM_PARAM0 = 1000

# Per-year series recorded for every simulation (means and quantiles are reported).
SERIES = (
    "x_chips", "x_hbm", "x_sme", "x_cloud", "x_enf", "R",
    "m", "y_rd", "y_ret", "h", "b_cn",
    "W", "D", "pref", "acc", "Q_dom", "dom_add", "imports", "remote",
    "dom_share", "util_ratio", "bind_hbm",
    "C_us", "C_cn", "ratio_stock", "S_us", "S_cn", "ratio_train", "pf_us", "pf_cn",
    "K_logic", "K_hbm", "K_sme", "K_soft",
    "logA_us", "logA_cn", "lag_years", "O",
    "T", "I", "h_war", "h_cat", "adv_us", "adv_cn",
    "cat_raw", "cat_cn", "cat_noslack", "cat_norace", "cat_nonat", "cat_noopen",
    "war_T", "war_sdi", "war_det", "war_I",
    "up_us", "up_cn", "up_row",
    "arrived", "war_cum", "cat_cum",
)

# Discounted payoff components. Money components are trillions of 2026 US dollars;
# index components are index-years. Suffixes name the actor.
COMPONENTS = (
    "ai_us", "ai_cn", "ai_row",          # AI-driven output
    "trade_us", "trade_cn", "trade_row",  # export profit, retaliation, decoupling, subsidy cost
    "open_us", "open_cn", "open_row",     # open-model gains net of markups paid by users
    "rent_us",                            # markups received by US model providers
    "lead_us", "lead_cn", "lead_row",     # capture of contestable post-transition surplus
    "inst_us", "inst_cn", "inst_row",     # cost of an institutionally adverse durable order
    "war_us", "war_cn", "war_row",        # war losses (negative)
    "cat_us", "cat_cn", "cat_row",        # AI-catastrophe losses (negative)
    "sec_us", "sec_cn",                   # security / coercion index-years
    "liberty",                            # openness and pluralism index-years
    "trust",                              # integration minus tension index-years
    "advyrs_us", "advyrs_cn",             # durable-advantage index-years by leader
    "sov_cn",                             # China's sovereign technological capacity index-years
)

# Groups used when decomposing a policy difference.
GROUPS = {
    "Economics": ("ai_us", "ai_cn", "ai_row", "trade_us", "trade_cn", "trade_row", "rent_us"),
    "Openness": ("open_us", "open_cn", "open_row", "liberty"),
    "Security": ("sec_us", "sec_cn"),
    "Conflict": ("war_us", "war_cn", "war_row"),
    "AI safety": ("cat_us", "cat_cn", "cat_row"),
    "Durable lead": ("lead_us", "lead_cn", "lead_row", "inst_us", "inst_cn", "inst_row", "advyrs_us", "advyrs_cn"),
    "Integration": ("trust",),
}

REGIMES = (
    "us_durable", "us_transient", "cn_durable", "cn_transient",
    "near_simultaneous", "distributed", "no_monopoly", "no_sharp",
)
REGIME_LABELS = {
    "us_durable": "Durable US lead",
    "us_transient": "US lead that dissipates",
    "cn_durable": "Durable Chinese lead",
    "cn_transient": "Chinese lead that dissipates",
    "near_simultaneous": "Near-simultaneous arrival",
    "distributed": "Distributed frontier",
    "no_monopoly": "Transformation without strategic monopoly",
    "no_sharp": "No sharp transition by 2050",
}
