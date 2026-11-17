import { YEARS, simulate, race, outcome, evaluate, breakEvenPD, tornado, grid, sampleRanges } from './model.js';
import { PARAMS, PRESETS, SCENARIOS, LEVERS, SOURCES, STAGES, withPreset, scenario } from './params.js';
import { svg, h, cssVar, lineChart, signedBars, tornadoChart, heatmap } from './charts.js';

const $ = (id) => document.getElementById(id);
const clone = (s) => ({ ...s, then: s.then ? { ...s.then } : undefined });
const state = { preset: 'middle', p: withPreset('middle'), aId: 'current', bId: 'sell', A: clone(scenario('current')), B: clone(scenario('sell')) };
const controls = {}, leverInputs = { A: {}, B: {} };
let C = {};

// ---------------------------------------------------------------- formatting

const sig = (v) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : String(+v.toPrecision(3)));
function money(b) { // input in $ billions
  if (!Number.isFinite(b)) return '–';
  const a = Math.abs(b), s = b < 0 ? '−' : '';
  if (a >= 1000) return `${s}$${sig(a / 1000)}T`;
  if (a >= 1) return `${s}$${sig(a)}B`;
  if (a >= 0.001) return `${s}$${sig(a * 1000)}M`;
  return '$0';
}
const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
const pctAuto = (v) => (v > 0 && v < 0.0995 ? pct(v, 1) : pct(v));
const times = (v) => `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}×`;
const months = (v) => `${v.toFixed(1)} mo`;
const signed = (v, d = 1) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
function show(d, v) {
  switch (d.unit) {
    case 'pct': return `${+(v * 100).toFixed(1)}%`;
    case 'months': return `${+v.toFixed(1)} mo`;
    case 'year': return String(Math.round(v));
    case 'years': return `${Math.round(v)} yr`;
    case 'x': return `${+v.toFixed(1)}×`;
    case 'pts': return String(Math.round(v));
    case 'T': return money(v * 1000);
    case 'B/yr': return `${money(v)}/yr`;
    case 'pp': return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} pp`;
    default: return String(v);
  }
}
const nameOf = (which) => (state[`${which.toLowerCase()}Id`] === 'custom' ? `Custom ${which}` : state[which].short);
function rich(el, ...parts) { // strings become text, [text] becomes <strong>
  el.replaceChildren(...parts.map((x) => (Array.isArray(x) ? h('strong', { text: x[0] }) : document.createTextNode(x))));
}

// ---------------------------------------------------------------- controls

const toPos = (d, v) => (d.log ? (1000 * Math.log(v / d.min)) / Math.log(d.max / d.min) : v);
function fromPos(d, pos) {
  if (!d.log) return pos;
  const v = d.min * (d.max / d.min) ** (pos / 1000);
  if (d.unit === 'months') return Math.round(v);
  const mag = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
}

function control(d) {
  const id = `s-${d.id}`;
  const input = h('input', d.log ? { type: 'range', id, min: 0, max: 1000, step: 1 } : { type: 'range', id, min: d.min, max: d.max, step: d.step });
  const out = h('output', { for: id });
  const root = h('div', { class: 'ctl' },
    h('div', { class: 'ctl-top' }, h('label', { for: id, text: d.label }), out), input,
    h('p', { class: 'ctl-help' }, `${d.help} `, h('span', { class: 'status', text: d.status })));
  input.addEventListener('input', () => { state.p[d.id] = fromPos(d, +input.value); refresh(); });
  controls[d.id] = { d, input, out, root };
  return root;
}

function buildControls() {
  for (const st of STAGES) {
    const host = $(`ctl-${st.id}`), mine = PARAMS.filter((d) => d.stage === st.id);
    const rest = mine.filter((d) => !d.crux);
    host.append(...mine.filter((d) => d.crux).map(control));
    if (rest.length) host.append(h('details', { class: 'more' }, h('summary', { text: `More assumptions (${rest.length})` }), ...rest.map(control)));
  }
  for (const which of ['A', 'B']) {
    const host = $(`levers${which}`);
    for (const lv of LEVERS) {
      const id = `l-${which}-${lv.id}`, input = h('input', { type: 'range', id, min: 0, max: 1, step: 0.01, title: lv.help }), out = h('output', { for: id });
      host.append(h('div', { class: 'lever' }, h('div', { class: 'lever-top' }, h('label', { for: id, text: lv.label }), out), input,
        h('div', { class: 'lever-ends' }, h('span', { text: lv.lo }), h('span', { text: lv.hi }))));
      input.addEventListener('input', () => { state[which][lv.id] = +input.value; state[`${which.toLowerCase()}Id`] = 'custom'; refresh(); });
      leverInputs[which][lv.id] = { input, out };
    }
    host.append(h('p', { class: 'lever-note', id: `note${which}` }));
    const sel = $(`sel${which}`);
    for (const s of SCENARIOS) sel.append(h('option', { value: s.id, text: s.label }));
    sel.append(h('option', { value: 'custom', text: 'Custom levers' }));
    sel.addEventListener('change', () => {
      state[`${which.toLowerCase()}Id`] = sel.value;
      if (sel.value !== 'custom') state[which] = clone(scenario(sel.value));
      refresh();
    });
  }
  for (const pr of PRESETS) {
    $('presetSeg').append(h('button', { type: 'button', 'data-id': pr.id, text: pr.label, onclick: () => { state.preset = pr.id; state.p = withPreset(pr.id); refresh(); } }));
  }
  $('resetBtn').addEventListener('click', () => {
    Object.assign(state, { preset: 'middle', p: withPreset('middle'), aId: 'current', bId: 'sell', A: clone(scenario('current')), B: clone(scenario('sell')) });
    refresh();
  });
  $('linkBtn').addEventListener('click', async () => {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); $('linkBtn').textContent = 'Copied'; } catch { $('linkBtn').textContent = 'Link is in the address bar'; }
    setTimeout(() => { $('linkBtn').textContent = 'Copy link'; }, 1600);
  });
  $('themeBtn').addEventListener('click', () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    refresh();
  });
}

function syncControls() {
  const base = withPreset(state.preset);
  for (const { d, input, out, root } of Object.values(controls)) {
    input.value = toPos(d, state.p[d.id]);
    out.textContent = show(d, state.p[d.id]);
    root.classList.toggle('changed', Math.abs(state.p[d.id] - base[d.id]) > 1e-9);
  }
  for (const which of ['A', 'B']) {
    for (const lv of LEVERS) { const c = leverInputs[which][lv.id]; c.input.value = state[which][lv.id]; c.out.textContent = pct(state[which][lv.id]); }
    $(`sel${which}`).value = state[`${which.toLowerCase()}Id`];
    const pol = state[which], sc = SCENARIOS.find((s) => s.id === state[`${which.toLowerCase()}Id`]);
    $(`note${which}`).textContent = (pol.then ? `On ${state.p.warning} ${state.p.warning === 1 ? "year's" : "years'"} warning of a decisive window: chips ${pct(pol.then.chips)}, enforcement ${pct(pol.then.enforce)}, tools ${pct(pol.then.tools)}. ` : '') + (sc ? sc.note : '');
  }
  const warn = controls.warning.root, cutoff = Boolean(state.A.then || state.B.then);
  if (cutoff && warn.parentElement !== $('ctl-outcomes')) $('ctl-outcomes').prepend(warn);
  if (!cutoff && warn.parentElement === $('ctl-outcomes')) $('ctl-outcomes').querySelector('details.more').append(warn);
  for (const b of $('presetSeg').children) b.setAttribute('aria-pressed', String(b.dataset.id === state.preset));
  const pr = PRESETS.find((x) => x.id === state.preset);
  $('presetBlurb').textContent = `${pr.blurb}${pr.stated ? ` ${pr.stated}` : ''}`;
}

// ---------------------------------------------------------------- link state

function writeHash() {
  const base = withPreset(state.preset), parts = [`b=${state.preset}`, `A=${state.aId}`, `B=${state.bId}`];
  for (const which of ['A', 'B']) if (state[`${which.toLowerCase()}Id`] === 'custom') for (const lv of LEVERS) parts.push(`${which}.${lv.id}=${state[which][lv.id]}`);
  for (const d of PARAMS) if (Math.abs(state.p[d.id] - base[d.id]) > 1e-9) parts.push(`${d.id}=${+state.p[d.id].toPrecision(6)}`);
  history.replaceState(null, '', `#${parts.join('&')}`);
}
function readHash() {
  const kv = Object.fromEntries(location.hash.slice(1).split('&').filter(Boolean).map((s) => s.split('=')));
  if (PRESETS.some((x) => x.id === kv.b)) { state.preset = kv.b; state.p = withPreset(kv.b); }
  for (const which of ['A', 'B']) {
    const id = kv[which];
    if (scenario(id)) { state[`${which.toLowerCase()}Id`] = id; state[which] = clone(scenario(id)); }
    if (id === 'custom') {
      state[`${which.toLowerCase()}Id`] = 'custom';
      for (const lv of LEVERS) { const v = parseFloat(kv[`${which}.${lv.id}`]); if (Number.isFinite(v)) state[which][lv.id] = Math.min(1, Math.max(0, v)); }
    }
  }
  for (const d of PARAMS) { const v = parseFloat(kv[d.id]); if (Number.isFinite(v)) state.p[d.id] = Math.min(d.max, Math.max(d.min, v)); }
}

