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
]) { try { db.exec(sql); } catch { /* already there */ } }

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
  // On your vendor cloud, you create the restaurants' accounts (vendor page), so open signup is off unless ALLOW_SIGNUP=1
  if (process.env.ALLOW_SIGNUP === '0' || (process.env.VENDOR_PASSWORD && process.env.ALLOW_SIGNUP !== '1')) return res.status(403).json({ error: 'Signups are closed on this server' });
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
// The installed POS asks this every few hours (server/licence.js) and keeps the last answer for offline days
app.get('/api/licence', branchAuth, (req, res) => res.json({ ...membership(req.branch.owner_id), branch: req.branch.name, server_time: now() }));

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

// ---------- Memberships ----------
// VENDOR_PASSWORD set = this is your HazelPOS Cloud and memberships are enforced (see vendor routes below).
// Not set = someone runs their own cloud just for their branches: nothing is enforced.
const VENDOR = !!process.env.VENDOR_PASSWORD;
const today = () => new Date().toISOString().slice(0, 10);
function membership(ownerId) {
  if (!VENDOR) return { active: true, paid_until: null, suspended: false };
  const o = db.prepare('SELECT paid_until, suspended, plan FROM owners WHERE id=?').get(ownerId) || {};
  const active = !o.suspended && !!o.paid_until && o.paid_until >= today();
  return { active, paid_until: o.paid_until || null, suspended: !!o.suspended, plan: o.plan || null };
}

// ---------- Vendor (you): restaurants, memberships, AI usage — page: /vendor.html ----------
const vendorTokens = new Map(); // token -> created; in memory, so a restart means logging in again
const vendorAuth = (req, res, next) => {
  const t = (req.get('authorization') || '').replace(/^Bearer /, '');
  const at = VENDOR && vendorTokens.get(t);
  if (!at || Date.now() - at > 7 * 864e5) return res.status(401).json({ error: 'Please log in again' });
  next();
};
app.post('/api/vendor/login', (req, res) => {
  if (!VENDOR) return res.status(404).json({ error: 'Vendor mode is off on this server' });
  const f = fails.get('v:' + req.ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes' });
  const ok = crypto.timingSafeEqual(Buffer.from(sha(req.body.password || '')), Buffer.from(sha(process.env.VENDOR_PASSWORD)));
  if (!ok) { f.n++; if (f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60 * 1000; } fails.set('v:' + req.ip, f); return res.status(401).json({ error: 'Wrong password' }); }
  fails.delete('v:' + req.ip);
  const token = crypto.randomBytes(32).toString('hex');
  vendorTokens.set(token, Date.now());
  res.json({ token });
});
const addMonths = (from, n) => { const d = new Date(from + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
app.get('/api/vendor/owners', vendorAuth, (req, res) => {
  const month = today().slice(0, 7);
  res.json(db.prepare('SELECT id, email, name, phone, plan, notes, paid_until, suspended, created_at FROM owners ORDER BY id DESC').all().map(o => ({
    ...o, ...membership(o.id),
    branches: db.prepare('SELECT id, name, created_at, last_sync, last_ip FROM branches WHERE owner_id=? ORDER BY id').all(o.id).map(b => ({
      ...b,
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
  db.prepare('UPDATE owners SET name=?, phone=?, plan=?, notes=?, paid_until=?, suspended=? WHERE id=?').run(
    b.name ?? o.name, b.phone ?? o.phone, b.plan ?? o.plan, b.notes ?? o.notes,
    b.paid_until === undefined ? o.paid_until : b.paid_until, b.suspended === undefined ? o.suspended : (b.suspended ? 1 : 0), o.id);
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
// The branch key goes into the restaurant's activation screen. Shown once; only its hash is kept.
app.post('/api/vendor/owners/:id/branches', vendorAuth, (req, res) => {
  const o = vendorOwner(req, res); if (!o) return;
  const name = String(req.body.name || '').trim() || 'Main branch';
  const key = 'hz_' + crypto.randomBytes(24).toString('hex');
  const id = db.prepare('INSERT INTO branches (owner_id,name,key_hash,created_at) VALUES (?,?,?,?)').run(o.id, name, sha(key), now()).lastInsertRowid;
  res.json({ id, name, key });
});
app.post('/api/vendor/branches/:id/rekey', vendorAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM branches WHERE id=?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Branch not found' });
  const key = 'hz_' + crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE branches SET key_hash=? WHERE id=?').run(sha(key), b.id);
  res.json({ id: b.id, name: b.name, key });
});

// ---------- AI proxy (Authorization: Bearer <branch key>) ----------
// Restaurants' installed apps have no AI keys. Their WhatsApp assistant (DeepSeek) and voice notes (Groq) come through
// here: your keys stay on this server, every call is counted per branch, and an unpaid membership switches AI off.
const AI_DAILY_LIMIT = +process.env.AI_DAILY_LIMIT || 3000; // calls per branch per day: a runaway loop can't empty your account
const aiAuth = (req, res, next) => {
  if (!VENDOR) return res.status(503).json({ error: 'The AI proxy only runs on the vendor cloud (VENDOR_PASSWORD set)' }); // else anyone who signs up uses your keys
  const key = (req.get('authorization') || '').replace(/^Bearer /, '');
  const b = key && db.prepare('SELECT * FROM branches WHERE key_hash=?').get(sha(key));
  if (!b) return res.status(401).json({ error: 'Unknown branch key' });
  if (!membership(b.owner_id).active) return res.status(402).json({ error: 'HazelPOS membership is not active: the WhatsApp assistant is paused until it is renewed' });
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
