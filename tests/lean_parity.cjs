// Prints lean-model results from web/lean.js for test_lean.py.
const path = require('path');
const Lm = require(path.join(__dirname, '..', 'web', 'lean.js'));
const out = {};
for (const c of Object.keys(Lm.data.derived)) for (const pair of Lm.data.pairs) for (const w of ['us_interest', 'global'])
  out[`${c}/${pair}/${w}`] = Lm.evaluate(Lm.defaults(c, pair, w)).net;
process.stdout.write(JSON.stringify(out));
