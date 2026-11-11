// HazelPOS Cloud: owners see every branch in one dashboard; branches push their data here and keep working offline.
// Each branch PC runs the normal POS on its LAN and syncs to this server whenever it has internet.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'cloud.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS owners (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, pass TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS owner_sessions (token TEXT PRIMARY KEY, owner_id INTEGER, created_at TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY, owner_id INTEGER, name TEXT, key_hash TEXT UNIQUE, created_at TEXT, last_sync TEXT, last_ip TEXT);
CREATE TABLE IF NOT EXISTS c_orders (branch_id INTEGER, local_id INTEGER, type TEXT, status TEXT, table_name TEXT, subtotal REAL, discount REAL,
  promo_amount REAL, points_amount REAL, tax REAL, total REAL, payment_method TEXT, created_at TEXT, paid_at TEXT, day TEXT, user_name TEXT,
  PRIMARY KEY (branch_id, local_id));
CREATE TABLE IF NOT EXISTS c_items (branch_id INTEGER, order_local_id INTEGER, name TEXT, qty INTEGER, price REAL);
CREATE INDEX IF NOT EXISTS c_items_order ON c_items (branch_id, order_local_id);
CREATE INDEX IF NOT EXISTS c_orders_day ON c_orders (branch_id, day);
CREATE TABLE IF NOT EXISTS c_expenses (branch_id INTEGER, local_id INTEGER, date TEXT, title TEXT, category TEXT, amount REAL, PRIMARY KEY (branch_id, local_id));
CREATE TABLE IF NOT EXISTS c_stock (branch_id INTEGER, local_id INTEGER, name TEXT, unit TEXT, stock REAL, low_level REAL, cost REAL, PRIMARY KEY (branch_id, local_id));
CREATE TABLE IF NOT EXISTS c_shifts (branch_id INTEGER, local_id INTEGER, opened_at TEXT, closed_at TEXT, opened_by TEXT, closed_by TEXT,
  opening_cash REAL, expected_cash REAL, closing_cash REAL, difference REAL, notes TEXT, PRIMARY KEY (branch_id, local_id));
CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY, branch_id INTEGER, at TEXT, size INTEGER, file TEXT);
`);

const now = () => new Date().toISOString();
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const hashPass = p => { const salt = crypto.randomBytes(16).toString('hex'); return `s1$${salt}$${crypto.scryptSync(p, salt, 32).toString('hex')}`; };
const passMatches = (p, stored) => {
  const [v, salt, hash] = String(stored).split('$');
  return v === 's1' && crypto.timingSafeEqual(crypto.scryptSync(String(p), salt, 32), Buffer.from(hash, 'hex'));
};
const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const KEEP_BACKUPS = 14;

const app = express();
app.use('/api/sync/backup', express.raw({ type: '*/*', limit: '500mb' }));
app.use(express.json({ limit: '10mb' }));

// ---------- Owner accounts ----------
const fails = new Map(); // ip -> { n, until }
app.post('/api/owner/signup', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pass = String(req.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (pass.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (process.env.ALLOW_SIGNUP === '0') return res.status(403).json({ error: 'Signups are closed on this server' });
  if (db.prepare('SELECT 1 FROM owners WHERE email=?').get(email)) return res.status(400).json({ error: 'An account with this email already exists' });
  const id = db.prepare('INSERT INTO owners (email,name,pass,created_at) VALUES (?,?,?,?)').run(email, String(req.body.name || ''), hashPass(pass), now()).lastInsertRowid;
  res.json(session(id));
});
app.post('/api/owner/login', (req, res) => {
  const f = fails.get(req.ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes' });
  const o = db.prepare('SELECT * FROM owners WHERE email=?').get(String(req.body.email || '').trim().toLowerCase());
  if (!o || !passMatches(req.body.password || '', o.pass)) {
    f.n++; if (f.n >= 8) { f.n = 0; f.until = Date.now() + 10 * 60 * 1000; }
    fails.set(req.ip, f);
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  fails.delete(req.ip);
  res.json(session(o.id));
});
function session(ownerId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO owner_sessions VALUES (?,?,?,?)').run(token, ownerId, now(), now());
  const o = db.prepare('SELECT id,email,name FROM owners WHERE id=?').get(ownerId);
  return { token, owner: o };
}
const ownerAuth = (req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const s = token && db.prepare('SELECT * FROM owner_sessions WHERE token=?').get(token);
  if (!s || Date.now() - Date.parse(s.last_seen) > 30 * 864e5) return res.status(401).json({ error: 'Please log in again' });
  db.prepare('UPDATE owner_sessions SET last_seen=? WHERE token=?').run(now(), token);
  req.owner = db.prepare('SELECT id,email,name FROM owners WHERE id=?').get(s.owner_id);
  req.token = token;
  next();
};
app.post('/api/owner/logout', ownerAuth, (req, res) => { db.prepare('DELETE FROM owner_sessions WHERE token=?').run(req.token); res.json({ ok: true }); });

// ---------- Branches ----------
const myBranch = (req, res) => {
  const b = db.prepare('SELECT * FROM branches WHERE id=? AND owner_id=?').get(req.params.id, req.owner.id);
  if (!b) res.status(404).json({ error: 'Branch not found' });
  return b;
};
// The sync key is shown once; only its hash is stored
app.post('/api/branches', ownerAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Enter the branch name' });
  const key = 'hz_' + crypto.randomBytes(24).toString('hex');
  const id = db.prepare('INSERT INTO branches (owner_id,name,key_hash,created_at) VALUES (?,?,?,?)').run(req.owner.id, name, sha(key), now()).lastInsertRowid;
  res.json({ id, name, key });
});
app.post('/api/branches/:id/rekey', ownerAuth, (req, res) => {
  const b = myBranch(req, res); if (!b) return;
  const key = 'hz_' + crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE branches SET key_hash=? WHERE id=?').run(sha(key), b.id);
  res.json({ id: b.id, name: b.name, key });
});
app.post('/api/branches/:id/rename', ownerAuth, (req, res) => {
  const b = myBranch(req, res); if (!b) return;
  db.prepare('UPDATE branches SET name=? WHERE id=?').run(String(req.body.name || b.name).trim(), b.id);
  res.json({ ok: true });
});

// ---------- Dashboard (owner) ----------
const range = req => [req.query.from || '0000-01-01', req.query.to || '9999-12-31'];
app.get('/api/dashboard', ownerAuth, (req, res) => {
  const [from, to] = range(req);
  const branches = db.prepare('SELECT id, name, created_at, last_sync FROM branches WHERE owner_id=? ORDER BY id').all(req.owner.id).map(b => ({
    ...b,
    ...db.prepare(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue, COALESCE(SUM(tax),0) tax, COALESCE(SUM(discount + promo_amount + points_amount),0) discounts
      FROM c_orders WHERE branch_id=? AND status='paid' AND day BETWEEN ? AND ?`).get(b.id, from, to),
    cancelled: db.prepare(`SELECT COUNT(*) c FROM c_orders WHERE branch_id=? AND status='cancelled' AND day BETWEEN ? AND ?`).get(b.id, from, to).c,
    expenses: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM c_expenses WHERE branch_id=? AND date BETWEEN ? AND ?').get(b.id, from, to).s,
    cash_difference: db.prepare(`SELECT COALESCE(SUM(difference),0) s FROM c_shifts WHERE branch_id=? AND substr(closed_at,1,10) BETWEEN ? AND ?`).get(b.id, from, to).s,
    low_stock: db.prepare('SELECT COUNT(*) c FROM c_stock WHERE branch_id=? AND stock <= low_level').get(b.id).c,
    last_backup: db.prepare('SELECT MAX(at) at FROM backups WHERE branch_id=?').get(b.id).at,
  }));
  const ids = branches.map(b => b.id);
  const inIds = `branch_id IN (${ids.map(() => '?').join(',') || 'NULL'})`;
  res.json({
    branches,
    byDay: db.prepare(`SELECT day, branch_id, SUM(total) revenue, COUNT(*) orders FROM c_orders
      WHERE ${inIds} AND status='paid' AND day BETWEEN ? AND ? GROUP BY day, branch_id ORDER BY day`).all(...ids, from, to),
    topItems: db.prepare(`SELECT i.name, SUM(i.qty) qty, SUM(i.qty * i.price) revenue FROM c_items i
      JOIN c_orders o ON o.branch_id = i.branch_id AND o.local_id = i.order_local_id
      WHERE o.${inIds} AND o.status='paid' AND o.day BETWEEN ? AND ? GROUP BY i.name ORDER BY qty DESC LIMIT 10`).all(...ids, from, to),
  });
});
app.get('/api/branches/:id', ownerAuth, (req, res) => {
  const b = myBranch(req, res); if (!b) return;
  const [from, to] = range(req);
  const W = `branch_id=? AND status='paid' AND day BETWEEN ? AND ?`;
  res.json({
    id: b.id, name: b.name, last_sync: b.last_sync,
    byMethod: db.prepare(`SELECT payment_method k, COUNT(*) orders, SUM(total) revenue FROM c_orders WHERE ${W} GROUP BY k`).all(b.id, from, to),
    byType: db.prepare(`SELECT type k, COUNT(*) orders, SUM(total) revenue FROM c_orders WHERE ${W} GROUP BY k`).all(b.id, from, to),
    byStaff: db.prepare(`SELECT user_name k, COUNT(*) orders, SUM(total) revenue FROM c_orders WHERE ${W} GROUP BY k ORDER BY revenue DESC`).all(b.id, from, to),
    topItems: db.prepare(`SELECT i.name, SUM(i.qty) qty, SUM(i.qty * i.price) revenue FROM c_items i
      JOIN c_orders o ON o.branch_id = i.branch_id AND o.local_id = i.order_local_id
      WHERE o.branch_id=? AND o.status='paid' AND o.day BETWEEN ? AND ? GROUP BY i.name ORDER BY qty DESC LIMIT 10`).all(b.id, from, to),
    shifts: db.prepare('SELECT * FROM c_shifts WHERE branch_id=? ORDER BY closed_at DESC LIMIT 15').all(b.id),
    lowStock: db.prepare('SELECT name, unit, stock, low_level FROM c_stock WHERE branch_id=? AND stock <= low_level ORDER BY name').all(b.id),
    expenses: db.prepare('SELECT category, SUM(amount) amount FROM c_expenses WHERE branch_id=? AND date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC').all(b.id, from, to),
    backups: db.prepare('SELECT id, at, size FROM backups WHERE branch_id=? ORDER BY id DESC').all(b.id),
  });
});
app.get('/api/backups/:id/download', ownerAuth, (req, res) => {
  const bk = db.prepare('SELECT k.* FROM backups k JOIN branches b ON b.id = k.branch_id WHERE k.id=? AND b.owner_id=?').get(req.params.id, req.owner.id);
  if (!bk) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(DATA, 'backups', bk.file), `pos-backup-${bk.at.slice(0, 10)}.db`);
});

