// One image, three services. Railway variable APP picks which one this service runs:
//   APP=pos (default)  the POS for restaurants (server/index.js)
//   APP=admin          the HazelPOS admin panel (admin/server.js)
//   APP=site           the landing page (site/server.js)
const app = String(process.env.APP || 'pos').toLowerCase();
const entry = { pos: './server/index.js', admin: './admin/server.js', site: './site/server.js' }[app];
if (!entry) { console.error(`APP must be pos, admin or site (got "${app}")`); process.exit(1); }
console.log(`Starting HazelPOS ${app}`);
require(entry);
