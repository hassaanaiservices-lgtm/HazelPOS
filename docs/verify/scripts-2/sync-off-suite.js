// SYNC-1 and OFF-1 against git HEAD. Ports 5180-5195.
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node docs/verify/scripts/sync-off-suite.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dir = path.join(L.SCRATCH, 'sync'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const E = {};
const ev = (id, k, v) => { (E[id] ||= {})[k] = v; L.say(id, k, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 700)); };
const q = (file, sql, ...a) => { const d = new DatabaseSync(file); d.exec('PRAGMA busy_timeout = 8000'); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const cloudOpts = { name: 'so-cloud', port: 5180, waPort: 5182, dsPort: 5181, dataDir: path.join(dir, 'cloud') };
const cloudDb = path.join(cloudOpts.dataDir, 'cloud.db');
const aOpts = { name: 'so-posA', port: 5184, waPort: 5185, db: path.join(dir, 'a.db'), dataDir: path.join(dir, 'a-data'), extraEnv: { WHATSAPP: 'off' } };
const bOpts = { name: 'so-posB', port: 5186, waPort: 5187, db: path.join(dir, 'b.db'), dataDir: path.join(dir, 'b-data'), extraEnv: { WHATSAPP: 'off' } };
let cloud, A, B, posA, posB;

const posSide = db => ({
  paid: q(db, "SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM orders WHERE status='paid'")[0],
  expenses: q(db, 'SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM expenses')[0],
  shifts_closed: q(db, "SELECT COUNT(*) n FROM register_sessions WHERE status='closed'")[0].n,
});
const cloudSide = bid => ({
  paid: q(cloudDb, "SELECT COUNT(*) n, COALESCE(SUM(total),0) s FROM c_orders WHERE branch_id=? AND status='paid'", bid)[0],
  all_orders: q(cloudDb, 'SELECT COUNT(*) n FROM c_orders WHERE branch_id=?', bid)[0].n,
  items: q(cloudDb, 'SELECT COUNT(*) n FROM c_items WHERE branch_id=?', bid)[0].n,
  expenses: q(cloudDb, 'SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM c_expenses WHERE branch_id=?', bid)[0],
  shifts: q(cloudDb, 'SELECT COUNT(*) n FROM c_shifts WHERE branch_id=?', bid)[0].n,
  stock_rows: q(cloudDb, 'SELECT COUNT(*) n FROM c_stock WHERE branch_id=?', bid)[0].n,
  backups: q(cloudDb, 'SELECT COUNT(*) n FROM backups WHERE branch_id=?', bid)[0].n,
});
async function sell(pos, n) {
  const products = (await pos.api('GET', '/menu')).data.products.map(p => ({ ...p, size: JSON.parse(p.sizes || '[]')[0]?.name || null }));
  const ids = [];
  for (let i = 0; i < n; i++) {
    const o = await pos.api('POST', '/orders', { type: 'takeaway', items: [{ product_id: products[i % products.length].id, size: products[i % products.length].size, qty: 1 + (i % 3) }] });
    const p = await pos.api('POST', `/orders/${o.data.id}/pay`, { method: 'cash', paid: 100000 });
    if (p.status !== 200) L.say('pay failed', p.data);
    ids.push(o.data.id);
  }
  return ids;
}
const timed = async (label, fn) => { const t = Date.now(); let r; try { r = await fn(); } catch (e) { r = { status: 'ERR ' + e.message }; } return { action: label, status: r.status, ms: Date.now() - t, note: r.data?.error }; };

(async () => {
  L.fakeDeepseek(5181);
  cloud = await L.startCloud(cloudOpts);
  A = await L.newClient(cloud, 'SyncA'); B = await L.newClient(cloud, 'SyncB');
  posA = await L.startPos(aOpts); await L.login(posA, '1234');
  posB = await L.startPos(bOpts); await L.login(posB, '1234');
  await posA.api('POST', '/cloud/connect', { url: cloud.base, key: A.code });
  await posB.api('POST', '/cloud/connect', { url: cloud.base, key: B.code });

  // ---------- SYNC-1 ----------
  await sell(posA, 5); await sell(posB, 3);
  await L.sleep(70000);
  const s1 = { A: { pos: posSide(aOpts.db), cloud: cloudSide(A.branch_id) }, B: { pos: posSide(bOpts.db), cloud: cloudSide(B.branch_id) } };
  ev('SYNC-1', 'after 70 s', s1);
  // Restart (nothing to resend) and a forced re-push of everything (sync_log cleared)
  await L.stopProc(posA.p); posA = await L.startPos(aOpts); posA.token = (await L.login(posA, '1234')).data.token;
  await L.sleep(10000);
  ev('SYNC-1', 'cloud A after plain restart', cloudSide(A.branch_id));
  await L.stopProc(posA.p); q(aOpts.db, 'DELETE FROM sync_log RETURNING tbl'); posA = await L.startPos(aOpts); await L.login(posA, '1234');
  await L.sleep(12000);
  ev('SYNC-1', 'cloud A after full re-push (sync_log cleared)', cloudSide(A.branch_id));
  ev('SYNC-1', 'owner dashboard totals', (await (async () => {
    const own = q(cloudDb, 'SELECT owner_id FROM branches WHERE id=?', A.branch_id)[0].owner_id;
    return q(cloudDb, "SELECT branch_id, COUNT(*) n, SUM(total) s FROM c_orders WHERE status='paid' GROUP BY branch_id").concat([{ owner: own }]);
  })()));

  // ---------- OFF-1 (a): cloud process killed (connection refused) ----------
  await L.stopProc(cloud.p);
  const runOps = async tag => {
    const out = [];
    const prod0 = (await posA.api('GET', '/menu')).data.products[0]; const prod = { id: prod0.id, size: JSON.parse(prod0.sizes || '[]')[0]?.name || null };
    let id;
    out.push(await timed('create order', async () => { const r = await posA.api('POST', '/orders', { type: 'takeaway', items: [{ product_id: prod.id, size: prod.size, qty: 1 }] }); id = r.data.id; return r; }));
    out.push(await timed('modify order (add item)', () => posA.api('POST', '/orders', { id, type: 'takeaway', items: [{ product_id: prod.id, size: prod.size, qty: 2 }] })));
    out.push(await timed('print receipt (no printer set)', () => posA.api('POST', `/print/receipt/${id}`, {})));
    out.push(await timed('pay', () => posA.api('POST', `/orders/${id}/pay`, { method: 'cash', paid: 100000 })));
    const qi = (await posA.api('GET', '/qr-info')).data.tables[0];
    let reqId;
    out.push(await timed('table QR order (public)', async () => { const r = await posA.api('POST', `/qr/${qi.qr_token}/order`, { items: [{ product_id: prod.id, size: prod.size, qty: 1 }] }, null); reqId = r.data.id; return r; }));
    out.push(await timed('accept QR order', () => posA.api('POST', `/qr-requests/${reqId}/accept`, {})));
    out.push(await timed('expense', () => posA.api('POST', '/expenses', { title: 'Offline ' + tag, category: 'Other', amount: 123, payment_method: 'cash', date: new Date().toISOString().slice(0, 10), user_name: 'Owner' })));
    out.push(await timed('reports', () => posA.api('GET', '/reports?from=2000-01-01&to=2099-01-01')));
    out.push(await timed('whatsapp status', () => posA.api('GET', '/whatsapp/status')));
    out.push(await timed('cloud status', () => posA.api('GET', '/cloud/status')));
    out.push(await timed('licence', () => posA.api('GET', '/licence')));
    out.push(await timed('close shift', () => posA.api('POST', '/register/close', { closing_cash: 0 })));
    out.push(await timed('open shift', () => posA.api('POST', '/register/open', { opening_cash: 0 })));
    out.push(await timed('manual "Sync now" button (expected to wait)', () => posA.api('POST', '/cloud/sync', {})));
    return out;
  };
  ev('OFF-1', 'cloud down (refused)', await runOps('refused'));
  // ---------- OFF-1 (b): cloud address black-holed (every cloud call hangs until its 20 s timeout) ----------
  await L.stopProc(posA.p);
  const realUrl = q(aOpts.db, "SELECT value FROM cloud_config WHERE key='url'")[0].value;
  q(aOpts.db, "UPDATE cloud_config SET value='http://10.255.255.1:5199' WHERE key='url' RETURNING key");
  posA = await L.startPos(aOpts); await L.login(posA, '1234');
  await L.sleep(6000); // the first background sync is now hanging
  ev('OFF-1', 'cloud black-holed (hangs)', await runOps('blackhole'));
  const pending = (await posA.api('GET', '/cloud/status')).data;
  ev('OFF-1', 'pending while offline', { pending_orders: pending.pending_orders, last_error: pending.last_error });

  // ---------- back online ----------
  await L.stopProc(posA.p);
  q(aOpts.db, "UPDATE cloud_config SET value=? WHERE key='url' RETURNING key", realUrl);
  cloud = await L.startCloud(cloudOpts);
  posA = await L.startPos(aOpts); await L.login(posA, '1234');
  await L.sleep(70000);
  ev('OFF-1', 'after reconnect', { pos: posSide(aOpts.db), cloud: cloudSide(A.branch_id) });
  ev('OFF-1', 'duplicate keys in cloud (should be none: PK branch+local_id)', q(cloudDb, 'SELECT branch_id, local_id, COUNT(*) c FROM c_orders GROUP BY 1,2 HAVING c>1'));

  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1));
  L.say('done');
  process.exit(0);
})().catch(e => { console.error('FAILED', e); fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1)); process.exit(1); });