// ---------- Branch sync (Authorization: Bearer <branch key>) ----------
const branchAuth = (req, res, next) => {
  const key = (req.get('authorization') || '').replace(/^Bearer /, '');
  req.branch = key && db.prepare('SELECT * FROM branches WHERE key_hash=?').get(sha(key));
  if (!req.branch) return res.status(401).json({ error: 'Unknown branch key' });
  db.prepare('UPDATE branches SET last_sync=?, last_ip=? WHERE id=?').run(now(), req.ip, req.branch.id);
  next();
};
app.get('/api/sync/hello', branchAuth, (req, res) => res.json({ branch: req.branch.name, id: req.branch.id }));

// Upserts are keyed by (branch, local id), so re-sending the same batch is harmless
app.post('/api/sync/push', branchAuth, (req, res) => {
  const b = req.branch.id, { orders = [], expenses = [], deleted_expenses = [], stock, shifts = [] } = req.body;
  tx(() => {
    const up = db.prepare(`INSERT OR REPLACE INTO c_orders (branch_id,local_id,type,status,table_name,subtotal,discount,promo_amount,points_amount,tax,total,
      payment_method,created_at,paid_at,day,user_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const o of orders) {
      up.run(b, o.local_id, o.type, o.status, o.table_name ?? null, o.subtotal || 0, o.discount || 0, o.promo_amount || 0, o.points_amount || 0,
        o.tax || 0, o.total || 0, o.payment_method ?? null, o.created_at, o.paid_at ?? null, o.day, o.user_name ?? '');
      db.prepare('DELETE FROM c_items WHERE branch_id=? AND order_local_id=?').run(b, o.local_id);
      for (const i of o.items || []) db.prepare('INSERT INTO c_items VALUES (?,?,?,?,?)').run(b, o.local_id, i.name, i.qty, i.price);
    }
    for (const e of expenses) db.prepare('INSERT OR REPLACE INTO c_expenses VALUES (?,?,?,?,?,?)').run(b, e.local_id, e.date, e.title, e.category, e.amount);
    for (const id of deleted_expenses) db.prepare('DELETE FROM c_expenses WHERE branch_id=? AND local_id=?').run(b, id);
    if (Array.isArray(stock)) { // full snapshot
      db.prepare('DELETE FROM c_stock WHERE branch_id=?').run(b);
      for (const s of stock) db.prepare('INSERT INTO c_stock VALUES (?,?,?,?,?,?,?)').run(b, s.local_id, s.name, s.unit, s.stock, s.low_level, s.cost);
    }
    for (const s of shifts) db.prepare('INSERT OR REPLACE INTO c_shifts VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(b, s.local_id, s.opened_at, s.closed_at, s.opened_by, s.closed_by, s.opening_cash, s.expected_cash, s.closing_cash, s.difference, s.notes ?? '');
  });
  res.json({ ok: true, received: { orders: orders.length, expenses: expenses.length, shifts: shifts.length } });
});

// Whole-database snapshot from the branch; the newest KEEP_BACKUPS are kept
app.post('/api/sync/backup', branchAuth, (req, res) => {
  if (!req.body?.length || req.body.subarray(0, 15).toString() !== 'SQLite format 3') return res.status(400).json({ error: 'Not a database file' });
  const file = `b${req.branch.id}-${Date.now()}.db`;
  fs.writeFileSync(path.join(DATA, 'backups', file), req.body);
  db.prepare('INSERT INTO backups (branch_id,at,size,file) VALUES (?,?,?,?)').run(req.branch.id, now(), req.body.length, file);
  for (const old of db.prepare('SELECT * FROM backups WHERE branch_id=? ORDER BY id DESC LIMIT -1 OFFSET ?').all(req.branch.id, KEEP_BACKUPS)) {
    fs.rmSync(path.join(DATA, 'backups', old.file), { force: true });
    db.prepare('DELETE FROM backups WHERE id=?').run(old.id);
  }
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4200;
app.listen(PORT, '0.0.0.0', () => console.log(`HazelPOS Cloud running on http://localhost:${PORT}`));
