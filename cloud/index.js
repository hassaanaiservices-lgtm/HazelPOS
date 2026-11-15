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
CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY, branch_id INTEGER, at TEXT, day TEXT, kind TEXT, ok INTEGER,
  tokens_in INTEGER, tokens_cached INTEGER, tokens_out INTEGER, audio_seconds REAL, ms INTEGER);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage (branch_id, day);
`);
// Memberships (you, the vendor, sell HazelPOS monthly): paid_until per owner account; suspended = switched off by hand
for (const sql of [
  'ALTER TABLE owners ADD COLUMN paid_until TEXT',
  'ALTER TABLE owners ADD COLUMN suspended INTEGER DEFAULT 0',
  'ALTER TABLE owners ADD COLUMN plan TEXT',
  'ALTER TABLE owners ADD COLUMN phone TEXT',
  'ALTER TABLE owners ADD COLUMN notes TEXT',
  // Unpaid rules per client (empty = the defaults): days after paid_until before the WhatsApp bot stops / the POS stops
  'ALTER TABLE owners ADD COLUMN wa_grace_days INTEGER',
  'ALTER TABLE owners ADD COLUMN pos_grace_days INTEGER',
  'ALTER TABLE owners ADD COLUMN cancelled_at TEXT',
  // Updates to a few clients first: test clients install every new version; everyone else up to release_version
  'ALTER TABLE owners ADD COLUMN early_updates INTEGER DEFAULT 0',
  // Activation code (HZ-XXXX-XXXX): one use, swapped for the branch key by the installed app
  'ALTER TABLE branches ADD COLUMN code_hash TEXT',
  'ALTER TABLE branches ADD COLUMN code_created_at TEXT',
  'ALTER TABLE branches ADD COLUMN code_used_at TEXT',
  // Latest health report from the branch's POS (version, WhatsApp, errors): server/index.js health()
  'ALTER TABLE branches ADD COLUMN health TEXT',
  'ALTER TABLE branches ADD COLUMN health_at TEXT',
  // Refunds reach the cloud too (cloud-sync.js re-sends an order when its status changes)
  'ALTER TABLE c_orders ADD COLUMN refunded_at TEXT',
  'ALTER TABLE c_orders ADD COLUMN refunded_by TEXT',
  'ALTER TABLE c_orders ADD COLUMN refund_reason TEXT',
]) { try { db.exec(sql); } catch { /* already there */ } }
// The restaurant's setup you prepare before they install (server/setup.js applies it): one per branch
db.exec(`
CREATE TABLE IF NOT EXISTS vendor_settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS setups (branch_id INTEGER PRIMARY KEY, data TEXT, updated_at TEXT, applied_at TEXT, applied TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS setup_images (id INTEGER PRIMARY KEY, branch_id INTEGER, caption TEXT, mime TEXT, data BLOB, sort INTEGER);
CREATE TABLE IF NOT EXISTS branch_errors (id INTEGER PRIMARY KEY, branch_id INTEGER, at TEXT, text TEXT, UNIQUE (branch_id, at, text));
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
app.use('/api/ai/transcribe', express.raw({ type: '*/*', limit: '25mb' })); // WhatsApp voice notes are small
app.use(express.json({ limit: '10mb' }));

// ---------- Owner accounts ----------
const fails = new Map(); // ip -> { n, until }
app.post('/api/owner/signup', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pass = String(req.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (pass.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  // On your vendor cloud, you create the restaurants' accounts (admin app), so open signup is off unless ALLOW_SIGNUP=1
  if (process.env.ALLOW_SIGNUP === '0' || (process.env.VENDOR_API_KEY && process.env.ALLOW_SIGNUP !== '1')) return res.status(403).json({ error: 'Signups are closed on this server' });
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
    ...(r => ({ refunds: r.c, refunded: r.s }))(db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM c_orders WHERE branch_id=? AND status='refunded'
      AND substr(COALESCE(refunded_at, paid_at),1,10) BETWEEN ? AND ?`).get(b.id, from, to)),
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
    refunds: db.prepare(`SELECT local_id, total, payment_method, user_name, refunded_at, refunded_by, refund_reason FROM c_orders WHERE branch_id=? AND status='refunded'
      AND substr(COALESCE(refunded_at, paid_at),1,10) BETWEEN ? AND ? ORDER BY refunded_at DESC LIMIT 50`).all(b.id, from, to),
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
// The installed POS asks this every few hours (server/licence.js) and keeps the last answer for offline days
app.get('/api/licence', branchAuth, (req, res) => {
  const st = db.prepare('SELECT updated_at, applied_at FROM setups WHERE branch_id=?').get(req.branch.id);
  const vs = k => db.prepare('SELECT value FROM vendor_settings WHERE key=?').get(k)?.value || null;
  const early = !!db.prepare('SELECT early_updates FROM owners WHERE id=?').get(req.branch.owner_id)?.early_updates;
  res.json({ ...membership(req.branch.owner_id), branch: req.branch.name, server_time: now(), setup_ready: !!st && !st.applied_at,
    update_requested_at: vs('update_requested_at'), update_policy: { early, release_version: vs('release_version') } });
});

// ---------- Activation code + setup download (the installed app, right after activation) ----------
// The code is one use: it's swapped for a NEW branch key, so an old install on another PC stops working.
app.post('/api/activate', (req, res) => {
  const f = fails.get('a:' + req.ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Too many wrong codes. Try again in 15 minutes' });
  const code = String(req.body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const b = code && db.prepare('SELECT * FROM branches WHERE code_hash=? AND code_used_at IS NULL').get(sha(code));
  if (!b) { f.n++; if (f.n >= 10) { f.n = 0; f.until = Date.now() + 15 * 60 * 1000; } fails.set('a:' + req.ip, f); return res.status(400).json({ error: 'That activation code is wrong or was already used. Ask HazelPOS for a new one' }); }
  fails.delete('a:' + req.ip);
  if (!membership(b.owner_id).pos_active) return res.status(402).json({ error: 'The HazelPOS membership for this restaurant is not active. Contact HazelPOS' });
  const key = 'hz_' + crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE branches SET key_hash=?, code_used_at=?, last_ip=? WHERE id=?').run(sha(key), now(), req.ip, b.id);
  res.json({ key, branch: b.name });
});
app.get('/api/setup', branchAuth, (req, res) => {
  const st = db.prepare('SELECT * FROM setups WHERE branch_id=?').get(req.branch.id);
  if (!st) return res.json({ setup: null });
  const images = db.prepare('SELECT caption, mime, data FROM setup_images WHERE branch_id=? ORDER BY sort, id').all(req.branch.id)
    .map(i => ({ caption: i.caption, mime: i.mime, data: Buffer.from(i.data).toString('base64') }));
  res.json({ setup: { ...JSON.parse(st.data || '{}'), images }, updated_at: st.updated_at });
});
// The POS applied it (or couldn't). Staff PINs are removed from the cloud copy once they're on the PC.
app.post('/api/setup/applied', branchAuth, (req, res) => {
  const st = db.prepare('SELECT * FROM setups WHERE branch_id=?').get(req.branch.id);
  if (!st) return res.json({ ok: true });
  if (req.body.error) { db.prepare('UPDATE setups SET error=? WHERE branch_id=?').run(String(req.body.error).slice(0, 500), req.branch.id); return res.json({ ok: true }); }
  const data = JSON.parse(st.data || '{}');
  if (Array.isArray(data.staff)) data.staff = data.staff.map(({ pin, ...u }) => ({ ...u, pin_applied: true }));
  db.prepare('UPDATE setups SET applied_at=?, applied=?, error=NULL, data=? WHERE branch_id=?').run(now(), JSON.stringify(req.body.done || {}), JSON.stringify(data), req.branch.id);
  res.json({ ok: true });
});
// Health report every few hours (server/licence.js): kept for your admin app; errors are kept as a short history
app.post('/api/sync/health', branchAuth, (req, res) => {
  const { errors = [], ...h } = req.body || {};
  db.prepare('UPDATE branches SET health=?, health_at=? WHERE id=?').run(JSON.stringify(h).slice(0, 20000), now(), req.branch.id);
  const ins = db.prepare('INSERT OR IGNORE INTO branch_errors (branch_id, at, text) VALUES (?,?,?)');
  for (const e of errors.slice(-30)) ins.run(req.branch.id, String(e.at || now()), String(e.text || '').slice(0, 1000));
  db.prepare('DELETE FROM branch_errors WHERE branch_id=? AND id NOT IN (SELECT id FROM branch_errors WHERE branch_id=? ORDER BY at DESC LIMIT 200)').run(req.branch.id, req.branch.id);
  res.json({ ok: true });
});

// Upserts are keyed by (branch, local id), so re-sending the same batch is harmless
app.post('/api/sync/push', branchAuth, (req, res) => {
  const b = req.branch.id, { orders = [], expenses = [], deleted_expenses = [], stock, shifts = [] } = req.body;
  tx(() => {
    const up = db.prepare(`INSERT OR REPLACE INTO c_orders (branch_id,local_id,type,status,table_name,subtotal,discount,promo_amount,points_amount,tax,total,
      payment_method,created_at,paid_at,day,user_name,refunded_at,refunded_by,refund_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const o of orders) {
      up.run(b, o.local_id, o.type, o.status, o.table_name ?? null, o.subtotal || 0, o.discount || 0, o.promo_amount || 0, o.points_amount || 0,
        o.tax || 0, o.total || 0, o.payment_method ?? null, o.created_at, o.paid_at ?? null, o.day, o.user_name ?? '',
        o.refunded_at ?? null, o.refunded_by ?? null, o.refund_reason ?? null);
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
// The branch's newest backup, for a new PC or a restore (server/restore.js). 404 = none yet.
app.get('/api/sync/backup/latest', branchAuth, (req, res) => {
  const bk = db.prepare('SELECT * FROM backups WHERE branch_id=? ORDER BY id DESC LIMIT 1').get(req.branch.id);
  if (!bk || !fs.existsSync(path.join(DATA, 'backups', bk.file))) return res.status(404).json({ error: 'No backup of this branch yet' });
  res.set('X-Backup-At', bk.at).type('application/octet-stream').sendFile(path.join(DATA, 'backups', bk.file));
});
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

// ---------- Memberships ----------
// VENDOR_API_KEY set = this is your HazelPOS Cloud: memberships are enforced and your admin app (admin/) can manage it.
// Not set = someone runs their own cloud just for their branches: nothing is enforced.
const VENDOR_KEY = process.env.VENDOR_API_KEY || '';
const VENDOR = VENDOR_KEY.length >= 32;
if (VENDOR_KEY && !VENDOR) console.error('VENDOR_API_KEY is too short (32+ characters): vendor mode is OFF');
const today = () => new Date().toISOString().slice(0, 10);
// Unpaid: the WhatsApp bot stops WA_GRACE days after paid_until, the POS (new orders) POS_GRACE days after.
// Per client you can change both (owners.wa_grace_days / pos_grace_days), stop them now (suspended) or cancel.
// Internet doesn't matter: a POS that can't reach the cloud keeps working on its last answer.
const WA_GRACE = +process.env.WA_GRACE_DAYS || 3, POS_GRACE = +process.env.POS_GRACE_DAYS || 7;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function membership(ownerId) {
  if (!VENDOR) return { active: true, ai_active: true, pos_active: true, paid_until: null, suspended: false, cancelled: false };
  const o = db.prepare('SELECT paid_until, suspended, plan, wa_grace_days, pos_grace_days, cancelled_at FROM owners WHERE id=?').get(ownerId) || {};
  const wa = o.wa_grace_days ?? WA_GRACE, pos = o.pos_grace_days ?? POS_GRACE;
  const off = !!o.suspended || !!o.cancelled_at || !o.paid_until;
  const t = today();
  const ai_until = o.paid_until ? addDays(o.paid_until, wa) : null, pos_until = o.paid_until ? addDays(o.paid_until, pos) : null; // last working day
  return {
    active: !off && o.paid_until >= t, // paid up
    ai_active: !off && ai_until >= t, pos_active: !off && pos_until >= t,
    paid_until: o.paid_until || null, ai_until, pos_until, wa_grace_days: wa, pos_grace_days: pos,
    days_overdue: o.paid_until && o.paid_until < t ? Math.round((Date.parse(t) - Date.parse(o.paid_until)) / 864e5) : 0,
    suspended: !!o.suspended, cancelled: !!o.cancelled_at, cancelled_at: o.cancelled_at || null, plan: o.plan || null,
    defaults: { wa_grace_days: WA_GRACE, pos_grace_days: POS_GRACE },
  };
}

// ---------- Vendor API (you): used only by the admin app's server (admin/server.js), never by a browser ----------
// One long secret, VENDOR_API_KEY, shared by this cloud and the admin server. The admin app has its own login.
const keyMatches = k => k.length === VENDOR_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(VENDOR_KEY));
const vendorAuth = (req, res, next) => {
  const k = (req.get('authorization') || '').replace(/^Bearer /, '');
  if (!VENDOR || !keyMatches(k)) return res.status(401).json({ error: 'Not allowed' });
  next();
};
const addMonths = (from, n) => { const d = new Date(from + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
app.get('/api/vendor/owners', vendorAuth, (req, res) => {
  const month = today().slice(0, 7);
  res.json(db.prepare('SELECT id, email, name, phone, plan, notes, paid_until, suspended, created_at, wa_grace_days AS wa_grace_custom, pos_grace_days AS pos_grace_custom FROM owners ORDER BY id DESC').all().map(o => ({
    ...o, ...membership(o.id),
    branches: db.prepare('SELECT id, name, created_at, last_sync, last_ip, code_created_at, code_used_at, health, health_at FROM branches WHERE owner_id=? ORDER BY id').all(o.id).map(b => ({
      ...b, health: JSON.parse(b.health || 'null'),
      setup: setupSummary(b.id),
      errors_24h: db.prepare('SELECT COUNT(*) c FROM branch_errors WHERE branch_id=? AND at > ?').get(b.id, new Date(Date.now() - 864e5).toISOString()).c,
      ai: db.prepare(`SELECT COUNT(*) calls, COALESCE(SUM(tokens_in),0) tokens_in, COALESCE(SUM(tokens_cached),0) tokens_cached,
        COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(audio_seconds),0) audio_seconds, COALESCE(SUM(ok=0),0) failed
        FROM ai_usage WHERE branch_id=? AND substr(day,1,7)=?`).get(b.id, month),
    })),
  })));
});
app.post('/api/vendor/owners', vendorAuth, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pass = String(req.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (pass.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (db.prepare('SELECT 1 FROM owners WHERE email=?').get(email)) return res.status(400).json({ error: 'An account with this email already exists' });
  const paid = /^\d{4}-\d{2}-\d{2}$/.test(req.body.paid_until || '') ? req.body.paid_until : addMonths(today(), 1);
  const id = db.prepare('INSERT INTO owners (email,name,pass,created_at,phone,plan,notes,paid_until) VALUES (?,?,?,?,?,?,?,?)')
    .run(email, String(req.body.name || ''), hashPass(pass), now(), String(req.body.phone || ''), String(req.body.plan || ''), String(req.body.notes || ''), paid).lastInsertRowid;
  res.json({ id });
});
const vendorOwner = (req, res) => {
  const o = db.prepare('SELECT * FROM owners WHERE id=?').get(req.params.id);
  if (!o) res.status(404).json({ error: 'Restaurant not found' });
  return o;
};
app.post('/api/vendor/owners/:id', vendorAuth, (req, res) => {
  const o = vendorOwner(req, res); if (!o) return;
  const b = req.body || {};
  if (b.paid_until !== undefined && b.paid_until !== null && !/^\d{4}-\d{2}-\d{2}$/.test(b.paid_until)) return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
  // Grace days: a number 0–365, or null = back to the default
  const grace = (v, cur) => v === undefined ? cur : v === null || v === '' ? null : Math.max(0, Math.min(365, Math.round(+v)));
  if ([b.wa_grace_days, b.pos_grace_days].some(v => v != null && v !== '' && !Number.isFinite(+v))) return res.status(400).json({ error: 'Days must be a number' });
  db.prepare('UPDATE owners SET name=?, phone=?, plan=?, notes=?, paid_until=?, suspended=?, wa_grace_days=?, pos_grace_days=?, cancelled_at=? WHERE id=?').run(
    b.name ?? o.name, b.phone ?? o.phone, b.plan ?? o.plan, b.notes ?? o.notes,
    b.paid_until === undefined ? o.paid_until : b.paid_until, b.suspended === undefined ? o.suspended : (b.suspended ? 1 : 0),
    grace(b.wa_grace_days, o.wa_grace_days), grace(b.pos_grace_days, o.pos_grace_days),
    b.cancelled === undefined ? o.cancelled_at : b.cancelled ? (o.cancelled_at || now()) : null, o.id);
  res.json({ ok: true, ...membership(o.id) });
});
// Payment received: add months from the later of today and the current paid-until date
app.post('/api/vendor/owners/:id/extend', vendorAuth, (req, res) => {
  const o = vendorOwner(req, res); if (!o) return;
  const months = Math.max(1, Math.min(24, +req.body.months || 1));
  const from = o.paid_until && o.paid_until > today() ? o.paid_until : today();
  db.prepare('UPDATE owners SET paid_until=? WHERE id=?').run(addMonths(from, months), o.id);
  res.json({ ok: true, ...membership(o.id) });
});
// A new branch comes with its activation code (shown once). The branch key itself is made when the code is used.
app.post('/api/vendor/owners/:id/branches', vendorAuth, (req, res) => {
  const o = vendorOwner(req, res); if (!o) return;
  const name = String(req.body.name || '').trim() || 'Main branch';
  const code = newCode();
  const id = db.prepare('INSERT INTO branches (owner_id,name,key_hash,created_at,code_hash,code_created_at) VALUES (?,?,?,?,?,?)')
    .run(o.id, name, sha(crypto.randomBytes(24).toString('hex')), now(), codeHash(code), now()).lastInsertRowid;
  res.json({ id, name, code });
});
app.get('/api/vendor/menu-template', vendorAuth, (req, res) => menuImport ? res.json(menuImport.TEMPLATE) : res.status(503).json({ error: 'Menu upload is off on this server' }));
app.post('/api/vendor/branches/:id/rekey', vendorAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM branches WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Branch not found' });
  const key = 'hz_' + crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE branches SET key_hash=? WHERE id=?').run(sha(key), b.id);
  res.json({ id: b.id, name: b.name, key });
});

// ---------- Vendor: a branch's setup (prepared before the restaurant installs; server/setup.js applies it) ----------
let menuImport = null; // the same reader the POS uses; needs the whole repo deployed (cloud/README.md → Railway)
try { menuImport = require('../server/menu-import'); } catch { /* cloud deployed alone: menu upload is off */ }
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: read out on the phone without mistakes
const newCode = () => { const c = Array.from(crypto.randomBytes(8), x => CODE_CHARS[x % CODE_CHARS.length]).join(''); return `HZ-${c.slice(0, 4)}-${c.slice(4)}`; };
const codeHash = code => sha(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
const getSetup = id => { const st = db.prepare('SELECT * FROM setups WHERE branch_id=?').get(id); return { st, data: JSON.parse(st?.data || '{}') }; };
function saveSetup(id, data) {
  db.prepare(`INSERT INTO setups (branch_id, data, updated_at) VALUES (?,?,?)
    ON CONFLICT(branch_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, applied_at=NULL, error=NULL`).run(id, JSON.stringify(data), now());
}
function setupSummary(id) {
  const { st, data } = getSetup(id);
  return {
    restaurant: !!data.restaurant?.name, logo: !!data.restaurant?.logo_image, floors: (data.floors || []).length, menu: (data.menu || []).length, tables: (data.tables || []).length, zones: (data.zones || []).length,
    staff: (data.staff || []).length, images: db.prepare('SELECT COUNT(*) c FROM setup_images WHERE branch_id=?').get(id).c,
    updated_at: st?.updated_at || null, applied_at: st?.applied_at || null, error: st?.error || null,
  };
}
const vendorBranch = (req, res) => {
  const b = db.prepare('SELECT * FROM branches WHERE id=?').get(req.params.id);
  if (!b) res.status(404).json({ error: 'Branch not found' });
  return b;
};
app.get('/api/vendor/branches/:id/setup', vendorAuth, (req, res) => {
  const b = vendorBranch(req, res); if (!b) return;
  const { st, data } = getSetup(b.id);
  res.json({
    owner: db.prepare("SELECT id, COALESCE(NULLIF(name,''), email) name FROM owners WHERE id=?").get(b.owner_id),
    branch: { id: b.id, name: b.name, code_created_at: b.code_created_at, code_used_at: b.code_used_at, last_sync: b.last_sync, health: JSON.parse(b.health || 'null'), health_at: b.health_at },
    setup: data, summary: setupSummary(b.id), applied: JSON.parse(st?.applied || 'null'), menu_upload: !!menuImport,
    images: db.prepare('SELECT id, caption, length(data) size FROM setup_images WHERE branch_id=? ORDER BY sort, id').all(b.id),
    errors: db.prepare('SELECT at, text FROM branch_errors WHERE branch_id=? ORDER BY at DESC LIMIT 50').all(b.id),
  });
});
// Restaurant details, tables, delivery areas, staff (any of them). Saving again re-sends the setup to a POS that has
// no orders yet; a POS that already has orders keeps its own data.
app.post('/api/vendor/branches/:id/setup', vendorAuth, (req, res) => {
  const b = vendorBranch(req, res); if (!b) return;
  const { data } = getSetup(b.id), body = req.body || {};
  if (body.restaurant) {
    const { logo_image, ...rest } = body.restaurant;
    data.restaurant = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v ?? '').slice(0, 300)]));
    if (logo_image && !/^data:image\/(png|jpeg|webp);base64,/.test(logo_image)) return res.status(400).json({ error: 'The logo must be a PNG, JPG or WebP picture' });
    if (String(logo_image || '').length > 400 * 1024) return res.status(400).json({ error: 'The logo picture is too large (max 300 KB)' });
    if (logo_image) data.restaurant.logo_image = logo_image;
  }
  // The whole setup menu (the admin app's deal editor sends it back with deals added, changed or removed)
  if (Array.isArray(body.menu)) {
    const clean = body.menu.slice(0, 2000).map(i => ({
      category: String(i.category || '').trim() || 'Menu', name: String(i.name || '').trim(), price: Math.max(0, +i.price || 0),
      sizes: Array.isArray(i.sizes) ? i.sizes.map(z => ({ name: String(z.name || '').trim(), detail: String(z.detail || ''), price: +z.price || 0 })).filter(z => z.name) : [],
      description: String(i.description || ''), emoji: String(i.emoji || ''), active: i.active !== false,
      deal: Array.isArray(i.deal) ? i.deal.map(d => ({ name: String(d.name || '').trim(), size: String(d.size || ''), qty: Math.max(1, +d.qty || 1) })).filter(d => d.name) : [],
      combo_for: String(i.combo_for || '').trim(),
    })).filter(i => i.name);
    if (new Set(clean.map(i => i.name.toLowerCase())).size !== clean.length) return res.status(400).json({ error: 'Two items on the menu have the same name' });
    const problems = menuImport ? menuImport.checkDeals(clean) : [];
    if (problems.length) return res.status(400).json({ error: problems.map(p => p.error).join('; ') });
    data.menu = clean;
  }
  if (Array.isArray(body.floors)) data.floors = [...new Set(body.floors.map(f => String(f.name ?? f).trim()).filter(Boolean))].slice(0, 30).map(name => ({ name }));
  if (Array.isArray(body.tables)) data.tables = body.tables.slice(0, 300).map(t => ({ name: String(t.name || '').trim(), seats: +t.seats || 4, floor: String(t.floor || '').trim() })).filter(t => t.name);
  if (Array.isArray(body.zones)) data.zones = body.zones.slice(0, 200).map(z => ({ name: String(z.name || '').trim(), fee: +z.fee || 0, min_order: +z.min_order || 0, free_above: +z.free_above || 0, eta_min: +z.eta_min || 45 })).filter(z => z.name);
  if (Array.isArray(body.staff)) {
    const staff = body.staff.map(u => ({ name: String(u.name || '').trim(), role: u.role, pin: String(u.pin || '').trim() })).filter(u => u.name);
    if (staff.some(u => !['admin', 'cashier', 'kitchen'].includes(u.role))) return res.status(400).json({ error: 'Role must be admin, cashier or kitchen' });
    if (staff.some(u => !/^\d{4}$/.test(u.pin))) return res.status(400).json({ error: 'Every PIN must be exactly 4 digits (the POS login pad takes 4)' });
    if (new Set(staff.map(u => u.pin)).size !== staff.length) return res.status(400).json({ error: 'Two people have the same PIN' });
    if (staff.length && !staff.some(u => u.role === 'admin')) return res.status(400).json({ error: 'Add at least one admin (the owner), or they cannot open Settings' });
    data.staff = staff;
  }
  saveSetup(b.id, data);
  res.json({ ok: true, summary: setupSummary(b.id) });
});
// Menu from Excel/CSV: same reader as the POS. Dry run unless apply:true; rows with errors block it.
app.post('/api/vendor/branches/:id/setup/menu', vendorAuth, (req, res) => {
  const b = vendorBranch(req, res); if (!b) return;
  if (!menuImport) return res.status(503).json({ error: 'Menu upload needs the whole HazelPOS repo deployed (see cloud/README.md)' });
  let menu;
  try { menu = menuImport.toMenu(menuImport.readSheet(Buffer.from(String(req.body.file || ''), 'base64'), String(req.body.name || ''))); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const categories = [...new Set(menu.items.map(i => i.category))];
  menu.errors.push(...menuImport.checkDeals(menu.items)); // deal items must be on this menu
  const apply = !!req.body.apply && !menu.errors.length && menu.items.length > 0;
  if (apply) { const { data } = getSetup(b.id); data.menu = menu.items; saveSetup(b.id, data); }
  res.json({ applied: apply, items: menu.items.length, categories, errors: menu.errors, sample: menu.items.slice(0, 8) });
});
app.post('/api/vendor/branches/:id/setup/images', vendorAuth, (req, res) => {
  const b = vendorBranch(req, res); if (!b) return;
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(req.body.data || ''));
  if (!m) return res.status(400).json({ error: 'Choose a JPG, PNG or WebP picture' });
  const data = Buffer.from(m[3], 'base64');
  if (data.length > 1.5 * 1024 * 1024) return res.status(400).json({ error: 'That picture is too large (max 1.5 MB)' });
  if (db.prepare('SELECT COUNT(*) c FROM setup_images WHERE branch_id=?').get(b.id).c >= 6) return res.status(400).json({ error: 'Up to 6 menu pictures' });
  const sort = (db.prepare('SELECT MAX(sort) s FROM setup_images WHERE branch_id=?').get(b.id).s ?? 0) + 1;
  db.prepare('INSERT INTO setup_images (branch_id, caption, mime, data, sort) VALUES (?,?,?,?,?)').run(b.id, String(req.body.caption || '').slice(0, 200), m[1], data, sort);
  const { data: d } = getSetup(b.id); saveSetup(b.id, d); // re-send to a POS without orders
  res.json({ ok: true });
});
app.post('/api/vendor/setup-images/:id/delete', vendorAuth, (req, res) => {
  const im = db.prepare('SELECT branch_id FROM setup_images WHERE id=?').get(req.params.id);
  if (im) { db.prepare('DELETE FROM setup_images WHERE id=?').run(req.params.id); const { data } = getSetup(im.branch_id); saveSetup(im.branch_id, data); }
  res.json({ ok: true });
});
app.get('/api/vendor/setup-images/:id', vendorAuth, (req, res) => {
  const im = db.prepare('SELECT mime, data FROM setup_images WHERE id=?').get(req.params.id);
  im ? res.type(im.mime).send(Buffer.from(im.data)) : res.status(404).end();
});
// AI usage for a month, per branch and per day, with an estimated cost in USD (prices: rag/config/rag.config.json,
// DeepSeek peak prices so the estimate errs high; Groq Whisper per audio hour). Override with AI_PRICES env (JSON).
const PRICES = { input_miss: 0.3, input_hit: 0.006, output: 1.2, whisper_hour: 0.111, ...JSON.parse(process.env.AI_PRICES || '{}') };
const aiCost = u => ((u.tokens_in - u.tokens_cached) * PRICES.input_miss + u.tokens_cached * PRICES.input_hit + u.tokens_out * PRICES.output) / 1e6
  + (u.audio_seconds / 3600) * PRICES.whisper_hour;
app.get('/api/vendor/usage', vendorAuth, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  const SUM = `COUNT(*) calls, COALESCE(SUM(kind='voice'),0) voice_notes, COALESCE(SUM(tokens_in),0) tokens_in, COALESCE(SUM(tokens_cached),0) tokens_cached,
    COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(audio_seconds),0) audio_seconds, COALESCE(SUM(ok=0),0) failed`;
  const branches = db.prepare(`SELECT b.id, b.name, o.id owner_id, COALESCE(NULLIF(o.name,''), o.email) owner, o.plan FROM branches b JOIN owners o ON o.id=b.owner_id ORDER BY o.id, b.id`).all()
    .map(b => { const u = db.prepare(`SELECT ${SUM} FROM ai_usage WHERE branch_id=? AND substr(day,1,7)=?`).get(b.id, month); return { ...b, ...u, cost_usd: +aiCost(u).toFixed(4) }; });
  const days = db.prepare(`SELECT day, ${SUM} FROM ai_usage WHERE substr(day,1,7)=? GROUP BY day ORDER BY day`).all(month).map(d => ({ ...d, cost_usd: +aiCost(d).toFixed(4) }));
  const months = db.prepare(`SELECT DISTINCT substr(day,1,7) m FROM ai_usage ORDER BY m DESC LIMIT 24`).all().map(r => r.m);
  res.json({ month, months: months.includes(month) ? months : [month, ...months], prices: PRICES, branches, days });
});

// Versions across all branches (from their health reports), and "ask all clients to update": their apps check for
// the update at their next licence check (within 3 hours) and install it at night with no open orders.
app.get('/api/vendor/updates', vendorAuth, (req, res) => {
  const branches = db.prepare(`SELECT b.id, b.name, b.health, b.health_at, o.id owner_id, o.early_updates, COALESCE(NULLIF(o.name,''), o.email) owner FROM branches b JOIN owners o ON o.id=b.owner_id ORDER BY o.id, b.id`).all()
    .map(b => { const h = JSON.parse(b.health || 'null'); return { id: b.id, name: b.name, owner: b.owner, owner_id: b.owner_id, early: !!b.early_updates, version: h?.version || null, update: h?.update || null, health_at: b.health_at }; });
  const vs = k => db.prepare('SELECT value FROM vendor_settings WHERE key=?').get(k)?.value || null;
  res.json({ branches, requested_at: vs('update_requested_at'), release_version: vs('release_version') });
});
// Test clients (early_updates) get every new version; the others install only up to release_version
app.post('/api/vendor/owners/:id/early', vendorAuth, (req, res) => {
  const o = vendorOwner(req, res); if (!o) return;
  db.prepare('UPDATE owners SET early_updates=? WHERE id=?').run(req.body.early ? 1 : 0, o.id);
  res.json({ ok: true });
});
app.post('/api/vendor/updates/release', vendorAuth, (req, res) => {
  const v = String(req.body.version || '').trim();
  if (v && !/^\d+\.\d+\.\d+$/.test(v)) return res.status(400).json({ error: 'Version like 1.2.0' });
  db.prepare("INSERT INTO vendor_settings (key,value) VALUES ('release_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(v);
  res.json({ ok: true, release_version: v || null });
});
app.post('/api/vendor/updates/request', vendorAuth, (req, res) => {
  db.prepare("INSERT INTO vendor_settings (key,value) VALUES ('update_requested_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(now());
  res.json({ ok: true });
});

// A new activation code: shown once. Using it on a PC swaps it for a new key, so any older install stops.
app.post('/api/vendor/branches/:id/code', vendorAuth, (req, res) => {
  const b = vendorBranch(req, res); if (!b) return;
  const code = newCode();
  db.prepare('UPDATE branches SET code_hash=?, code_created_at=?, code_used_at=NULL WHERE id=?').run(codeHash(code), now(), b.id);
  res.json({ code, branch: b.name });
});

// ---------- AI proxy (Authorization: Bearer <branch key>) ----------
// Restaurants' installed apps have no AI keys. Their WhatsApp assistant (DeepSeek) and voice notes (Groq) come through
// here: your keys stay on this server, every call is counted per branch, and an unpaid membership switches AI off.
const AI_DAILY_LIMIT = +process.env.AI_DAILY_LIMIT || 3000; // calls per branch per day: a runaway loop can't empty your account
const aiAuth = (req, res, next) => {
  if (!VENDOR) return res.status(503).json({ error: 'The AI proxy only runs on the vendor cloud (VENDOR_API_KEY set)' }); // else anyone who signs up uses your keys
  const key = (req.get('authorization') || '').replace(/^Bearer /, '');
  const b = key && db.prepare('SELECT * FROM branches WHERE key_hash=?').get(sha(key));
  if (!b) return res.status(401).json({ error: 'Unknown branch key' });
  if (!membership(b.owner_id).ai_active) return res.status(402).json({ error: 'HazelPOS membership is not paid: the WhatsApp assistant is paused until it is renewed' });
  const used = db.prepare('SELECT COUNT(*) c FROM ai_usage WHERE branch_id=? AND day=?').get(b.id, today()).c;
  if (used >= AI_DAILY_LIMIT) return res.status(403).json({ error: `Daily AI limit reached (${AI_DAILY_LIMIT} calls). It resets tomorrow` });
  req.branch = b;
  next();
};
const logAi = (b, kind, ok, t0, u = {}) => db.prepare(`INSERT INTO ai_usage (branch_id,at,day,kind,ok,tokens_in,tokens_cached,tokens_out,audio_seconds,ms)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.id, now(), today(), kind, ok ? 1 : 0, u.in ?? null, u.cached ?? null, u.out ?? null, u.seconds ?? null, Date.now() - t0);

app.post('/api/ai/chat', aiAuth, async (req, res) => {
  if (!process.env.DEEPSEEK_API_KEY) return res.status(503).json({ error: 'The cloud has no DeepSeek key yet' });
  const t0 = Date.now(), { model, messages, max_tokens, thinking, response_format } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages missing' });
  try {
    const r = await fetch((process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com') + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: Math.min(+max_tokens || 400, 1000), thinking, response_format }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await r.json().catch(() => ({}));
    const u = body.usage || {};
    logAi(req.branch, 'chat', r.ok, t0, { in: u.prompt_tokens, cached: u.prompt_cache_hit_tokens, out: u.completion_tokens });
    res.status(r.status).json(body);
  } catch (e) {
    logAi(req.branch, 'chat', false, t0);
    res.status(502).json({ error: 'DeepSeek did not answer: ' + e.message });
  }
});

app.post('/api/ai/transcribe', aiAuth, async (req, res) => {
  if (!process.env.GROQ_API_KEY) return res.status(503).json({ error: 'The cloud has no Groq key yet' });
  if (!req.body?.length) return res.status(400).json({ error: 'No audio' });
  const t0 = Date.now();
  const form = new FormData();
  form.append('file', new Blob([req.body], { type: req.get('content-type') || 'audio/ogg' }), path.basename(String(req.query.name || 'voice.ogg')));
  form.append('model', String(req.query.model || 'whisper-large-v3'));
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (req.query.language) form.append('language', String(req.query.language));
  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', body: form, headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY }, signal: AbortSignal.timeout(60_000),
    });
    const body = await r.json().catch(() => ({}));
    logAi(req.branch, 'voice', r.ok, t0, { seconds: body.duration });
    res.status(r.status).json(body);
  } catch (e) {
    logAi(req.branch, 'voice', false, t0);
    res.status(502).json({ error: 'Groq did not answer: ' + e.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4200;
app.listen(PORT, '0.0.0.0', () => console.log(`HazelPOS Cloud running on http://localhost:${PORT}`));
