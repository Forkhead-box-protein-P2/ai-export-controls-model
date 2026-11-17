// Run with: node --test lead/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { YEARS, N, simulate, race, outcome, windowProbs, evaluate, breakEvenPD, tornado, sampleRanges } from '../model.js';
import { PARAMS, PRESETS, SCENARIOS, DEFAULTS, withPreset, scenario } from '../params.js';

const at = (path, key, year) => path[key][YEARS.indexOf(year)];
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, wanted ${b} ± ${tol}`);
const current = scenario('current'), sell = scenario('sell'), tight = scenario('tight'), open = scenario('open'), later = scenario('later');

test('defaults sit inside their ranges and every source key exists', async () => {
  const { SOURCES } = await import('../params.js');
  for (const d of PARAMS) {
    assert.ok(d.def >= d.min && d.def <= d.max, `${d.id} default outside range`);
    for (const s of d.src) assert.ok(SOURCES[s], `${d.id} cites unknown source ${s}`);
  }
  for (const pr of PRESETS) for (const [k, v] of Object.entries(pr.set)) {
    const d = PARAMS.find((x) => x.id === k);
    assert.ok(d, `preset ${pr.id} sets unknown parameter ${k}`);
    assert.ok(v >= d.min && v <= d.max, `preset ${pr.id}: ${k} outside range`);
  }
});

test('anchors: the default compute paths reproduce the published projections', () => {
  const p = DEFAULTS;
  // IFP: about 9x at end-2026 rising to 13x at end-2027 under current controls.
  close(at(simulate(p, current), 'R', 2027), 13, 2.5, 'current controls, 2027');
  // Forethought: 12.4x in 2029 if controls are maintained, 3.8x if chip controls fail from 2027.
  close(at(simulate(p, current), 'R', 2029), 12.4, 1.5, 'current controls, 2029');
  close(at(simulate(p, sell), 'R', 2029), 3.8, 0.4, 'chips sold, 2029');
  // The lead those two ratios buy, at 5.4 months per 10x: about 2.6 to 2.8 months.
  const bought = at(simulate(p, current), 'lead', 2029) - at(simulate(p, sell), 'lead', 2029);
  close(bought, 2.7, 0.4, 'months bought in 2029');
});

test('the decisive preset reproduces the stated compute forecast', () => {
  const path = simulate(withPreset('decisive'), current);
  for (const y of YEARS) {
    if (y >= 2027 && y <= 2036) assert.ok(at(path, 'R', y) >= 10, `ratio below 10x in ${y}`);
    if (y >= 2040) assert.ok(at(path, 'R', y) >= 2, `ratio below 2x in ${y}`);
  }
});

test('accounting: flows add up and stay within China\'s appetite', () => {
  for (const pr of PRESETS) for (const s of SCENARIOS) {
    const p = withPreset(pr.id), path = simulate(p, s);
    for (let t = 1; t <= N; t++) {
      close(path.dom[t] + path.legal[t] + path.leak[t], path.flow[t], 1e-12, 'flow parts');
      assert.ok(path.flow[t] <= p.appetite + 1e-12, 'flow exceeds appetite');
      assert.ok(path.dom[t] >= 0 && path.legal[t] >= 0 && path.leak[t] >= -1e-12);
      assert.ok(path.e[t] > 0 && path.e[t] < 1, 'chip performance stays between 0 and parity');
      assert.ok(path.R[t] >= 1 / p.appetite - 1e-9, 'ratio cannot fall below 1 / appetite');
    }
  }
});

test('directions: each lever moves the compute ratio the way it should', () => {
  const p = DEFAULTS, R = (pol, y = 2032) => at(simulate(p, pol), 'R', y);
  assert.ok(R({ ...current, chips: 1 }) > R(current), 'blocking more chips widens the gap');
  assert.ok(R({ ...current, enforce: 0.9 }) > R(current), 'enforcement widens the gap');
  assert.ok(R({ ...current, tools: 1 }, 2040) > R({ ...current, tools: 0 }, 2040), 'tool controls slow China\'s industry');
  // Chip controls give China's industry a captive market: more domestic capability than if chips were sold.
  const cap = (pol) => at(simulate(p, pol), 'q', 2036) * at(simulate(p, pol), 'e', 2036);
  assert.ok(cap(current) > cap(sell), 'captive market speeds indigenisation');
  // A high mandate removes most of that difference.
  const hi = { ...p, mandate: 0.8 };
  const gap = (pp) => at(simulate(pp, current), 'q', 2036) / at(simulate(pp, sell), 'q', 2036);
  assert.ok(gap(hi) < gap(p), 'a state-guaranteed market shrinks the effect of controls on indigenisation');
  // Tool controls do nothing for the lead if chips are sold freely.
  close(R(sell, 2040), R(open, 2040), 1e-9, 'with chips sold the ratio is 1 / appetite either way');
});

test('race probabilities are probabilities and behave', () => {
  const p = DEFAULTS;
  for (const m of [-20, -3, 0, 4, 6.5, 12, 40]) {
    const r = race(m, p);
    close(r.us + r.cn + r.tie, 1, 1e-9, 'race sums to one');
    assert.ok(r.us >= 0 && r.cn >= 0 && r.tie >= 0);
    const l = outcome(m, p).leaves;
    close(l.usLed + l.multi + l.cnLed + l.lost, 1, 1e-9, 'leaves sum to one');
  }
  assert.ok(race(9, p).us > race(5, p).us, 'more lead, more chance of a clear US lead');
  close(race(3, p).us, race(-3, p).cn, 1e-12, 'symmetric in who is ahead');
  close(race(p.tau, { ...p, noise: 0 }).us, 0.5, 1e-12, 'even chance at the critical lead');
  assert.ok(race(6.5, { ...p, tau: 60 }).us < 0.01, 'a five-year critical lead makes months irrelevant');
});

test('window probabilities sum to pD times the mass inside the horizon', () => {
  const h = windowProbs(DEFAULTS), total = h.reduce((s, v) => s + v, 0);
  assert.ok(total <= DEFAULTS.pD + 1e-12 && total > 0.9 * DEFAULTS.pD);
  assert.equal(windowProbs({ ...DEFAULTS, pD: 0 }).reduce((s, v) => s + v, 0), 0);
});

test('evaluation: identities and signs', () => {
  const p = DEFAULTS;
  const same = evaluate(p, current, current);
  close(same.net, 0, 1e-9, 'a policy against itself is worth nothing');
  const ab = evaluate(p, current, sell), ba = evaluate(p, sell, current);
  close(ab.net, -ba.net, 1e-6, 'swapping the policies flips the sign');
  const c = ab.components;
  close(c.strategic + c.leadValue + c.exportsValue + c.thirdValue + c.conflictValue, ab.net, 1e-6, 'components add to the net');
  assert.ok(c.exportsValue < 0, 'controls forgo chip sales');
  assert.ok(ab.monthsAtWindow > 0 && ab.monthsPeak >= ab.monthsAtWindow - 1e-9);
  // With no decisive window there is no strategic term.
  close(evaluate({ ...p, pD: 0 }, current, sell).components.strategic, 0, 1e-12, 'no window, no strategic value');
  // If every outcome under human control is valued equally and risk is symmetric, the lead buys nothing.
  const flat = { ...p, vUS: 80, vTie: 80, vCN: 80, qUS: 0.1, qTie: 0.1, qCN: 0.1 };
  close(evaluate(flat, current, sell).components.strategic, 0, 1e-6, 'symmetric outcomes, no strategic value');
  // Net value is linear in pD, so the break-even is exact.
  const pd = breakEvenPD(p, current, sell);
  close(evaluate({ ...p, pD: pd }, current, sell).net, 0, 1e-3, 'break-even pD zeroes the net');
  // And the break-even stakes zero it too.
  close(evaluate({ ...p, stakes: ab.breakEvenStakes }, current, sell).net, 0, 1e-3, 'break-even stakes zero the net');
  // Required and implied value per month are the two sides of the same ledger.
  assert.equal(Math.sign(ab.impliedPerMonth - ab.requiredPerMonth), Math.sign(ab.net));
});

test('the cut-off scenario: warning is what makes it work', () => {
  const p = DEFAULTS;
  const none = evaluate({ ...p, warning: 0 }, later, sell);
  close(none.monthsAtWindow, 0, 1e-9, 'with no warning the cut-off is the same as selling');
  const m = (w) => evaluate({ ...p, warning: w }, later, sell).monthsAtWindow;
  assert.ok(m(1) > 0 && m(3) > m(1), 'more warning, more lead recovered');
  // A cut-off in a tense moment carries the extra war risk; standing sales do not.
  assert.ok(evaluate(p, later, sell).warRisk.A > evaluate(p, later, sell).warRisk.B);
});

test('the presets disagree, and for the reasons they say', () => {
  const net = (id) => evaluate(withPreset(id), current, sell).net;
  assert.ok(net('decisive') > 0, 'decisive view: controls pay');
  assert.ok(net('continuous') < 0, 'continuous view: controls cost');
  // Months bought fade under the continuous view and persist under the decisive one.
  const fade = (id) => { const r = evaluate(withPreset(id), current, sell); return r.dLead[YEARS.indexOf(2040)] / r.dLead[YEARS.indexOf(2029)]; };
  assert.ok(fade('continuous') < 0.1 && fade('decisive') > 0.9);
});

test('sensitivity helpers run and are reproducible', () => {
  const rows = tornado(DEFAULTS, current, sell, PARAMS);
  assert.equal(rows.length, PARAMS.length);
  assert.ok(rows[0].span >= rows[rows.length - 1].span);
  const a = sampleRanges(DEFAULTS, current, sell, PARAMS, 300, 7), b = sampleRanges(DEFAULTS, current, sell, PARAMS, 300, 7);
  assert.deepEqual(a, b);
  assert.ok(a.shareA >= 0 && a.shareA <= 1 && a.q05 <= a.q50 && a.q50 <= a.q95);
  assert.ok(tight.chips >= current.chips);
});