// ---------------------------------------------------------------- verdict

function drawVerdict(r) {
  const nA = nameOf('A'), nB = nameOf('B'), peakYear = YEARS[r.dLead.indexOf(r.monthsPeak)];
  const tile = (label, value, sub, cls = '') => h('div', { class: `tile ${cls}` }, h('div', { class: 'tile-label', text: label }), h('div', { class: 'tile-value', text: value }), h('div', { class: 'tile-sub', text: sub }));
  const buys = r.monthsAtWindow > 0.005 && Number.isFinite(r.requiredPerMonth);
  const cost = -r.ordinary;
  const net = tile('Net, present value', money(Math.abs(r.net)), `in favour of ${r.net >= 0 ? nA : nB}`, 'net');
  net.style.setProperty('--edge', r.net >= 0 ? C.a : C.b);
  $('tiles').replaceChildren(
    tile('Lead A buys over B', `${signed(r.monthsAtWindow)} months`, `on average when a decisive window opens · peak ${r.monthsPeak.toFixed(1)} in ${peakYear}`),
    tile(cost >= 0 ? 'What A costs' : 'What A gains regardless', money(Math.abs(cost)), 'standing terms: chip sales, third countries, open models, war risk'),
    tile('A month must be worth', !buys ? '–' : r.requiredPerMonth > 0 ? money(r.requiredPerMonth) : 'Nothing', !buys ? 'A buys no lead at a decisive window' : r.requiredPerMonth > 0 ? 'each month of lead at a decisive window, to cover that cost' : 'the standing terms already favour A'),
    tile('A month is worth', buys ? money(r.impliedPerMonth) : '–', 'at a decisive window, under your outcome assumptions and stakes'),
    net);

  const even = breakEvenPD(state.p, state.A, state.B), s = r.components.strategic, o = r.ordinary;
  const parts = ['The comparison favours ', [r.net >= 0 ? nA : nB], ` over ${r.net >= 0 ? nB : nA} by `, [money(Math.abs(r.net))], '. '];
  if (Math.abs(s) < 1e-6 && Math.abs(o) < 1e-6) parts.splice(0, parts.length, 'The two policies are the same.');
  else if (Math.sign(s) !== Math.sign(o) && Math.abs(s) > 1e-6 && Math.abs(o) > 1e-6) {
    parts.push(`The strategic term (${money(s)}) and the standing terms (${money(o)}) pull in opposite directions. `);
    const ties = [];
    if (Number.isFinite(r.breakEvenStakes)) ties.push(`the stakes are ${money(r.breakEvenStakes * 1000)} (now ${money(state.p.stakes * 1000)})`);
    if (Number.isFinite(even)) ties.push(`the chance of a decisive window is ${pct(even, 1)} (now ${pct(state.p.pD)})`);
    if (ties.length) parts.push(`They cancel when ${ties.join(', or when ')}.`);
  } else parts.push(`The strategic term (${money(s)}) and the standing terms (${money(o)}) point the same way, so no level of stakes reverses the answer.`);
  rich($('verdictText'), ...parts);
}

