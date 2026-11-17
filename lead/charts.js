// Small SVG chart helpers. No dependencies.

const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

export function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const k in props) {
    if (k === 'class') n.className = props[k];
    else if (k === 'text') n.textContent = props[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), props[k]);
    else n.setAttribute(k, props[k]);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid);
  return n;
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------------------------------------------------------------- tooltip

let tipEl;
export function showTip(evt, title, rows) {
  if (!tipEl) { tipEl = h('div', { class: 'tip' }); document.body.append(tipEl); }
  tipEl.replaceChildren();
  if (title) tipEl.append(h('div', { class: 'tip-title', text: title }));
  for (const r of rows) {
    const key = h('span', { class: 'tip-key' });
    if (r.color) key.style.background = r.color; else key.style.visibility = 'hidden';
    tipEl.append(h('div', { class: 'tip-row' }, key, h('strong', { text: r.value }), h('span', { text: r.name })));
  }
  tipEl.style.display = 'block';
  const box = tipEl.getBoundingClientRect(), pad = 14;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + box.width > innerWidth - 8) x = evt.clientX - box.width - pad;
  if (y + box.height > innerHeight - 8) y = evt.clientY - box.height - pad;
  tipEl.style.left = `${Math.max(4, x)}px`; tipEl.style.top = `${Math.max(4, y)}px`;
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

// ---------------------------------------------------------------- scales

const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
const logScale = (d0, d1, r0, r1) => (v) => r0 + ((Math.log(v) - Math.log(d0)) / (Math.log(d1) - Math.log(d0))) * (r1 - r0);

export function ticks(min, max, n = 5) {
  const span = max - min || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), err = raw / mag;
  const step = mag * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1), out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const logTicks = (min, max) => [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].filter((v) => v >= min && v <= max);

// Signed log: linear near zero, logarithmic beyond `k`. For values spanning orders of magnitude on both sides of zero.
export const symlog = (v, k) => Math.sign(v) * Math.log10(1 + Math.abs(v) / k);

function legend(host, items) {
  const box = h('div', { class: 'legend' });
  for (const it of items) {
    const key = h('span', { class: `key ${it.kind || 'line'}` });
    key.style.background = it.color;
    box.append(h('span', { class: 'legend-item' }, key, h('span', { text: it.name })));
  }
  host.append(box);
}

function dataTable(host, head, rows) {
  const table = h('table', {}, h('thead', {}, h('tr', {}, head.map((t) => h('th', { text: t })))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h(i ? 'td' : 'th', { text: c }))))));
  host.append(h('details', { class: 'data' }, h('summary', { text: 'Table' }), h('div', { class: 'data-scroll' }, table)));
}

function frame(host, height) {
  const width = Math.max(260, Math.floor(host.clientWidth || 600));
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'chart', role: 'img' });
  return { root, width };
}

