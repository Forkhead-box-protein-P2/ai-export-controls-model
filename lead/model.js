// What is a month of AI lead worth? The whole model, in four stages.
// Pure functions, no DOM. The browser page and the Node tests both import this file.
//
//   1. policy            -> US:China compute ratio      simulate()
//   2. compute ratio     -> months of US lead           (inside simulate)
//   3. months of lead    -> outcome probabilities       race(), outcome(), windowProbs()
//   4. outcomes + costs  -> expected value, break-even  evaluate()
//
// A policy is three levers in [0, 1]: { chips, enforce, tools }.
// A policy may carry `then: { chips, enforce, tools }`: levers the US switches to
// once it has `warning` years' notice of a decisive window.

export const START = 2026; // state at the end of this year is the shared starting point
export const END = 2050;
export const N = END - START;
export const YEARS = Array.from({ length: N + 1 }, (_, i) => START + i);

const HILL = 3; // sharpness of the lead-to-dominance curve (see race)
const SPREAD = 0.5; // log-spread of the window's timing (see windowProbs)

// ---------------------------------------------------------------- stage 1 and 2

// One policy path. `switchAt` is the year index from which `policy.then` applies.
export function simulate(p, policy, switchAt = Infinity) {
  let c = 1 / p.R0; // China's compute stock as a share of the US stock
  let q = p.q0; // China's domestic chip output, units, relative to US unit purchases
  let e = p.e0; // performance of a Chinese chip relative to the US frontier chip
  const path = {
    R: [p.R0], lead: [p.lead0], q: [q], e: [e],
    flow: [NaN], dom: [NaN], legal: [NaN], leak: [NaN], captive: [NaN], supply: [NaN],
    chips: [NaN], enforce: [NaN], tools: [NaN],
  };
  for (let t = 1; t <= N; t++) {
    const x = policy.then && t >= switchAt ? policy.then : policy;

    // What the US lets through, as shares of China's appetite.
    const legalShare = 1 - x.chips;
    const leakShare = x.chips * p.leak * (1 - x.enforce);
    const foreignShare = legalShare + leakShare;

    // China's response: whatever foreign chips do not serve is a captive market for
    // domestic chips, and the state reserves at least `mandate` of it regardless.
    const captive = Math.max(p.mandate, 1 - foreignShare);
    const supply = q * e; // domestic effective compute on offer, relative to US purchases
    const dom = Math.min(supply, captive * p.appetite);
    const foreign = Math.min(foreignShare * p.appetite, p.appetite - dom);
    const legal = foreignShare > 0 ? (foreign * legalShare) / foreignShare : 0;
    const flow = dom + foreign; // China's acquisitions relative to the US's this year

    // Stocks: the ratio of stocks is a moving average of the ratio of purchases.
    c = (1 - p.turnover) * c + p.turnover * flow;

    // Industry: one drive term moves both quantity and quality. A captive market
    // raises it; tool and memory controls lower it.
    const drive = captive * (1 - p.choke * x.tools);
    q *= (1 + p.growth * drive) / (1 + p.usGrowth);
    e += p.catchup * drive * (1 - e);

    const R = 1 / c;
    path.R.push(R);
    path.lead.push(p.lead0 + p.beta * Math.log10(R / p.R0)); // stage 2
    path.q.push(q); path.e.push(e);
    path.flow.push(flow); path.dom.push(dom); path.legal.push(legal); path.leak.push(foreign - legal);
    path.captive.push(captive); path.supply.push(supply);
    path.chips.push(x.chips); path.enforce.push(x.enforce); path.tools.push(x.tools);
  }
  return path;
}

// ---------------------------------------------------------------- stage 3

const Z = (() => { // standard-normal quadrature nodes for the noise in the realised lead
  const n = 41, nodes = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const z = -4 + (8 * i) / (n - 1), w = Math.exp((-z * z) / 2);
    nodes.push([z, w]); sum += w;
  }
  return nodes.map(([z, w]) => [z, w / sum]);
})();

// Chance that a leader `x` months ahead converts the lead into durable dominance.
// `tau` is the lead at which that chance is one half.
const convert = (x, tau) => (x <= 0 ? 0 : 1 / (1 + (tau / x) ** HILL));

// Race structure when a decisive window opens with the US `m` months ahead
// (negative: China ahead). The realised lead differs from m by N(0, noise).
export function race(m, p) {
  let us = 0, cn = 0;
  if (p.noise <= 0) {
    us = convert(m, p.tau); cn = convert(-m, p.tau);
  } else {
    for (const [z, w] of Z) {
      const x = m + z * p.noise;
      us += w * convert(x, p.tau); cn += w * convert(-x, p.tau);
    }
  }
  return { us, cn, tie: Math.max(0, 1 - us - cn) };
}