// ---------------------------------------------------------------- tree

function drawTree(r) {
  const W = 1040, H = 470, p = state.p;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tree', role: 'img', 'aria-label': 'Game tree with probabilities for policy A and policy B' });
  root.style.width = '100%';
  const text = (x, y, s, cls = '', anchor = 'start') => { const t = svg('text', { x, y, class: cls, 'text-anchor': anchor }, root); t.textContent = s; return t; };
  const pair = (x, y, a, b) => {
    svg('rect', { x, y: y - 9, width: 9, height: 9, rx: 2, fill: C.a }, root); text(x + 13, y, a, 't-num');
    const w = 13 + a.length * 6.9 + 10;
    svg('rect', { x: x + w, y: y - 9, width: 9, height: 9, rx: 2, fill: C.b }, root); text(x + w + 13, y, b, 't-num');
  };
  const box = (x, y, w, hh, title, stroke) => { const b = svg('rect', { x, y, width: w, height: hh, rx: 8, class: stroke ? 'leaf' : 'box' }, root); if (stroke) b.style.stroke = stroke; text(x + 10, y + 18, title, 't-title'); };
  const line = (...pts) => svg('path', { d: pts.map((q, i) => `${i ? 'L' : 'M'}${q[0]},${q[1]}`).join(''), class: 'edge' }, root);
  const node = (x, y) => svg('circle', { cx: x, cy: y, r: 7, class: 'node' }, root);
  const head = (x, s, anchor) => text(x, 13, s.toUpperCase(), 't-small', anchor);

  const mid = 200, tA = r.tree.A, tB = r.tree.B;
  const ratioAt = (m) => p.R0 * 10 ** ((m - p.lead0) / p.beta);
  const y2035 = YEARS.indexOf(2035), ownShare = (path) => path.dom[y2035] / path.flow[y2035];
  const leakIn = (pol) => pol.chips * p.leak * (1 - pol.enforce);

  head(6, 'Decision'); head(204, 'Response'); head(410, 'State'); head(604, 'Chance', 'middle'); head(708, 'Who is clearly ahead'); head(868, 'Outcome · value');

  // edges first
  line([174, mid], [204, mid]); line([380, mid], [410, mid]); line([570, mid], [597, mid]);
  line([611, mid], [668, mid]); line([604, mid + 7], [604, 435], [640, 435]);
  const ys = [58, 164, 270], lostY = 356;
  line([682, mid], [700, mid]); line([700, ys[0]], [700, ys[2]]);
  for (const y of ys) { line([700, y], [805, y]); line([819, y], [868, y]); }
  line([840, ys[0]], [840, lostY], [868, lostY]);

  box(6, mid - 46, 168, 92, 'The US sets policy');
  svg('rect', { x: 16, y: mid - 9, width: 9, height: 9, rx: 2, fill: C.a }, root); text(30, mid, nameOf('A'), 't-num');
  svg('rect', { x: 16, y: mid + 13, width: 9, height: 9, rx: 2, fill: C.b }, root); text(30, mid + 22, nameOf('B'), 't-num');

  box(204, mid - 60, 176, 120, 'China responds');
  text(214, mid - 24, 'barred demand that leaks in', 't-small'); pair(214, mid - 9, pct(leakIn(state.A)), pct(leakIn(state.B)));
  text(214, mid + 10, 'market left to its own chips', 't-small'); pair(214, mid + 25, pct(r.base.A.captive[1]), pct(r.base.B.captive[1]));
  text(214, mid + 44, 'own chips in 2035 purchases', 't-small'); pair(214, mid + 55, pct(ownShare(r.base.A)), pct(ownShare(r.base.B)));

  box(410, mid - 46, 160, 92, 'When it matters');
  text(420, mid - 10, 'compute ratio', 't-small'); pair(420, mid + 5, times(ratioAt(tA.lead)), times(ratioAt(tB.lead)));
  text(420, mid + 24, 'US lead, months', 't-small'); pair(420, mid + 39, tA.lead.toFixed(1), tB.lead.toFixed(1));

  node(604, mid); text(604, mid - 58, 'Decisive window?', 't-title', 'middle');
  text(640, mid + 16, `yes ${pctAuto(r.pWindow)}`, 't-num', 'middle');
  text(612, 330, `no ${pctAuto(1 - r.pWindow)}`, 't-num');
  node(675, mid);

  const cases = [
    { key: 'us', leaf: 'usLed', name: 'US clearly ahead', out: 'US-led order', v: p.vUS, q: p.qUS, color: C.us },
    { key: 'tie', leaf: 'multi', name: 'Contested', out: 'Multipolar', v: p.vTie, q: p.qTie, color: C.tie },
    { key: 'cn', leaf: 'cnLed', name: 'China clearly ahead', out: 'China-led order', v: p.vCN, q: p.qCN, color: C.cn },
  ];
  cases.forEach((c, i) => {
    const y = ys[i];
    text(708, y - 24, c.name, 't-title'); pair(708, y - 8, pctAuto(tA.race[c.key]), pctAuto(tB.race[c.key]));
    node(812, y);
    text(836, y + 16, `lost ${pct(c.q)}`, 't-small', 'end');
    box(868, y - 26, 166, 52, `${c.out} · ${c.v}`, c.color);
    pair(878, y + 16, pctAuto(tA.leaves[c.leaf]), pctAuto(tB.leaves[c.leaf]));
  });
  box(868, lostY - 26, 166, 52, 'Loss of control · 0', C.lost);
  pair(878, lostY + 16, pctAuto(tA.leaves.lost), pctAuto(tB.leaves.lost));

  box(640, 410, 394, 52, 'No window: nothing is ever decided');
  text(650, 448, `only the standing terms count: A over B = ${money(r.ordinary)}`);

  text(6, 300, 'Expected outcome score, given a window', 't-title'); pair(6, 318, tA.score.toFixed(1), tB.score.toFixed(1));
  text(6, 340, `A over B: ${(tA.score - tB.score >= 0 ? '+' : '−')}${Math.abs(tA.score - tB.score).toFixed(2)} points of 100`);
  text(6, 358, `× stakes ${money(p.stakes * 1000)} × chance of a window ${pctAuto(r.pWindow)}, discounted`);
  text(6, 376, `= strategic value ${money(r.components.strategic)}`, 't-num');
  $('treeHost').replaceChildren(root);
}

