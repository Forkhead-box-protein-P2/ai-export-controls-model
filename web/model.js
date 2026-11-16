/*
 * Browser port of the Python model in src/ai_controls. Same equations, same keyed random
 * numbers, same parameter registry (web/params.js is generated from configs/*.yaml).
 * tests/test_web_parity.py checks that both implementations give the same numbers.
 *
 * The Python version is vectorised over simulated worlds; this one loops over worlds and
 * then years, with scalar arithmetic. Every world is independent, so the two orders agree.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./params.js'));
  else if (root.AIC_DATA) root.AICModel = factory(root.AIC_DATA);
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  const EPS = 1e-12, NEVER = 1e6;
  const MAX_CHINA_SHARE = 0.4, MAX_CN_EXPORT_SHARE = 0.3, H_REF = 0.5;
  const HEADROOM = 1.2, OVERBUILD = 2.0, SME_EXP_GROWTH0 = 0.25, SME_EXP_SHARE0 = 0.8;
  const DEC_HIGH = [4.0, 1.2], DEC_LOW = [1.2, 5.0], ROW_API_GAP = 0.3, PROX_SCALE = 1.0;
  const DURABLE_CAPTURE = 0.25, DURABLE_HALFLIFE = 10.0, TRANSIENT_CAPTURE = 0.08;
  const WAR_SEV = [1.0, 1.9, 0.3];
  const ST = D.streams, STREAM_FACTOR0 = 900, STREAM_PARAM0 = 1000;
  const RW = D.r_weights;
  const COMPONENTS = D.components, NC = COMPONENTS.length;
  const CIDX = Object.fromEntries(COMPONENTS.map((c, k) => [c, k]));

  // ------------------------------------------------------------------ random numbers
  function mix(x) {
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x7FEB352D) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, 0x846CA68B) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
  function uniform(seed, stream, sim, t) {
    let h = (seed ^ 0x9E3779B9) >>> 0;
    h = mix((h + (Math.imul(stream + 1, 0x85EBCA6B) >>> 0)) >>> 0);
    h = mix((h + (Math.imul(sim + 1, 0xC2B2AE35) >>> 0)) >>> 0);
    h = mix((h + (Math.imul((t || 0) + 1, 0x27D4EB2F) >>> 0)) >>> 0);
    return (h + 0.5) / 4294967296;
  }
  const A_ = [-3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02, 1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00];
  const B_ = [-5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02, 6.680131188771972e01, -1.328068155288572e01];
  const C_ = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00, -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00];
  const D_ = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00, 3.754408661907416e00];
  function invnorm(u) {
    u = Math.min(Math.max(u, 1e-12), 1 - 1e-12);
    if (u < 0.02425) {
      const q = Math.sqrt(-2 * Math.log(u));
      return (((((C_[0] * q + C_[1]) * q + C_[2]) * q + C_[3]) * q + C_[4]) * q + C_[5]) / ((((D_[0] * q + D_[1]) * q + D_[2]) * q + D_[3]) * q + 1);
    }
    if (u > 1 - 0.02425) {
      const q = Math.sqrt(-2 * Math.log(1 - u));
      return -(((((C_[0] * q + C_[1]) * q + C_[2]) * q + C_[3]) * q + C_[4]) * q + C_[5]) / ((((D_[0] * q + D_[1]) * q + D_[2]) * q + D_[3]) * q + 1);
    }
    const q = u - 0.5, r = q * q;
    return (((((A_[0] * r + A_[1]) * r + A_[2]) * r + A_[3]) * r + A_[4]) * r + A_[5]) * q / (((((B_[0] * r + B_[1]) * r + B_[2]) * r + B_[3]) * r + B_[4]) * r + 1);
  }
  function normcdf(z) {
    const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
    const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
    const erf = 1 - poly * Math.exp(-x * x);
    return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
  }
  const normal = (seed, stream, sim, t) => invnorm(uniform(seed, stream, sim, t));

  // ------------------------------------------------------------------ helpers
  const clip = (x, a, b) => Math.min(Math.max(x, a), b);
  const sigmoid = z => 1 / (1 + Math.exp(-z));
  const kumaraswamy = (u, a, b) => Math.pow(1 - Math.pow(1 - u, 1 / b), 1 / a);

  // ------------------------------------------------------------------ configuration
  const PNAMES = D.params.map(p => p.name);
  const PINDEX = Object.fromEntries(PNAMES.map((k, j) => [k, j]));

  /** A configuration: one of the YAML worldviews, optionally with overrides. */
  function makeConfig(name, overrides) {
    const c = D.configs[name];
    const cfg = {
      name, label: c.label, description: c.description,
      values: c.values.slice(), low: c.low.slice(), high: c.high.slice(), sampled: c.sampled.slice(),
      policies: D.policies, status_quo: D.status_quo, weights: D.weights, stances: D.stances,
      reference_policy: D.reference_policy, start_year: D.start_year, end_year: D.end_year,
      nYears: D.end_year - D.start_year + 1,
    };
    cfg.years = Array.from({ length: cfg.nYears }, (_, t) => cfg.start_year + t);
    return overrides ? withOverrides(cfg, overrides) : cfg;
  }
  /** Plain numbers fix a parameter (it is no longer sampled), as in the Python version. */
  function withOverrides(cfg, overrides) {
    const out = { ...cfg, values: cfg.values.slice(), sampled: cfg.sampled.slice() };
    for (const [k, v] of Object.entries(overrides || {})) {
      const j = PINDEX[k];
      if (j === undefined) throw new Error('Unknown parameter ' + k);
      out.values[j] = +v;
      out.sampled[j] = false;
    }
    return out;
  }
  function quantile(j, cfg, u) {
    const lo = cfg.low[j], hi = cfg.high[j], dist = D.params[j].dist;
    if (dist === 'uniform') return lo + u * (hi - lo);
    if (dist === 'loguniform') return Math.exp(Math.log(lo) + u * (Math.log(hi) - Math.log(lo)));
    const mode = clip(cfg.values[j], lo, hi), f = (mode - lo) / (hi - lo);
    return u < f ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
  }
  /** One parameter object per simulated world (keyed draws, Gaussian-copula factors). */
  function sampleParams(cfg, n, seed) {
    const zf = {};
    D.factors.forEach((f, k) => { zf[f] = Float64Array.from({ length: n }, (_, i) => normal(seed, STREAM_FACTOR0 + k, i, 0)); });
    const list = new Array(n);
    for (let i = 0; i < n; i++) list[i] = {};
    PNAMES.forEach((name, j) => {
      const meta = D.params[j];
      const hasRange = cfg.low[j] !== null && cfg.high[j] !== null && cfg.high[j] > cfg.low[j];
      if (!(cfg.sampled[j] && hasRange)) { for (let i = 0; i < n; i++) list[i][name] = cfg.values[j]; return; }
      for (let i = 0; i < n; i++) {
        let u = uniform(seed, STREAM_PARAM0 + j, i, 0);
        if (meta.factor && meta.loading) {
          const rho = meta.loading;
          u = normcdf(rho * zf[meta.factor][i] + Math.sqrt(1 - rho * rho) * invnorm(u));
        }
        list[i][name] = quantile(j, cfg, u);
      }
    });
    return list;
  }

  // ------------------------------------------------------------------ policy
  function policyVector(policy, t, sq, prev, lagObs, out) {
    if (t === 0) { for (let k = 0; k < 5; k++) out[k] = sq[k]; return; }
    if (policy.type === 'fixed' || t === 1) { for (let k = 0; k < 5; k++) out[k] = policy.x[k]; return; }
    for (let k = 0; k < 5; k++) out[k] = prev[k];
    const step = policy.gain * (policy.target_lag - lagObs);
    for (const k of policy.dims) out[k] = clip(prev[k] + step, policy.min[k], policy.max[k]);
  }

  // ------------------------------------------------------------------ one world
  function terminalFactor(P) {
    const q = P.terminal_persist / (1 + P.discount_rate);
    return q * (1 - Math.pow(q, P.terminal_years)) / (1 - q);
  }
  /** Catastrophe hazard summed over the US and Chinese developers; see ai_transition.py. */
  function catHaz(proxUS, proxCN, lag, T, O, P, sl, ra, na, op) {
    const gap = Math.abs(lag), slack = 1 - Math.exp(-gap / P.safe_tau);
    const race = Math.exp(-gap / P.safe_tau) * (0.5 + 0.5 * T);
    const cut = sl * P.lead_safety * P.slack_used * slack, usLeads = lag >= 0;
    const common = P.cat_base * (1 + ra * P.race_risk * race) * Math.max(1 + op * P.open_risk * O, 0);
    const hUS = common * proxUS * (usLeads ? 1 - cut : 1);
    const hCN = common * proxCN * (usLeads ? 1 : 1 - cut) * (1 + na * (P.cat_mult_cn - 1));
    CH.us = hUS; CH.cn = hCN;
    return clip(hUS + hCN, 0, 1);
  }
  const CH = { us: 0, cn: 0 };
  function baseUplift(avail, avail0, inf, inf0, P) {
    const u = Math.max(P.cap_w * (avail - avail0) + P.inf_w * Math.log(Math.max(inf, EPS) / inf0), 0);
    return P.uplift_max * (1 - Math.exp(-u / P.uplift_scale));
  }

  /**
   * Simulate ``n`` worlds under one policy. Returns per-year series (Float32Array, index
   * t * n + i), discounted payoff components (index i * NC + k) and per-world events.
   */
  function simulate(cfg, Plist, policy, n, seed, calib, opts) {
    opts = opts || {};
    const events = opts.events !== false, stance = opts.stance || { indig: 1, conf: 1 };
    const nY = cfg.nYears, sq = cfg.status_quo;
    const recNames = opts.record === false ? [] : (Array.isArray(opts.record) ? opts.record : D.series);
    const S = {};
    for (const k of recNames) S[k] = new Float32Array(nY * n);
    const comps = new Float64Array(n * NC);
    const calibFront = opts.calibOut ? new Float64Array(nY * n) : null;
    const calibLogit = opts.calibOut ? new Float64Array(nY * n) : null;
    const E = {
      arrived: new Uint8Array(n), t_arr: new Float64Array(n), leader: new Int8Array(n),
      lead0: new Float64Array(n), near_sim: new Uint8Array(n), distributed: new Uint8Array(n),
      dec: new Float64Array(n), half_life: new Float64Array(n), kcap: new Float64Array(n),
      war: new Uint8Array(n), t_war: new Float64Array(n), wtype: new Int8Array(n), escal: new Uint8Array(n),
      cat: new Uint8Array(n), t_cat: new Float64Array(n), adverse: new Uint8Array(n), regime: new Array(n),
    };
    const x = new Float64Array(5), xPrev = new Float64Array(5);
    const rec = {}, fl = {};

    for (let i = 0; i < n; i++) {
      const P = Plist[i];
      const U = (name, t) => uniform(seed, ST[name], i, t || 0);
      const Z = (name, t) => normal(seed, ST[name], i, t || 0);
      const tf = terminalFactor(P);

      // World types, fixed across policies.
      const uMix = U('dec_mix'), uVal = U('dec_val');
      let theta = U('no_threshold') < P.p_no_threshold ? Infinity : calib.theta_med * Math.exp(P.theta_sigma * Z('theta'));
      const dec = uMix < P.p_high_dec ? kumaraswamy(uVal, DEC_HIGH[0], DEC_HIGH[1]) : kumaraswamy(uVal, DEC_LOW[0], DEC_LOW[1]);
      const rho = P.dec_persist_corr;
      const zP = rho * (-invnorm(uMix)) + Math.sqrt(1 - rho * rho) * Z('persist');
      const halfLife = 10 * Math.exp(P.persist_sigma * (zP - invnorm(1 - P.p_persist10)));
      if (!events) theta = Infinity;
      const uAdv = U('adverse'), uWtype = U('war_type'), uEsc = U('war_escal'), uDist = U('dist');
      const twShock = P.th_tw_sd * Z('tw'), openShock = P.open_sigma * Z('open_shock');
      const gapShock = P.intrinsic_sd * Z('intrinsic');

      // Initial state.
      let C_us = P.c_us0;
      const C_cn0 = P.c_us0 / P.ratio0;
      let C_dom = C_cn0 * P.stock_dom_share0, C_imp = C_cn0 - C_dom;
      let K_logic = P.k_logic0, K_hbm = P.k_hbm0, K_sme = P.k_sme0, K_soft = P.k_soft0;
      const yld = K => P.yield_min + (P.yield_max - P.yield_min) * K;
      const qual = K => Math.exp(-P.q_gamma * (1 - K));
      const logicOut0 = P.qdom_share0 * P.w0 / (P.final_yield * qual(K_logic));
      let L = logicOut0 / yld(K_logic), H = P.hbm_cov0 * logicOut0 / yld(K_hbm);
      let HS = P.hbm_stock0 * logicOut0, Pk = P.pack_cov0 * logicOut0;
      let E_logic = P.exp_years0 * logicOut0 * P.final_yield;
      let E_hbm = P.exp_years0 * P.hbm_cov0 * logicOut0;
      let E_sme = P.exp_years0 * (L + H) * SME_EXP_GROWTH0 * SME_EXP_SHARE0;
      let E_soft = P.exp_years0 * C_dom * P.util;
      const Es_logic = E_logic, Es_hbm = E_hbm, Es_sme = E_sme, Es_soft = E_soft;
      let h = P.h0, b_cn = P.b_cn0, B = P.backlog0 * C_cn0;
      let G_us = 0, G_cn = 0, T = P.T0, I = P.I0, cumW = 0;
      let tai_us = 0, tai_cn = 0, tai_row = 0;
      // Power in compute units a 2026 Western chip could run; China's relative to the US's physical capacity.
      let E_us = P.pow_slack_us0 * C_us, E_cn = P.pow_cn_us0 * E_us, res_us = 1, res_cn = 1;

      let arrived = false, nearSim = false, distributed = false, tArr = NEVER, leader = 0, lead0 = 0, kcap = 0;
      let war = false, escal = false, cat = false, tWar = NEVER, tCat = NEVER, wtype = 2, depAtWar = 0, catSurv = 1;
      let crossedUS = false, crossedCN = false, tCrossUS = NEVER, tCrossCN = NEVER;
      let R_prev = 0, acc = 0, lagPrev = 0, alg_anchor = 0;
      let Tr_us0 = 0, inf_us0 = 0, inf_cn0 = 0, av0_us = 0, av0_cn = 0, av0_row = 0;

      for (let t = 0; t < nY; t++) {
        // 1. US policy.
        const lagObs = lagPrev + P.obs_noise * Z('obs', t);
        policyVector(policy, t, sq, xPrev, lagObs, x);
        if (war) for (let k = 0; k < 5; k++) x[k] = 1;
        const R = RW[0] * x[0] + RW[1] * x[1] + RW[2] * x[2] + RW[3] * x[3];
        if (t === 0) R_prev = R;

        // 2. China's response.
        const y_rd = Math.max(1 + P.rd_h * (h - H_REF) + P.rd_b * (b_cn - P.b_cn0), 0) * stance.indig;
        const m = clip((P.m_base + P.m_h * (h - H_REF)) * stance.indig, 0, 1);
        const y_ret = clip((P.ret_R * R + P.ret_dR * Math.max(R - R_prev, 0)) * stance.conf, 0, 1);
        const y_fa = clip(P.fa_R * R, 0, 1);
        const slack = (1 - x[4]) * (0.5 + 0.5 * y_fa);
        const xc = x[0] * (1 - P.leak_chips * slack), xh = x[1] * (1 - P.leak_hbm * slack);
        const xs = x[2] * (1 - P.leak_sme * slack), xcl = x[3] * (1 - P.leak_cloud * slack);

        // 3. Western supply.
        const g_w = P.g_w_inf + (P.g_w0 - P.g_w_inf) * Math.pow(0.5, t / P.g_w_halflife);
        const W_nom = P.w0 * Math.exp(cumW), cu_chip = Math.exp(P.perf_share * cumW);
        const dep_tw = P.dep_tw0 * Math.exp(-P.dep_tw_decay * t);
        const scarcity_t = P.scarcity * Math.pow(0.5, t / P.scarcity_halflife);
        const recovering = Math.max(1 - (t - tWar) / P.fab_recovery, 0);
        const fabLoss = (war && wtype !== 2 && t >= tWar) ? P.war_fab_loss * depAtWar * recovering : 0;
        const W = W_nom * (1 - fabLoss);

        // 4. Domestic industry.
        const a_sme = 1 - xs * (1 - K_sme);
        const logic_out = L * yld(K_logic), hbm_dom = H * yld(K_hbm);
        const hbm_gap = Math.max(logic_out - hbm_dom, 0), hbm_imp = hbm_gap * (1 - xh);
        const hbm_draw = Math.min(HS, Math.max(hbm_gap - hbm_imp, 0));
        const hbm_avail = hbm_dom + hbm_imp + hbm_draw;
        const chips = Math.min(Math.min(logic_out, hbm_avail), Pk) * P.final_yield;
        const q_chip = qual(K_logic);
        const bind_hbm = hbm_avail < Math.min(logic_out, Pk) ? 1 : 0;
        const captured = war && wtype === 1 && t >= tWar + 2;
        const Q_dom = chips * q_chip * cu_chip + (captured ? P.capture_yield * depAtWar * W_nom : 0);

        // 5. Chinese market.
        const usab = P.usab_min + (1 - P.usab_min) * K_soft;
        const q_imp = 1 - P.q_imp_floor * x[0];
        const accTarget = 1 - xc;
        acc = t === 0 ? accTarget : (accTarget < acc ? accTarget : acc + P.access_ramp * (accTarget - acc));
        const pref = sigmoid(P.pref_a0 + P.pref_bm * m * (1 - P.mandate_erosion * acc) + P.pref_eh * h
          - P.pref_dq * Math.log(Math.max(q_imp, EPS) / Math.max(q_chip * usab, EPS)));
        const Dm = P.demand_share * W_nom * (1 + P.sal_b * (b_cn - P.b_cn0));
        const desDom = pref * Dm, desImp = (1 - pref) * Dm, imp1 = desImp * acc, blocked = desImp - imp1;
        const Dd = desDom + P.spill_dom * blocked;
        const dom_add = Math.min(Dd, Q_dom), shortfall = Dd - dom_add;
        const imports = Math.min(imp1 + shortfall * acc * P.backfill, MAX_CHINA_SHARE * W);
        const unmet = Math.max(Dm - dom_add - imports, 0);
        const util_ratio = Math.min(1, Dd / Math.max(Q_dom, EPS));
        const legal_imports = imports * (1 - x[0]) / Math.max(accTarget, EPS);
        const dom_share = dom_add / Math.max(dom_add + imports, EPS);
        const cn_exports = P.cn_export_share * Math.min(Math.max(Q_dom - Dd, 0), MAX_CN_EXPORT_SHARE * W_nom);

        // 6. Remote compute, power and services.
        const remote = P.cloud_suit * B * (1 - xcl);
        const ppwIdx = Math.exp(P.ppw_share * cumW), ppwRel = Math.exp(-P.ppw_gamma * (1 - K_logic));
        const need_us = C_us / ppwIdx, need_cn = (C_imp + C_dom / ppwRel) / ppwIdx;
        if (t === 0) { res_us = E_us / need_us; res_cn = E_cn / need_cn; }
        const pf_us = Math.min(1, E_us / Math.max(need_us, EPS)), pf_cn = Math.min(1, E_cn / Math.max(need_cn, EPS));
        const S_us = P.util * Math.max(C_us * pf_us - scarcity_t * remote, 0);
        const S_cn_local = P.util * pf_cn * (C_imp + C_dom * usab);
        const S_cn = S_cn_local + P.util * remote;
        const Tr_us = P.train_share * S_us;
        const Tr_cn = P.train_share * (S_cn_local + P.cloud_train_discount * P.util * remote);
        const inf_us = (1 - P.train_share) * S_us, inf_cn = (1 - P.train_share) * S_cn;
        if (t === 0) { Tr_us0 = Tr_us; inf_us0 = inf_us; inf_cn0 = inf_cn; }

        // 7. Capability and openness.
        const rate = P.alpha_T * g_w + P.g_alg;
        if (t === 0) G_cn = -(P.lag0 * rate + P.alpha_T * Math.log(Tr_cn / Tr_us));
        const logA_us = P.alpha_T * Math.log(Math.max(Tr_us, 1e-12) / Tr_us0) + G_us;
        const comp_cn = P.alpha_T * Math.log(Math.max(Tr_cn, 1e-12) / Tr_us0);
        const logA_cn = Math.max(Math.min(comp_cn + G_cn, logA_us - P.follow_floor), comp_cn + G_us - (P.intrinsic_gap + gapShock));
        const lag = (logA_us - logA_cn) / rate;
        const front = Math.max(logA_us, logA_cn);
        const open_us = logA_us - Math.max(P.open_gap_us + openShock, 0);
        const open_cn = logA_cn - P.open_lag_cn - P.open_lag_T * Math.max(T - P.T0, 0) - P.open_lag_b * Math.max(b_cn - P.b_cn0, 0);
        const o_us = Math.exp(-Math.max(front - open_us, 0) / P.open_scale);
        const o_cn = Math.exp(-Math.max(front - open_cn, 0) / P.open_scale);
        const O = 1 - (1 - o_us) * (1 - o_cn);
        const openFront = Math.max(open_us, open_cn);
        const av_us = Math.max(logA_us, openFront), av_cn = Math.max(logA_cn, openFront);
        const av_row = Math.max(openFront, logA_us - ROW_API_GAP);
        if (t === 0) { av0_us = av_us; av0_cn = av_cn; av0_row = av_row; }

        // 8. Transition.
        if (!arrived && front >= theta) {
          const gap = Math.abs(lag);
          const distNow = uDist < Math.exp(-Math.max(front - openFront, 0) / P.dist_gap);
          leader = logA_us >= logA_cn ? 1 : 2;
          lead0 = gap; distributed = distNow; nearSim = gap < P.sim_window;
          kcap = distNow ? 0 : clip(dec * (1 - Math.exp(-gap / P.lead_conv)) * (1 - P.open_erode * O), 0, 1);
          tArr = t; arrived = true;
        }
        const yrsSince = Math.max(t - tArr, 0);
        const adv = arrived ? kcap * Math.pow(0.5, yrsSince / halfLife) : 0;
        const prox = arrived ? Math.pow(0.5, yrsSince / P.cat_window) : Math.exp(-Math.max(theta - front, 0) / PROX_SCALE);
        const adverse = leader === 1 ? uAdv < P.p_adverse_us : leader === 2 ? uAdv < P.p_adverse_cn : false;
        if (!crossedUS && logA_us >= theta) { crossedUS = true; tCrossUS = t; }
        if (!crossedCN && logA_cn >= theta) { crossedCN = true; tCrossCN = t; }
        const proxUS = crossedUS ? Math.pow(0.5, Math.max(t - tCrossUS, 0) / P.cat_window) : Math.exp(-Math.max(theta - logA_us, 0) / PROX_SCALE);
        const proxCN = crossedCN ? Math.pow(0.5, Math.max(t - tCrossCN, 0) / P.cat_window) : Math.exp(-Math.max(theta - logA_cn, 0) / PROX_SCALE);

        // 9. Catastrophe.
        const hCatRaw = catHaz(proxUS, proxCN, lag, T, O, P, 1, 1, 1, 1), hCatCN = CH.cn;
        catSurv *= 1 - hCatRaw;
        const h_cat = cat ? 0 : hCatRaw;
        if (events && !cat && U('cat', t) < h_cat) { cat = true; tCat = t; }

        // 10. War.
        const pT = P.th_T * (T - P.T0), pSdi = P.th_sdi * b_cn * dep_tw * xc;
        const pDet = -P.th_det * Math.tanh(Math.max(lag, 0) / P.det_tau), pI = -P.th_I * (I - P.I0);
        const shock = twShock + P.th_ar_sd * Z('war_ar', t);
        const h_war = war ? 0 : sigmoid(calib.th0 + pT + pSdi + pDet + pI + shock);
        if (calibFront) { calibFront[t * n + i] = front; calibLogit[t * n + i] = pT + pSdi + pDet + pI + shock; }
        if (events && !war && U('war', t) < h_war) {
          war = true; tWar = t;
          wtype = uWtype < P.war_p_deny ? 0 : uWtype < P.war_p_deny + P.war_p_capture ? 1 : 2;
          escal = uEsc < P.war_escal; depAtWar = dep_tw;
        }

        // 11. Payoff flows.
        const gdp_us = P.gdp_us0 * Math.pow(1 + P.g_us, t), gdp_cn = P.gdp_cn0 * Math.pow(1 + P.g_cn, t);
        const gdp_row = P.gdp_row0 * Math.pow(1 + P.g_row, t);
        const up_us = baseUplift(av_us, av0_us, inf_us, inf_us0, P);
        const up_cn = baseUplift(av_cn, av0_cn, inf_cn, inf_cn0, P);
        const up_row = baseUplift(av_row, av0_row, inf_us, inf_us0, P);
        const own_us = gdp_us * (up_us + tai_us), own_cn = gdp_cn * (up_cn + tai_cn), own_row = gdp_row * (up_row + tai_row);
        const ownSum = own_us + own_cn + own_row, gdpSum = gdp_us + gdp_cn + gdp_row;
        const ai_us = own_us + P.sci_spill * (ownSum - own_us) * gdp_us / gdpSum;
        const ai_cn = own_cn + P.sci_spill * (ownSum - own_cn) * gdp_cn / gdpSum;
        const ai_row = own_row + P.sci_spill * (ownSum - own_row) * gdp_row / gdpSum;
        fl.ai_us = ai_us; fl.ai_cn = ai_cn; fl.ai_row = ai_row;
        const unit = P.w_rev0 / P.w0 / Math.max(cu_chip, EPS);
        const profit = legal_imports * unit * P.chip_margin * (1 - scarcity_t);
        const cnProfit = cn_exports * unit * P.chip_margin, lost = P.cn_export_disp * cnProfit;
        const friction = P.tens_cost * Math.max(T - P.t_floor, 0);
        fl.trade_us = P.us_capture * (profit - lost) - P.ret_cost * y_ret * gdp_us - friction * gdp_us;
        fl.trade_cn = cnProfit - friction * gdp_cn - P.sub_cost * (y_rd - 1) * gdp_cn;
        fl.trade_row = (1 - P.us_capture) * (profit - lost) - 0.5 * friction * gdp_row;
        const markup = P.markup_max * (1 - O);
        const rent_us = markup * P.spend_share * own_us, rent_row = markup * P.spend_share * own_row;
        fl.open_us = gdp_us * up_us * P.open_boost * O - rent_us - 0.5 * markup * rent_us;
        fl.open_cn = gdp_cn * up_cn * P.open_boost * O;
        fl.open_row = gdp_row * up_row * P.open_boost * O - rent_row - 0.5 * markup * rent_row;
        fl.rent_us = rent_us + rent_row;
        const pool_us = P.contest_share * gdp_us * tai_us, pool_cn = P.contest_share * gdp_cn * tai_cn;
        const pool_row = P.contest_share * gdp_row * tai_row, keep = 1 - P.capture_dwl;
        const usL = leader === 1, cnL = leader === 2;
        fl.lead_us = usL ? keep * adv * (pool_cn + pool_row) : cnL ? -adv * pool_us : 0;
        fl.lead_cn = cnL ? keep * adv * (pool_us + pool_row) : usL ? -adv * pool_cn : 0;
        fl.lead_row = -adv * pool_row;
        const inWar = war && t >= tWar && t < tWar + P.war_years, escalated = war && escal && t >= tWar;
        const sev = WAR_SEV[wtype], pCat = 1 - catSurv;
        const inst = -P.adverse_cost * adv * (adverse ? 1 : 0);
        fl.inst_us = inst * (gdp_us + ai_us); fl.inst_cn = inst * (gdp_cn + ai_cn); fl.inst_row = inst * (gdp_row + ai_row);
        const wl = (cost) => Math.min((inWar ? cost * sev : 0) + (escalated ? P.escal_severity : 0), 1);
        fl.war_us = -wl(P.war_cost_us) * (gdp_us + ai_us);
        fl.war_cn = -wl(P.war_cost_cn) * (gdp_cn + ai_cn);
        fl.war_row = -wl(P.war_cost_row) * (gdp_row + ai_row);
        fl.cat_us = -P.cat_severity * pCat * (gdp_us + ai_us);
        fl.cat_cn = -P.cat_severity * pCat * (gdp_cn + ai_cn);
        fl.cat_row = -P.cat_severity * pCat * (gdp_row + ai_row);
        const edge = arrived ? 0 : P.pre_sec * Math.tanh(lag / P.det_tau);
        fl.sec_us = -(cnL ? adv : 0) + edge;
        fl.sec_cn = -(usL ? adv : 0) - edge;
        fl.liberty = P.lib_open * O + P.lib_plural * (1 - adv) - P.lib_adverse * adv * (adverse ? 1 : 0);
        fl.trust = I - T;
        fl.advyrs_us = usL ? adv : 0;
        fl.advyrs_cn = cnL ? adv : 0;
        fl.sov_cn = 0.25 * (K_logic + K_hbm + K_sme + K_soft);
        const disc = Math.pow(1 + P.discount_rate, -t), mult = t === nY - 1 ? disc * (1 + tf) : disc;
        const base = i * NC;
        for (let k = 0; k < NC; k++) comps[base + k] += mult * fl[COMPONENTS[k]];

        // Record.
        if (recNames.length) {
          const C_cn = C_dom + C_imp;
          rec.x_chips = x[0]; rec.x_hbm = x[1]; rec.x_sme = x[2]; rec.x_cloud = x[3]; rec.x_enf = x[4]; rec.R = R;
          rec.m = m; rec.y_rd = y_rd; rec.y_ret = y_ret; rec.h = h; rec.b_cn = b_cn;
          rec.W = W; rec.D = Dm; rec.pref = pref; rec.acc = acc; rec.Q_dom = Q_dom; rec.dom_add = dom_add;
          rec.imports = imports; rec.remote = remote; rec.dom_share = dom_share; rec.util_ratio = util_ratio;
          rec.bind_hbm = bind_hbm; rec.C_us = C_us; rec.C_cn = C_cn; rec.ratio_stock = C_us / Math.max(C_cn, EPS);
          rec.S_us = S_us; rec.S_cn = S_cn; rec.ratio_train = Tr_us / Math.max(Tr_cn, EPS);
          rec.pf_us = pf_us; rec.pf_cn = pf_cn;
          rec.K_logic = K_logic; rec.K_hbm = K_hbm; rec.K_sme = K_sme; rec.K_soft = K_soft;
          rec.logA_us = logA_us; rec.logA_cn = logA_cn; rec.lag_years = lag; rec.O = O;
          rec.T = T; rec.I = I; rec.h_war = h_war; rec.h_cat = h_cat;
          rec.adv_us = usL ? adv : 0; rec.adv_cn = cnL ? adv : 0;
          rec.war_T = pT; rec.war_sdi = pSdi; rec.war_det = pDet; rec.war_I = pI;
          rec.up_us = up_us + tai_us; rec.up_cn = up_cn + tai_cn; rec.up_row = up_row + tai_row;
          rec.arrived = arrived ? 1 : 0; rec.war_cum = war ? 1 : 0; rec.cat_cum = cat ? 1 : 0;
          rec.cat_raw = hCatRaw; rec.cat_cn = hCatCN;
          if (S.cat_noslack) {
            rec.cat_noslack = catHaz(proxUS, proxCN, lag, T, O, P, 0, 1, 1, 1);
            rec.cat_norace = catHaz(proxUS, proxCN, lag, T, O, P, 1, 0, 1, 1);
            rec.cat_nonat = catHaz(proxUS, proxCN, lag, T, O, P, 1, 1, 0, 1);
            rec.cat_noopen = catHaz(proxUS, proxCN, lag, T, O, P, 1, 1, 1, 0);
          }
          const o = t * n + i;
          for (const k of recNames) S[k][o] = rec[k];
        }

        // 12. Advance the state.
        const C_dom_old = C_dom;
        C_us = (1 - P.dep) * C_us + P.us_share_w * Math.max(W - scarcity_t * imports, 0);
        C_dom = (1 - P.dep) * C_dom + dom_add;
        C_imp = (1 - P.dep) * C_imp + imports;
        B = (1 - P.dep) * B + unmet;
        const g_need = (1 - P.ppw_share) * g_w;
        E_us = Math.max(E_us, Math.min(E_us * Math.exp(P.g_e_us), res_us * need_us * Math.exp(g_need)));
        E_cn = Math.max(E_cn, Math.min(E_cn * Math.exp(P.g_e_cn), res_cn * need_cn * Math.exp(g_need)));

        const sub = Math.pow(Math.max(y_rd, 1e-9), P.sub_beta), feasible = Math.pow(a_sme, P.eta_sme) * sub;
        const target = HEADROOM * (1 + (1 - P.util_pull) * OVERBUILD) * Dd * Math.exp(g_w);
        const gL = Math.min(P.g_cap_max * feasible, Math.max(Math.log(target / Math.max(Q_dom, 1e-12)), 0));
        const wantH = Math.max(Math.log(HEADROOM * logic_out * Math.exp(gL) / Math.max(hbm_dom, 1e-12)), 0);
        const gH = Math.min(P.g_hbm_max * feasible, wantH);
        const L_new = L * Math.exp(gL), H_new = H * Math.exp(gH);
        Pk = Pk * Math.exp(P.g_pack * sub);

        const new_logic = dom_add / Math.max(q_chip * cu_chip, EPS);
        const new_hbm = Math.min(hbm_dom, logic_out);
        const new_sme = Math.max(L_new - L + H_new - H, 0) * (P.sme_share0 + (1 - P.sme_share0) * xs);
        const new_soft = C_dom_old * pf_cn * P.util / cu_chip * ((1 - P.lab_sens) + P.lab_sens * dom_share);
        const lrn = (Ec, nE, Es, c) => c * (Math.log1p((Ec + nE) / Es) - Math.log1p(Ec / Es));
        const rd_eff = y_rd + P.rev_rd * dom_add / Math.max(Dm, EPS);
        const rd_mult = Math.log1p(rd_eff) / Math.log(2);
        const tool = 1 - P.rd_tool_dep * (1 - a_sme);
        const upd = (K, rdc, tl, learn, spill) => {
          const gap = 1 - K;
          return clip((1 - P.k_decay) * K + rdc * rd_mult * tl * gap + learn + P.spill_k * spill * gap, 0, P.k_cap);
        };
        K_logic = upd(K_logic, P.rd_logic, tool, lrn(E_logic, new_logic, Es_logic, P.learn_logic), 1 - xs);
        K_hbm = upd(K_hbm, P.rd_hbm, tool, lrn(E_hbm, new_hbm, Es_hbm, P.learn_hbm), 1 - xh);
        K_sme = upd(K_sme, P.rd_sme, 1, lrn(E_sme, new_sme, Es_sme, P.learn_sme), 1 - xs);
        K_soft = upd(K_soft, P.rd_soft, 1, lrn(E_soft, new_soft, Es_soft, P.learn_soft), 0);
        E_logic += new_logic; E_hbm += new_hbm; E_sme += new_sme; E_soft += new_soft;
        L = L_new; H = H_new; HS -= hbm_draw;

        const zc = Z('alg_common', t), zi = Z('alg_cn', t);
        const rel = Math.pow(Math.min(Tr_cn / Math.max(Tr_us, EPS), 1), P.theta_exp);
        const kappa = P.diff_rate * (1 + P.diff_open * O);
        if (t === 0) alg_anchor = (G_us - G_cn) - P.g_alg * (1 - rel) / kappa;
        G_cn = G_cn + P.g_alg * rel + kappa * (G_us - G_cn - alg_anchor) + P.sigma_alg * (zc + 0.5 * zi);
        G_us = G_us + P.g_alg * (1 + P.cn_spill * rel * o_cn) + P.sigma_alg * zc;

        if (arrived) {
          tai_us += P.tai_growth * Math.exp(-Math.max(theta - av_us, 0) / P.acc_scale);
          tai_cn += P.tai_growth * Math.exp(-Math.max(theta - av_cn, 0) / P.acc_scale);
          tai_row += P.tai_growth * Math.exp(-Math.max(theta - av_row, 0) / P.acc_scale);
        }
        b_cn = arrived ? 1 : clip(b_cn + P.sig_eta * R * (1 - b_cn) + P.prog_eta * prox * (1 - b_cn), 0, 1);
        h = h + (R > h ? P.h_up : P.h_down) * (R - h);
        T = war ? 1 : T + P.t_adj * (clip(P.t_floor + P.t_R * R + P.t_ret * y_ret, 0, 1) - T);
        I = war ? 0 : I + P.i_adj * (P.i_max * (1 - P.i_R * R) - I);
        cumW = cumW + g_w + P.rev_rd_feedback * imports / Math.max(W_nom, EPS);
        R_prev = R; lagPrev = lag;
        for (let k = 0; k < 5; k++) xPrev[k] = x[k];
      }

      E.arrived[i] = arrived; E.t_arr[i] = tArr; E.leader[i] = leader; E.lead0[i] = lead0;
      E.near_sim[i] = nearSim; E.distributed[i] = distributed; E.dec[i] = dec; E.half_life[i] = halfLife;
      E.kcap[i] = kcap; E.war[i] = war; E.t_war[i] = tWar; E.wtype[i] = wtype; E.escal[i] = war && escal;
      E.cat[i] = cat; E.t_cat[i] = tCat;
      E.adverse[i] = arrived && (leader === 1 ? uAdv < P.p_adverse_us : uAdv < P.p_adverse_cn);
      let reg = 'no_sharp';
      if (arrived) {
        reg = 'no_monopoly';
        if (nearSim) reg = 'near_simultaneous';
        if (distributed) reg = 'distributed';
        if (!nearSim && !distributed) {
          const durable = kcap >= DURABLE_CAPTURE && halfLife >= DURABLE_HALFLIFE;
          const transient = kcap >= TRANSIENT_CAPTURE && !durable;
          const who = leader === 1 ? 'us' : 'cn';
          if (durable) reg = who + '_durable'; else if (transient) reg = who + '_transient';
        }
      }
      E.regime[i] = reg;
    }
    return { series: S, comps, events: E, n, nYears: nY, calibFront, calibLogit };
  }

  // ------------------------------------------------------------------ calibration
  function bisect(f, lo, hi) {
    for (let k = 0; k < 60; k++) { const mid = 0.5 * (lo + hi); if (f(mid) < 0) lo = mid; else hi = mid; }
    return 0.5 * (lo + hi);
  }
  function calibrate(cfg, Plist, n, seed) {
    const ref = simulate(cfg, Plist, cfg.policies[cfg.reference_policy], n, seed, { theta_med: 8, th0: -5 },
      { events: false, record: false, calibOut: true });
    const i35 = cfg.years.indexOf(2035), i40 = cfg.years.indexOf(2040);
    const a35 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let mx = -Infinity;
      for (let t = 0; t <= i35; t++) mx = Math.max(mx, ref.calibFront[t * n + i]);
      a35[i] = Math.log(Math.max(mx, 1e-6));
    }
    const taiProb = lt => { let s = 0; for (let i = 0; i < n; i++) s += (1 - Plist[i].p_no_threshold) * normcdf((a35[i] - lt) / Plist[i].theta_sigma); return s / n; };
    const taiTarget = Plist.reduce((s, P) => s + P.p_tai_2035, 0) / n;
    const logTheta = bisect(lt => taiTarget - taiProb(lt), Math.log(0.01), Math.log(200));
    const warProb = th0 => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        let surv = 1;
        for (let t = 0; t <= i40; t++) surv *= 1 - sigmoid(th0 + ref.calibLogit[t * n + i]);
        s += 1 - surv;
      }
      return s / n;
    };
    const warTarget = Plist.reduce((s, P) => s + P.war_base_2040, 0) / n;
    const th0 = bisect(v => warProb(v) - warTarget, -20, 8);
    return { theta_med: Math.exp(logTheta), th0, p_tai_2035: taiProb(logTheta), war_2040: warProb(th0) };
  }

  /** Simulate every requested policy on the same worlds (common random numbers). */
  function runConfig(cfg, n, seed, opts) {
    opts = opts || {};
    const Plist = sampleParams(cfg, n, seed);
    const calib = calibrate(cfg, Plist, n, seed);
    const pols = opts.policies || Object.keys(cfg.policies);
    const extra = opts.extraPolicies || {};
    const results = {};
    for (const name of pols) {
      const pol = extra[name] || cfg.policies[name];
      results[name] = simulate(cfg, Plist, pol, n, seed, calib, { stance: opts.stance, record: opts.record });
    }
    return { cfg, n, seed, Plist, calib, results };
  }

  // ------------------------------------------------------------------ analysis
  function weightVector(w) {
    const money = w.money, out = new Float64Array(NC);
    COMPONENTS.forEach((name, k) => {
      const cut = name.lastIndexOf('_'), head = name.slice(0, cut), actor = name.slice(cut + 1);
      if (['ai', 'trade', 'open', 'lead', 'inst'].includes(head)) out[k] = money[actor];
      else if (head === 'rent') out[k] = money[actor] * (w.rent_weight ?? 1);
      else if (head === 'war') out[k] = money[actor] * (1 + (w.war_extra || 0));
      else if (head === 'cat') out[k] = money[actor] * (1 + (w.cat_extra || 0));
      else if (head === 'sec') out[k] = w['v_sec_' + actor] || 0;
      else if (head === 'advyrs') out[k] = w['lead_extra_' + actor] || 0;
      else if (head === 'sov') out[k] = w['v_sov_' + actor] || 0;
      else if (name === 'liberty') out[k] = w.v_liberty || 0;
      else if (name === 'trust') out[k] = w.v_trust || 0;
    });
    return out;
  }
  const GROUP_IDX = Object.fromEntries(Object.entries(D.groups).map(([g, cs]) => [g, cs.map(c => CIDX[c])]));

  /** Per-world value difference and group means for policy a minus policy b. */
  function compare(resA, resB, w) {
    const wv = weightVector(w), n = resA.n;
    const v = new Float64Array(n), groups = Object.fromEntries(Object.keys(GROUP_IDX).map(g => [g, 0]));
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < NC; k++) s += wv[k] * (resA.comps[i * NC + k] - resB.comps[i * NC + k]);
      v[i] = s;
      for (const [g, idx] of Object.entries(GROUP_IDX)) {
        let gs = 0;
        for (const k of idx) gs += wv[k] * (resA.comps[i * NC + k] - resB.comps[i * NC + k]);
        groups[g] += gs / n;
      }
    }
    let mean = 0; for (let i = 0; i < n; i++) mean += v[i]; mean /= n;
    let ss = 0, better = 0; for (let i = 0; i < n; i++) { ss += (v[i] - mean) ** 2; if (v[i] > 0) better++; }
    return { mean, se: n > 1 ? Math.sqrt(ss / (n - 1) / n) : 0, pBetter: better / n, groups, values: v };
  }
  function absoluteValue(res, w) {
    const wv = weightVector(w), n = res.n;
    let s = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < NC; k++) s += wv[k] * res.comps[i * NC + k];
    return s / n;
  }
  function seriesSummary(res, name) {
    const a = res.series[name], n = res.n, nY = res.nYears;
    const out = { mean: [], p10: [], p50: [], p90: [] }, buf = new Float64Array(n);
    for (let t = 0; t < nY; t++) {
      let s = 0;
      for (let i = 0; i < n; i++) { buf[i] = a[t * n + i]; s += buf[i]; }
      buf.sort();
      const q = p => { const pos = (n - 1) * p, l = Math.floor(pos), u = Math.ceil(pos); return buf[l] + (buf[u] - buf[l]) * (pos - l); };
      out.mean.push(s / n); out.p10.push(q(0.1)); out.p50.push(q(0.5)); out.p90.push(q(0.9));
    }
    return out;
  }
  function seriesMean(res, name, t) {
    const a = res.series[name], n = res.n;
    let s = 0; for (let i = 0; i < n; i++) s += a[t * n + i];
    return s / n;
  }
  function outcomeProbs(res, cfg) {
    const e = res.events, n = res.n, i35 = cfg.years.indexOf(2035), i40 = cfg.years.indexOf(2040);
    const out = Object.fromEntries(D.regimes.map(r => [r, 0]));
    let tai35 = 0, usFirst = 0, cnFirst = 0, war40 = 0, war = 0, cat = 0, both = 0, lead = 0, arr = 0;
    for (let i = 0; i < n; i++) {
      out[e.regime[i]] += 1 / n;
      if (e.t_arr[i] <= i35) tai35++;
      const clear = e.arrived[i] && !e.near_sim[i] && !e.distributed[i];
      if (clear && e.leader[i] === 1) usFirst++;
      if (clear && e.leader[i] === 2) cnFirst++;
      if (e.t_war[i] <= i40) war40++;
      if (e.war[i]) war++;
      if (e.cat[i]) cat++;
      if (e.war[i] && e.cat[i]) both++;
      if (e.arrived[i]) { arr++; lead += e.lead0[i]; }
    }
    return Object.assign(out, {
      tai_by_2035: tai35 / n, us_first: usFirst / n, cn_first: cnFirst / n, war_by_2040: war40 / n,
      war_by_2050: war / n, catastrophe: cat / n, war_and_catastrophe: both / n, mean_lead_years: arr ? lead / arr : 0,
    });
  }
  /** Cumulative incidence of first war by year t along each path, averaged. */
  function cumulative(res, key, t) {
    const a = res.series[key], n = res.n;
    let s = 0;
    for (let i = 0; i < n; i++) { let surv = 1; for (let u = 0; u <= t; u++) surv *= 1 - a[u * n + i]; s += 1 - surv; }
    return s / n;
  }
  function warDecomposition(resA, resB, t) {
    const total = cumulative(resA, 'h_war', t) - cumulative(resB, 'h_war', t);
    const names = { war_T: 'provocation', war_sdi: 'strategic denial', war_det: 'deterrence', war_I: 'interdependence' };
    const n = resA.n, dl = {};
    let tot = 0;
    for (const [k, lab] of Object.entries(names)) {
      let s = 0;
      for (let u = 0; u <= t; u++) for (let i = 0; i < n; i++) s += resA.series[k][u * n + i] - resB.series[k][u * n + i];
      dl[lab] = s / (n * (t + 1)); tot += dl[lab];
    }
    const pp = {};
    for (const lab of Object.values(names)) pp[lab] = Math.abs(tot) > 1e-12 ? 100 * total * dl[lab] / tot : 0;
    return { baseline: cumulative(resB, 'h_war', t), withPolicy: cumulative(resA, 'h_war', t), marginal_pp: 100 * total, logit: dl, pp };
  }
  /** Marginal catastrophe risk A - B by year t and its channels (see analysis.cat_decomposition). */
  function catDecomposition(resA, resB, t) {
    const ch = { cat_noslack: 'lead slack', cat_norace: 'race', cat_nonat: 'Chinese developer', cat_noopen: 'openness' };
    const total = cumulative(resA, 'cat_raw', t) - cumulative(resB, 'cat_raw', t);
    const pp = {};
    let rest = total;
    for (const [k, lab] of Object.entries(ch)) {
      const d = (cumulative(resA, 'cat_raw', t) - cumulative(resA, k, t)) - (cumulative(resB, 'cat_raw', t) - cumulative(resB, k, t));
      pp[lab] = 100 * d; rest -= d;
    }
    pp.exposure = 100 * rest;
    const share = res => { let a = 0, b = 0; for (let u = 0; u <= t; u++) for (let i = 0; i < res.n; i++) { a += res.series.cat_cn[u * res.n + i]; b += res.series.cat_raw[u * res.n + i]; } return b > 0 ? a / b : 0; };
    return { baseline: cumulative(resB, 'cat_raw', t), withPolicy: cumulative(resA, 'cat_raw', t), marginal_pp: 100 * total, pp, cnShareA: share(resA), cnShareB: share(resB) };
  }
  function twoWorldToy(p, du, dn, c) {
    return { delta: p * du + (1 - p) * dn - c, breakEven: du !== dn ? (c - dn) / (du - dn) : NaN };
  }

  return {
    data: D, uniform, normal, invnorm, normcdf, makeConfig, withOverrides, sampleParams, calibrate,
    simulate, runConfig, weightVector, compare, absoluteValue, seriesSummary, seriesMean, outcomeProbs,
    cumulative, warDecomposition, catDecomposition, twoWorldToy, PINDEX, COMPONENTS,
  };
});