// ---------------------------------------------------------------- line and area chart
// o = { x: number[], series: [{ name, color, y: number[], dash? }], height, yLog, yDomain, yFmt, xFmt,
//       stacked, marks: [{ x, y, label }], vlines: [{ x, label, color }], hlines: [{ y, label }],
//       endLabels, label }
export function lineChart(host, o) {
  host.replaceChildren();
  if (o.series.length > 1) legend(host, o.series.map((s) => ({ name: s.name, color: s.color, kind: o.stacked ? 'box' : 'line' })));
  const height = o.height || 240, { root, width } = frame(host, height);
  root.setAttribute('aria-label', o.label || 'chart');
  const m = { l: 46, r: o.endLabels ? 66 : 14, t: 10, b: o.xTitle ? 42 : 26 };
  const x0 = o.x[0], x1 = o.x[o.x.length - 1];
  const sx = lin(x0, x1, m.l, width - m.r);

  let layers = o.series.map((s) => s.y);
  if (o.stacked) {
    const run = o.x.map(() => 0);
    layers = o.series.map((s) => s.y.map((v, i) => (run[i] += v)));
  }
  const flat = layers.flat().concat((o.marks || []).map((k) => k.y), (o.hlines || []).map((k) => k.y)).filter(Number.isFinite);
  let [y0, y1] = o.yDomain || [o.yLog ? Math.min(...flat) : Math.min(0, ...flat), Math.max(...flat)];
  if (o.yLog) { y0 = Math.max(y0 / 1.15, 1e-9); y1 *= 1.15; } else if (!o.yDomain) { y1 += (y1 - y0) * 0.06; }
  const sy = o.yLog ? logScale(y0, y1, height - m.b, m.t) : lin(y0, y1, height - m.b, m.t);
  const yFmt = o.yFmt || ((v) => v), xFmt = o.xFmt || ((v) => v);

  const g = svg('g', {}, root);
  for (const v of o.yLog ? logTicks(y0, y1) : ticks(y0, y1, 4)) {
    svg('line', { x1: m.l, x2: width - m.r, y1: sy(v), y2: sy(v), class: 'grid' }, g);
    svg('text', { x: m.l - 6, y: sy(v) + 4, class: 'tick', 'text-anchor': 'end' }, g).textContent = (o.yTickFmt || yFmt)(v);
  }
  const xt = o.xTicks || ticks(x0, x1, Math.min(8, Math.floor(width / 70)));
  for (const v of xt) svg('text', { x: sx(v), y: height - m.b + 16, class: 'tick', 'text-anchor': 'middle' }, g).textContent = xFmt(v);
  if (o.xTitle) svg('text', { x: (m.l + width - m.r) / 2, y: height - 6, class: 'axis-title', 'text-anchor': 'middle' }, g).textContent = o.xTitle;
  svg('line', { x1: m.l, x2: width - m.r, y1: height - m.b, y2: height - m.b, class: 'axis' }, g);

  for (const hl of o.hlines || []) {
    svg('line', { x1: m.l, x2: width - m.r, y1: sy(hl.y), y2: sy(hl.y), class: 'ref' }, g);
    svg('text', { x: width - m.r - 4, y: sy(hl.y) - 4, class: 'note', 'text-anchor': 'end' }, g).textContent = hl.label;
  }

  const pathOf = (ys) => ys.map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(ys[i - 1]) ? 'L' : 'M'}${sx(o.x[i]).toFixed(1)},${sy(v).toFixed(1)}` : '')).join('');
  if (o.stacked) {
    for (let k = o.series.length - 1; k >= 0; k--) {
      const top = layers[k], bot = k ? layers[k - 1] : o.x.map(() => 0);
      let d = top.map((v, i) => `${i ? 'L' : 'M'}${sx(o.x[i]).toFixed(1)},${sy(v).toFixed(1)}`).join('');
      for (let i = o.x.length - 1; i >= 0; i--) d += `L${sx(o.x[i]).toFixed(1)},${sy(bot[i]).toFixed(1)}`;
      svg('path', { d: `${d}Z`, fill: o.series[k].color, class: 'area' }, g);
    }
  } else {
    if (o.fillBetween) { // shade the gap between two series
      const [a, b] = o.fillBetween;
      let d = layers[a].map((v, i) => `${i ? 'L' : 'M'}${sx(o.x[i]).toFixed(1)},${sy(v).toFixed(1)}`).join('');
      for (let i = o.x.length - 1; i >= 0; i--) d += `L${sx(o.x[i]).toFixed(1)},${sy(layers[b][i]).toFixed(1)}`;
      svg('path', { d: `${d}Z`, class: 'gap' }, g);
    }
    o.series.forEach((s, k) => {
      const p = svg('path', { d: pathOf(layers[k]), stroke: s.color, class: 'line' }, g);
      if (s.dash) p.setAttribute('stroke-dasharray', s.dash);
    });
  }

  for (const v of o.vlines || []) {
    const vl = svg('line', { x1: sx(v.x), x2: sx(v.x), y1: m.t, y2: height - m.b, class: 'ref vref' }, g);
    if (v.color) { vl.style.stroke = v.color; vl.style.strokeWidth = 2; }
    svg('text', { x: sx(v.x) + (v.flip ? -5 : 5), y: m.t + 10 + (v.row || 0) * 13, class: 'note', 'text-anchor': v.flip ? 'end' : 'start' }, g).textContent = v.label;
  }
  for (const k of o.marks || []) {
    svg('circle', { cx: sx(k.x), cy: sy(k.y), r: 4, class: 'mark' }, g);
    svg('text', { x: sx(k.x) + (k.left ? -7 : 7), y: sy(k.y) + (k.below ? 14 : -6), class: 'note', 'text-anchor': k.left ? 'end' : 'start' }, g).textContent = k.label;
  }

  if (o.endLabels && !o.stacked) { // direct labels at the line ends, nudged apart
    const ends = o.series.map((s, k) => ({ y: sy(layers[k][layers[k].length - 1]), text: yFmt(layers[k][layers[k].length - 1]), color: s.color }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    for (const e of ends) {
      svg('circle', { cx: width - m.r + 7, cy: e.y, r: 3.5, fill: e.color }, g);
      svg('text', { x: width - m.r + 14, y: e.y + 4, class: 'endlabel' }, g).textContent = e.text;
    }
  }

  // hover: crosshair snaps to the nearest x, one tooltip lists every series
  const cross = svg('line', { y1: m.t, y2: height - m.b, class: 'cross', visibility: 'hidden' }, g);
  const hit = svg('rect', { x: m.l, y: m.t, width: width - m.l - m.r, height: height - m.t - m.b, fill: 'transparent' }, g);
  hit.addEventListener('pointermove', (evt) => {
    const box = root.getBoundingClientRect(), px = ((evt.clientX - box.left) / box.width) * width;
    let i = 0, best = Infinity;
    o.x.forEach((v, k) => { const dist = Math.abs(sx(v) - px); if (dist < best) { best = dist; i = k; } });
    cross.setAttribute('x1', sx(o.x[i])); cross.setAttribute('x2', sx(o.x[i])); cross.setAttribute('visibility', 'visible');
    showTip(evt, xFmt(o.x[i]), o.series.map((s) => ({ name: s.name, color: s.color, value: Number.isFinite(s.y[i]) ? yFmt(s.y[i]) : '-' })));
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });

  host.append(root);
  if (o.table !== false) dataTable(host, [o.xName || '', ...o.series.map((s) => s.name)], o.x.map((v, i) => [xFmt(v), ...o.series.map((s) => (Number.isFinite(s.y[i]) ? yFmt(s.y[i]) : ''))]));
}

// ---------------------------------------------------------------- signed horizontal bars
// o = { rows: [{ label, value, strong }], fmt, posColor, negColor }
export function signedBars(host, o) {
  host.replaceChildren();
  const narrow = (host.clientWidth || 600) < 520, rowH = narrow ? 44 : 30, off = narrow ? 16 : 0; // narrow: label above its bar
  const height = o.rows.length * rowH + 8, { root, width } = frame(host, height);
  root.setAttribute('aria-label', o.label || 'bar chart');
  const labelW = narrow ? 0 : Math.min(210, Math.floor(width * 0.42)), valW = 76;
  const maxAbs = Math.max(...o.rows.map((r) => Math.abs(r.value)), 1e-9);
  const zero = labelW + (width - labelW) / 2, half = (width - labelW) / 2 - valW; // room for a value label at either end
  svg('line', { x1: zero, x2: zero, y1: 2, y2: height - 4, class: 'axis' }, root);
  o.rows.forEach((r, i) => {
    const y = i * rowH + 6, len = Math.max(1.5, (Math.abs(r.value) / maxAbs) * half), pos = r.value >= 0;
    if (r.strong) svg('line', { x1: 0, x2: width, y1: y - 3, y2: y - 3, class: 'grid' }, root);
    svg('text', { x: 0, y: y + (narrow ? 11 : 15), class: r.strong ? 'rowlabel strong' : 'rowlabel' }, root).textContent = r.label;
    const bar = svg('rect', { x: pos ? zero + 1 : zero - 1 - len, y: y + 3 + off, width: len, height: 16, rx: 3, fill: pos ? o.posColor : o.negColor, class: 'bar' }, root);
    const tx = svg('text', { x: pos ? zero + len + 7 : zero - len - 7, y: y + 15 + off, class: r.strong ? 'value strong' : 'value', 'text-anchor': pos ? 'start' : 'end' }, root);
    tx.textContent = o.fmt(r.value);
    const hitbox = svg('rect', { x: labelW, y, width: width - labelW, height: rowH - 4, fill: 'transparent' }, root);
    hitbox.addEventListener('pointermove', (evt) => { bar.classList.add('hot'); showTip(evt, r.label, [{ value: o.fmt(r.value), name: r.note || '', color: pos ? o.posColor : o.negColor }]); });
    hitbox.addEventListener('pointerleave', () => { bar.classList.remove('hot'); hideTip(); });
  });
  host.append(root);
}

// ---------------------------------------------------------------- tornado
// o = { rows: [{ label, lo, hi, loText, hiText }], here, fmt, k, posColor, negColor }
export function tornadoChart(host, o) {
  host.replaceChildren();
  const narrow = (host.clientWidth || 600) < 520, rowH = narrow ? 40 : 26, off = narrow ? 14 : 0;
  const top = 22, height = o.rows.length * rowH + top + 6, { root, width } = frame(host, height);
  root.setAttribute('aria-label', o.label || 'sensitivity chart');
  const labelW = narrow ? 0 : Math.min(250, Math.floor(width * 0.44));
  let lastTick = -Infinity;
  const all = o.rows.flatMap((r) => [r.lo, r.hi]).concat([o.here, 0]);
  const s0 = symlog(Math.min(...all), o.k), s1 = symlog(Math.max(...all), o.k);
  const pad = (s1 - s0) * 0.04 || 1;
  const sx = lin(s0 - pad, s1 + pad, labelW + 6, width - 8), X = (v) => sx(symlog(v, o.k));
  for (const t of [-1e6, -1e5, -1e4, -1e3, -100, 0, 100, 1e3, 1e4, 1e5, 1e6, 1e7]) {
    if (symlog(t, o.k) < s0 - pad || symlog(t, o.k) > s1 + pad) continue;
    svg('line', { x1: X(t), x2: X(t), y1: top - 4, y2: height - 4, class: t === 0 ? 'axis' : 'grid' }, root);
    if ((Math.abs(t) === 100 && X(100) - X(0) < 44) || X(t) - lastTick < 50) continue; // too crowded to label
    lastTick = X(t);
    svg('text', { x: X(t), y: 12, class: 'tick', 'text-anchor': 'middle' }, root).textContent = t === 0 ? '0' : o.fmt(t);
  }
  svg('line', { x1: X(o.here), x2: X(o.here), y1: top - 4, y2: height - 4, class: 'here' }, root);
  o.rows.forEach((r, i) => {
    const y = top + i * rowH, a = Math.min(r.lo, r.hi), b = Math.max(r.lo, r.hi);
    svg('text', { x: 0, y: y + (narrow ? 11 : 15), class: 'rowlabel' }, root).textContent = r.label;
    const seg = (v0, v1, color) => { if (v1 > v0) svg('rect', { x: X(v0), y: y + 5 + off, width: Math.max(1, X(v1) - X(v0)), height: 12, rx: 3, fill: color, class: 'bar' }, root); };
    seg(a, Math.min(b, 0), o.negColor); seg(Math.max(a, 0), b, o.posColor);
    if (b - a < 1e-9) svg('rect', { x: X(a) - 1, y: y + 5 + off, width: 2, height: 12, class: 'nub' }, root);
    svg('circle', { cx: X(r.hi), cy: y + 11 + off, r: 4, class: 'dot-hi' }, root); // parameter at the top of its range
    svg('circle', { cx: X(r.lo), cy: y + 11 + off, r: 3.5, class: 'dot-lo' }, root); // at the bottom
    const hitbox = svg('rect', { x: 0, y, width, height: rowH, fill: 'transparent' }, root);
    hitbox.addEventListener('pointermove', (evt) => showTip(evt, r.label, [
      { value: o.fmt(r.lo), name: `at ${r.loText}` }, { value: o.fmt(r.hi), name: `at ${r.hiText}` }]));
    hitbox.addEventListener('pointerleave', hideTip);
  });
  host.append(root);
}

// ---------------------------------------------------------------- heatmap
// o = { xs, ys, z[yi][xi], xFmt, yFmt, vFmt, xTitle, yTitle, marker: { x, y }, k, posColor, negColor, neutral }
const hex = (c) => { const v = c.replace('#', ''); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };

export function heatmap(host, o) {
  host.replaceChildren();
  const height = o.height || 300, { root, width } = frame(host, height);
  root.setAttribute('aria-label', o.label || 'heat map');
  const m = { l: 58, r: 10, t: 8, b: 40 };
  const nx = o.xs.length, ny = o.ys.length, cw = (width - m.l - m.r) / nx, ch = (height - m.t - m.b) / ny;
  const vmax = Math.max(...o.z.flat().map(Math.abs), 1e-9), smax = symlog(vmax, o.k);
  const color = (v) => { const t = Math.min(1, Math.abs(symlog(v, o.k)) / smax); return mix(o.neutral, v >= 0 ? o.posColor : o.negColor, 0.12 + 0.88 * t); };
  const cy = (j) => m.t + (ny - 1 - j) * ch; // y grows upward
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cell = svg('rect', { x: m.l + i * cw + 0.5, y: cy(j) + 0.5, width: cw - 1, height: ch - 1, fill: color(o.z[j][i]), class: 'cell' }, root);
    cell.addEventListener('pointermove', (evt) => showTip(evt, `${o.xTitle} ${o.xFmt(o.xs[i])} · ${o.yTitle} ${o.yFmt(o.ys[j])}`, [{ value: o.vFmt(o.z[j][i]), name: o.z[j][i] >= 0 ? 'A ahead' : 'B ahead', color: o.z[j][i] >= 0 ? o.posColor : o.negColor }]));
    cell.addEventListener('pointerleave', hideTip);
  }
  // the break-even line: edges between cells of opposite sign
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const s = Math.sign(o.z[j][i]);
    if (i + 1 < nx && Math.sign(o.z[j][i + 1]) !== s) svg('line', { x1: m.l + (i + 1) * cw, x2: m.l + (i + 1) * cw, y1: cy(j), y2: cy(j) + ch, class: 'even' }, root);
    if (j + 1 < ny && Math.sign(o.z[j + 1][i]) !== s) svg('line', { x1: m.l + i * cw, x2: m.l + (i + 1) * cw, y1: cy(j), y2: cy(j), class: 'even' }, root);
  }
  const pick = (n, want) => { const step = Math.max(1, Math.round(n / want)); return Array.from({ length: n }, (_, i) => i).filter((i) => i % step === 0); };
  for (const i of pick(nx, Math.min(7, Math.floor(width / 80)))) svg('text', { x: m.l + (i + 0.5) * cw, y: height - m.b + 14, class: 'tick', 'text-anchor': 'middle' }, root).textContent = o.xFmt(o.xs[i]);
  for (const j of pick(ny, 6)) svg('text', { x: m.l - 6, y: cy(j) + ch / 2 + 4, class: 'tick', 'text-anchor': 'end' }, root).textContent = o.yFmt(o.ys[j]);
  svg('text', { x: m.l + (width - m.l - m.r) / 2, y: height - 6, class: 'axis-title', 'text-anchor': 'middle' }, root).textContent = o.xTitle;
  svg('text', { x: 12, y: m.t + (height - m.t - m.b) / 2, class: 'axis-title', 'text-anchor': 'middle', transform: `rotate(-90 12 ${m.t + (height - m.t - m.b) / 2})` }, root).textContent = o.yTitle;
  if (o.marker) { // nearest cell to the current settings
    const near = (arr, v, log) => arr.reduce((b, a, i) => (Math.abs(log ? Math.log(a / v) : a - v) < Math.abs(log ? Math.log(arr[b] / v) : arr[b] - v) ? i : b), 0);
    const i = near(o.xs, o.marker.x, o.xLog), j = near(o.ys, o.marker.y, o.yLog);
    svg('circle', { cx: m.l + (i + 0.5) * cw, cy: cy(j) + ch / 2, r: 6, class: 'youarehere' }, root);
  }
  host.append(root);
  host.append(h('div', { class: 'heat-key' },
    h('span', { text: 'B ahead' }), (() => { const bar = h('span', { class: 'heat-ramp' }); bar.style.background = `linear-gradient(90deg, ${o.negColor}, ${o.neutral}, ${o.posColor})`; return bar; })(), h('span', { text: 'A ahead' }),
    h('span', { class: 'heat-note', text: 'dark line: break-even · ring: your settings' })));
}