// ---------------------------------------------------------------- stages

const at = (path, key, year) => path[key][YEARS.indexOf(year)];

function drawStage1(r) {
  const p = state.p, a = r.base.A, b = r.base.B, nA = nameOf('A'), nB = nameOf('B');
  lineChart($('chRatio'), {
    x: YEARS, xName: 'Year', height: 270, yLog: true, yFmt: times, yTickFmt: (v) => `${v}×`, endLabels: true, label: 'US to China compute ratio by year',
    series: [{ name: `A: ${nA}`, color: C.a, y: a.R }, { name: `B: ${nB}`, color: C.b, y: b.R }],
    marks: [{ x: 2027, y: 13, label: 'IFP 13×', left: true }, { x: 2029, y: 12.4, label: 'Forethought 12.4×' }, { x: 2029, y: 3.8, label: 'Forethought 3.8×', below: true }],
    hlines: [{ y: 1 / p.appetite, label: `floor: 1 / appetite = ${times(1 / p.appetite)}` }],
  });
  const mix = (host, path) => lineChart(host, {
    x: YEARS.slice(1), xName: 'Year', height: 190, stacked: true, yDomain: [0, p.appetite * 1.04], yFmt: (v) => pct(v, v < 0.1 ? 1 : 0), label: 'Sources of China\'s yearly compute',
    series: [{ name: 'Chinese-made', color: C.cn, y: path.dom.slice(1) }, { name: 'US chips, sold', color: C.us, y: path.legal.slice(1) }, { name: 'US chips, leaked', color: C.tie, y: path.leak.slice(1) }],
  });
  mix($('chMixA'), a); mix($('chMixB'), b);

  const capA = at(a, 'q', 2035) * at(a, 'e', 2035), capB = at(b, 'q', 2035) * at(b, 'e', 2035);
  rich($('read1'), 'In 2029 the ratio is ', [times(at(a, 'R', 2029))], ' under A and ', [times(at(b, 'R', 2029))], ' under B; by 2040 it is ', [times(at(a, 'R', 2040))], ' and ', [times(at(b, 'R', 2040))],
    `. China's chip industry could supply ${pct(capA, capA < 0.1 ? 1 : 0)} of US purchases by 2035 under A against ${pct(capB, capB < 0.1 ? 1 : 0)} under B, a factor of `, [`${(capA / capB).toFixed(1)}`], '. That factor is how much the controls speed or slow indigenisation on net.');

  // how the model, at the current settings, lines up with the published projections
  const cur = simulate(p, scenario('current')), sold = simulate(p, scenario('sell')), tightened = simulate(p, scenario('tight'));
  const rows = [
    ['IFP: end of 2027, controls kept', '13×', times(at(cur, 'R', 2027))],
    ['Forethought: 2029, controls kept', '12.4×', times(at(cur, 'R', 2029))],
    ['Forethought: 2029, chip controls fail from 2027', '3.8×', times(at(sold, 'R', 2029))],
    ['Forethought: 2029, smuggling stopped (the model\'s Tightened also closes remote access)', '17.8×', times(at(tightened, 'R', 2029))],
    ['Months bought in 2029, controls kept against chips sold, at IFP\'s 5.4 per 10×', '2.7 mo', months(at(cur, 'lead', 2029) - at(sold, 'lead', 2029))],
  ];
  $('anchors').replaceChildren(h('table', { class: 'anchor-table' }, h('caption', { text: 'Published projections against the model at your settings' }),
    h('thead', {}, h('tr', {}, ['', 'Published', 'Model'].map((t) => h('th', { text: t })))),
    h('tbody', {}, rows.map((row) => h('tr', {}, row.map((c, i) => h(i ? 'td' : 'th', { text: c })))))));
}

