// Prints how a raw crit chance splits into crit tiers (rolled 20,000 times). Usage: node tools/crit_check.js
const G = require(require('path').join(__dirname, '..', 'src', 'core.js'));
for (const raw of [0.05, 0.8, 1, 1.5, 2, 3, 5]) {
  const c = {};
  for (let i = 0; i < 20000; i++) { const t = G.rollCrit(raw); c[t] = (c[t] || 0) + 1; }
  console.log((Math.round(raw * 100) + '%').padStart(5), Object.entries(c).map(([k, v]) => (G.CRIT_TIERS[k] || 'normal') + ' ' + (v / 200).toFixed(1) + '%').join(', '));
}
