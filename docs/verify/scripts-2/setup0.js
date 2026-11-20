// SETUP-0: local cloud + two POS branches (A, B) on Linux, activated with codes from the vendor API.
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node docs/verify/scripts/setup0.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
(async () => {
  const dir = path.join(L.SCRATCH, 'setup0'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  L.fakeDeepseek(5101, path.join(dir, 'ds.jsonl'));
  const cloud = await L.startCloud({ name: 's0-cloud', port: 5100, waPort: 5102, dsPort: 5101, dataDir: path.join(dir, 'cloud') });
  const A = await L.newClient(cloud, 'Client A'), B = await L.newClient(cloud, 'Client B');
  L.say('clients', A, B);
  const posA = await L.startPos({ name: 's0-posA', port: 5110, waPort: 5111, db: path.join(dir, 'a.db'), dataDir: path.join(dir, 'a-data') });
  const posB = await L.startPos({ name: 's0-posB', port: 5120, waPort: 5121, db: path.join(dir, 'b.db'), dataDir: path.join(dir, 'b-data') });
  const out = {};
  for (const [pos, c, n] of [[posA, A, 'A'], [posB, B, 'B']]) {
    const lg = await L.login(pos, '1234');
    const con = await pos.api('POST', '/cloud/connect', { url: cloud.base, key: c.code });
    const st = await pos.api('GET', '/cloud/status');
    out[n] = { login: lg.status, connect: con.status, connect_body: con.data, status: st.data };
    L.say(n, JSON.stringify(out[n]));
  }
  const owners = await cloud.v('GET', '/owners');
  out.vendor_branches = owners.data.map(o => ({ owner: o.name, branches: o.branches.map(b => ({ id: b.id, name: b.name, last_sync: b.last_sync, code_used_at: b.code_used_at })) }));
  out.vendor_branches_route = (await cloud.v('GET', '/branches')).status;
  L.say(JSON.stringify(out.vendor_branches), 'GET /api/vendor/branches ->', out.vendor_branches_route);
  const ok = out.A.status.connected && out.B.status.connected && out.vendor_branches.every(o => o.branches.every(b => b.last_sync));
  L.record('SETUP-0', ok ? 'PASS' : 'FAIL', out);
  L.saveResults(path.join(dir, 'results.json'));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