function drawStage2(r) {
  const a = r.base.A, b = r.base.B, peakYear = YEARS[r.dLead.indexOf(r.monthsPeak)];
  lineChart($('chLead'), {
    x: YEARS, xName: 'Year', height: 250, yFmt: (v) => v.toFixed(1), endLabels: true, fillBetween: [0, 1], label: 'US lead in months by year',
    series: [{ name: `A: ${nameOf('A')}`, color: C.a, y: a.lead }, { name: `B: ${nameOf('B')}`, color: C.b, y: b.lead }],
  });
  rich($('read2'), 'A buys ', [`${r.monthsPeak.toFixed(1)} months`], ` at its peak in ${peakYear}, `, [`${at(r, 'dLead', 2035).toFixed(1)}`], ' in 2035 and ', [`${at(r, 'dLead', 2045).toFixed(1)}`],
    ' in 2045. Averaged over when a decisive window would open, it buys ', [`${r.monthsAtWindow.toFixed(1)} months`], '.',
    state.A.then || state.B.then ? ' The lines show the standing policies; a cut-off changes the lead only in the years just before a window, which the average includes.' : '');
}

function drawStage3(r) {
  const p = state.p, tA = r.tree.A, tB = r.tree.B;
  lineChart($('chWindow'), { x: YEARS.slice(1), xName: 'Year', height: 130, stacked: true, yFmt: (v) => pct(v, 1), table: false, label: 'Probability that a decisive window opens, by year',
    series: [{ name: 'Chance a window opens this year', color: cssVar('--muted'), y: r.h.slice(1) }] });
  const xs = Array.from({ length: 73 }, (_, i) => -6 + i * 0.5), probs = xs.map((m) => race(m, p));
  const marks = [{ x: tA.lead, label: `A ${tA.lead.toFixed(1)}`, color: C.a }, { x: tB.lead, label: `B ${tB.lead.toFixed(1)}`, color: C.b }]
    .map((v, i, all) => ({ ...v, x: Math.min(30, Math.max(-6, v.x)), flip: v.x > 20 || v.x < all[1 - i].x }));
  lineChart($('chRace'), { x: xs, xName: 'US lead (months)', xTitle: 'US lead when the window opens (months)', height: 240, yDomain: [0, 1], yFmt: (v) => pct(v), xFmt: (v) => `${v}`, xTicks: [-6, 0, 6, 12, 18, 24, 30], vlines: marks, table: false, label: 'Race structure by lead',
    series: [{ name: 'US clearly ahead', color: C.us, y: probs.map((q) => q.us) }, { name: 'Contested', color: C.tie, y: probs.map((q) => q.tie) }, { name: 'China clearly ahead', color: C.cn, y: probs.map((q) => q.cn) }] });
  lineChart($('chScore'), { x: xs, xName: 'US lead (months)', xTitle: 'US lead when the window opens (months)', height: 240, yDomain: [0, 100], yFmt: (v) => v.toFixed(0), xFmt: (v) => `${v}`, xTicks: [-6, 0, 6, 12, 18, 24, 30], vlines: marks, table: false, label: 'Expected outcome score by lead',
    series: [{ name: 'Expected score', color: cssVar('--ink-2'), y: xs.map((m) => outcome(m, p).score * 100) }] });
  rich($('read3'), `A decisive window opens before 2051 with probability ${pctAuto(r.pWindow)}. If one does, the US is clearly ahead with probability `, [pctAuto(tA.race.us)], ' under A and ', [pctAuto(tB.race.us)],
    ' under B; China is clearly ahead with ', [pctAuto(tA.race.cn)], ' and ', [pctAuto(tB.race.cn)], '. Control is lost with ', [pct(tA.leaves.lost, 1)], ' and ', [pct(tB.leaves.lost, 1)],
    `. So what the lead mostly moves is the split between a US-led outcome and a contested one. The expected score moves by ${(tA.score - tB.score >= 0 ? '+' : '−')}${Math.abs(tA.score - tB.score).toFixed(2)} points of 100. The slope of the right-hand curve at the two markers is what a month of lead is worth.`);
}

