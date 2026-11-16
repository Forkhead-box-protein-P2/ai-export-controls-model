/* The lean, outcome-level model. Same formula as src/ai_controls/lean.py; see that file
 * for the derivation. tests/test_lean.py checks that the two agree. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lean_params.js'));
  else root.AICLean = factory(root.AIC_LEAN);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';
  const YEARS = 25, F_YEARS = L.f_years;
  function arrivalDensity(p35, pNone) {
    const p50 = Math.max(1 - pNone, 1e-9), q = Math.min(Math.max(p35 / p50, 1e-6), 1 - 1e-9);
    const g = lam => Math.abs(lam) < 1e-9 ? 0.4 : (1 - Math.exp(-10 * lam)) / (1 - Math.exp(-25 * lam));
    let lo = -2, hi = 6;
    for (let k = 0; k < 80; k++) { const mid = 0.5 * (lo + hi); if (g(mid) < q) lo = mid; else hi = mid; }
    const lam = 0.5 * (lo + hi);
    const F = t => p50 * (Math.abs(lam) < 1e-9 ? t / 25 : (1 - Math.exp(-lam * t)) / (1 - Math.exp(-25 * lam)));
    return Array.from({ length: YEARS }, (_, t) => F(t + 1) - F(t));
  }
  function leadPath(p) {
    const L1 = p.k * Math.log10(Math.max(p.m, 1e-9)), He = Math.max(p.H - p.b, 0.25);
    return Array.from({ length: YEARS }, (_, t) => t >= 1 ? L1 * Math.pow(0.5, (t - 1) / He) : 0);
  }
  function evaluate(p) {
    const f = arrivalDensity(p.p35, p.p_none), dL = leadPath(p), pArr = Math.max(1 - p.p_none, 1e-9);
    let sLead = 0, sSafe = 0;
    for (let t = 0; t < YEARS; t++) { sLead += f[t] * dL[t]; sSafe += f[t] * Math.min(Math.max(p.r * dL[t], -1), 1); }
    const lead = p.p_dec * p.V_m * sLead, safety = p.K_cat * p.c0 / pArr * sSafe;
    const output = -p.y * F_YEARS, openness = -p.o * F_YEARS, war = -p.d_war / 100 * p.K_war;
    return { lead, safety, output, openness, war, net: lead + safety + output + openness + war, f, dL, sLead };
  }
  function defaults(config, pair, weights) {
    const d = L.derived[config], w = d.world, pr = d.pairs[pair], bw = pr.by_weights[weights];
    return { m: pr.m, k: w.k, H: pr.H, b: pr.b, p35: w.p35, p_none: w.p_none, p_dec: w.p_dec, V_m: w.V_m[weights],
      c0: w.c0, r: w.r, K_cat: bw.K_cat, y: bw.y, o: bw.o, d_war: pr.d_war, K_war: bw.K_war };
  }
  return { data: L, arrivalDensity, leadPath, evaluate, defaults, F_YEARS };
});
