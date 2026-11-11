// Pushes this branch's finished orders, expenses, stock and closed shifts to HazelPOS Cloud, plus a daily database backup.
// Runs in the background: no internet just means "try again next minute"; the POS itself never waits on it.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BATCH = 200;
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;

module.exports = function cloudSync(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_config (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS sync_log (tbl TEXT, local_id INTEGER, hash TEXT, PRIMARY KEY (tbl, local_id));
  `);
  const get = k => db.prepare('SELECT value FROM cloud_config WHERE key=?').get(k)?.value || '';
  const set = (k, v) => db.prepare('INSERT INTO cloud_config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));
  const hash = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');
  const mark = (tbl, id, h = '') => db.prepare('INSERT OR REPLACE INTO sync_log VALUES (?,?,?)').run(tbl, id, h);
  let running = false;

  async function call(urlPath, body, raw) {
    const r = await fetch(get('url').replace(/\/+$/, '') + urlPath, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bearer ' + get('key'), 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(raw ? 120000 : 20000),
    }).catch(e => { throw new Error(e.name === 'TimeoutError' ? 'Cloud took too long to answer' : 'Cloud not reachable (no internet?)'); });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Cloud replied ${r.status}`);
    return data;
  }

  // Paid/cancelled orders never change again, so each is sent once
  function pendingOrders() {
    return db.prepare(`SELECT o.*, t.name table_name, date(COALESCE(o.paid_at, o.created_at), 'localtime') day FROM orders o
      LEFT JOIN tables_ t ON t.id = o.table_id
      WHERE o.status IN ('paid','cancelled','refunded') AND o.id NOT IN (SELECT local_id FROM sync_log WHERE tbl='orders') ORDER BY o.id LIMIT ?`).all(BATCH)
      .map(o => ({
        local_id: o.id, type: o.type, status: o.status, table_name: o.table_name, subtotal: o.subtotal, discount: o.discount,
        promo_amount: o.promo_amount, points_amount: o.points_amount, tax: o.tax, total: o.total, payment_method: o.payment_method,
        created_at: o.created_at, paid_at: o.paid_at, day: o.day, user_name: o.user_name,
        items: db.prepare('SELECT name, qty, price FROM order_items WHERE order_id=?').all(o.id),
      }));
  }
  // Expenses can be edited or deleted, so they are compared by hash
  function changedExpenses() {
    const seen = new Map(db.prepare("SELECT local_id, hash FROM sync_log WHERE tbl='expenses'").all().map(r => [r.local_id, r.hash]));
    const rows = db.prepare('SELECT id, date, title, category, amount FROM expenses').all();
    const changed = rows.filter(e => seen.get(e.id) !== hash(e)).slice(0, BATCH);
    const ids = new Set(rows.map(e => e.id));
    return { changed, deleted: [...seen.keys()].filter(id => !ids.has(id)) };
  }

  async function syncNow() {
    if (!get('url') || !get('key')) return { skipped: 'not connected' };
    if (running) return { skipped: 'already running' };
    running = true;
    let sent = 0;
    try {
      for (let round = 0; round < 25; round++) { // up to 5,000 orders per run on the first upload
        const orders = pendingOrders();
        const { changed, deleted } = changedExpenses();
        const stockRows = db.prepare('SELECT id local_id, name, unit, stock, low_level, cost FROM ingredients ORDER BY id').all();
        const stockChanged = get('stock_hash') !== hash(stockRows);
        const shifts = db.prepare(`SELECT id local_id, opened_at, closed_at, opened_by, closed_by, opening_cash, expected_cash, closing_cash, difference, notes
          FROM register_sessions WHERE status='closed' AND id NOT IN (SELECT local_id FROM sync_log WHERE tbl='shifts')`).all();
        if (!orders.length && !changed.length && !deleted.length && !stockChanged && !shifts.length) break;

        await call('/api/sync/push', {
          orders, shifts, deleted_expenses: deleted, stock: stockChanged ? stockRows : undefined,
          expenses: changed.map(e => ({ local_id: e.id, date: e.date, title: e.title, category: e.category, amount: e.amount })),
        });
        db.exec('BEGIN');
        orders.forEach(o => mark('orders', o.local_id));
        shifts.forEach(s => mark('shifts', s.local_id));
        changed.forEach(e => mark('expenses', e.id, hash(e)));
        deleted.forEach(id => db.prepare("DELETE FROM sync_log WHERE tbl='expenses' AND local_id=?").run(id));
        db.exec('COMMIT');
        if (stockChanged) set('stock_hash', hash(stockRows));
        sent += orders.length;
      }
      set('last_sync', new Date().toISOString()); set('last_error', '');
      if (Date.now() - Date.parse(get('last_backup') || 0) > BACKUP_EVERY_MS) await backupNow();
      return { ok: true, orders: sent };
    } catch (e) {
      set('last_error', e.message);
      return { error: e.message };
    } finally { running = false; }
  }

  // VACUUM INTO writes a clean, consistent copy of the live database
  async function backupNow() {
    const file = path.join(os.tmpdir(), `hazelpos-backup-${process.pid}-${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      await call('/api/sync/backup', fs.readFileSync(file), true);
      set('last_backup', new Date().toISOString());
      return { ok: true };
    } finally { fs.rmSync(file, { force: true }); }
  }

  async function connect(url, key) {
    const old = { url: get('url'), key: get('key') };
    set('url', url); set('key', key);
    try {
      const hello = await call('/api/sync/hello');
      if (old.url !== url || old.key !== key) { db.exec('DELETE FROM sync_log'); set('stock_hash', ''); set('last_backup', ''); } // new cloud: send everything
      set('branch', hello.branch); set('last_error', '');
      syncNow();
      return hello;
    } catch (e) { set('url', old.url); set('key', old.key); throw e; }
  }

  function status() {
    return {
      connected: !!(get('url') && get('key')), url: get('url'), branch: get('branch'),
      last_sync: get('last_sync'), last_backup: get('last_backup'), last_error: get('last_error'), running,
      pending_orders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE status IN ('paid','cancelled','refunded')
        AND id NOT IN (SELECT local_id FROM sync_log WHERE tbl='orders')`).get().c,
    };
  }
  const disconnect = () => { set('url', ''); set('key', ''); set('branch', ''); };

  setInterval(syncNow, 60 * 1000).unref();
  setTimeout(syncNow, 5000).unref();
  return { syncNow, backupNow, connect, disconnect, status };
};