function drawStage4(r) {
  const c = r.components;
  signedBars($('chValue'), { fmt: money, posColor: C.a, negColor: C.b, label: 'Value of A over B by term',
    rows: [
      { label: 'Strategic value of the lead', value: c.strategic, note: 'stakes × chance of a window × change in score' },
      { label: 'Ordinary value of the lead', value: c.leadValue, note: 'being ahead, net of open-model cost' },
      { label: 'Chip sales', value: c.exportsValue, note: 'surplus on sales to China' },
      { label: 'Third countries', value: c.thirdValue, note: 'cost of extraterritorial licensing' },
      { label: 'War risk', value: c.conflictValue, note: `${r.warRisk.A.toFixed(2)} pp under A, ${r.warRisk.B.toFixed(2)} pp under B` },
      { label: 'Net', value: r.net, strong: true },
    ] });
  const buys = r.monthsAtWindow > 0.005 && Number.isFinite(r.requiredPerMonth);
  const parts = ['Bars to the right favour A, bars to the left favour B. '];
  if (buys && r.requiredPerMonth > 0) parts.push('To cover its standing cost, each month of lead A holds at a decisive window must be worth ', [money(r.requiredPerMonth)], '. Your outcome assumptions and stakes make it worth ', [money(r.impliedPerMonth)], '.');
  else if (buys) parts.push('The standing terms already favour A, so the months need be worth nothing; your assumptions make each worth ', [money(r.impliedPerMonth)], '.');
  else parts.push('A holds no more lead than B when a decisive window opens, so there is no price per month to report.');
  parts.push(` War risk attributable to policy: ${r.warRisk.A.toFixed(2)} percentage points under A and ${r.warRisk.B.toFixed(2)} under B.`);
  rich($('read4'), ...parts);
}

