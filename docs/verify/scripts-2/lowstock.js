// WA-AUTO-8 (low-stock part): the owner's low-stock alert goes out through the cloud while the cloud bot is on, and from
// the POS's own WhatsApp while it is off. Ports 5170-5179.
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node docs/verify/scripts/lowstock.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const dir = path.join(L.SCRATCH, 'lowstock'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
for (const f of ['ls-cloud', 'ls-pos']) for (const s of ['.log', '-wa.jsonl']) fs.rmSync(path.join(L.SCRATCH, f + s), { force: true });
const jsonl = f => { try { return fs.readFileSync(path.join(L.SCRATCH, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
(async () => {
  L.fakeDeepseek(5171);
  const cloud = await L.startCloud({ name: 'ls-cloud', port: 5170, waPort: 5172, dsPort: 5171, dataDir: path.join(dir, 'cloud') });
  const A = await L.newClient(cloud, 'StockCo');
  const opts = { name: 'ls-pos', port: 5174, waPort: 5175, db: path.join(dir, 'p.db'), dataDir: path.join(dir, 'p-data') };
  let pos = await L.startPos(opts); await L.login(pos, '1234');
  await pos.api('POST', '/cloud/connect', { url: cloud.base, key: A.code });
  await pos.wa('/scan', { id: 'local' });
  const ing = (await pos.api('POST', '/ingredients', { name: 'Chicken', unit: 'kg', low_level: 10, cost: 500 })).data;
  await pos.api('POST', '/settings', { low_stock_alert_to: '03009998877', low_stock_alert: '1' });
  const out = { ingredient: ing, preview: (await pos.api('GET', '/low-stock-alert/preview')).data };
  // bot OFF
  let t = Date.now();
  out.off = (await pos.api('POST', '/low-stock-alert/test', {})).data;
  await L.sleep(1000);
  out.off_sends = { pos: jsonl('ls-pos-wa.jsonl').filter(e => e.ms >= t && e.type === 'send').map(e => e.chat), cloud: jsonl('ls-cloud-wa.jsonl').filter(e => e.ms >= t && e.type === 'send').map(e => e.chat) };
  // bot ON (restart the POS so its first check at 15 s sees it)
  await cloud.v('POST', `/branches/${A.branch_id}/whatsapp/enable`, { enabled: true });
  await cloud.wa('/scan', { id: String(A.branch_id) });
  await L.stopProc(pos.p); pos = await L.startPos(opts); await L.login(pos, '1234');
  out.cloud_mode = !!(await L.waitFor(async () => (await pos.api('GET', '/whatsapp/status')).data.cloud_bot, 40000, 2000));
  t = Date.now();
  out.on = (await pos.api('POST', '/low-stock-alert/test', {})).data;
  await L.sleep(1000);
  out.on_sends = { pos: jsonl('ls-pos-wa.jsonl').filter(e => e.ms >= t && e.type === 'send').map(e => e.chat), cloud: jsonl('ls-cloud-wa.jsonl').filter(e => e.ms >= t && e.type === 'send').map(e => `${e.id} -> ${e.chat}: ${e.text.split('\n')[0]}`) };
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
