// Print the model's headline tables: `node lead/cli.mjs`
import { YEARS, simulate, evaluate, breakEvenPD, tornado } from './model.js';
import { PARAMS, PRESETS, SCENARIOS, withPreset, scenario } from './params.js';

const at = (path, key, year) => path[key][YEARS.indexOf(year)];
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const money = (b) => (!Number.isFinite(b) ? '-' : Math.abs(b) >= 1000 ? `${(b / 1000).toFixed(2)}T` : `${b.toFixed(0)}B`);

for (const preset of PRESETS) {
  const p = withPreset(preset.id);
  console.log(`\n=== ${preset.label} ===`);
  console.log('compute ratio (x) and US lead (months)');
  console.log('scenario'.padEnd(34), ['2027', '2029', '2036', '2045'].map((y) => `R${y}`.padStart(7)).join(''), ['2029', '2036', '2045'].map((y) => `m${y}`.padStart(7)).join(''), '  cn chip 2036 (q*e)');
  for (const s of SCENARIOS) {
    const path = simulate(p, s);
    console.log(s.label.padEnd(34), [2027, 2029, 2036, 2045].map((y) => f(at(path, 'R', y)).padStart(7)).join(''),
      [2029, 2036, 2045].map((y) => f(at(path, 'lead', y)).padStart(7)).join(''), '  ', f(at(path, 'q', 2036) * at(path, 'e', 2036), 3));
  }
  for (const [a, b] of [['current', 'sell'], ['tight', 'current'], ['current', 'open'], ['current', 'later']]) {
    const A = scenario(a), B = scenario(b), r = evaluate(p, A, B), c = r.components;
    console.log(`\n${A.label}  vs  ${B.label}`);
    console.log(`  months bought: at window ${f(r.monthsAtWindow, 2)}, peak ${f(r.monthsPeak, 2)}, mean ${f(r.monthsMean, 2)}; P(window) ${f(r.pWindow * 100, 0)}%`);
    console.log(`  race given window  A: US ${f(r.tree.A.race.us * 100)}% tie ${f(r.tree.A.race.tie * 100)}% CN ${f(r.tree.A.race.cn * 100)}% lost ${f(r.tree.A.leaves.lost * 100)}% score ${f(r.tree.A.score)}`);
    console.log(`                     B: US ${f(r.tree.B.race.us * 100)}% tie ${f(r.tree.B.race.tie * 100)}% CN ${f(r.tree.B.race.cn * 100)}% lost ${f(r.tree.B.leaves.lost * 100)}% score ${f(r.tree.B.score)}`);
    console.log(`  strategic ${money(c.strategic)} | lead ${money(c.leadValue)} | exports ${money(c.exportsValue)} | third ${money(c.thirdValue)} | conflict ${money(c.conflictValue)} | NET ${money(r.net)}`);
    console.log(`  month at window: required ${money(r.requiredPerMonth)}, implied ${money(r.impliedPerMonth)}; break-even stakes ${f(r.breakEvenStakes, 0)}T; break-even pD ${f(breakEvenPD(p, A, B) * 100, 1)}%`);
  }
  const top = tornado(p, scenario('current'), scenario('sell'), PARAMS).slice(0, 8);
  console.log('\n  sensitivity (current vs sell):');
  for (const row of top) console.log(`   ${row.label.padEnd(44)} ${money(row.lo).padStart(9)} .. ${money(row.hi).padStart(9)} ${row.flips ? ' flips' : ''}`);
}