// ---------------------------------------------------------------- what decides the answer

function drawCruxes() {
  const p = state.p, A = state.A, B = state.B;
  const rows = tornado(p, A, B, PARAMS).slice(0, 14);
  const byId = Object.fromEntries(PARAMS.map((d) => [d.id, d]));
  tornadoChart($('chTornado'), { here: rows[0].here, fmt: money, k: 100, posColor: C.a, negColor: C.b, label: 'Net value as each assumption moves across its range',
    rows: rows.map((row) => ({ label: row.label, lo: row.lo, hi: row.hi, loText: show(byId[row.id], byId[row.id].min), hiText: show(byId[row.id], byId[row.id].max) })) });

  const pDs = Array.from({ length: 19 }, (_, i) => i * 0.05), taus = Array.from({ length: 15 }, (_, i) => +(2 * 30 ** (i / 14)).toFixed(2));
  heatmap($('chMap'), { xs: pDs, ys: taus, z: grid(p, A, B, pDs, taus, 'pD', 'tau'), xFmt: (v) => pct(v), yFmt: (v) => `${v < 10 ? v.toFixed(1) : v.toFixed(0)} mo`, vFmt: money,
    xTitle: 'Chance of a decisive window', yTitle: 'Critical lead', marker: { x: p.pD, y: p.tau }, yLog: true, k: 100, posColor: C.a, negColor: C.b, neutral: C.neutral, label: 'Net value by chance and sharpness of a decisive window' });

  const lv = Array.from({ length: 11 }, (_, i) => i / 10);
  heatmap($('chPolicy'), { xs: lv, ys: lv, z: grid(p, A, B, lv, lv, 'chips', 'tools', 'lever'), xFmt: (v) => pct(v), yFmt: (v) => pct(v), vFmt: money,
    xTitle: 'Chip sales blocked', yTitle: 'Tool and memory controls', marker: { x: A.chips, y: A.tools }, k: 100, posColor: C.a, negColor: C.b, neutral: C.neutral, label: 'Net value by chip and tool levers' });

  const s = sampleRanges(p, A, B, PARAMS, 2000, 1);
  $('sampleBox').replaceChildren(h('div', { class: 'sample-big', text: pct(s.shareA) }),
    h('p', {}, `Share of 2,000 draws in which A beats B when every assumption except your outcome values and stakes is drawn independently from its full range. The net value runs from ${money(s.q05)} at the 5th percentile through ${money(s.q50)} at the median to ${money(s.q95)} at the 95th. This describes the ranges, not anyone's beliefs: narrow a range you think is too wide and the share moves.`));
  drawAssumptions();
}

