// One image, three services. Railway variable APP picks which one this service runs:
//   APP=pos (default)  the POS for restaurants (server/index.js)
//   APP=admin          the HazelPOS admin panel (admin/server.js)
//   APP=site           the landing page (site/server.js)
//   APP=demo           the landing page at / plus the public demo POS at /app (fresh sample restaurant on every start)
const app = String(process.env.APP || 'pos').toLowerCase();
const entry = { pos: './server/index.js', admin: './admin/server.js', site: './site/server.js', demo: './demo/start.js' }[app];
if (!entry) { console.error(`APP must be pos, admin, site or demo (got "${app}")`); process.exit(1); }
console.log(`Starting HazelPOS ${app}`);
if (app === 'demo') process.env.NODE_ENV = 'demo'; // the public demo holds only sample data; the production checks are for the real POS
if (app === 'demo') { // build the sample restaurant (3 s, through the real API) so its orders are always from the last 7 days
  const r = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, 'demo', 'seed.js')], { stdio: 'inherit', env: { ...process.env, PORT: '' } });
  if (r.status !== 0) { console.error('Could not build the demo restaurant'); process.exit(1); }
}
require(entry);
