/* Front page: the lean model. Numbers come from web/lean.js and web/lean_params.js. */
(function () {
  'use strict';
  const Lm = window.AICLean, L = Lm.data, $ = id => document.getElementById(id);
  const CFGS = ['baseline', 'fox_continuous', 'erich_decisive', 'agnostic_wide'];
  const CFG_SHORT = { baseline: 'Baseline', fox_continuous: 'Continuous', erich_decisive: 'Decisive', agnostic_wide: 'Agnostic, wide' };
  const W_SHORT = { us_interest: 'US interest', global: 'Global welfare', pluralist: 'Pluralist' };
  const PL = L.policy_labels;
  const pairLabel = p => { const [a, b] = p.split('|'); return `${PL[a]} vs ${PL[b]}`; };
  const META = Object.fromEntries(L.params.map(p => [p.name, p]));
  const BLOCKS = ['Lead bought', 'Timing', 'Worth of a lead', 'Yearly cost of controls'];
  const SRC = {
    m: 'US:China training-compute ratio under the controls policy relative to the alternative, at its peak over 2027–2050 (the engine’s lead builds for years as stocks accumulate; the lean path starts at full size).',
    k: '12 × α·ln10 / (α·g_W + g_alg) at 2030: how the engine turns a compute ratio into months of capability lead.',
    H: 'Half-life of the engine’s extra-lead path with the captive-market channels switched off.',
    b: 'Half-life lost when the captive-market channels are switched back on. Negative: forced adoption helps controls.',
    p35: 'The worldview’s calibration target for arrival by 2035 under Maintain.',
    p_none: 'Share of engine worlds with no sharp transition by 2050 under Maintain.',
    p_dec: 'The worldview’s probability of a high-decisiveness world.',
    V_m: 'Calibrated: the engine’s durable-lead and security value for Maintain vs Relax chips, divided by P(decisive) × expected extra months at arrival. Negative under global values when a US lead mostly transfers value.',
    c0: 'Expected probability of catastrophe by 2050 under Maintain in the engine.',
    r: 'Calibrated on the engine’s AI-safety value for Maintain vs Relax chips (global values); absorbs when catastrophes happen as well as whether.',
    K_cat: 'Average weighted loss per catastrophe in the engine under the alternative policy.',
    y: 'Engine difference in AI-driven output, trade and integration, per discounted year (positive: controls cost this).',
    o: 'Engine difference in openness gains and closed-provider markups, per discounted year.',
    d_war: 'Engine change in cumulative probability of a first great-power war by 2050 (positive: controls raise risk).',
    K_war: 'Average weighted loss per war in the engine.',
  };
  const S = { config: 'erich_decisive', weights: 'global', pair: L.ref_pair, p: null, d: null, hx: 'p_dec', hy: 'H' };

  // ---------------------------------------------------------------- helpers
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sgn = (x, d = 1) => { const r = +x.toFixed(d); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(d); };
  const tn = x => sgn(x, Math.abs(x) >= 10 ? 0 : 1) + ' tn';
  const fv = (v, name) => {
    const u = META[name] && META[name].units;
    if (u === 'probability') return (100 * v).toFixed(v < 0.1 ? 1 : 0) + '%';
    if (u === 'share') return (100 * v).toFixed(2) + '%';
    const a = Math.abs(v); const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
    return u === '×' ? s + '×' : s;
  };
  const tip = $('tip');
  function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; const r = tip.getBoundingClientRect(); let x = e.clientX + 14, y = e.clientY + 14; if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 12; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  const hideTip = () => { tip.style.display = 'none'; };
  function tipHost(el) { el.addEventListener('mousemove', e => { const t = e.target.closest && e.target.closest('[data-ti]'); if (t && el._tips) showTip(e, el._tips[+t.dataset.ti]); else hideTip(); }); el.addEventListener('mouseleave', hideTip); }
  function niceTicks(lo, hi, n) { const span = hi - lo || 1, s0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(s0))); const st = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= s0) || 10 * mag; const o = []; for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) o.push(+v.toFixed(10)); return o; }

  // Slider ranges span every derived default across worldviews, comparisons and value sets.
  const RANGE = (() => {
    const all = {}; L.params.forEach(p => { all[p.name] = []; });
    for (const c of CFGS) for (const pair of L.pairs) for (const w of Object.keys(W_SHORT)) { const d = Lm.defaults(c, pair, w); for (const k in d) all[k].push(d[k]); }
    const R = {};
    for (const [k, v] of Object.entries(all)) {
      const lo = Math.min(...v), hi = Math.max(...v), u = META[k].units, M = Math.max(Math.abs(lo), Math.abs(hi));
      if (u === 'probability') R[k] = [0, k === 'c0' ? Math.max(0.8, hi * 1.5) : 1];
      else if (k === 'm') R[k] = [1, Math.max(4, hi * 1.6)];
      else if (k === 'd_war') R[k] = [-Math.max(6, M * 1.5), Math.max(6, M * 1.5)];
      else if (lo >= 0 && k !== 'b') R[k] = [0, Math.max(hi * 1.6, 1e-3)];
      else R[k] = [-Math.max(M * 1.6, k === 'b' ? 5 : 1e-3), Math.max(M * 1.6, k === 'b' ? 5 : 1e-3)];
    }
    return R;
  })();

  // ---------------------------------------------------------------- controls
  function seg(host, items, cur, pick) {
    host.innerHTML = items.map(([k, l]) => `<button type="button" data-k="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('');
    host.querySelectorAll('button').forEach(b => b.onclick = () => pick(b.dataset.k));
  }
  function loadDefaults() { S.d = Lm.defaults(S.config, S.pair, S.weights); S.p = { ...S.d }; }
  function renderControls() {
    seg($('cfgSeg'), CFGS.map(c => [c, CFG_SHORT[c]]), S.config, k => { S.config = k; loadDefaults(); renderControls(); buildSliders(); render(); });
    seg($('wSeg'), Object.keys(W_SHORT).map(w => [w, W_SHORT[w]]), S.weights, k => { S.weights = k; loadDefaults(); renderControls(); buildSliders(); render(); });
    $('pairSel').innerHTML = L.pairs.map(p => `<option value="${p}" ${p === S.pair ? 'selected' : ''}>${esc(pairLabel(p))}</option>`).join('');
  }
  $('pairSel').onchange = e => { S.pair = e.target.value; loadDefaults(); buildSliders(); render(); };
  $('resetBtn').onclick = () => { loadDefaults(); buildSliders(); render(); };
  (function theme() {
    let cur = 'auto'; try { cur = localStorage.getItem('aic-theme') || 'auto'; } catch (e) { /* storage blocked */ }
    const apply = () => { if (cur === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = cur; $('themeBtn').textContent = 'Theme: ' + cur; if (S.p) render(); };
    $('themeBtn').onclick = () => { cur = { auto: 'light', light: 'dark', dark: 'auto' }[cur]; try { localStorage.setItem('aic-theme', cur); } catch (e) { /* ignore */ } apply(); };
    apply();
  })();

  // ---------------------------------------------------------------- sliders
  function buildSliders() {
    const host = $('sliders');
    host.innerHTML = BLOCKS.map(b => `<div class="blk"><h4>${b}</h4>${L.params.filter(p => p.block === b).map(p => {
      const [lo, hi] = RANGE[p.name], v = S.p[p.name];
      return `<div class="slider" data-p="${p.name}" title="${esc(SRC[p.name])}"><div class="sh"><b>${esc(p.label)}</b><span class="sv">${fv(v, p.name)}</span></div><input type="range" min="${lo}" max="${hi}" step="${(hi - lo) / 400}" value="${v}" aria-label="${esc(p.label)}"><div class="dflt">derived: ${fv(S.d[p.name], p.name)} ${p.units === '$tn' || p.units === '$tn/yr' ? p.units : ''}</div></div>`;
    }).join('')}</div>`).join('');
    host.querySelectorAll('.slider').forEach(div => {
      const k = div.dataset.p, inp = div.querySelector('input');
      inp.oninput = () => { S.p[k] = +inp.value; div.classList.toggle('edited', Math.abs(S.p[k] - S.d[k]) > 1e-12); div.querySelector('.sv').textContent = fv(S.p[k], k); render(); };
    });
  }

  // ---------------------------------------------------------------- render
  function render() {
    const e = Lm.evaluate(S.p), p = S.p, pArr = 1 - p.p_none;
    const L1 = p.k * Math.log10(Math.max(p.m, 1e-9)), He = Math.max(p.H - p.b, 0.25);
    const atArr = pArr > 0 ? e.sLead / pArr : 0;
    const nodes = [
      ['Controls', pairLabel(S.pair).replace(' vs ', ' vs '), ''],
      ['Compute multiple', fv(p.m, 'm'), 'US:China ratio, controls vs alternative'],
      ['Extra lead in 2027', L1.toFixed(1) + ' mo', `${p.k.toFixed(1)} months per 10× compute`],
      ['Fades with half-life', He.toFixed(1) + ' yr', p.b > 0 ? `${p.b.toFixed(1)} yr lost to Chinese learning` : `${(-p.b).toFixed(1)} yr gained from forced adoption`],
      ['Lead when AI arrives', atArr.toFixed(1) + ' mo', `if it arrives by 2050 (${(100 * pArr).toFixed(0)}%)`],
      ['Value of the lead', tn(e.lead + e.safety), `decisive ${tn(e.lead)} · safety ${tn(e.safety)}`],
      ['Yearly costs × years', tn(e.output + e.openness), `output ${tn(e.output)} · openness ${tn(e.openness)}`],
      ['War risk', tn(e.war), `${sgn(p.d_war, 2)} pp by 2050`],
    ];
    $('chain').innerHTML = nodes.map(([l, v, s]) => `<div class="cn"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div><div class="ar" aria-hidden="true">→</div>`).join('') +
      `<div class="cn net"><div class="l">Net advantage of controls</div><div class="v">${tn(e.net)}</div><div class="s">${W_SHORT[S.weights]}</div></div>`;
    $('net').textContent = tn(e.net);
    const eng = L.derived[S.config].pairs[S.pair].by_weights[S.weights].engine;
    const terms = [['Decisive lead', e.lead], ['Safety', e.safety], ['Output, trade', e.output], ['Openness', e.openness], ['War', e.war]];
    const top = terms.slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const [a, b] = S.pair.split('|');
    $('reading').innerHTML = `With these numbers, <strong>${esc(PL[a])}</strong> ${e.net >= 0 ? 'beats' : 'trails'} <strong>${esc(PL[b])}</strong> by <strong>$${Math.abs(e.net).toFixed(1)} tn</strong> under ${W_SHORT[S.weights].toLowerCase()} values. The biggest terms are ${top[0][0].toLowerCase()} (${tn(top[0][1])}) and ${top[1][0].toLowerCase()} (${tn(top[1][1])}). The full engine at the derived settings gives ${tn(eng.net)}.`;
    drawTerms(terms, e.net, eng.net);
    drawLead(e);
    drawArrival(e.f);
    drawFlips();
    drawHeat();
    renderNumbers();
    $('status').textContent = `${CFG_SHORT[S.config]} · ${W_SHORT[S.weights]}`;
  }

  function drawTerms(terms, net, engNet) {
    const W = 640, L = 112, R = 70, rowH = 30, T = 22, rows = [...terms, ['Net', net]], H = T + rows.length * rowH + 4;
    const vals = rows.map(r => r[1]).concat(0, engNet);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    const sx = v => L + (v - lo) / (hi - lo) * (W - L - R);
    const cols = ['var(--c1)', 'var(--c3)', 'var(--c2)', 'var(--c4)', 'var(--c8)', 'var(--ink2)'];
    let g = niceTicks(lo, hi, 5).map(v => `<line class="gridline" x1="${sx(v)}" x2="${sx(v)}" y1="${T - 6}" y2="${H}"/><text x="${sx(v)}" y="${T - 10}" text-anchor="middle" style="fill:var(--muted);font-size:10px">${v}</text>`).join('');
    g += `<line class="zero" x1="${sx(0)}" x2="${sx(0)}" y1="${T - 6}" y2="${H}"/>`;
    rows.forEach(([lab, v], k) => {
      const y = T + k * rowH + 7, h = rowH - 14, x0 = sx(Math.min(0, v)), x1 = sx(Math.max(0, v));
      g += `<text x="${L - 8}" y="${y + h / 2 + 4}" text-anchor="end" style="font-size:12px;${lab === 'Net' ? 'font-weight:700' : ''}">${lab}</text><rect x="${x0}" y="${y}" width="${Math.max(x1 - x0, 1)}" height="${h}" rx="3" style="fill:${cols[k]}"/><text x="${W - 4}" y="${y + h / 2 + 4}" text-anchor="end" style="font-size:12px;font-variant-numeric:tabular-nums">${tn(v)}</text>`;
    });
    const ey = T + (rows.length - 1) * rowH + 3;
    g += `<line x1="${sx(engNet)}" x2="${sx(engNet)}" y1="${ey}" y2="${ey + rowH - 6}" style="stroke:var(--ink);stroke-width:2;stroke-dasharray:3 2"/><text x="${sx(engNet)}" y="${ey + rowH + 6}" text-anchor="middle" style="fill:var(--muted);font-size:9.5px">engine</text>`;
    const svg = $('terms'); svg.setAttribute('viewBox', `0 0 ${W} ${H + 10}`); svg.innerHTML = g;
  }
  function axisChart(svgId, H, series, yfmt, bars) {
    const W = 640, L = 44, R = 10, T = 10, B = 22, n = 25;
    const vals = series.flatMap(s => s.v).concat(bars ? bars.v : [], 0);
    let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1e-9) hi = lo + 1; hi += (hi - lo) * 0.08;
    const sx = i => L + (i + 0.5) / n * (W - L - R), sy = v => T + (hi - v) / (hi - lo) * (H - T - B);
    let g = niceTicks(lo, hi, 4).map(v => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${L - 6}" y="${sy(v) + 3.5}" text-anchor="end" style="fill:var(--muted);font-size:10px">${yfmt(v)}</text>`).join('');
    for (const y of [2026, 2030, 2035, 2040, 2045, 2050]) g += `<text x="${sx(y - 2026)}" y="${H - 6}" text-anchor="middle" style="fill:var(--muted);font-size:10px">${y}</text>`;
    g += `<line class="zero" x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}"/>`;
    const tips = [];
    if (bars) bars.v.forEach((v, i) => { tips.push(`<b>${2026 + i}</b><br>${bars.name}: ${yfmt(v)}`); const bw = (W - L - R) / n * 0.7; g += `<rect data-ti="${tips.length - 1}" x="${sx(i) - bw / 2}" y="${sy(Math.max(v, 0))}" width="${bw}" height="${Math.abs(sy(v) - sy(0))}" rx="2" style="fill:${bars.color}"/>`; });
    series.forEach(s => {
      g += `<path d="${s.v.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')}" style="fill:none;stroke:${s.color};stroke-width:2;${s.dash ? 'stroke-dasharray:4 3' : ''}"/>`;
      const i = s.labelAt || 3; g += `<text x="${sx(i) + 6}" y="${sy(s.v[i]) - 6}" style="font-size:10.5px;fill:var(--ink2)">${s.name}</text>`;
    });
    const svg = $(svgId); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g; svg._tips = tips;
  }
  function drawLead(e) {
    const eng = L.derived[S.config].pairs[S.pair].engine_months;
    axisChart('leadChart', 190, [{ v: e.dL, color: 'var(--c1)', name: 'lean model', labelAt: 2 }, { v: eng, color: 'var(--ink2)', dash: true, name: 'engine (derived settings)', labelAt: 8 }], v => v.toFixed(0) + ' mo');
  }
  function drawArrival(f) { axisChart('arrChart', 150, [], v => (100 * v).toFixed(0) + '%', { v: f, color: 'var(--c7)', name: 'P(arrival this year)' }); }

  // ---------------------------------------------------------------- break-even
  function solve(name) {
    const [lo, hi] = RANGE[name], g = x => Lm.evaluate({ ...S.p, [name]: x }).net, N = 240;
    const roots = [];
    let px = lo, pg = g(lo);
    for (let i = 1; i <= N; i++) {
      const x = lo + (hi - lo) * i / N, gx = g(x);
      if ((pg > 0) !== (gx > 0)) { let a = px, b = x, ga = pg; for (let k = 0; k < 50; k++) { const m = 0.5 * (a + b), gm = g(m); if ((gm > 0) === (ga > 0)) { a = m; ga = gm; } else b = m; } roots.push(0.5 * (a + b)); }
      px = x; pg = gx;
    }
    return roots;
  }
  function drawFlips() {
    const net = Lm.evaluate(S.p).net;
    const rows = L.params.map(p => {
      const roots = solve(p.name), cur = S.p[p.name], [lo, hi] = RANGE[p.name];
      const best = roots.length ? roots.reduce((a, b) => Math.abs(b - cur) < Math.abs(a - cur) ? b : a) : null;
      return { p, cur, best, dist: best === null ? Infinity : Math.abs(best - cur) / (hi - lo) };
    }).sort((a, b) => a.dist - b.dist);
    $('flipTable').innerHTML = `<thead><tr><th>Number</th><th class="num">Now</th><th class="num">Flips at</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.p.label)}</td><td class="num">${fv(r.cur, r.p.name)}</td><td class="num ${r.best !== null ? 'flip' : ''}">${r.best === null ? '<span class="muted">no flip in range</span>' : fv(r.best, r.p.name)}</td></tr>`).join('')}</tbody>`;
    $('flipTable').querySelector('thead th').textContent = `Number (net now ${tn(net)})`;
  }
  function fillHeatSelects() {
    const opts = L.params.map(p => `<option value="${p.name}">${esc(p.label)}</option>`).join('');
    $('hmX').innerHTML = opts; $('hmY').innerHTML = opts; $('hmX').value = S.hx; $('hmY').value = S.hy;
    $('hmX').onchange = e => { S.hx = e.target.value; drawHeat(); }; $('hmY').onchange = e => { S.hy = e.target.value; drawHeat(); };
  }
  const hex = c => { c = c.trim(); if (c[0] !== '#') return [128, 128, 128]; if (c.length === 4) c = '#' + [...c.slice(1)].map(x => x + x).join(''); return [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16)); };
  const mixc = (a, b, t) => `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`;
  function drawHeat() {
    const X = S.hx, Y = S.hy, [x0, x1] = RANGE[X], [y0, y1] = RANGE[Y], nx = 36, ny = 24;
    const W = 560, H = 340, L = 64, R = 12, T = 10, B = 46, cw = (W - L - R) / nx, ch = (H - T - B) / ny;
    const cs = getComputedStyle(document.documentElement), pos = hex(cs.getPropertyValue('--pos')), neg = hex(cs.getPropertyValue('--neg')), mid = hex(cs.getPropertyValue('--mid'));
    const V = []; let mx = 1e-9;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const xv = x0 + (x1 - x0) * (i + 0.5) / nx, yv = y0 + (y1 - y0) * (j + 0.5) / ny; const v = X === Y ? Lm.evaluate({ ...S.p, [X]: xv }).net : Lm.evaluate({ ...S.p, [X]: xv, [Y]: yv }).net; V.push(v); mx = Math.max(mx, Math.abs(v)); }
    let g = '';
    const tips = [];
    V.forEach((v, k) => { const i = k % nx, j = Math.floor(k / nx), t = v / mx; tips.push(`${esc(META[X].label)}: ${fv(x0 + (x1 - x0) * (i + 0.5) / nx, X)}<br>${esc(META[Y].label)}: ${fv(y0 + (y1 - y0) * (j + 0.5) / ny, Y)}<br><b>Net ${tn(v)}</b>`); g += `<rect data-ti="${k}" x="${L + i * cw}" y="${T + (ny - 1 - j) * ch}" width="${cw + 0.5}" height="${ch + 0.5}" style="fill:${t >= 0 ? mixc(mid, pos, Math.sqrt(t)) : mixc(mid, neg, Math.sqrt(-t))}"/>`; });
    const cx = i => L + (i + 0.5) * cw, cy = j => T + (ny - 1 - j + 0.5) * ch, val = (i, j) => V[j * nx + i];
    let segs = '';
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], pts = [];
      for (let k = 0; k < 4; k++) { const [a1, b1] = c[k], [a2, b2] = c[(k + 1) % 4], v1 = val(a1, b1), v2 = val(a2, b2); if ((v1 > 0) !== (v2 > 0)) { const f = v1 / (v1 - v2); pts.push([cx(a1) + (cx(a2) - cx(a1)) * f, cy(b1) + (cy(b2) - cy(b1)) * f]); } }
      for (let k = 0; k + 1 < pts.length; k += 2) segs += `M${pts[k][0].toFixed(1)},${pts[k][1].toFixed(1)} L${pts[k + 1][0].toFixed(1)},${pts[k + 1][1].toFixed(1)} `;
    }
    if (segs) g += `<path d="${segs}" style="stroke:var(--ink);stroke-width:2;fill:none;pointer-events:none"/>`;
    const px = L + (S.p[X] - x0) / (x1 - x0) * (W - L - R), py = T + (y1 - S.p[Y]) / (y1 - y0) * (H - T - B);
    g += `<circle cx="${px}" cy="${py}" r="6" style="fill:none;stroke:var(--card);stroke-width:3;pointer-events:none"/><circle cx="${px}" cy="${py}" r="6" style="fill:none;stroke:var(--ink);stroke-width:1.6;pointer-events:none"/>`;
    for (let k = 0; k <= 4; k++) { const xv = x0 + (x1 - x0) * k / 4, yv = y0 + (y1 - y0) * k / 4; g += `<text x="${L + (W - L - R) * k / 4}" y="${H - B + 15}" text-anchor="middle" style="fill:var(--muted);font-size:10px">${fv(xv, X)}</text><text x="${L - 6}" y="${T + (H - T - B) * (1 - k / 4) + 3.5}" text-anchor="end" style="fill:var(--muted);font-size:10px">${fv(yv, Y)}</text>`; }
    g += `<text x="${(L + W - R) / 2}" y="${H - 10}" text-anchor="middle" style="font-size:11px">${esc(META[X].label)}</text><text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" style="font-size:11px">${esc(META[Y].label)}</text>`;
    const svg = $('heat'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g; svg._tips = tips;
  }

  // ---------------------------------------------------------------- where the numbers come from
  function renderNumbers() {
    $('derivTable').innerHTML = `<thead><tr><th>Number</th>${CFGS.map(c => `<th class="num">${CFG_SHORT[c]}</th>`).join('')}<th>Derived from the engine</th></tr></thead><tbody>${L.params.map(p => `<tr><td><b>${esc(p.label)}</b><br><span class="small muted">${esc(p.units)}</span></td>${CFGS.map(c => `<td class="num ${c === S.config ? 'best' : ''}">${fv(Lm.defaults(c, S.pair, S.weights)[p.name], p.name)}</td>`).join('')}<td class="small">${esc(SRC[p.name])}</td></tr>`).join('')}</tbody>`;
    const rows = L.validation.filter(r => r.config === S.config);
    $('valTable').innerHTML = `<thead><tr><th>Comparison</th><th>Values</th><th class="num">Engine</th><th class="num">Lean formula</th><th class="num">Difference</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.calibration_pair ? 'ref' : ''}"><td>${esc(pairLabel(r.pair))}${r.calibration_pair ? ' <span class="muted small">(calibration)</span>' : ''}</td><td>${W_SHORT[r.weights]}</td><td class="num">${tn(r.engine_net)}</td><td class="num">${tn(r.lean_net)}</td><td class="num">${(100 * r.rel_error).toFixed(0)}%</td></tr>`).join('')}</tbody>`;
  }
  const s = L.summary;
  $('valSummary').textContent = `median error ${(100 * s.median_abs_rel_error).toFixed(0)}% across ${s.cells} out-of-sample cells, ${(100 * s.share_within_20pct).toFixed(0)}% of them within 20%, and the sign agrees in ${(100 * s.share_sign_agrees).toFixed(0)}%. The misses are concentrated in Broad relaxation, where easing every control also lowers tension and the race part of catastrophe risk, and in Tighten vs Maintain, where the engine's value of a lead is non-linear in its length.`;

  [$('heat'), $('arrChart')].forEach(tipHost);
  loadDefaults(); renderControls(); buildSliders(); fillHeatSelects(); render();
})();