// Leaves of the tree at a decisive window, and the expected outcome score in [0, 1].
// Loss of control scores 0 whoever was ahead.
export function outcome(m, p) {
  const r = race(m, p);
  const leaves = {
    usLed: r.us * (1 - p.qUS),
    multi: r.tie * (1 - p.qTie),
    cnLed: r.cn * (1 - p.qCN),
    lost: r.us * p.qUS + r.tie * p.qTie + r.cn * p.qCN,
  };
  const score = (leaves.usLed * p.vUS + leaves.multi * p.vTie + leaves.cnLed * p.vCN) / 100;
  return { race: r, leaves, score };
}

const erf = (x) => { // Abramowitz and Stegun 7.1.26
  const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
};
const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

// Probability that a decisive window opens in each year. Lognormal in years from now,
// median `tMed`, scaled by pD. Mass after END is outside the decision's horizon.
export function windowProbs(p) {
  const med = Math.max(0.5, p.tMed - START);
  const F = (t) => (t <= 0 ? 0 : normCdf(Math.log(t / med) / SPREAD));
  return YEARS.map((_, t) => (t === 0 ? 0 : p.pD * (F(t) - F(t - 1))));
}

// ---------------------------------------------------------------- stage 4

const denial = (path) => { // how much is being denied, averaged over the path
  let s = 0;
  for (let t = 1; t <= N; t++) s += (path.chips[t] + path.tools[t]) / 2;
  return s / N;
};

// Policy A against reference B. Money is in $ billions, present value; positive favours A.
export function evaluate(p, A, B) {
  const h = windowProbs(p);
  const base = { A: simulate(p, A), B: simulate(p, B) };
  // Lead when a window opens in year t. A cut-off policy switches `warning` years ahead.
  const leadAt = (pol, path, t) =>
    pol.then ? simulate(p, pol, t - Math.round(p.warning) + 1).lead[t] : path.lead[t];

  const tree = { A: blankTree(), B: blankTree() };
  const leadAtWindow = { A: [NaN], B: [NaN] };
  let pWindow = 0, perStake = 0, hdDm = 0, hDm = 0;
  let leadValue = 0, exportsValue = 0, thirdValue = 0, discSum = 0;

  for (let t = 1; t <= N; t++) {
    const d = (1 + p.disc) ** -t;
    const grow = (1 + p.flowGrowth) ** (t - 1);
    const mA = leadAt(A, base.A, t), mB = leadAt(B, base.B, t);
    const oA = outcome(mA, p), oB = outcome(mB, p);
    leadAtWindow.A.push(mA); leadAtWindow.B.push(mB);
    addTree(tree.A, oA, h[t], mA); addTree(tree.B, oB, h[t], mB);
    pWindow += h[t];
    perStake += h[t] * d * (oA.score - oB.score);
    hdDm += h[t] * d * (mA - mB);
    hDm += h[t] * (mA - mB);

    // Ordinary flows, along the standing policies.
    leadValue += d * grow * (p.bLead - p.bOpen) * (base.A.lead[t] - base.B.lead[t]);
    const sold = (path) => (path.legal[t] + path.leak[t]) / p.appetite; // share of the open-access market still served
    exportsValue += d * grow * p.surplus * p.market * (sold(base.A) - sold(base.B));
    const reach = (path) => path.enforce[t] * path.chips[t]; // nothing to police abroad if nothing is barred
    thirdValue -= d * grow * p.third * (reach(base.A) - reach(base.B));
    discSum += d;
  }
  for (const k of ['A', 'B']) closeTree(tree[k], pWindow);

  // War risk in percentage points. The second term applies in worlds with a decisive
  // window, to the extent Beijing shares that belief; a cut-off lands in exactly those worlds.
  const warRisk = (pol, path) => {
    const standing = denial(path);
    const atWindow = pol.then ? (pol.then.chips + pol.then.tools) / 2 : standing;
    return standing * p.w0 + atWindow * p.w1 * p.kappa * p.pD;
  };
  const risk = { A: warRisk(A, base.A), B: warRisk(B, base.B) };
  const conflictValue = (-(risk.A - risk.B) / 100) * p.warCost * 1000 * (discSum / N);

  const strategic = perStake * p.stakes * 1000;
  const ordinary = leadValue + exportsValue + thirdValue + conflictValue;
  const net = strategic + ordinary;

  const dLead = YEARS.map((_, t) => base.A.lead[t] - base.B.lead[t]);
  const monthsAtWindow = pWindow > 0 ? hDm / pWindow : 0;
  return {
    base, h, tree, pWindow, leadAtWindow, dLead,
    components: { strategic, leadValue, exportsValue, thirdValue, conflictValue },
    ordinary, net,
    monthsAtWindow,
    monthsPeak: Math.max(...dLead),
    monthsMean: dLead.slice(1).reduce((s, v) => s + v, 0) / N,
    // Price of a month of lead held when a decisive window opens:
    // what the standing costs require it to be worth, and what the outcome
    // assumptions imply it is worth.
    requiredPerMonth: hdDm > 1e-9 ? -ordinary / hdDm : NaN,
    impliedPerMonth: hdDm > 1e-9 ? strategic / hdDm : NaN,
    // Stakes ($ trillions) at which A and B tie; NaN if no positive stakes do it.
    breakEvenStakes: perStake * -ordinary > 0 ? -ordinary / (perStake * 1000) : NaN,
    scoreShift: pWindow > 0 ? (tree.A.score - tree.B.score) : 0, // points out of 100, given a window
    warRisk: risk,
  };
}

