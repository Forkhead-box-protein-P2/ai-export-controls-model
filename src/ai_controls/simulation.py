"""The simulator: one annual step applied to every simulated world at once.

Within-year sequence
    1. the US sets its policy vector (year 0 is the inherited status quo);
    2. China observes it and responds (mandates, R&D and subsidies, retaliation, evasion);
    3. the domestic industry produces what its bottlenecks allow;
    4. Chinese buyers split demand between domestic chips and imports;
    5. hardware stocks, power, compute services and capability follow;
    6. transition, catastrophe and war hazards are drawn;
    7. payoff flows are recorded and the state advances.

New hardware delivered during a year becomes usable at the start of the next year.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace

import numpy as np

from . import ai_transition, china_response, compute, geopolitics, industry, payoffs, policies, rng
from .parameters import Config
from .state import COMPONENTS, SERIES, STREAMS

EPS = 1e-12
NEVER = 10 ** 6


@dataclass
class Calibration:
    """Primitives solved from targets stated for the reference policy."""
    theta_med: float = 8.0   # median transition threshold, nats above 2026 US capability
    th0: float = -5.0        # war-logit intercept
    p_tai_2035: float = float("nan")
    war_2040: float = float("nan")


@dataclass
class SimResult:
    years: list
    series: dict            # name -> (n_years, n) array
    comps: np.ndarray       # (n, n_components) discounted payoff components
    events: dict            # per-simulation outcome variables
    calib_front: np.ndarray | None = None
    calib_logit: np.ndarray | None = None
    extras: dict = field(default_factory=dict)


def _ns(p: dict, n: int) -> SimpleNamespace:
    return SimpleNamespace(**{k: np.broadcast_to(np.asarray(v, dtype=float), (n,)) for k, v in p.items()})


def simulate(cfg: Config, p: dict, policy: dict, n: int, seed: int, calib: Calibration, *,
             events: bool = True, stance: dict | None = None, lead_path=None,
             record: bool = True) -> SimResult:
    """Simulate ``n`` paired worlds under one policy.

    ``events=False`` runs the event-free path used for calibration: no transition,
    catastrophe or war is triggered. ``lead_path`` replaces the endogenous US:China
    training-compute ratio with an imposed path (a reduced-form stress test).
    """
    n_years = cfg.n_years
    sims = np.arange(n)
    P = _ns(p, n)
    stance = stance or {"indig": 1.0, "conf": 1.0}
    U = lambda name, t=0: rng.uniform(seed, STREAMS[name], sims, t)
    Z = lambda name, t=0: rng.normal(seed, STREAMS[name], sims, t)
    zeros = lambda: np.zeros(n)
    false = lambda: np.zeros(n, dtype=bool)

    # World types: fixed across policies.
    theta, dec, half_life = ai_transition.world_types(seed, sims, P, calib.theta_med, U, Z)
    if not events:
        theta = np.full(n, np.inf)
    u_adv, u_wtype, u_esc, u_dist = U("adverse"), U("war_type"), U("war_escal"), U("dist")
    tw_shock = P.th_tw_sd * Z("tw")
    open_shock = P.open_sigma * Z("open_shock")

    # Initial state (start of 2026).
    C_us = P.c_us0.copy()
    C_cn0 = P.c_us0 / P.ratio0
    C_dom = C_cn0 * P.stock_dom_share0
    C_imp = C_cn0 - C_dom
    K_logic, K_hbm, K_sme, K_soft = P.k_logic0.copy(), P.k_hbm0.copy(), P.k_sme0.copy(), P.k_soft0.copy()
    logic_out0 = P.qdom_share0 * P.w0 / (P.final_yield * industry.chip_quality(K_logic, P))
    L = logic_out0 / industry.yields(K_logic, P)
    H = P.hbm_cov0 * logic_out0 / industry.yields(K_hbm, P)
    HS = P.hbm_stock0 * logic_out0
    Pk = P.pack_cov0 * logic_out0
    E_logic = P.exp_years0 * logic_out0 * P.final_yield
    E_hbm = P.exp_years0 * P.hbm_cov0 * logic_out0
    E_sme = P.exp_years0 * (L + H) * industry.SME_EXP_GROWTH0 * industry.SME_EXP_SHARE0
    E_soft = P.exp_years0 * C_dom * P.util
    Es_logic, Es_hbm, Es_sme, Es_soft = E_logic.copy(), E_hbm.copy(), E_sme.copy(), E_soft.copy()
    h, b_cn = P.h0.copy(), P.b_cn0.copy()
    B = P.backlog0 * C_cn0
    G_us, G_cn = zeros(), zeros()
    T, I = P.T0.copy(), P.I0.copy()
    cumW = zeros()
    tai_us, tai_cn, tai_row = zeros(), zeros(), zeros()
    ppw_rel0 = np.exp(-P.ppw_gamma * (1.0 - K_logic))
    E_us0 = P.pow_slack_us0 * C_us
    E_cn0 = P.pow_slack_cn0 * (C_imp + C_dom / ppw_rel0)

    arrived, near_sim, distributed = false(), false(), false()
    t_arr = np.full(n, NEVER)
    leader = np.zeros(n, dtype=int)
    lead0, kcap = zeros(), zeros()
    war, escal, cat = false(), false(), false()
    t_war, t_cat = np.full(n, NEVER), np.full(n, NEVER)
    wtype = np.full(n, 2)
    dep_at_war = zeros()
    cat_surv = np.ones(n)
    R_prev = x_prev = acc = None
    lag_prev = zeros()
    Tr_us0 = inf_us0 = inf_cn0 = avail0 = None

    series = {name: np.zeros((n_years, n)) for name in SERIES} if record else {}
    comps = np.zeros((n, len(COMPONENTS)))
    calib_front = np.zeros((n_years, n))
    calib_logit = np.zeros((n_years, n))
    ratio_train_path = np.zeros((n_years, n))

    for t in range(n_years):
        # 1. US policy.
        lag_obs = lag_prev + P.obs_noise * Z("obs", t)
        x = policies.policy_vector(policy, t, n, cfg.status_quo, x_prev, lag_obs)
        x = np.where(war[:, None], 1.0, x)  # embargo after a war
        R = policies.restrictiveness(x)
        if t == 0:
            R_prev = R.copy()

        # 2. China's response.
        m, y_rd, y_ret, y_fa = china_response.respond(R, R_prev, h, b_cn, P, stance)
        xc, xh, xs, xcl = policies.effective(x, y_fa, P)

        # 3. Western accelerator supply.
        g_w = P.g_w_inf + (P.g_w0 - P.g_w_inf) * 0.5 ** (t / P.g_w_halflife)
        W_nom = P.w0 * np.exp(cumW)
        cu_chip = np.exp(P.perf_share * cumW)
        dep_tw = geopolitics.taiwan_dependence(t, P)
        scarcity_t = P.scarcity * 0.5 ** (t / P.scarcity_halflife)
        W = W_nom * (1.0 - geopolitics.fab_loss(war, t, t_war, wtype, dep_at_war, P))

        # 4. Domestic industry output.
        a_sme = industry.sme_access(xs, K_sme)
        ind = industry.output(L, H, HS, Pk, K_logic, K_hbm, xh, cu_chip, P)
        captured = war & (wtype == 1) & (t >= t_war + 2)
        Q_dom = ind["Q_dom"] + np.where(captured, P.capture_yield * dep_at_war * W_nom, 0.0)

        # 5. Chinese hardware market.
        usab = P.usab_min + (1.0 - P.usab_min) * K_soft
        q_imp = 1.0 - P.q_imp_floor * x[:, 0]
        acc_target = 1.0 - xc
        acc = acc_target.copy() if t == 0 else compute.update_access(acc, acc_target, P)
        pref = compute.preference(m, acc, h, q_imp, ind["q_chip"] * usab, P)
        D = P.demand_share * W_nom * (1.0 + P.sal_b * (b_cn - P.b_cn0))
        dom_add, imports, unmet, util_ratio, Dd = compute.market(D, Q_dom, W, pref, acc, P)
        legal_imports = imports * (1.0 - x[:, 0]) / np.maximum(acc_target, EPS)
        dom_share = dom_add / np.maximum(dom_add + imports, EPS)
        cn_exports = P.cn_export_share * np.minimum(np.maximum(Q_dom - Dd, 0.0),
                                                    compute.MAX_CN_EXPORT_SHARE * W_nom)

        # 6. Remote compute, power and services.
        remote = P.cloud_suit * B * (1.0 - xcl)
        ppw_idx = np.exp(P.ppw_share * cumW)
        ppw_rel = np.exp(-P.ppw_gamma * (1.0 - K_logic))
        pf_us = compute.power_factor(C_us / ppw_idx, E_us0 * np.exp(P.g_e_us * t))
        pf_cn = compute.power_factor((C_imp + C_dom / ppw_rel) / ppw_idx, E_cn0 * np.exp(P.g_e_cn * t))
        S_us, S_cn, Tr_us, Tr_cn = compute.services(C_us, C_dom, C_imp, remote, usab, pf_us, pf_cn,
                                                    scarcity_t, P)
        if lead_path is not None:
            Tr_cn = Tr_us / lead_path[t]
        inf_us, inf_cn = (1.0 - P.train_share) * S_us, (1.0 - P.train_share) * S_cn
        if t == 0:
            Tr_us0, inf_us0, inf_cn0 = Tr_us.copy(), inf_us.copy(), inf_cn.copy()

        # 7. Capability and openness. China's 2026 algorithmic index is set so that the
        # capability lag starts at its observed value.
        rate = P.alpha_T * g_w + P.g_alg
        if t == 0:
            G_cn = -(P.lag0 * rate + P.alpha_T * np.log(Tr_cn / Tr_us))
        logA_us, logA_cn = ai_transition.capability(Tr_us, Tr_cn, Tr_us0, G_us, G_cn, P)
        lag_years = (logA_us - logA_cn) / rate
        front, open_front, open_cn, O = ai_transition.openness(logA_us, logA_cn, T, b_cn, open_shock, P)
        avail = {"us": np.maximum(logA_us, open_front), "cn": np.maximum(logA_cn, open_front),
                 "row": np.maximum(open_front, logA_us - ai_transition.ROW_API_GAP)}
        if t == 0:
            avail0 = {a: v.copy() for a, v in avail.items()}

        # 8. Transition.
        new_arr = ~arrived & (front >= theta)
        if new_arr.any():
            gap = np.abs(lag_years)
            dist_now = u_dist < np.exp(-np.maximum(front - open_front, 0.0) / P.dist_gap)
            leader = np.where(new_arr, np.where(logA_us >= logA_cn, 1, 2), leader)
            lead0 = np.where(new_arr, gap, lead0)
            distributed = np.where(new_arr, dist_now, distributed)
            near_sim = np.where(new_arr, gap < P.sim_window, near_sim)
            kcap = np.where(new_arr, ai_transition.capture_share(dec, gap, O, dist_now, P), kcap)
            t_arr = np.where(new_arr, t, t_arr)
            arrived = arrived | new_arr
        yrs_since = np.maximum(t - t_arr, 0)
        adv = np.where(arrived, kcap * 0.5 ** (yrs_since / half_life), 0.0)
        prox = ai_transition.proximity(arrived, yrs_since, theta, front, P)
        adverse = np.where(leader == 1, u_adv < P.p_adverse_us,
                           np.where(leader == 2, u_adv < P.p_adverse_cn, False))

        # 9. Catastrophe hazard.
        h_cat_raw = ai_transition.catastrophe_hazard(prox, lag_years, T, logA_cn > logA_us, O, P)
        cat_surv = cat_surv * (1.0 - h_cat_raw)
        h_cat = np.where(cat, 0.0, h_cat_raw)
        if events:
            new_cat = ~cat & (U("cat", t) < h_cat)
            t_cat = np.where(new_cat, t, t_cat)
            cat = cat | new_cat

        # 10. War hazard.
        parts = geopolitics.war_logit_parts(T, I, b_cn, dep_tw, xc, lag_years, P)
        shock = tw_shock + P.th_ar_sd * Z("war_ar", t)
        h_war = np.where(war, 0.0, geopolitics.war_hazard(calib.th0, parts, shock))
        calib_front[t] = front
        calib_logit[t] = parts[0] + parts[1] + parts[2] + parts[3] + shock
        if events:
            new_war = ~war & (U("war", t) < h_war)
            if new_war.any():
                t_war = np.where(new_war, t, t_war)
                wtype = np.where(new_war, geopolitics.war_type(u_wtype, P), wtype)
                escal = np.where(new_war, u_esc < P.war_escal, escal)
                dep_at_war = np.where(new_war, dep_tw, dep_at_war)
                war = war | new_war

        # 11. Payoff flows.
        gdp = {"us": P.gdp_us0 * (1.0 + P.g_us) ** t, "cn": P.gdp_cn0 * (1.0 + P.g_cn) ** t,
               "row": P.gdp_row0 * (1.0 + P.g_row) ** t}
        base_up = {
            "us": payoffs.base_uplift(avail["us"], avail0["us"], inf_us, inf_us0, P),
            "cn": payoffs.base_uplift(avail["cn"], avail0["cn"], inf_cn, inf_cn0, P),
            "row": payoffs.base_uplift(avail["row"], avail0["row"], inf_us, inf_us0, P),
        }
        sev = np.where(wtype == 0, geopolitics.WAR_SEVERITY["deny"],
                       np.where(wtype == 1, geopolitics.WAR_SEVERITY["capture"],
                                geopolitics.WAR_SEVERITY["limited"]))
        fl = payoffs.flows({
            "gdp_us": gdp["us"], "gdp_cn": gdp["cn"], "gdp_row": gdp["row"],
            "base_up_us": base_up["us"], "base_up_cn": base_up["cn"], "base_up_row": base_up["row"],
            "tai_up_us": tai_us, "tai_up_cn": tai_cn, "tai_up_row": tai_row,
            "O": O, "T": T, "I": I, "adv": adv, "leader": leader, "adverse": adverse,
            "legal_imports": legal_imports, "cu_chip": cu_chip, "y_ret": y_ret, "y_rd": y_rd,
            "scarcity_t": scarcity_t, "cn_exports": cn_exports,
            "in_war": war & (t >= t_war) & (t < t_war + P.war_years), "war_sev": sev,
            "escalated": war & escal & (t >= t_war), "p_cat": 1.0 - cat_surv,
            "arrived": arrived, "lag_years": lag_years,
            "k_mean": 0.25 * (K_logic + K_hbm + K_sme + K_soft),
        }, P)
        disc = (1.0 + P.discount_rate) ** (-t)
        mult = disc * (1.0 + payoffs.terminal_factor(P)) if t == n_years - 1 else disc
        for k, name in enumerate(COMPONENTS):
            comps[:, k] += mult * fl[name]

        ratio_train_path[t] = Tr_us / np.maximum(Tr_cn, EPS)
        if record:
            rec = {
                "x_chips": x[:, 0], "x_hbm": x[:, 1], "x_sme": x[:, 2], "x_cloud": x[:, 3],
                "x_enf": x[:, 4], "R": R, "m": m, "y_rd": y_rd, "y_ret": y_ret, "h": h, "b_cn": b_cn,
                "W": W, "D": D, "pref": pref, "acc": acc, "Q_dom": Q_dom, "dom_add": dom_add,
                "imports": imports, "remote": remote, "dom_share": dom_share,
                "util_ratio": util_ratio, "bind_hbm": ind["bind_hbm"],
                "C_us": C_us, "C_cn": C_dom + C_imp, "ratio_stock": C_us / np.maximum(C_dom + C_imp, EPS),
                "S_us": S_us, "S_cn": S_cn, "ratio_train": ratio_train_path[t],
                "K_logic": K_logic, "K_hbm": K_hbm, "K_sme": K_sme, "K_soft": K_soft,
                "logA_us": logA_us, "logA_cn": logA_cn, "lag_years": lag_years, "O": O,
                "T": T, "I": I, "h_war": h_war, "h_cat": h_cat,
                "adv_us": np.where(leader == 1, adv, 0.0), "adv_cn": np.where(leader == 2, adv, 0.0),
                "war_T": parts[0], "war_sdi": parts[1], "war_det": parts[2], "war_I": parts[3],
                "up_us": base_up["us"] + tai_us, "up_cn": base_up["cn"] + tai_cn,
                "up_row": base_up["row"] + tai_row,
                "arrived": arrived.astype(float), "war_cum": war.astype(float),
                "cat_cum": cat.astype(float),
            }
            for name in SERIES:
                series[name][t] = rec[name]

        # 12. Advance the state.
        C_dom_old = C_dom
        C_us = (1.0 - P.dep) * C_us + P.us_share_w * np.maximum(W - scarcity_t * imports, 0.0)
        C_dom = (1.0 - P.dep) * C_dom + dom_add
        C_imp = (1.0 - P.dep) * C_imp + imports
        B = (1.0 - P.dep) * B + unmet

        L_new, H_new, Pk = industry.expand(L, H, Pk, a_sme, y_rd, Dd, Q_dom, ind["logic_out"],
                                           ind["hbm_dom"], g_w, P)
        new_logic = dom_add / np.maximum(ind["q_chip"] * cu_chip, EPS)
        new_hbm = np.minimum(ind["hbm_dom"], ind["logic_out"])
        new_sme = np.maximum(L_new - L + H_new - H, 0.0) * (P.sme_share0 + (1.0 - P.sme_share0) * xs)
        new_soft = (C_dom_old * pf_cn * P.util / cu_chip
                    * ((1.0 - P.lab_sens) + P.lab_sens * dom_share))
        lrn = industry.learning_increment
        rd_eff = y_rd + P.rev_rd * dom_add / np.maximum(D, EPS)
        rd_mult = np.log1p(rd_eff) / np.log(2.0)
        tool = 1.0 - P.rd_tool_dep * (1.0 - a_sme)
        one = np.ones(n)
        K_logic = industry.update_knowhow(K_logic, P.rd_logic, rd_mult, tool,
                                          lrn(E_logic, new_logic, Es_logic, P.learn_logic), 1.0 - xs, P)
        K_hbm = industry.update_knowhow(K_hbm, P.rd_hbm, rd_mult, tool,
                                        lrn(E_hbm, new_hbm, Es_hbm, P.learn_hbm), 1.0 - xh, P)
        K_sme = industry.update_knowhow(K_sme, P.rd_sme, rd_mult, one,
                                        lrn(E_sme, new_sme, Es_sme, P.learn_sme), 1.0 - xs, P)
        K_soft = industry.update_knowhow(K_soft, P.rd_soft, rd_mult, one,
                                         lrn(E_soft, new_soft, Es_soft, P.learn_soft), zeros(), P)
        E_logic, E_hbm, E_sme, E_soft = E_logic + new_logic, E_hbm + new_hbm, E_sme + new_sme, E_soft + new_soft
        L, H = L_new, H_new
        HS = HS - ind["hbm_draw"]

        # Algorithms. The follower's own progress depends on its relative compute, and
        # diffusion pulls its gap back toward ``alg_anchor``, which is set so that the
        # 2026 gap implied by the observed lag is a steady state at the 2026 compute ratio.
        z_c, z_i = Z("alg_common", t), Z("alg_cn", t)
        rel = np.minimum(Tr_cn / np.maximum(Tr_us, EPS), 1.0) ** P.theta_exp
        kappa = P.diff_rate * (1.0 + P.diff_open * O)
        if t == 0:
            alg_anchor = (G_us - G_cn) - P.g_alg * (1.0 - rel) / kappa
        G_cn = (G_cn + P.g_alg * rel + kappa * (G_us - G_cn - alg_anchor)
                + P.sigma_alg * (z_c + 0.5 * z_i))
        o_cn = np.exp(-np.maximum(front - open_cn, 0.0) / P.open_scale)
        G_us = G_us + P.g_alg * (1.0 + P.cn_spill * rel * o_cn) + P.sigma_alg * z_c

        # Post-transition growth needs access to transformative capability: it is full
        # once an economy's available AI clears the threshold and falls off below it.
        reach = {a: np.exp(-np.maximum(theta - avail[a], 0.0) / P.acc_scale) for a in avail}
        tai_us = tai_us + np.where(arrived, P.tai_growth * reach["us"], 0.0)
        tai_cn = tai_cn + np.where(arrived, P.tai_growth * reach["cn"], 0.0)
        tai_row = tai_row + np.where(arrived, P.tai_growth * reach["row"], 0.0)

        b_cn = china_response.update_belief_cn(b_cn, R, prox, arrived, P)
        h = china_response.update_memory(h, R, P)
        T = np.where(war, 1.0, geopolitics.update_tension(T, R, y_ret, P))
        I = np.where(war, 0.0, geopolitics.update_interdependence(I, R, P))
        cumW = cumW + g_w + P.rev_rd_feedback * imports / np.maximum(W_nom, EPS)
        R_prev, x_prev, lag_prev = R, x, lag_years

    regime = ai_transition.classify(arrived, leader, near_sim, distributed, kcap, half_life)
    ev = {
        "arrived": arrived, "t_arr": t_arr, "leader": leader, "lead0": lead0,
        "near_sim": near_sim, "distributed": distributed, "dec": dec, "half_life": half_life,
        "kcap": kcap, "war": war, "t_war": t_war, "wtype": wtype, "escal": war & escal,
        "cat": cat, "t_cat": t_cat, "regime": regime,
        "adverse": arrived & np.where(leader == 1, u_adv < P.p_adverse_us, u_adv < P.p_adverse_cn),
    }
    return SimResult(years=cfg.years, series=series, comps=comps, events=ev,
                     calib_front=calib_front, calib_logit=calib_logit,
                     extras={"ratio_train": ratio_train_path})


def _bisect(f, lo, hi, iters=60):
    """Root of an increasing function on [lo, hi]."""
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def calibrate(cfg: Config, p: dict, n: int, seed: int) -> Calibration:
    """Solve the two primitives that are stated as targets under the reference policy.

    * ``p_tai_2035`` is the probability of transformative AI by 2035 under the reference
      policy; it pins the median capability threshold ``theta_med``.
    * ``war_base_2040`` is the cumulative probability of a first great-power war by 2040
      under the reference policy; it pins the war-logit intercept ``th0``.

    Both are solved on the event-free reference path and then held fixed for every
    policy, so the targets are not imposed a second time as effects.
    """
    ref = simulate(cfg, p, cfg.policies[cfg.reference_policy], n, seed, Calibration(),
                   events=False, record=False)
    P = _ns(p, n)
    i35 = cfg.years.index(2035)
    i40 = cfg.years.index(2040)
    a35 = np.maximum(ref.calib_front[: i35 + 1].max(axis=0), 1e-6)

    def tai_gap(log_theta):
        prob = (1.0 - P.p_no_threshold) * rng.normcdf((np.log(a35) - log_theta) / P.theta_sigma)
        return float(np.mean(P.p_tai_2035 - prob))  # increasing in log_theta

    log_theta = _bisect(tai_gap, np.log(0.01), np.log(200.0))
    logit = ref.calib_logit[: i40 + 1]

    def war_gap(th0):
        surv = np.prod(1.0 - compute.sigmoid(th0 + logit), axis=0)
        return float(np.mean((1.0 - surv) - P.war_base_2040))  # increasing in th0

    th0 = _bisect(war_gap, -20.0, 8.0)
    out = Calibration(theta_med=float(np.exp(log_theta)), th0=float(th0))
    out.p_tai_2035 = float(np.mean((1.0 - P.p_no_threshold) * rng.normcdf(
        (np.log(a35) - log_theta) / P.theta_sigma)))
    out.war_2040 = float(np.mean(1.0 - np.prod(1.0 - compute.sigmoid(th0 + logit), axis=0)))
    return out
