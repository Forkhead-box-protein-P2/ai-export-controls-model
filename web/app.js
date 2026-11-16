/* Interactive front end for the AI export-controls game model. All numbers come from
 * web/model.js running in the browser on the parameter registry in web/params.js. */
(function () {
  'use strict';
  const M = window.AICModel, D = M.data;
  const $ = id => document.getElementById(id);
  const PBY = Object.fromEntries(D.params.map((p, j) => [p.name, Object.assign({ j }, p)]));
  const POLS = [...Object.keys(D.policies), 'custom'];
  // Only the series the page draws are recorded, which halves the run time.
  const SITE_SERIES = ['x_chips', 'x_hbm', 'x_sme', 'x_cloud', 'x_enf', 'm', 'y_rd', 'y_ret', 'h', 'b_cn', 'dom_share', 'Q_dom', 'W', 'imports',
    'K_soft', 'K_logic', 'K_sme', 'ratio_stock', 'ratio_train', 'lag_years', 'O', 'h_war', 'h_cat', 'adv_us', 'adv_cn', 'war_T', 'war_sdi', 'war_det', 'war_I',
    'cat_raw', 'cat_cn', 'cat_noslack', 'cat_norace', 'cat_nonat', 'cat_noopen'];
  const GROUPS = Object.keys(D.groups);
  const GC = Object.fromEntries(GROUPS.map((g, k) => [g, `var(--c${k + 1})`]));
  const CONFIGS = ['baseline', 'fox_continuous', 'erich_decisive', 'agnostic_wide'];
  const CFG_SHORT = { baseline: 'Baseline', fox_continuous: 'Continuous', erich_decisive: 'Decisive', agnostic_wide: 'Agnostic, wide' };
  const CFG_NOTE = {
    baseline: 'central illustrative values, uncertain parameters fixed',
    fox_continuous: 'closer to fox’s starting intuition; an illustrative operationalisation, not elicited priors',
    erich_decisive: 'closer to Erich Grunewald’s stated expectation; only his compute-lead forecasts are his own numbers',
    agnostic_wide: 'every uncertain parameter drawn from its full range, with correlated clusters',
  };
  const W_SHORT = { us_interest: 'US interest', global: 'Global welfare', pluralist: 'Pluralist' };
  const REG = {
    us_durable: ['var(--c1)', 'Durable US lead'], us_transient: ['#86b6ef', 'US lead dissipates'],
    cn_durable: ['var(--c8)', 'Durable Chinese lead'], cn_transient: ['#f2a7a6', 'Chinese lead dissipates'],
    near_simultaneous: ['var(--c7)', 'Near-simultaneous'], distributed: ['var(--c3)', 'Distributed frontier'],
    no_monopoly: ['var(--c4)', 'Transformation, no monopoly'], no_sharp: ['var(--gray)', 'No sharp transition'],
  };
  const S = {
    config: 'baseline', weights: 'global', A: 'maintain', B: 'relax_chips', n: 500, seed: 42, year: 2035,
    overrides: {}, custom: [0.6, 0.9, 0.85, 0.4, 0.7], node: 'ind', run: null, cfg: null, cache: {}, sum: {},
  };

  // ---------------------------------------------------------------- formatting
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sgn = (x, d = 1) => { const r = +x.toFixed(d); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(d); };
  const pc = (x, d = 0) => (100 * x).toFixed(d) + '%';
  const f2 = x => x.toFixed(2);
  const fr = x => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + '×';
  const fu = x => x >= 1000 ? (x / 1000).toFixed(1) + 'k' : x >= 10 ? x.toFixed(0) : x.toFixed(2);
  const fv = v => { const a = Math.abs(v); return a === 0 ? '0' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toExponential(1); };
  const tn = x => sgn(x, Math.abs(x) >= 10 ? 0 : 1) + ' tn';
  const polLabel = p => p === 'custom' ? 'Your policy' : D.policies[p].label;
  const lc = g => g.startsWith('AI') ? g : g.toLowerCase();

  // ---------------------------------------------------------------- tooltip
  const tip = $('tip');
  function showTip(e, html) {
    tip.innerHTML = html; tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 12;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
  }
  const hideTip = () => { tip.style.display = 'none'; };
  function tipHost(host) {
    host.addEventListener('mousemove', e => {
      const t = e.target.closest && e.target.closest('[data-ti]');
      if (t && host._tips) showTip(e, host._tips[+t.dataset.ti]); else if (!host._hover) hideTip();
    });
    host.addEventListener('mouseleave', hideTip);
  }

  // ---------------------------------------------------------------- running
  const cfgNow = () => M.makeConfig(S.config, S.overrides);
  const extra = () => ({ custom: { type: 'fixed', x: S.custom.slice() } });
  let timer = 0;
  function schedule(delay) {
    $('status').textContent = 'Running…';
    clearTimeout(timer);
    timer = setTimeout(runMain, delay === undefined ? 90 : delay);
  }
  function runMain() {
    const t0 = performance.now();
    S.cfg = cfgNow();
    S.run = M.runConfig(S.cfg, S.n, S.seed, { policies: POLS, extraPolicies: extra(), record: SITE_SERIES });
    S.cache = {}; S.sum = {};
    $('status').textContent = `${S.n} worlds × ${POLS.length} policies · ${Math.round(performance.now() - t0)} ms`;
    renderAll();
    writeQuery();
  }
  const res = p => S.run.results[p];
  function cmp(a, b, w) {
    const key = a + '|' + b + '|' + w;
    return S.cache[key] || (S.cache[key] = M.compare(res(a), res(b), D.weights[w]));
  }
  function summary(p, k) {
    const key = p + '|' + k;
    return S.sum[key] || (S.sum[key] = M.seriesSummary(res(p), k));
  }
  const meanAt = (p, k, t) => M.seriesMean(res(p), k, t);
  const medAt = (p, k, t) => summary(p, k).p50[t];
  function frac(p, pred) {
    const e = res(p).events, n = res(p).n;
    let c = 0; for (let i = 0; i < n; i++) if (pred(e, i)) c++;
    return c / n;
  }
  const ty = () => S.year - D.start_year;

  // ---------------------------------------------------------------- controls
  function seg(host, items, current, onPick) {
    host.innerHTML = items.map(([k, lab, title]) => `<button type="button" data-k="${k}" class="${k === current ? 'on' : ''}" ${title ? `title="${esc(title)}"` : ''}>${lab}</button>`).join('');
    host.querySelectorAll('button').forEach(b => b.onclick = () => onPick(b.dataset.k));
  }
  function renderControls() {
    seg($('cfgSeg'), CONFIGS.map(c => [c, CFG_SHORT[c], D.configs[c].description]), S.config, k => {
      S.config = k; S.overrides = {}; renderControls(); renderInspector(); buildParamTable(); schedule(0);
    });
    seg($('wSeg'), Object.keys(D.weights).map(w => [w, W_SHORT[w] || w, D.weights[w].desc]), S.weights, k => {
      S.weights = k; renderControls(); renderAll(); writeQuery();
    });
    for (const id of ['polA', 'polB']) {
      const key = id === 'polA' ? 'A' : 'B';
      $(id).innerHTML = POLS.map(p => `<option value="${p}" ${p === S[key] ? 'selected' : ''}>${polLabel(p)}</option>`).join('');
    }
    $('nSel').value = String(S.n);
  }
  $('polA').onchange = e => { S.A = e.target.value; renderAll(); writeQuery(); };
  $('polB').onchange = e => { S.B = e.target.value; renderAll(); writeQuery(); };
  $('nSel').onchange = e => { S.n = +e.target.value; schedule(0); };
  $('resetAll').onclick = () => { S.overrides = {}; S.custom = [0.6, 0.9, 0.85, 0.4, 0.7]; renderInspector(); buildParamTable(); schedule(0); };

  function readQuery() {
    const q = new URLSearchParams(location.search);
    if (CONFIGS.includes(q.get('w'))) S.config = q.get('w');
    if (D.weights[q.get('v')]) S.weights = q.get('v');
    if (POLS.includes(q.get('a'))) S.A = q.get('a');
    if (POLS.includes(q.get('b'))) S.B = q.get('b');
    const y = +q.get('y'); if (y >= D.start_year && y <= D.end_year) S.year = y;
    const n = +q.get('n'); if ([250, 500, 1000, 2000].includes(n)) S.n = n;
  }
  function writeQuery() {
    const q = new URLSearchParams({ w: S.config, v: S.weights, a: S.A, b: S.B, y: S.year, n: S.n });
    try { history.replaceState(null, '', '?' + q.toString() + location.hash); } catch (e) { /* file:// */ }
  }

  // theme
  (function theme() {
    const order = ['auto', 'light', 'dark'];
    let cur = 'auto';
    try { cur = localStorage.getItem('aic-theme') || 'auto'; } catch (e) { /* storage blocked */ }
    const apply = () => {
      if (cur === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = cur;
      $('themeBtn').textContent = cur === 'auto' ? 'Theme: auto' : cur === 'light' ? 'Theme: light' : 'Theme: dark';
      if (S.surface) drawSurface();
    };
    $('themeBtn').onclick = () => { cur = order[(order.indexOf(cur) + 1) % 3]; try { localStorage.setItem('aic-theme', cur); } catch (e) { /* ignore */ } apply(); };
    apply();
  })();

  // ---------------------------------------------------------------- reading
  function renderReading() {
    const c = cmp(S.A, S.B, S.weights);
    const parts = GROUPS.map(g => [g, c.groups[g]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const others = Object.keys(D.weights).filter(w => w !== S.weights).map(w => `${W_SHORT[w]}: ${tn(cmp(S.A, S.B, w).mean)}`).join('; ');
    const verb = c.mean > 0 ? 'beats' : 'trails';
    $('reading').innerHTML = S.A === S.B ? 'Choose two different policies to compare.' :
      `Under the <strong>${CFG_SHORT[S.config]}</strong> worldview with <strong>${W_SHORT[S.weights]}</strong> values, <span class="sw a"></span><strong>${polLabel(S.A)}</strong> ${verb} <span class="sw b"></span><strong>${polLabel(S.B)}</strong> by <strong>$${Math.abs(c.mean).toFixed(1)} tn</strong> in present value (±${(2 * c.se).toFixed(1)}), and does better in ${pc(c.pBetter)} of simulated worlds. The largest contributions are ${lc(parts[0][0])} (${tn(parts[0][1])}) and ${lc(parts[1][0])} (${tn(parts[1][1])}). Other value sets: ${others}. <span class="muted">This worldview is ${CFG_NOTE[S.config]}.</span>`;
  }

  // ---------------------------------------------------------------- game map
  const NODES = {
    us: { step: '1', title: 'US sets controls', sub: 'Restrictiveness on chips, HBM, equipment and cloud, plus enforcement',
      params: ['leak_chips', 'leak_hbm', 'leak_sme', 'leak_cloud', 'scarcity', 'scarcity_halflife'],
      why: ['The US chooses a policy vector each year. In 2026 every policy starts from the inherited regime; a policy change takes effect from 2027, and past restrictions, investments and Chinese mandates cannot be undone by setting a knob to zero.',
        'Restrictions leak through smuggling, diversion and shell buyers. Enforcement shrinks the leak; China’s evasion effort grows with restrictiveness. After a war, all exports stop.',
        'Lost sales to China are not a dollar-for-dollar US loss: while supply is scarce, a chip sold to China is a chip not sold elsewhere. Scarcity fades as fabrication and packaging capacity respond.'],
      eqn: '\\(x^{\\text{eff}}_k=x_k\\,\\big[1-\\ell_k\\,(1-x_{\\text{enf}})\\,(\\tfrac12+\\tfrac12\\,y^{\\text{evade}})\\big]\\)' },
    cn: { step: '2', title: 'China responds', sub: 'Mandates, R&D and subsidies, retaliation and evasion: an assumed rule',
      params: ['m_base', 'm_h', 'rd_h', 'rd_b', 'b_cn0', 'sig_eta', 'prog_eta', 'h_down', 'ret_dR'],
      why: ['China’s response is an assumed behavioural rule, labelled as such; the strategic game section compares it with optimising stances. Supply insecurity rises fast when controls tighten and fades slowly when they ease, so a rollback does not erase the experience of 2022–26.',
        'The procurement mandate and R&D effort rise with insecurity. R&D also rises with Beijing’s belief that AI is decisive. That belief starts lower than an AGI-focused US view and moves with observed progress toward a transition and, through the signalling channel, with how hard the US restricts.'],
      eqn: '\\(h_{t+1}=h_t+\\eta^{\\pm}(R_t-h_t),\\qquad b_{t+1}=b_t+(\\eta_s R_t+\\eta_p\\,\\text{prox}_t)(1-b_t)\\)' },
    ind: { step: '3', title: 'Industry and market', sub: 'Adoption, know-how and output, tracked separately',
      params: ['mandate_erosion', 'pref_dq', 'lab_sens', 'learn_soft', 'learn_logic', 'rd_logic', 'rd_sme', 'g_cap_max', 'util_pull', 'demand_share'],
      why: ['This is the core contested counterfactual. Chinese buyers choose between domestic chips and permitted imports. How captive the market is depends on mandate erosion: at zero, Beijing secures the same domestic demand whether or not US chips are on offer; near one, available US chips undermine the mandate.',
        'Know-how grows with R&D, with learning from new production and operating experience, and with spillovers from foreign tools. Software-stack learning depends on leading buyers actually running on domestic chips. Output is a separate quantity: the minimum of the logic, HBM and packaging bottlenecks. SME controls slow capacity expansion and HBM controls cap memory, so controls can speed know-how while cutting output.'],
      eqn: '\\(s_t=\\sigma\\big(a_0+b_m m_t(1-\\varepsilon\\,\\text{acc}_t)+e_h h_t-d_q\\ln\\tfrac{q^{\\text{imp}}}{q^{\\text{dom}}}\\big)\\)' },
    cap: { step: '4', title: 'Compute and capability', sub: 'Hardware stocks, training compute and the capability lead',
      params: ['ratio0', 'alpha_T', 'g_w0', 'g_w_inf', 'diff_rate', 'follow_floor', 'intrinsic_gap', 'g_e_us', 'cn_spill'],
      why: ['Western accelerator output grows fast and then slows; the US installs most of it. China’s stock is imports plus domestic chips, depreciated. Power caps how much hardware can run, so more electricity cannot help without chips. Rented foreign cloud adds services in the year it is rented and never becomes Chinese hardware.',
        'A compute ratio maps into a capability gap only through α, the return to training compute. China’s 2026 algorithmic efficiency reproduces the observed lag of about seven months. Borrowed efficiency keeps a follower close but cannot carry it past the leader.'],
      eqn: '\\(\\ln A^{US}_t=\\alpha\\ln\\tfrac{T^{US}_t}{T^{US}_0}+G^{US}_t,\\quad \\text{lead}_t=\\dfrac{\\ln A^{US}_t-\\ln A^{CN}_t}{\\alpha g_W+g_{\\text{alg}}}\\)' },
    arr: { step: '5', title: 'Transformative AI?', sub: 'Arrival when the frontier crosses an uncertain threshold',
      params: ['p_tai_2035', 'p_no_threshold', 'theta_sigma'],
      why: ['A transition arrives when frontier capability crosses a threshold drawn for each world. Its median is solved so that the probability of arrival by 2035 under Maintain equals the stated value. Some worlds have no sharp threshold at all, and progress stays continuous.',
        'Arrival does not pick a winner and does not imply lock-in: those are separate draws in the next two stages.'],
      eqn: '\\(\\Pr(\\text{arrival by 2035}\\mid\\text{Maintain})=p_{2035}\\)' },
    lead: { step: '6', title: 'Lead at arrival', sub: 'Who is ahead, by how much, and whether open models distribute the frontier',
      params: ['open_gap_us', 'open_lag_b', 'open_lag_T', 'dist_gap', 'sim_window'],
      why: ['At arrival the leader is whoever has the higher capability, and the lead is measured in years of frontier progress. If open-weight models are close to the frontier, the frontier is likely distributed and nobody captures it.',
        'Chinese labs release less openly as tension rises and as Beijing comes to see AI as decisive, which is one way controls can reduce open-model competition.'],
      eqn: '\\(\\Pr(\\text{distributed})=\\exp\\!\\big(-\\max(A^{\\text{front}}-A^{\\text{open}},0)/g_d\\big)\\)' },
    dec: { step: '7', title: 'Decisive and durable?', sub: 'Capture share and persistence, drawn as world types',
      params: ['p_high_dec', 'p_persist10', 'lead_conv', 'contest_share', 'tai_growth', 'open_erode'],
      why: ['Strategic decisiveness d is a world type fixed across policies, drawn from a two-regime mixture. A lead converts into durable capture of other economies’ contestable post-transition surplus only in proportion to d and to how long the lead is. Open models erode capture.',
        'The advantage then decays with a persistence half-life that is correlated with d. This is where a temporary hardware lead does, or does not, become lasting power.'],
      eqn: '\\(k=d\\,(1-e^{-\\ell/c})(1-\\omega O),\\qquad a_t=k\\cdot 2^{-(t-t^*)/H}\\)' },
    out: { step: '8', title: 'Outcome regimes', sub: 'Every world classified by 2050; war and catastrophe overlap',
      params: ['p_adverse_us', 'p_adverse_cn', 'adverse_cost', 'cat_mult_cn'],
      why: ['A lead is durable if the capture share is at least 0.25 and the half-life is at least ten years, and dissipates if capture is smaller or shorter-lived. A world can be transformed with no strategic monopoly at all.',
        'Whether a durable order is institutionally adverse is drawn separately for US-led and China-led orders, and an adverse order costs every economy a share of output while it lasts. Neither is assumed safe or benign by construction; set the two probabilities equal to remove any difference.'],
      eqn: '\\(\\text{durable}\\iff k\\ge 0.25\\ \\wedge\\ H\\ge 10\\text{ yr}\\)' },
    haz: { step: 'H', title: 'Hazards: war and catastrophe', sub: 'Annual hazards alongside every stage', haz: true,
      params: ['war_base_2040', 'th_T', 'th_sdi', 'th_det', 'th_I', 'cat_base', 'cat_mult_cn', 'lead_safety', 'slack_used', 'race_risk', 'cat_severity'],
      why: ['The baseline war hazard, where China’s political claim on Taiwan belongs, is calibrated to a cumulative probability by 2040 under Maintain. Controls change it only at the margin: provocation through tension, strategic denial through Beijing’s belief and US dependence on Taiwan, deterrence through the US lead, and interdependence through trade.',
        'The catastrophe hazard is summed over the US and Chinese frontier developers, each in proportion to how close it is to the threshold, so a trailing developer adds risk too. Chinese development carries a nationality multiplier (1 = no difference). A lead lowers the leader’s hazard only to the extent its slack is actually spent on safety rather than on racing domestic rivals; a close race under tension raises both.'],
      eqn: '\\(h_t=\\sigma\\big(\\theta_0+\\theta_T\\Delta T_t+\\theta_S b_t\\,\\text{dep}_t\\,x^{\\text{eff}}_{\\text{chips}}-\\theta_D\\tanh\\tfrac{\\text{lead}_t}{\\tau}-\\theta_I\\Delta I_t\\big)\\)' },
    pay: { step: '9', title: 'Payoffs', sub: 'A vector of components, weighted only at the end', wide: true,
      params: ['discount_rate', 'terminal_years', 'uplift_max', 'open_boost', 'sci_spill', 'markup_max', 'tens_cost'],
      why: ['Each world yields discounted components: AI-driven output for each economy (with idea spillovers), trade, openness, lead capture, war and catastrophe losses, and indices of security, liberty and integration. The value set chosen above weights them; there is no separate jackpot for winning.',
        'A terminal value carries the 2050 flows forward so that a 25-year horizon does not mechanically favour short-run gains.'],
      eqn: '\\(V(\\pi)=\\mathbb E\\Big[\\sum_t \\beta^t\\,w\\cdot u_t(\\pi)\\Big]+\\text{terminal}\\)' },
  };
  const ORDER = ['us', 'cn', 'ind', 'cap', 'arr', 'lead', 'dec', 'out', 'pay', 'haz'];
  const EDGES = [['us', 'cn'], ['cn', 'ind'], ['ind', 'cap'], ['cap', 'arr'], ['arr', 'lead'], ['lead', 'dec'], ['dec', 'out'], ['out', 'pay'], ['arr', 'haz', 'haz'], ['haz', 'pay', 'haz']];

  function buildMap() {
    const map = $('map');
    for (const id of ORDER) {
      const nd = NODES[id], div = document.createElement('div');
      div.className = 'node' + (id === 'pay' ? ' node-pay' : '');
      div.dataset.id = id; div.style.gridArea = id; div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.innerHTML = `<div class="nh"><span class="step ${nd.haz ? 'h' : ''}">${nd.step}</span><h3>${nd.title}</h3></div><div class="ns">${nd.sub}</div><div class="nb"></div><div class="more">Mechanism and assumptions ▸</div>`;
      div.onclick = () => selectNode(id, true);
      div.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(id, true); } };
      map.appendChild(div);
      tipHost(div);
    }
    new ResizeObserver(drawWires).observe(map);
  }
  function selectNode(id, scroll) {
    S.node = id;
    document.querySelectorAll('.node').forEach(n => n.classList.toggle('sel', n.dataset.id === id));
    renderInspector();
    if (scroll && innerWidth < 980) $('inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawWires() {
    const map = $('map'), svg = $('wires'), base = map.getBoundingClientRect();
    const R = {};
    map.querySelectorAll('.node').forEach(n => {
      const r = n.getBoundingClientRect();
      R[n.dataset.id] = { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top, cx: (r.left + r.right) / 2 - base.left, cy: (r.top + r.bottom) / 2 - base.top };
    });
    const inside = (x, y, skip) => Object.entries(R).some(([k, r]) => !skip.includes(k) && x > r.l + 2 && x < r.r - 2 && y > r.t + 2 && y < r.b - 2);
    const out = [];
    for (const [a, b, kind] of EDGES) {
      const A = R[a], B = R[b];
      let x1, y1, x2, y2;
      const oy = Math.min(A.b, B.b) - Math.max(A.t, B.t), ox = Math.min(A.r, B.r) - Math.max(A.l, B.l);
      if (oy > 24) { const y = (Math.max(A.t, B.t) + Math.min(A.b, B.b)) / 2; y1 = y2 = y; if (B.cx > A.cx) { x1 = A.r; x2 = B.l; } else { x1 = A.l; x2 = B.r; } }
      else { const down = B.cy > A.cy; y1 = down ? A.b : A.t; y2 = down ? B.t : B.b; if (ox > 24) { x1 = x2 = (Math.max(A.l, B.l) + Math.min(A.r, B.r)) / 2; } else { x1 = A.cx; x2 = B.cx; } }
      let blocked = false;
      for (let s = 1; s < 20 && !blocked; s++) blocked = inside(x1 + (x2 - x1) * s / 20, y1 + (y2 - y1) * s / 20, [a, b]);
      if (blocked) continue;
      const d = (x1 === x2 || y1 === y2) ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
      out.push(`<path class="wire ${kind === 'haz' ? 'haz' : 'flow'}" d="${d}" marker-end="url(#${kind === 'haz' ? 'ah' : 'af'})"/>`);
    }
    const A = R.cap, B = R.us;
    let loop, lx, ly;
    if (Math.abs(A.cy - B.cy) < 30) { const top = Math.min(A.t, B.t); loop = `M${A.cx},${A.t} C${A.cx},${top - 40} ${B.cx},${top - 40} ${B.cx},${B.t}`; lx = (A.cx + B.cx) / 2; ly = top - 26; }
    else { const left = Math.min(A.l, B.l); loop = `M${A.l},${A.cy} C${left - 26},${A.cy} ${left - 26},${B.cy} ${B.l},${B.cy}`; lx = left - 4; ly = (A.cy + B.cy) / 2; }
    svg.innerHTML = `<defs><marker id="af" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" style="fill:var(--accent);fill-opacity:.7"/></marker><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" style="fill:var(--c8);fill-opacity:.6"/></marker></defs>${out.join('')}<path class="wire flow" d="${loop}" marker-end="url(#af)"/><text class="wire-label" x="${lx}" y="${ly}" text-anchor="middle" ${Math.abs(A.cy - B.cy) < 30 ? '' : `transform="rotate(-90 ${lx} ${ly})"`}>state carries into next year</text>`;
  }

  function dual(label, a, b, dom, fmt, log, title) {
    const w = v => {
      if (!Number.isFinite(v)) return 0;
      const t = log ? (Math.log(Math.max(v, dom[0])) - Math.log(dom[0])) / (Math.log(dom[1]) - Math.log(dom[0])) : (v - dom[0]) / (dom[1] - dom[0]);
      return Math.max(0, Math.min(1, t)) * 100;
    };
    return `<div class="dual" ${title ? `title="${esc(title)}"` : ''}><div class="dual-l">${label}</div><div class="dual-t"><i class="ba" style="width:${w(a)}%"></i><i class="bb" style="width:${w(b)}%"></i></div><div class="dual-v"><span><b class="sw a"></b>${fmt(a)}</span><span><b class="sw b"></b>${fmt(b)}</span></div></div>`;
  }
  function stackBar(p, tips) {
    const e = res(p).events, n = res(p).n, cnt = Object.fromEntries(Object.keys(REG).map(k => [k, 0]));
    for (let i = 0; i < n; i++) cnt[e.regime[i]]++;
    return `<div class="stack">${Object.keys(REG).filter(k => cnt[k]).map(k => { tips.push(`<b>${polLabel(p)}</b><br>${REG[k][1]}: ${pc(cnt[k] / n, 1)}`); return `<i data-ti="${tips.length - 1}" style="flex:${cnt[k]};background:${REG[k][0]}"></i>`; }).join('')}</div>`;
  }
  function nodeBody(id, tips) {
    const t = ty(), A = S.A, B = S.B, yr = S.year;
    const by = (key, p) => frac(p, (e, i) => e[key][i] <= t);
    switch (id) {
      case 'us':
        return [['Chips', 'x_chips'], ['HBM', 'x_hbm'], ['Equipment (SME)', 'x_sme'], ['Cloud access', 'x_cloud'], ['Enforcement', 'x_enf']]
          .map(([l, k]) => dual(l, meanAt(A, k, t), meanAt(B, k, t), [0, 1], f2)).join('');
      case 'cn':
        return dual('Procurement mandate', meanAt(A, 'm', t), meanAt(B, 'm', t), [0, 1], f2) +
          dual('R&D and subsidy effort', meanAt(A, 'y_rd', t), meanAt(B, 'y_rd', t), [0, 3], f2, false, '1 = baseline effort') +
          dual('Retaliation', meanAt(A, 'y_ret', t), meanAt(B, 'y_ret', t), [0, 1], f2) +
          dual('Supply insecurity', meanAt(A, 'h', t), meanAt(B, 'h', t), [0, 1], f2) +
          dual('Belief AI is decisive', meanAt(A, 'b_cn', t), meanAt(B, 'b_cn', t), [0, 1], f2);
      case 'ind': {
        const qw = p => meanAt(p, 'Q_dom', t) / meanAt(p, 'W', t);
        return dual('Domestic adoption', meanAt(A, 'dom_share', t), meanAt(B, 'dom_share', t), [0, 1], v => pc(v), false, 'Domestic share of new Chinese AI hardware') +
          dual('Domestic output ÷ Western', qw(A), qw(B), [0.005, 2], v => pc(v, v < 0.1 ? 1 : 0), true) +
          dual('Know-how: software', meanAt(A, 'K_soft', t), meanAt(B, 'K_soft', t), [0, 1], f2) +
          dual('Know-how: chips', meanAt(A, 'K_logic', t), meanAt(B, 'K_logic', t), [0, 1], f2) +
          dual('Know-how: equipment', meanAt(A, 'K_sme', t), meanAt(B, 'K_sme', t), [0, 1], f2);
      }
      case 'cap':
        return dual('US:China installed', medAt(A, 'ratio_stock', t), medAt(B, 'ratio_stock', t), [1, 40], fr, true, 'Median ratio of AI hardware stocks') +
          dual('US:China training compute', medAt(A, 'ratio_train', t), medAt(B, 'ratio_train', t), [1, 40], fr, true, 'Median ratio including rented cloud') +
          dual('US capability lead', meanAt(A, 'lag_years', t), meanAt(B, 'lag_years', t), [0, 2], v => v.toFixed(2) + ' yr', false, 'Years of frontier progress; negative means China ahead') +
          dual('Open-model pressure', meanAt(A, 'O', t), meanAt(B, 'O', t), [0, 1], f2);
      case 'arr':
        return dual(`Arrived by ${yr}`, by('t_arr', A), by('t_arr', B), [0, 1], v => pc(v)) +
          dual('Arrived by 2035', frac(A, (e, i) => e.t_arr[i] <= 2035 - D.start_year), frac(B, (e, i) => e.t_arr[i] <= 2035 - D.start_year), [0, 1], v => pc(v)) +
          dual('Arrived by 2050', frac(A, (e, i) => e.arrived[i]), frac(B, (e, i) => e.arrived[i]), [0, 1], v => pc(v));
      case 'lead': {
        const clear = (e, i) => e.arrived[i] && e.t_arr[i] <= t && !e.near_sim[i] && !e.distributed[i];
        const ml = p => { const e = res(p).events; let s = 0, c = 0; for (let i = 0; i < res(p).n; i++) if (e.arrived[i] && e.t_arr[i] <= t) { s += e.lead0[i]; c++; } return c ? s / c : NaN; };
        return dual('US clearly ahead', frac(A, (e, i) => clear(e, i) && e.leader[i] === 1), frac(B, (e, i) => clear(e, i) && e.leader[i] === 1), [0, 1], v => pc(v)) +
          dual('China clearly ahead', frac(A, (e, i) => clear(e, i) && e.leader[i] === 2), frac(B, (e, i) => clear(e, i) && e.leader[i] === 2), [0, 1], v => pc(v)) +
          dual('Near-simultaneous', frac(A, (e, i) => e.arrived[i] && e.t_arr[i] <= t && e.near_sim[i] && !e.distributed[i]), frac(B, (e, i) => e.arrived[i] && e.t_arr[i] <= t && e.near_sim[i] && !e.distributed[i]), [0, 1], v => pc(v)) +
          dual('Distributed frontier', frac(A, (e, i) => e.distributed[i] && e.t_arr[i] <= t), frac(B, (e, i) => e.distributed[i] && e.t_arr[i] <= t), [0, 1], v => pc(v)) +
          dual('Mean lead at arrival', ml(A), ml(B), [0, 2], v => Number.isFinite(v) ? v.toFixed(2) + ' yr' : '—');
      }
      case 'dec': {
        const dur = (e, i) => e.t_arr[i] <= t && (e.regime[i] === 'us_durable' || e.regime[i] === 'cn_durable');
        const tra = (e, i) => e.t_arr[i] <= t && (e.regime[i] === 'us_transient' || e.regime[i] === 'cn_transient');
        const adv = p => meanAt(p, 'adv_us', t) + meanAt(p, 'adv_cn', t);
        return dual('Durable lead', frac(A, dur), frac(B, dur), [0, 1], v => pc(v)) +
          dual('Lead that dissipates', frac(A, tra), frac(B, tra), [0, 1], v => pc(v)) +
          dual(`Advantage held in ${yr}`, adv(A), adv(B), [0, 0.5], f2, false, 'Mean capture share still held by a leader this year');
      }
      case 'out':
        return `<div class="small muted">By 2050</div><div class="dual"><div class="dual-l"><b class="sw a"></b>${polLabel(A)}</div><div style="grid-column:span 2">${stackBar(A, tips)}</div></div><div class="dual"><div class="dual-l"><b class="sw b"></b>${polLabel(B)}</div><div style="grid-column:span 2">${stackBar(B, tips)}</div></div><div class="legend" style="margin:6px 0 0;font-size:10.5px">${Object.values(REG).map(([c, l]) => `<span><i style="background:${c};width:9px;height:9px"></i>${l}</span>`).join('')}</div>`;
      case 'haz': {
        const wd = M.warDecomposition(res(A), res(B), t);
        return dual(`War by ${yr}`, by('t_war', A), by('t_war', B), [0, 0.4], v => pc(v, 1)) +
          dual('War hazard this year', meanAt(A, 'h_war', t), meanAt(B, 'h_war', t), [0, 0.04], v => pc(v, 2)) +
          dual(`Catastrophe by ${yr}`, by('t_cat', A), by('t_cat', B), [0, 0.4], v => pc(v, 1)) +
          dual('Chinese share of AI hazard', meanAt(A, 'cat_cn', t) / Math.max(meanAt(A, 'cat_raw', t), 1e-12), meanAt(B, 'cat_cn', t) / Math.max(meanAt(B, 'cat_raw', t), 1e-12), [0, 1], v => pc(v), false, 'Share of this year’s catastrophe hazard that comes from the Chinese developer') +
          `<div class="small" style="margin-top:6px">Marginal war risk A − B by ${yr}: <b>${sgn(wd.marginal_pp, 2)} pp</b></div>`;
      }
      case 'pay': {
        const c = cmp(A, B, S.weights), mx = Math.max(1e-9, ...GROUPS.map(g => Math.abs(c.groups[g])));
        const rows = GROUPS.map(g => {
          const v = c.groups[g], w = 50 * Math.abs(v) / mx;
          return `<span>${g}</span><div class="pbar"><i style="background:${GC[g]};${v >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`}"></i></div><span class="dual-v" style="text-align:right">${tn(v)}</span>`;
        }).join('');
        return `<div class="row" style="justify-content:space-between;align-items:baseline;margin-bottom:6px"><div><span class="big">${c.mean >= 0 ? '+' : '−'}$${Math.abs(c.mean).toFixed(1)} tn</span> <span class="small muted">A − B, ${W_SHORT[S.weights]}</span></div><span class="small muted">A better in ${pc(c.pBetter)} of worlds</span></div><div class="paygrid">${rows}</div>`;
      }
    }
    return '';
  }
  function renderMap() {
    document.querySelectorAll('.node').forEach(div => {
      const tips = [];
      div.querySelector('.nb').innerHTML = nodeBody(div.dataset.id, tips);
      div._tips = tips;
      div.classList.toggle('sel', div.dataset.id === S.node);
    });
    $('yearLabel').textContent = S.year;
    drawWires();
  }

  // ---------------------------------------------------------------- inspector and sliders
  const baseValue = name => D.configs[S.config].values[PBY[name].j];
  const curValue = name => name in S.overrides ? S.overrides[name] : baseValue(name);
  function sliderRange(p) {
    let lo = p.low, hi = p.high;
    const v = baseValue(p.name);
    if (lo === null || hi === null) { lo = v > 0 ? 0 : v < 0 ? 2 * v : 0; hi = v > 0 ? 2 * v : v < 0 ? 0 : 1; }
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    return [lo, hi];
  }
  function paramSlider(name) {
    const p = PBY[name]; if (!p) return '';
    const [lo, hi] = sliderRange(p), v = curValue(name);
    return `<div class="slider ${name in S.overrides ? 'edited' : ''}" data-p="${name}"><div class="sh"><b>${esc(name)}</b><span class="sv">${fv(v)} <span class="muted">${esc(p.units || '')}</span></span></div><input type="range" min="${lo}" max="${hi}" step="${(hi - lo) / 200}" value="${v}" aria-label="${esc(name)}"><div class="sd">${esc(p.def)} <span class="badge ${p.status}">${p.status}</span></div></div>`;
  }
  function bindSliders(host) {
    host.querySelectorAll('.slider[data-p]').forEach(div => {
      const name = div.dataset.p, inp = div.querySelector('input');
      inp.oninput = () => {
        const v = +inp.value;
        if (Math.abs(v - baseValue(name)) < 1e-12) delete S.overrides[name]; else S.overrides[name] = v;
        div.classList.toggle('edited', name in S.overrides);
        div.querySelector('.sv').firstChild.textContent = fv(v) + ' ';
        syncParamRow(name);
        schedule();
      };
    });
  }
  function renderInspector() {
    const nd = NODES[S.node], host = $('inspector');
    let custom = '';
    if (S.node === 'us') {
      custom = `<h3 style="margin-top:14px">Your policy</h3><p class="small muted" style="margin-bottom:4px">A fixed policy from 2027 on. It appears in the scorecard and can be chosen as Policy A or B.</p>` +
        ['Chips', 'HBM', 'Equipment (SME)', 'Cloud access', 'Enforcement'].map((l, k) => `<div class="slider" data-c="${k}"><div class="sh"><b>${l}</b><span class="sv">${S.custom[k].toFixed(2)}</span></div><input type="range" min="0" max="1" step="0.01" value="${S.custom[k]}" aria-label="Your policy: ${l}"></div>`).join('');
    }
    host.innerHTML = `<div class="why"><div class="eyebrow">Stage ${nd.step}</div><h3>${nd.title}</h3>${nd.why.map(p => `<p>${p}</p>`).join('')}<div class="eqn">${nd.eqn}</div>${custom}</div><div><div class="small muted" style="margin-bottom:4px">Assumptions behind this stage (${CFG_SHORT[S.config]} worldview). Edits re-run every policy.</div><div class="sliders">${nd.params.map(paramSlider).join('')}</div></div>`;
    bindSliders(host);
    host.querySelectorAll('.slider[data-c]').forEach(div => {
      const k = +div.dataset.c, inp = div.querySelector('input');
      inp.oninput = () => { S.custom[k] = +inp.value; div.querySelector('.sv').textContent = S.custom[k].toFixed(2); schedule(); };
    });
    if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([host]).catch(() => {});
  }

  // ---------------------------------------------------------------- outcome trees
  function treeData(p) {
    const e = res(p).events, n = res(p).n;
    const node = (label, pred, color, children) => {
      let c = 0, w = 0, k = 0;
      for (let i = 0; i < n; i++) if (pred(i)) { c++; if (e.war[i]) w++; if (e.cat[i]) k++; }
      return { label, p: c / n, war: c ? w / c : 0, cat: c ? k / c : 0, color, children: children || [] };
    };
    const clear = i => e.arrived[i] && !e.near_sim[i] && !e.distributed[i];
    const side = (who, lab, durC, traC) => node(`${lab} ahead at arrival`, i => clear(i) && e.leader[i] === who, who === 1 ? '#86b6ef' : '#f2a7a6', [
      node('Durable lead', i => clear(i) && e.leader[i] === who && e.regime[i].endsWith('_durable'), durC),
      node('Lead dissipates', i => clear(i) && e.leader[i] === who && e.regime[i].endsWith('_transient'), traC),
      node('Little capture', i => clear(i) && e.leader[i] === who && e.regime[i] === 'no_monopoly', REG.no_monopoly[0]),
    ]);
    return node('All worlds', () => true, 'var(--gray2)', [
      node('Transition by 2050', i => e.arrived[i], 'var(--gray2)', [
        node('Distributed frontier', i => e.distributed[i], REG.distributed[0]),
        node('Near-simultaneous', i => e.arrived[i] && e.near_sim[i] && !e.distributed[i], REG.near_simultaneous[0]),
        side(1, 'US', REG.us_durable[0], REG.us_transient[0]),
        side(2, 'China', REG.cn_durable[0], REG.cn_transient[0]),
      ]),
      node('No sharp transition', i => !e.arrived[i], REG.no_sharp[0]),
    ]);
  }
  function renderTrees() {
    const host = $('trees');
    host.innerHTML = '';
    for (const [p, cls] of [[S.A, 'a'], [S.B, 'b']]) {
      const W = 1000, H = 230, cols = [0, 120, 330, 610, 1000], tips = [];
      const rects = [];
      const lay = (nd, depth, y0, y1) => {
        const leaf = !nd.children.length, x0 = cols[depth] + 2, x1 = (leaf ? W : cols[depth + 1]) - 2, h = y1 - y0;
        if (h > 0.4) {
          tips.push(`<b>${nd.label}</b> · ${pc(nd.p, 1)} of worlds<br>war by 2050: ${pc(nd.war, 0)} · catastrophe: ${pc(nd.cat, 0)}`);
          const dark = ['var(--c1)', 'var(--c8)', 'var(--c7)', 'var(--c3)'].includes(nd.color);
          const neutral = nd.color.startsWith('var(--gray');
          rects.push(`<rect data-ti="${tips.length - 1}" x="${x0}" y="${y0 + 1}" width="${x1 - x0}" height="${Math.max(h - 2, 0.5)}" rx="3" style="fill:${nd.color}"/>`);
          if (h >= 15) {
            const tcol = neutral ? 'var(--ink)' : dark ? '#fff' : '#1d2422';
            rects.push(`<text x="${x0 + 7}" y="${y0 + h / 2 + 4}" style="fill:${tcol};font-size:11px;pointer-events:none">${esc(nd.label)} · ${pc(nd.p)}${leaf && h >= 15 && x1 - x0 > 300 ? `<tspan style="fill-opacity:.75"> · war ${pc(nd.war)} · catastrophe ${pc(nd.cat)}</tspan>` : ''}</text>`);
          }
        }
        let y = y0;
        for (const ch of nd.children) { const hh = ch.p / nd.p * h || 0; lay(ch, depth + 1, y, y + hh); y += hh; }
      };
      lay(treeData(p), 0, 0, H);
      const div = document.createElement('div');
      div.innerHTML = `<div class="tree-title"><span class="sw ${cls}"></span>Policy ${cls.toUpperCase()}: ${polLabel(p)}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Outcome tree for ${esc(polLabel(p))}">${rects.join('')}</svg>`;
      const svg = div.querySelector('svg'); svg._tips = tips; tipHost(svg);
      host.appendChild(div);
    }
  }

  // ---------------------------------------------------------------- policy scorecard
  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function renderScore() {
    const ref = S.cfg.reference_policy, w = S.weights;
    $('refName').textContent = polLabel(ref);
    $('groupLegend').innerHTML = GROUPS.map(g => `<span><i style="background:${GC[g]}"></i>${g}</span>`).join('') + '<span><i style="background:var(--ink);border-radius:50%;width:9px;height:9px"></i>Net value</span>';
    const rows = POLS.map(p => ({ p, c: cmp(p, ref, w) }));
    let lo = 0, hi = 0;
    for (const { c } of rows) {
      let pos = 0, neg = 0; for (const g of GROUPS) { if (c.groups[g] > 0) pos += c.groups[g]; else neg += c.groups[g]; }
      hi = Math.max(hi, pos, c.mean); lo = Math.min(lo, neg, c.mean);
    }
    const pad = (hi - lo) * 0.04 || 1; lo -= pad; hi += pad;
    const W = 1000, L = 150, Rm = 78, rowH = 30, T = 24, H = T + rows.length * rowH + 6;
    const sx = v => L + (v - lo) / (hi - lo) * (W - L - Rm);
    const tips = [];
    let g = niceTicks(lo, hi, 6).map(v => `<line class="gridline" x1="${sx(v)}" x2="${sx(v)}" y1="${T - 6}" y2="${H}"/><text class="axis" x="${sx(v)}" y="${T - 10}" text-anchor="middle" style="fill:var(--muted);font-size:10.5px">${v}</text>`).join('');
    g += `<line class="zero" x1="${sx(0)}" x2="${sx(0)}" y1="${T - 6}" y2="${H}"/>`;
    rows.forEach(({ p, c }, k) => {
      const y = T + k * rowH + 7, h = rowH - 14;
      let pos = 0, neg = 0;
      const brk = GROUPS.map(gr => `<div class="r"><span>${gr}</span><b>${tn(c.groups[gr])}</b></div>`).join('');
      tips.push(`<b>${polLabel(p)}</b> minus ${polLabel(ref)}<br>${brk}<div class="r"><span>Net</span><b>${tn(c.mean)} ± ${(2 * c.se).toFixed(1)}</b></div>`);
      const rowTip = tips.length - 1;
      g += `<text x="${L - 10}" y="${y + h / 2 + 4}" text-anchor="end" data-ti="${rowTip}" style="font-size:12px;${p === S.A || p === S.B ? 'font-weight:700' : ''}">${esc(polLabel(p))}</text>`;
      for (const gr of GROUPS) {
        const v = c.groups[gr]; if (Math.abs(v) < 1e-9) continue;
        const a = v > 0 ? pos : neg + v, b = v > 0 ? pos + v : neg;
        if (v > 0) pos += v; else neg += v;
        const x0 = sx(a), x1 = sx(b), wpx = x1 - x0;
        tips.push(`<b>${polLabel(p)}</b><br>${gr}: ${tn(v)}`);
        g += `<rect data-ti="${tips.length - 1}" x="${x0 + (wpx > 3 ? 1 : 0)}" y="${y}" width="${Math.max(wpx - (wpx > 3 ? 2 : 0), 0.6)}" height="${h}" rx="2" style="fill:${GC[gr]}"/>`;
      }
      g += `<circle data-ti="${rowTip}" cx="${sx(c.mean)}" cy="${y + h / 2}" r="5" style="fill:var(--ink);stroke:var(--card);stroke-width:2"/>`;
      g += `<text x="${W - 4}" y="${y + h / 2 + 4}" text-anchor="end" style="font-size:12px;font-variant-numeric:tabular-nums">${p === ref ? 'reference' : tn(c.mean)}</text>`;
    });
    const svg = $('score'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g; svg._tips = tips;
    // table
    const ws = Object.keys(D.weights);
    const vals = Object.fromEntries(ws.map(wn => [wn, POLS.map(p => cmp(p, ref, wn).mean)]));
    const best = Object.fromEntries(ws.map(wn => [wn, Math.max(...vals[wn])]));
    const op = p => M.outcomeProbs(res(p), S.cfg);
    $('scoreTable').innerHTML = `<thead><tr><th>Policy</th>${ws.map(wn => `<th class="num">${W_SHORT[wn]}</th>`).join('')}<th class="num">Better than ref. (${W_SHORT[w]})</th><th class="num">War by 2050</th><th class="num">Catastrophe</th><th class="num">Durable US lead</th><th class="num">Durable Chinese lead</th><th class="num">Lead at arrival</th></tr></thead><tbody>${POLS.map((p, k) => {
      const o = op(p);
      return `<tr class="${p === ref ? 'ref' : ''}"><td>${esc(polLabel(p))}</td>${ws.map(wn => `<td class="num ${vals[wn][k] === best[wn] && p !== ref ? 'best' : ''}">${p === ref ? '0' : tn(vals[wn][k])}</td>`).join('')}<td class="num">${p === ref ? '—' : pc(cmp(p, ref, w).pBetter)}</td><td class="num">${pc(o.war_by_2050, 1)}</td><td class="num">${pc(o.catastrophe, 1)}</td><td class="num">${pc(o.us_durable, 1)}</td><td class="num">${pc(o.cn_durable, 1)}</td><td class="num">${o.mean_lead_years.toFixed(2)} yr</td></tr>`;
    }).join('')}</tbody>`;
  }

  // ---------------------------------------------------------------- path charts
  const PATHS = [
    { k: 'ratio_stock', t: 'US:China installed capacity', d: 'Ratio of AI hardware stocks (log scale)', log: true, fmt: fr, guide: true },
    { k: 'ratio_train', t: 'US:China training compute', d: 'Usable training compute, incl. rented cloud (log)', log: true, fmt: fr },
    { k: 'lag_years', t: 'US capability lead', d: 'Years of frontier progress; below zero, China leads', fmt: v => v.toFixed(2) + ' yr' },
    { k: 'O', t: 'Open-model competitive pressure', d: '1 = an open model at the frontier', fmt: f2 },
    { k: 'dom_share', t: 'Domestic adoption', d: 'Domestic share of new Chinese AI hardware', fmt: v => pc(v) },
    { k: 'K_soft', t: 'Know-how: software stack', d: 'Learns from operating time on domestic chips', fmt: f2 },
    { k: 'K_logic', t: 'Know-how: chips', d: 'Design and process, relative to the frontier', fmt: f2 },
    { k: 'K_sme', t: 'Know-how: equipment', d: 'How well domestic tools replace restricted ones', fmt: f2 },
    { k: 'Q_dom', t: 'Domestic chip output', d: 'Capacity added per year, compute units (log)', log: true, fmt: fu },
    { k: 'imports', t: 'Chinese accelerator imports', d: 'Capacity imported per year, incl. leakage (log)', log: true, fmt: fu },
    { k: 'h_war', t: 'Annual war hazard', d: 'Chance of a first great-power war that year', fmt: v => pc(v, 2) },
    { k: 'b_cn', t: 'Beijing’s belief AI is decisive', d: 'Moves with progress and with US signalling', fmt: f2 },
  ];
  function lineChart(spec) {
    const W = 320, H = 178, L = 42, R = 8, T = 8, B = 22, years = S.cfg.years;
    const sa = summary(S.A, spec.k), sb = summary(S.B, spec.k);
    const all = [...sa.p10, ...sa.p90, ...sb.p10, ...sb.p90].filter(Number.isFinite);
    if (spec.guide) all.push(10, 2);
    let lo = Math.min(...all), hi = Math.max(...all);
    const tr = spec.log ? v => Math.log10(Math.max(v, 1e-9)) : v => v;
    if (spec.log) { lo = Math.max(lo, hi / 1e5, 1e-6); }
    let tlo = tr(lo), thi = tr(hi); if (thi - tlo < 1e-9) { thi += 0.5; tlo -= 0.5; }
    const padv = (thi - tlo) * 0.06; tlo -= padv; thi += padv;
    const sx = i => L + i / (years.length - 1) * (W - L - R);
    const sy = v => Math.max(T, Math.min(H - B, T + (thi - tr(v)) / (thi - tlo) * (H - T - B)));
    let g = '';
    const ticks = spec.log ? (() => { const o = []; for (let e = Math.ceil(tlo); e <= Math.floor(thi); e++) o.push(Math.pow(10, e)); if (o.length < 2) { o.length = 0; niceTicks(Math.pow(10, tlo), Math.pow(10, thi), 3).filter(v => v > 0).forEach(v => o.push(v)); } return o; })() : niceTicks(tlo, thi, 4);
    for (const v of ticks) { const y = sy(v); if (y < T - 1 || y > H - B + 1) continue; g += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis" x="${L - 5}" y="${y + 3.5}" text-anchor="end" style="fill:var(--muted);font-size:10px">${spec.log ? (v >= 1000 ? (v / 1000) + 'k' : v) : (Math.abs(v) < 1 && v !== 0 ? v.toFixed(2).replace(/0$/, '') : v)}</text>`; }
    for (const yv of [2026, 2030, 2035, 2040, 2045, 2050]) g += `<text class="axis" x="${sx(yv - years[0])}" y="${H - 6}" text-anchor="middle" style="fill:var(--muted);font-size:10px">${yv}</text>`;
    if (!spec.log && tlo < 0 && thi > 0) g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}"/>`;
    if (spec.guide) {
      const i36 = 2036 - years[0], i49 = 2049 - years[0];
      g += `<path d="M${sx(0)},${sy(10)} L${sx(i36)},${sy(10)} M${sx(i36)},${sy(2)} L${sx(i49)},${sy(2)}" style="stroke:var(--muted);stroke-width:1.4;stroke-dasharray:4 3;fill:none"/><text x="${sx(i36)}" y="${sy(10) - 4}" text-anchor="end" style="fill:var(--muted);font-size:9.5px">forecast ≥10×</text><text x="${sx(i36) + 2}" y="${sy(2) - 4}" style="fill:var(--muted);font-size:9.5px">≥2× through 2040s</text>`;
    }
    for (const [s, col] of [[sb, 'var(--b)'], [sa, 'var(--a)']]) {
      const up = s.p90.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
      const dn = s.p10.map((v, i) => `L${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).reverse().join(' ');
      g += `<path d="${up} ${dn} Z" style="fill:${col};fill-opacity:.13;stroke:none"/>`;
    }
    for (const [s, col] of [[sb, 'var(--b)'], [sa, 'var(--a)']]) g += `<path d="${s.p50.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')}" style="fill:none;stroke:${col};stroke-width:2;stroke-linejoin:round"/>`;
    const cx = sx(ty());
    g += `<line class="cur" x1="${cx}" x2="${cx}" y1="${T}" y2="${H - B}" style="stroke:var(--ink);stroke-opacity:.35;stroke-width:1"/>`;
    g += `<line class="hov" x1="0" x2="0" y1="${T}" y2="${H - B}" style="stroke:var(--ink);stroke-opacity:.55;stroke-width:1;display:none"/><rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" style="fill:transparent"/>`;
    const wrap = document.createElement('div'); wrap.className = 'panel';
    wrap.innerHTML = `<h4>${spec.t}</h4><div class="pd">${spec.d}</div><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.t)}">${g}</svg>`;
    const svg = wrap.querySelector('svg'), hov = svg.querySelector('.hov');
    svg._hover = true;
    svg.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(years.length - 1, Math.round((x - L) / (W - L - R) * (years.length - 1))));
      hov.setAttribute('x1', sx(i)); hov.setAttribute('x2', sx(i)); hov.style.display = '';
      showTip(e, `<b>${years[i]}</b><div class="r"><span><span class="sw a"></span>${esc(polLabel(S.A))}</span><b>${spec.fmt(sa.p50[i])}</b></div><div class="small muted">10–90%: ${spec.fmt(sa.p10[i])} to ${spec.fmt(sa.p90[i])}</div><div class="r"><span><span class="sw b"></span>${esc(polLabel(S.B))}</span><b>${spec.fmt(sb.p50[i])}</b></div><div class="small muted">10–90%: ${spec.fmt(sb.p10[i])} to ${spec.fmt(sb.p90[i])}</div>`);
    });
    svg.addEventListener('mouseleave', () => { hov.style.display = 'none'; hideTip(); });
    return wrap;
  }
  function renderPaths() {
    $('pathLegend').innerHTML = `<span><i style="background:var(--a)"></i>A: ${esc(polLabel(S.A))} (median, 10–90% band)</span><span><i style="background:var(--b)"></i>B: ${esc(polLabel(S.B))}</span><span><i style="background:var(--ink);opacity:.35;width:2px"></i>selected year</span>`;
    const host = $('pathGrid'); host.innerHTML = '';
    for (const spec of PATHS) host.appendChild(lineChart(spec));
  }
  function moveCursors() {
    document.querySelectorAll('#pathGrid svg').forEach(svg => {
      const cur = svg.querySelector('.cur'); if (!cur) return;
      const W = 320, L = 42, R = 8, x = L + ty() / (S.cfg.nYears - 1) * (W - L - R);
      cur.setAttribute('x1', x); cur.setAttribute('x2', x);
    });
  }

  // ---------------------------------------------------------------- conflict
  let warYear = 2040;
  function waterfall(svgId, pp, ch, total, caption) {
    const W = 560, H = 250, L = 46, R = 10, T = 18, B = 40;
    let run = 0; const bars = ch.map(c => { const a = run; run += pp[c]; return { c, a, b: run, v: pp[c] }; });
    bars.push({ c: 'total', a: 0, b: total, v: total, total: true });
    const vals = bars.flatMap(b => [b.a, b.b]).concat(0);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.15 || 0.1; lo -= pad; hi += pad;
    const bw = (W - L - R) / bars.length, sy = v => T + (hi - v) / (hi - lo) * (H - T - B);
    let g = niceTicks(lo, hi, 5).map(v => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${L - 6}" y="${sy(v) + 3.5}" text-anchor="end" style="fill:var(--muted);font-size:10px">${v}</text>`).join('');
    g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}"/>`;
    bars.forEach((b, k) => {
      const x = L + k * bw + bw * 0.18, w = bw * 0.64, y0 = sy(Math.max(b.a, b.b)), y1 = sy(Math.min(b.a, b.b));
      const col = b.total ? 'var(--ink2)' : b.v >= 0 ? 'var(--neg)' : 'var(--pos)';
      g += `<rect x="${x}" y="${y0}" width="${w}" height="${Math.max(y1 - y0, 1)}" rx="3" style="fill:${col}"/>`;
      g += `<text x="${x + w / 2}" y="${(b.v >= 0 ? y0 - 5 : y1 + 13)}" text-anchor="middle" style="font-size:11px;font-variant-numeric:tabular-nums">${sgn(b.v, 2)}</text>`;
      const words = b.c.split(' '), l1 = words.length > 1 ? words[0] : b.c, l2 = words.length > 1 ? words.slice(1).join(' ') : '';
      g += `<text x="${x + w / 2}" y="${H - 22}" text-anchor="middle" style="fill:var(--muted);font-size:10.5px">${l1}</text>${l2 ? `<text x="${x + w / 2}" y="${H - 10}" text-anchor="middle" style="fill:var(--muted);font-size:10.5px">${l2}</text>` : ''}`;
    });
    g += `<text x="${L}" y="${T - 6}" style="fill:var(--muted);font-size:10px">${caption}</text>`;
    const svg = $(svgId); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
  }
  function renderConflict() {
    seg($('warYearSeg'), [2035, 2040, 2050].map(y => [String(y), 'by ' + y]), String(warYear), k => { warYear = +k; renderConflict(); });
    const t = warYear - D.start_year, wd = M.warDecomposition(res(S.A), res(S.B), t);
    waterfall('warChart', wd.pp, ['provocation', 'strategic denial', 'deterrence', 'interdependence'], wd.marginal_pp, 'percentage points of cumulative war probability; red raises risk, blue lowers it');
    const cd = M.catDecomposition(res(S.A), res(S.B), t);
    waterfall('catChart', cd.pp, ['exposure', 'Chinese developer', 'lead slack', 'race', 'openness'], cd.marginal_pp, 'percentage points of cumulative catastrophe probability; red raises risk, blue lowers it');
    $('catKv').innerHTML = `<span><span class="sw a"></span>P(catastrophe by ${warYear}), ${esc(polLabel(S.A))}</span><b>${pc(cd.withPolicy, 1)}</b><span><span class="sw b"></span>P(catastrophe by ${warYear}), ${esc(polLabel(S.B))}</span><b>${pc(cd.baseline, 1)}</b><span>Marginal effect, A − B</span><b>${sgn(cd.marginal_pp, 2)} pp</b><span>Chinese-developer share of hazard, A / B</span><b>${pc(cd.cnShareA)} / ${pc(cd.cnShareB)}</b>`;
    const ref = S.cfg.reference_policy;
    $('warKv').innerHTML = `<span><span class="sw a"></span>P(war by ${warYear}), ${esc(polLabel(S.A))}</span><b>${pc(wd.withPolicy, 1)}</b><span><span class="sw b"></span>P(war by ${warYear}), ${esc(polLabel(S.B))}</span><b>${pc(wd.baseline, 1)}</b><span>Marginal effect, A − B</span><b>${sgn(wd.marginal_pp, 2)} pp</b><span>Calibrated baseline: P(war by 2040) under ${esc(polLabel(ref))}</span><b>${pc(S.run.calib.war_2040, 1)}</b>`;
  }

  // ---------------------------------------------------------------- break-even
  const toy = { p: 0.4, du: 50, dn: -20, c: 5 };
  function renderToy() {
    const items = [['p', 'P(decisive world)', 0, 1, 0.01], ['du', 'ΔU if decisive', -100, 150, 1], ['dn', 'ΔU if not decisive', -100, 100, 1], ['c', 'Common cost', -20, 50, 1]];
    $('toy').innerHTML = items.map(([k, l, a, b, s]) => `<div class="slider" data-t="${k}"><div class="sh"><b>${l}</b><span class="sv">${toy[k]}</span></div><input type="range" min="${a}" max="${b}" step="${s}" value="${toy[k]}" aria-label="${l}"></div>`).join('');
    $('toy').querySelectorAll('.slider').forEach(div => { const inp = div.querySelector('input'); inp.oninput = () => { toy[div.dataset.t] = +inp.value; div.querySelector('.sv').textContent = inp.value; drawToy(); }; });
    drawToy();
  }
  function drawToy() {
    const W = 520, H = 200, L = 44, R = 12, T = 30, B = 26;
    const f = p => M.twoWorldToy(p, toy.du, toy.dn, toy.c).delta, r = M.twoWorldToy(toy.p, toy.du, toy.dn, toy.c);
    const ys = [f(0), f(1), 0]; let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
    const sx = p => L + p * (W - L - R), sy = v => T + (hi - v) / (hi - lo) * (H - T - B);
    let g = niceTicks(lo, hi, 4).map(v => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${L - 6}" y="${sy(v) + 3.5}" text-anchor="end" style="fill:var(--muted);font-size:10px">${v}</text>`).join('');
    for (const p of [0, 0.25, 0.5, 0.75, 1]) g += `<text x="${sx(p)}" y="${H - 8}" text-anchor="middle" style="fill:var(--muted);font-size:10px">${p}</text>`;
    g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}"/><path d="M${sx(0)},${sy(f(0))} L${sx(1)},${sy(f(1))}" style="stroke:var(--accent);stroke-width:2;fill:none"/>`;
    if (r.breakEven >= 0 && r.breakEven <= 1) g += `<line x1="${sx(r.breakEven)}" x2="${sx(r.breakEven)}" y1="${T}" y2="${H - B}" style="stroke:var(--muted);stroke-dasharray:4 3"/><text x="${sx(r.breakEven) + 4}" y="${T + 10}" style="font-size:10.5px">break-even p = ${r.breakEven.toFixed(3)}</text>`;
    g += `<circle cx="${sx(toy.p)}" cy="${sy(r.delta)}" r="5" style="fill:var(--ink);stroke:var(--card);stroke-width:2"/><text x="${L}" y="12" style="font-size:11.5px">ΔEV = ${r.delta.toFixed(1)} at p = ${toy.p}</text>`;
    const svg = $('toyChart'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
  }
  const rangeParams = () => D.params.filter(p => p.ui && p.low !== null && p.high !== null && p.high > p.low);
  function fillBeSelects() {
    const opts = rangeParams().map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    $('beX').innerHTML = opts; $('beY').innerHTML = opts;
    $('beX').value = 'p_high_dec'; $('beY').value = 'p_persist10';
  }
  let busy = false;
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function computeSurface() {
    if (busy) return; busy = true;
    const X = $('beX').value, Y = $('beY').value, n = +$('beN').value, px = PBY[X], py = PBY[Y];
    const xs = Array.from({ length: 7 }, (_, k) => px.low + (px.high - px.low) * k / 6), ys = Array.from({ length: 6 }, (_, k) => py.low + (py.high - py.low) * k / 5);
    const cells = []; let done = 0;
    for (const yv of ys) for (const xv of xs) {
      const cfg = M.makeConfig(S.config, { ...S.overrides, [X]: xv, [Y]: yv });
      const run = M.runConfig(cfg, n, S.seed, { policies: [S.A, S.B], extraPolicies: extra(), record: false });
      const c = M.compare(run.results[S.A], run.results[S.B], D.weights[S.weights]);
      cells.push({ x: xv, y: yv, v: c.mean, se: c.se });
      $('beProg').style.width = (100 * ++done / (xs.length * ys.length)) + '%';
      await tick();
    }
    S.surface = { X, Y, xs, ys, cells, A: S.A, B: S.B, w: S.weights, cfg: S.config };
    drawSurface(); busy = false;
  }
  function hex(c) { c = c.trim(); if (c[0] === '#') { if (c.length === 4) c = '#' + [...c.slice(1)].map(x => x + x).join(''); return [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16)); } return [128, 128, 128]; }
  function mixc(a, b, t) { return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`; }
  function drawSurface() {
    const s = S.surface; if (!s) return;
    const cs = getComputedStyle(document.documentElement), pos = hex(cs.getPropertyValue('--pos')), neg = hex(cs.getPropertyValue('--neg')), mid = hex(cs.getPropertyValue('--mid'));
    const W = 560, H = 330, L = 56, R = 14, T = 14, B = 44, nx = s.xs.length, ny = s.ys.length;
    const cw = (W - L - R) / nx, chh = (H - T - B) / ny, mx = Math.max(1e-9, ...s.cells.map(c => Math.abs(c.v)));
    const tips = []; let g = '';
    s.cells.forEach((c, k) => {
      const i = k % nx, j = Math.floor(k / nx), t = c.v / mx;
      tips.push(`<b>${s.X} = ${fv(c.x)}, ${s.Y} = ${fv(c.y)}</b><br>A − B: ${tn(c.v)} ± ${(2 * c.se).toFixed(1)}`);
      g += `<rect data-ti="${k}" x="${L + i * cw + 1}" y="${T + (ny - 1 - j) * chh + 1}" width="${cw - 2}" height="${chh - 2}" rx="2" style="fill:${t >= 0 ? mixc(mid, pos, Math.sqrt(t)) : mixc(mid, neg, Math.sqrt(-t))}"/>`;
      if (cw > 50) g += `<text x="${L + i * cw + cw / 2}" y="${T + (ny - 1 - j) * chh + chh / 2 + 4}" text-anchor="middle" style="font-size:10px;pointer-events:none;fill:${Math.abs(t) > 0.55 ? '#fff' : 'var(--ink2)'}">${c.v >= 0 ? '+' : '−'}${Math.abs(c.v).toFixed(Math.abs(c.v) >= 10 ? 0 : 1)}</text>`;
    });
    // zero contour (marching squares on cell centres)
    const cx = i => L + i * cw + cw / 2, cy = j => T + (ny - 1 - j) * chh + chh / 2, val = (i, j) => s.cells[j * nx + i].v;
    let segs = '';
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const pts = [], corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      for (let k = 0; k < 4; k++) {
        const [a1, b1] = corners[k], [a2, b2] = corners[(k + 1) % 4], v1 = val(a1, b1), v2 = val(a2, b2);
        if ((v1 > 0) !== (v2 > 0)) { const f = v1 / (v1 - v2); pts.push([cx(a1) + (cx(a2) - cx(a1)) * f, cy(b1) + (cy(b2) - cy(b1)) * f]); }
      }
      for (let k = 0; k + 1 < pts.length; k += 2) segs += `M${pts[k][0].toFixed(1)},${pts[k][1].toFixed(1)} L${pts[k + 1][0].toFixed(1)},${pts[k + 1][1].toFixed(1)} `;
    }
    if (segs) g += `<path d="${segs}" style="stroke:var(--ink);stroke-width:2;fill:none;pointer-events:none"/>`;
    s.xs.forEach((v, i) => { if (i % 2 === 0 || nx < 8) g += `<text x="${cx(i)}" y="${H - B + 15}" text-anchor="middle" style="fill:var(--muted);font-size:10px">${fv(v)}</text>`; });
    s.ys.forEach((v, j) => { g += `<text x="${L - 6}" y="${cy(j) + 3.5}" text-anchor="end" style="fill:var(--muted);font-size:10px">${fv(v)}</text>`; });
    g += `<text x="${(L + W - R) / 2}" y="${H - 8}" text-anchor="middle" style="font-size:11px">${s.X}</text><text transform="translate(13 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" style="font-size:11px">${s.Y}</text>`;
    const curX = curValue(s.X), curY = curValue(s.Y), [x0, x1] = [s.xs[0], s.xs[nx - 1]], [y0, y1] = [s.ys[0], s.ys[ny - 1]];
    if (curX >= x0 && curX <= x1 && curY >= y0 && curY <= y1) {
      const px = cx(0) + (curX - x0) / (x1 - x0) * (cx(nx - 1) - cx(0)), py = cy(0) + (curY - y0) / (y1 - y0) * (cy(ny - 1) - cy(0));
      g += `<circle cx="${px}" cy="${py}" r="6" style="fill:none;stroke:var(--card);stroke-width:3"/><circle cx="${px}" cy="${py}" r="6" style="fill:none;stroke:var(--ink);stroke-width:1.6"/>`;
    }
    const svg = $('beChart'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g; svg._tips = tips;
  }

  // ---------------------------------------------------------------- tornado
  async function computeTornado() {
    if (busy) return; busy = true;
    const n = +$('toN').value, w = D.weights[S.weights], ps = rangeParams();
    const one = ov => { const run = M.runConfig(M.makeConfig(S.config, { ...S.overrides, ...ov }), n, S.seed, { policies: [S.A, S.B], extraPolicies: extra(), record: false }); return M.compare(run.results[S.A], run.results[S.B], w).mean; };
    const base = one({}), rows = [];
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      rows.push({ name: p.name, def: p.def, lo: p.low, hi: p.high, vlo: one({ [p.name]: p.low }), vhi: one({ [p.name]: p.high }) });
      $('toProg').style.width = (100 * (k + 1) / ps.length) + '%';
      await tick();
    }
    rows.forEach(r => { r.swing = Math.abs(r.vhi - r.vlo); r.flip = (r.vlo > 0) !== (r.vhi > 0) || (r.vlo > 0) !== (base > 0) || (r.vhi > 0) !== (base > 0); });
    rows.sort((a, b) => b.swing - a.swing);
    drawTornado(rows.slice(0, 18), base, n);
    busy = false;
  }
  function drawTornado(rows, base, n) {
    const W = 1000, L = 190, R = 150, rowH = 24, T = 30, H = T + rows.length * rowH + 10;
    const vals = rows.flatMap(r => [r.vlo, r.vhi]).concat(base, 0);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.05 || 1; lo -= pad; hi += pad;
    const sx = v => L + (v - lo) / (hi - lo) * (W - L - R);
    const tips = [];
    let g = niceTicks(lo, hi, 7).map(v => `<line class="gridline" x1="${sx(v)}" x2="${sx(v)}" y1="${T - 6}" y2="${H - 6}"/><text x="${sx(v)}" y="${T - 10}" text-anchor="middle" style="fill:var(--muted);font-size:10px">${v}</text>`).join('');
    g += `<line class="zero" x1="${sx(0)}" x2="${sx(0)}" y1="${T - 6}" y2="${H - 6}"/><line x1="${sx(base)}" x2="${sx(base)}" y1="${T - 6}" y2="${H - 6}" style="stroke:var(--ink);stroke-dasharray:3 3"/>`;
    rows.forEach((r, k) => {
      const y = T + k * rowH + 5, h = rowH - 10;
      tips.push(`<b>${r.name}</b><br>${esc(r.def)}<div class="r"><span>at low (${fv(r.lo)})</span><b>${tn(r.vlo)}</b></div><div class="r"><span>at high (${fv(r.hi)})</span><b>${tn(r.vhi)}</b></div>`);
      g += `<text data-ti="${k}" x="${L - 8}" y="${y + h / 2 + 4}" text-anchor="end" style="font-size:11.5px;font-family:ui-monospace,Menlo,monospace">${r.name}</text>`;
      for (const [v, col] of [[r.vlo, 'var(--c7)'], [r.vhi, 'var(--c6)']]) {
        const a = Math.min(sx(base), sx(v)), b = Math.max(sx(base), sx(v));
        g += `<rect data-ti="${k}" x="${a}" y="${y + (col === 'var(--c7)' ? 0 : h / 2)}" width="${Math.max(b - a, 0.8)}" height="${h / 2 - 1}" rx="1.5" style="fill:${col}"/>`;
      }
      if (r.flip) g += `<text x="${W - R + 8}" y="${y + h / 2 + 4}" style="font-size:11px;font-weight:650">flips the sign</text>`;
    });
    const svg = $('toChart'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g; svg._tips = tips;
    $('toNote').innerHTML = `<span class="legend" style="display:inline-flex;margin:0"><span><i style="background:var(--c7)"></i>parameter at its low end</span><span><i style="background:var(--c6)"></i>at its high end</span></span> · dashed line: current estimate ${tn(base)} (A − B, ${W_SHORT[S.weights]}, ${n} worlds)`;
  }

  // ---------------------------------------------------------------- strategic game
  async function computeGame() {
    if (busy) return; busy = true;
    const n = +$('gmN').value, pols = Object.keys(D.policies), sts = Object.keys(D.stances);
    const U = pols.map(() => sts.map(() => 0)), C = pols.map(() => sts.map(() => 0));
    for (let j = 0; j < sts.length; j++) {
      const stance = { indig: D.stances[sts[j]].indig, conf: D.stances[sts[j]].conf };
      const ru = M.runConfig(M.makeConfig(S.config, S.overrides), n, S.seed, { policies: pols, stance, record: false });
      $('gmProg').style.width = (100 * (2 * j + 1) / (2 * sts.length)) + '%'; await tick();
      const rc = M.runConfig(M.makeConfig(S.config, { ...S.overrides, ...D.china_beliefs }), n, S.seed, { policies: pols, stance, record: false });
      pols.forEach((p, i) => { U[i][j] = M.absoluteValue(ru.results[p], D.weights[S.weights]); C[i][j] = M.absoluteValue(rc.results[p], D.china_objective); });
      $('gmProg').style.width = (100 * (2 * j + 2) / (2 * sts.length)) + '%'; await tick();
    }
    const i0 = pols.indexOf(D.reference_policy), j0 = sts.indexOf('rule'), u0 = U[i0][j0], c0 = C[i0][j0];
    pols.forEach((_, i) => sts.forEach((__, j) => { U[i][j] -= u0; C[i][j] -= c0; }));
    const usBest = sts.map((_, j) => pols.reduce((b, _p, i) => U[i][j] > U[b][j] ? i : b, 0));
    const cnBest = pols.map((_, i) => sts.reduce((b, _s, j) => C[i][j] > C[i][b] ? j : b, 0));
    let i = i0, j = j0; const path = [`${D.policies[pols[i]].label} / ${D.stances[sts[j]].label}`];
    for (let k = 0; k < 12; k++) { const nj = cnBest[i], ni = usBest[nj]; if (ni === i && nj === j) break; i = ni; j = nj; path.push(`${D.policies[pols[i]].label} / ${D.stances[sts[j]].label}`); }
    $('gmTable').innerHTML = `<thead><tr><th>US policy ↓ · China stance →</th>${sts.map(s => `<th>${D.stances[s].label}</th>`).join('')}</tr></thead><tbody>${pols.map((p, a) => `<tr><td style="text-align:left">${D.policies[p].label}</td>${sts.map((s, b) => {
      const eq = usBest[b] === a && cnBest[a] === b;
      return `<td class="${eq ? 'eq' : ''}">US ${sgn(U[a][b])}${usBest[b] === a ? ' <span class="mark-us">▲</span>' : ''}<br>China ${sgn(C[a][b])}${cnBest[a] === b ? ' <span class="mark-cn">◆</span>' : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
    const eqs = []; pols.forEach((p, a) => sts.forEach((s, b) => { if (usBest[b] === a && cnBest[a] === b) eqs.push(`${D.policies[p].label} / ${D.stances[s].label}`); }));
    $('gmNote').textContent = `$tn relative to Maintain / assumed rule. Equilibria of this grid: ${eqs.join('; ') || 'none'}. Best-response path: ${path.join(' → ')}.`;
    busy = false;
  }

  // ---------------------------------------------------------------- assumptions table
  const SRC_NUM = Object.fromEntries(Object.keys(D.sources).map((k, i) => [k, i + 1]));
  function buildParamTable() {
    const groups = [...new Set(D.params.map(p => p.group))];
    $('pGroup').innerHTML = '<option value="">All groups</option>' + groups.map(g => `<option>${g}</option>`).join('');
    $('pStatus').innerHTML = '<option value="">All statuses</option>' + ['observed', 'estimated', 'elicited', 'illustrative'].map(s => `<option>${s}</option>`).join('');
    const counts = {}; D.params.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
    $('pCounts').textContent = `${D.params.length} parameters: ` + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
    $('pTable').innerHTML = `<thead><tr><th>Parameter</th><th class="num">Value</th><th>Units</th><th class="num">Range</th><th>Status</th><th>Source</th></tr></thead><tbody>${D.params.map(p => {
      const v = curValue(p.name), sampled = D.configs[S.config].sampled[p.j === undefined ? PBY[p.name].j : p.j];
      return `<tr data-p="${p.name}" data-g="${esc(p.group)}" data-s="${p.status}" class="${p.name in S.overrides ? 'edited' : ''}"><td class="def"><b>${p.name}</b> <span class="muted small">${esc(p.group)}</span><br>${esc(p.def)}</td><td class="num"><input type="number" step="any" value="${v}" aria-label="${p.name}"></td><td class="small">${esc(p.units || '')}</td><td class="num small">${p.low === null ? '—' : `${fv(p.low)} – ${fv(p.high)}`}${sampled ? '<br><span class="muted">sampled</span>' : ''}</td><td><span class="badge ${p.status}">${p.status}</span></td><td class="src">${p.src.map(k => `<a href="#ref-${k}">[${SRC_NUM[k]}]</a>`).join('')}</td></tr>`;
    }).join('')}</tbody>`;
    $('pTable').querySelectorAll('tr[data-p]').forEach(tr => {
      const name = tr.dataset.p, inp = tr.querySelector('input');
      inp.onchange = () => {
        const v = +inp.value; if (!Number.isFinite(v)) return;
        if (Math.abs(v - baseValue(name)) < 1e-12) delete S.overrides[name]; else S.overrides[name] = v;
        tr.classList.toggle('edited', name in S.overrides);
        renderInspector(); schedule(0);
      };
    });
    filterParams();
  }
  function syncParamRow(name) {
    const tr = $('pTable').querySelector(`tr[data-p="${name}"]`); if (!tr) return;
    tr.querySelector('input').value = curValue(name); tr.classList.toggle('edited', name in S.overrides);
  }
  function filterParams() {
    const q = $('pSearch').value.toLowerCase(), g = $('pGroup').value, s = $('pStatus').value;
    $('pTable').querySelectorAll('tr[data-p]').forEach(tr => {
      const p = PBY[tr.dataset.p];
      tr.style.display = (!g || p.group === g) && (!s || p.status === s) && (!q || (p.name + ' ' + p.def).toLowerCase().includes(q)) ? '' : 'none';
    });
  }
  $('pSearch').oninput = filterParams; $('pGroup').onchange = filterParams; $('pStatus').onchange = filterParams;
  $('pCsv').onclick = () => {
    const cell = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['name', 'group', 'definition', 'units', 'status', 'value', 'low', 'high', 'sources'].join(',')].concat(
      D.params.map(p => [p.name, p.group, p.def, p.units, p.status, curValue(p.name), p.low, p.high, p.src.map(k => D.sources[k].url).join(' ')].map(cell).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `assumptions_${S.config}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  function buildRefs() {
    $('refs').innerHTML = Object.entries(D.sources).map(([k, s]) => `<li id="ref-${k}"><a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a> <span>· ${esc(s.publisher)} · ${esc(s.date)}</span><br>${esc(s.note)}</li>`).join('');
  }

  // ---------------------------------------------------------------- year and play
  let playTimer = null;
  function setYear(y) {
    S.year = y; $('year').value = y; $('yearLabel').textContent = y;
    renderMap(); moveCursors();
  }
  $('year').oninput = e => { setYear(+e.target.value); writeQuery(); };
  $('play').onclick = () => {
    if (playTimer) { clearInterval(playTimer); playTimer = null; $('play').textContent = '▶ Play'; return; }
    if (S.year >= D.end_year) setYear(D.start_year);
    $('play').textContent = '❚❚ Pause';
    playTimer = setInterval(() => {
      if (S.year >= D.end_year) { clearInterval(playTimer); playTimer = null; $('play').textContent = '▶ Play'; return; }
      setYear(S.year + 1);
    }, 520);
  };

  // ---------------------------------------------------------------- render all
  function renderAll() {
    if (!S.run) return;
    renderReading(); renderMap(); renderTrees(); renderScore(); renderPaths(); renderConflict();
  }
  $('beRun').onclick = computeSurface; $('toRun').onclick = computeTornado; $('gmRun').onclick = computeGame;
  [$('score'), $('beChart'), $('toChart')].forEach(tipHost);

  readQuery();
  renderControls(); buildMap(); fillBeSelects(); renderToy(); buildParamTable(); buildRefs();
  $('year').value = S.year;
  selectNode(S.node);
  runMain();
})();