function blankTree() {
  return { race: { us: 0, tie: 0, cn: 0 }, leaves: { usLed: 0, multi: 0, cnLed: 0, lost: 0 }, score: 0, lead: 0 };
}
function addTree(tr, o, w, m) {
  for (const k in tr.race) tr.race[k] += w * o.race[k];
  for (const k in tr.leaves) tr.leaves[k] += w * o.leaves[k];
  tr.score += w * o.score * 100; tr.lead += w * m;
}
function closeTree(tr, pWindow) { // make everything conditional on a window opening
  const k = pWindow > 0 ? 1 / pWindow : 0;
  for (const key in tr.race) tr.race[key] *= k;
  for (const key in tr.leaves) tr.leaves[key] *= k;
  tr.score *= k; tr.lead *= k;
}

// Probability of a decisive window at which A and B tie. Net value is linear in pD.
export function breakEvenPD(p, A, B) {
  const n0 = evaluate({ ...p, pD: 0 }, A, B).net, n1 = evaluate({ ...p, pD: 1 }, A, B).net;
  if (n0 === n1) return NaN;
  const x = n0 / (n0 - n1);
  return x >= 0 && x <= 1 ? x : NaN;
}

// ---------------------------------------------------------------- analysis helpers

// One-at-a-time sensitivity: net value with each parameter at the ends of its range.
export function tornado(p, A, B, defs) {
  const here = evaluate(p, A, B).net;
  return defs
    .filter((d) => d.min !== undefined)
    .map((d) => {
      const lo = evaluate({ ...p, [d.id]: d.min }, A, B).net;
      const hi = evaluate({ ...p, [d.id]: d.max }, A, B).net;
      return { id: d.id, label: d.label, lo, hi, here, span: Math.abs(hi - lo), flips: Math.sign(lo) !== Math.sign(hi) };
    })
    .sort((a, b) => b.span - a.span);
}

// Net value over a grid of two parameters (kind 'param') or two levers of A (kind 'lever').
export function grid(p, A, B, xs, ys, xId, yId, kind = 'param') {
  return ys.map((y) => xs.map((x) => {
    if (kind === 'lever') return evaluate(p, { ...A, [xId]: x, [yId]: y }, B).net;
    return evaluate({ ...p, [xId]: x, [yId]: y }, A, B).net;
  }));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw every ranged parameter independently and uniformly from its range (log-uniform
// where flagged), holding the ones flagged `value` (preferences, not facts) where they are.
// This describes the ranges, not anyone's beliefs.
export function sampleRanges(p, A, B, defs, n = 2000, seed = 1) {
  const rnd = mulberry32(seed), nets = [];
  const ranged = defs.filter((d) => d.min !== undefined && !d.value);
  for (let i = 0; i < n; i++) {
    const draw = { ...p };
    for (const d of ranged) {
      const u = rnd();
      draw[d.id] = d.log ? Math.exp(Math.log(d.min) + u * (Math.log(d.max) - Math.log(d.min))) : d.min + u * (d.max - d.min);
      if (d.integer) draw[d.id] = Math.round(draw[d.id]);
    }
    nets.push(evaluate(draw, A, B).net);
  }
  nets.sort((a, b) => a - b);
  const qtile = (f) => nets[Math.min(n - 1, Math.floor(f * n))];
  return { n, shareA: nets.filter((v) => v > 0).length / n, q05: qtile(0.05), q25: qtile(0.25), q50: qtile(0.5), q75: qtile(0.75), q95: qtile(0.95) };
}