// Independent finite-tree model. This entry point accepts only the Atlas configuration.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports.atlas = factory();
  else root.ExportAtlas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const unit = x => Math.min(1, Math.max(0, x));

  function trajectory(c, policy, response, world, s) {
    const p = c.policies[policy], r = c.responses[response];
    const {industry: i, behavior: b, transition: tr, risk, value: v} = c;
    let {usStock, localStock: local, importStock: foreign, knowledge: k, experience, ratio} = c.initial;
    let pending = 1, shared = 0, temporary = 0, usLead = 0, cnLead = 0, war = 0, cat = 0;
    let planValue = 0;
    const totals = {}, rows = [];
    for (let t = 0; t <= c.end - c.start; t++) {
      const adaptive = policy === 'adaptive' ? unit((ratio - i.adaptiveThreshold) * i.adaptiveSlope) : 0;
      const chips = (p.chips + (1 - p.chips) * adaptive) * p.enforcement;
      const cloud = (p.cloud + (1 - p.cloud) * adaptive) * p.enforcement;
      const equipment = p.tools * p.enforcement, memory = p.hbm * p.enforcement;
      const supply = i.chipFlow * (1 + i.chipGrowth) ** t;
      const demand = i.baseDemand + i.mandateDemand * r.mandate + i.scarcityDemand * chips;
      const fab = i.fabFlow * world.fab * (1 + i.fabGrowth) ** t * k;
      const output = fab * Math.min(1 - i.equipmentDrag * equipment, 1 - i.memoryDrag * memory);
      const domestic = Math.min(output, supply * demand * k / (k + i.domesticQuality));
      const offered = supply * i.exportShare;
      const permitted = offered * (1 - chips);
      const imports = Math.min(Math.max(0, offered - domestic * r.mandate),
        permitted + offered * chips * i.diversionShare * r.bypass);
      const retain = 1 - i.retirement;
      usStock = retain * usStock + supply - imports;
      local = retain * local + domestic;
      foreign = retain * foreign + imports;
      const powerGrowth = (1 + i.powerGrowth) ** t;
      const usPhysical = Math.min(usStock, i.usPower * powerGrowth);
      const cnPhysical = Math.min(local + foreign, i.cnPower * powerGrowth);
      const rental = usPhysical * i.cloudShare * (1 - cloud) * r.bypass;
      const usCompute = usPhysical - rental, cnCompute = cnPhysical + rental;
      const localUse = cnPhysical ? cnPhysical * local / (local + foreign) : 0;
      const usTrain = usCompute, cnTrain = cnCompute - localUse * (1 - i.localNetwork) / (1 + k);
      const usCap = usTrain ** i.computeElasticity, ownCap = cnTrain ** i.computeElasticity;
      const cnCap = ownCap + world.diffusion * i.openCatchup * Math.max(0, usCap - ownCap);
      ratio = usCap ? cnCap / usCap : (cnCap ? Infinity : 1);
      const adoption = domestic + imports ? domestic / (domestic + imports) : 0;
      const learning = Math.log1p((output + localUse) / (i.experienceScale + experience));
      const useFraction = output + localUse ? localUse / (output + localUse) : 0;
      k = k * (1 - i.knowledgeDecay) + i.rdGain * r.investment + learning *
        (i.fabLearning * (1 - useFraction) + i.useLearning * s.learning * useFraction);
      experience += output + localUse;
      const exposure = (chips + equipment + memory + cloud) / 4;
      const belief = unit(b.strategicBelief + b.signal * exposure);
      const spend = b.investmentCost * r.investment ** 2 + b.routeCost * r.bypass ** 2;
      if (t < b.lookahead) {
        planValue += (Math.log1p(cnCompute) + b.sovereignty * k + b.security * belief * adoption - spend) / b.lookahead;
      }
      const frontier = Math.max(usCap, cnCap) / tr.capabilityScale;
      const hazard = 1 - 0.5 ** (frontier ** tr.progressExponent / s.timing);
      const arrival = pending * hazard;
      const exclusive = unit(s.lock * (1 - tr.diffusionDrag * world.diffusion));
      const durable = arrival * exclusive * tr.durability;
      const usFirst = 1 / (1 + ratio ** tr.leadershipSensitivity);
      const retention = 0.5 ** (1 / s.persistence);
      temporary += (usLead + cnLead) * (1 - retention) + arrival * exclusive * (1 - tr.durability);
      usLead = usLead * retention + durable * usFirst;
      cnLead = cnLead * retention + durable * (1 - usFirst);
      shared += arrival * (1 - exclusive);
      pending -= arrival;

      const provocation = risk.provocation * exposure * belief * (1 + s.friction);
      const deterrence = risk.deterrence * exposure * Math.max(0, 1 - ratio) * (1 - s.friction);
      const warHazard = unit(risk.baselineWar + provocation - deterrence);
      const closeness = Math.max(usCap, cnCap) ? Math.min(usCap, cnCap) / Math.max(usCap, cnCap) : 0;
      const catHazard = unit(risk.baselineCat + risk.raceCat * closeness + risk.progressCat * (1 - pending));
      const newWar = (1 - war) * warHazard, newCat = (1 - cat) * catHazard;
      war += newWar;
      cat += newCat;
      const openness = Math.log1p(cnCap) * world.diffusion / (1 + exposure * belief);
      const discount = (1 + v.discount) ** -t;
      const salesShare = supply ? imports / supply : 0;
      const flows = {
        usEconomy: Math.log1p(usCap) + v.salesSurplus * salesShare - v.enforcementCost * exposure,
        cnEconomy: Math.log1p(cnCap) - spend, spillovers: Math.log1p((usCap + cnCap) / 2),
        openness, lead: v.leadScale * (usLead - cnLead), war: -v.warLoss * newWar, catastrophe: -v.catLoss * newCat,
      };
      for (const [key, x] of Object.entries(flows)) totals[key] = (totals[key] || 0) + discount * x;
      rows.push({...totals, ongoing: pending, shared, transient: temporary, us: usLead, cn: cnLead,
        warRisk: war, catRisk: cat, warHazard, provocation, deterrence, usStock, cnStock: local + foreign,
        usCompute, cnCompute, usTrain, cnTrain, usCap, cnCap, adoption, knowledge: k,
        output, domestic, imports, rental, chips});
    }
    return {planValue, rows};
  }

  function simulate(c, policy, settings) {
    const branches = [];
    for (const world of c.worlds) {
      const paths = Object.keys(c.responses).map(response => ({response, ...trajectory(c, policy, response, world, settings)}));
      const peak = Math.max(...paths.map(p => p.planValue));
      const weights = paths.map(p => Math.exp((p.planValue - peak) / c.behavior.temperature));
      const sum = weights.reduce((a, b) => a + b, 0);
      paths.forEach((p, j) => branches.push({response: p.response, weight: world.weight * weights[j] / sum, rows: p.rows}));
    }
    return branches;
  }

  function snapshot(branches, t, response = null) {
    const paths = response ? branches.filter(p => p.response === response) : branches;
    const mass = paths.reduce((sum, p) => sum + p.weight, 0);
    const mean = {};
    for (const p of paths) {
      for (const [key, value] of Object.entries(p.rows[t])) {
        mean[key] = (mean[key] || 0) + p.weight * value / mass;
      }
    }
    return mean;
  }

  return {simulate, snapshot, trajectory};
});
