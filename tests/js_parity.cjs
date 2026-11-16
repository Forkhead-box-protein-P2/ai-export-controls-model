// Runs the browser engine under Node and prints summary numbers as JSON for test_web_parity.py.
const path = require('path');
const M = require(path.join(__dirname, '..', 'web', 'model.js'));
const [config, n, seed] = [process.argv[2] || 'baseline', +(process.argv[3] || 300), +(process.argv[4] || 42)];
const cfg = M.makeConfig(config);
const run = M.runConfig(cfg, n, seed);
const out = { calib: run.calib, policies: {} };
const ref = run.results[cfg.reference_policy];
for (const [pol, res] of Object.entries(run.results)) {
  const o = { outcomes: M.outcomeProbs(res, cfg), means: {}, delta: {} };
  for (const s of ['ratio_stock', 'lag_years', 'dom_share', 'K_logic', 'K_sme', 'O', 'h_war', 'Q_dom'])
    o.means[s] = [0, 4, 9, 24].map(t => M.seriesMean(res, s, t));
  for (const w of Object.keys(cfg.weights)) o.delta[w] = M.compare(res, ref, cfg.weights[w]).mean;
  out.policies[pol] = o;
}
process.stdout.write(JSON.stringify(out));