function drawAssumptions() {
  const order = Object.keys(SOURCES), table = $('assumeTable');
  const body = [];
  for (const st of STAGES) {
    body.push(h('tr', { class: 'stage-row' }, h('th', { colspan: 5, text: `${st.n} · ${st.title}` })));
    for (const d of PARAMS.filter((x) => x.stage === st.id)) {
      const refs = h('span', {});
      d.src.forEach((s, i) => refs.append(i ? ', ' : ' ', h('a', { href: `#src-${s}`, text: `[${order.indexOf(s) + 1}]` })));
      body.push(h('tr', {}, h('th', { text: d.label }), h('td', { class: 'num', text: show(d, state.p[d.id]) }), h('td', { class: 'num', text: `${show(d, d.min)} to ${show(d, d.max)}` }),
        h('td', {}, h('span', { class: 'tag', text: d.status })), h('td', {}, d.help, refs)));
    }
  }
  table.replaceChildren(h('thead', {}, h('tr', {}, ['Assumption', 'Now', 'Range', 'Basis', 'Meaning and sources'].map((t) => h('th', { text: t })))), h('tbody', {}, body));
  if (!$('sources').children.length) for (const k of order) $('sources').append(h('li', { id: `src-${k}` }, h('a', { href: SOURCES[k].url, text: SOURCES[k].cite }), `. ${SOURCES[k].note}`));
}

// ---------------------------------------------------------------- loop

let heavyTimer;
function refresh() {
  C = Object.fromEntries(['a', 'b', 'us', 'tie', 'cn', 'lost', 'neutral'].map((k) => [k, cssVar(`--${k}`)]));
  syncControls();
  const r = evaluate(state.p, state.A, state.B);
  drawVerdict(r); drawTree(r); drawStage1(r); drawStage2(r); drawStage3(r); drawStage4(r);
  clearTimeout(heavyTimer);
  heavyTimer = setTimeout(() => { drawCruxes(); writeHash(); }, 140);
}

buildControls();
readHash();
refresh();
addEventListener('hashchange', () => { readHash(); refresh(); }); // a pasted or edited link
let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refresh, 150); });
