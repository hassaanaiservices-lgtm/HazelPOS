// Many restaurants on one server: each restaurant has its own SQLite file, and the request in progress decides which one
// server/index.js's `db` means. `db` is a Proxy: with no restaurant selected it throws, so code can never silently
// touch the wrong restaurant's data.
//   DATA_DIR/control.db                 restaurants, owners, owner sessions, device index
//   DATA_DIR/tenants/<id>/pos.db        one restaurant's whole POS
process.env.TENANCY = '1'; // server mode: rag's readPos() refuses to open a shared database
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const sqlite = require('node:sqlite');
const { DatabaseSync } = sqlite;
const { initTenant } = require('./tenant-init');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(path.join(DATA_DIR, 'tenants'), { recursive: true });

const control = new DatabaseSync(path.join(DATA_DIR, 'control.db'));
control.exec('PRAGMA busy_timeout = 5000');
control.exec(`
CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, status TEXT DEFAULT 'active', plan TEXT, features TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS owners (id INTEGER PRIMARY KEY, phone TEXT UNIQUE, email TEXT, name TEXT, pass_hash TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS owner_tenants (owner_id INTEGER, tenant_id INTEGER, user_id INTEGER, PRIMARY KEY (owner_id, tenant_id));
CREATE TABLE IF NOT EXISTS owner_sessions (token TEXT PRIMARY KEY, owner_id INTEGER, created_at TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS owner_devices (owner_id INTEGER, device_hash TEXT, trusted_at TEXT, PRIMARY KEY (owner_id, device_hash));
CREATE TABLE IF NOT EXISTS otps (phone TEXT, code_hash TEXT, purpose TEXT, expires_at TEXT, tries INTEGER DEFAULT 0, device_hash TEXT, PRIMARY KEY (phone, purpose));
CREATE TABLE IF NOT EXISTS device_index (hash TEXT PRIMARY KEY, tenant_id INTEGER); -- sha256(device key) -> the restaurant it belongs to
CREATE TABLE IF NOT EXISTS owner_links (token_hash TEXT PRIMARY KEY, owner_id INTEGER, purpose TEXT, expires_at TEXT, used_at TEXT, created_at TEXT); -- welcome (7 days) and reset (1 hour) links, single use
CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY, tenant_id INTEGER, month TEXT, amount REAL, due_date TEXT, status TEXT DEFAULT 'open', paid_at TEXT, method TEXT, ref TEXT, marked_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS bridge_pairings (code_hash TEXT PRIMARY KEY, tenant_id INTEGER, created_by TEXT, expires_at TEXT, used_at TEXT); -- 6-digit printer pairing codes (10 minutes, single use)
CREATE TABLE IF NOT EXISTS vendor_audit (id INTEGER PRIMARY KEY, at TEXT, who TEXT, action TEXT, detail TEXT);
`);
for (const sql of ['ALTER TABLE tenants ADD COLUMN trial_ends TEXT', 'ALTER TABLE tenants ADD COLUMN paid_until TEXT', 'ALTER TABLE tenants ADD COLUMN monthly_fee REAL DEFAULT 0'])
  try { control.exec(sql); } catch { /* column exists */ }

try { control.exec('ALTER TABLE otps ADD COLUMN device_hash TEXT'); } catch { /* column exists */ }
const SLUG = /^[a-z0-9-]{3,40}$/;
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const als = new AsyncLocalStorage(); // { tenant, db }

// shortcut: every restaurant's database stays open once opened (no eviction). Fine for the first dozens of restaurants;
// add a reference-counted cache before there are hundreds.
const open = new Map(); // tenant id -> DatabaseSync

function dbFor(id) {
  let db = open.get(id);
  if (!db) {
    const dir = path.join(DATA_DIR, 'tenants', String(id));
    fs.mkdirSync(dir, { recursive: true });
    db = new DatabaseSync(path.join(dir, 'pos.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    initTenant(db);
    open.set(id, db);
  }
  return db;
}

const tenantRow = id => control.prepare('SELECT * FROM tenants WHERE id=?').get(id);
const bySlug = slug => SLUG.test(String(slug)) ? control.prepare('SELECT * FROM tenants WHERE slug=?').get(String(slug)) : undefined;

const current = () => als.getStore();
const db = new Proxy({}, {
  get(_, prop) {
    const ctx = als.getStore();
    if (!ctx) throw new Error('No restaurant selected');
    const d = dbFor(ctx.tenant.id); // looked up each time, so a request in flight after a restore uses the reopened file
    const v = d[prop];
    return typeof v === 'function' ? v.bind(d) : v;
  },
});

// Runs fn inside that restaurant's context (the tenant row is read fresh, so a suspension applies at once)
function run(tenantId, fn) {
  const tenant = tenantRow(tenantId);
  if (!tenant) throw new Error('Restaurant not found');
  return als.run({ tenant, db: dbFor(tenant.id) }, fn);
}

// Server-wide timers: once per active restaurant, each inside its own context. One failing restaurant never stops the rest.
function forEach(fn) {
  for (const t of control.prepare("SELECT id FROM tenants WHERE status != 'cancelled'").all()) {
    try {
      const r = run(t.id, fn);
      if (r && typeof r.catch === 'function') r.catch(e => console.error(`Timer, restaurant ${t.id}:`, e.message));
    } catch (e) { console.error(`Timer, restaurant ${t.id}:`, e.message); }
  }
}

function createTenant({ slug, name, plan = 'standard', features = {} }) {
  if (!SLUG.test(slug)) throw new Error('The restaurant code must be 3 to 40 lowercase letters, numbers or dashes');
  if (bySlug(slug)) throw new Error('That restaurant code is already used');
  const id = Number(control.prepare('INSERT INTO tenants (slug,name,status,plan,features,created_at) VALUES (?,?,?,?,?,?)')
    .run(slug, name, 'active', plan, JSON.stringify(features), new Date().toISOString()).lastInsertRowid);
  const d = dbFor(id);
  d.prepare("INSERT INTO settings (key,value) VALUES ('name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(name);
  return id;
}

// One consistent copy of every restaurant's database in dir (node:sqlite backup(): does not freeze the server)
async function backupAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const t of control.prepare('SELECT id, slug FROM tenants').all()) {
    const file = path.join(dir, `${t.slug}.db`);
    await sqlite.backup(dbFor(t.id), file);
    files.push(file);
  }
  return files;
}

// Closes one restaurant's handle (the next request reopens it)
function close(id) { const d = open.get(id); if (d) { try { d.close(); } catch { /* already closed */ } open.delete(id); } }

// Puts a backup file back as one restaurant's database; the server keeps running and no other restaurant is touched. It is
// synchronous, so no request can run while the file is swapped. The current file is kept as pos.db.before-restore-<time>.
// From the CLI with the server running, restart the server afterwards (it keeps its own open copy): use the Admin panel instead.
function restoreTenant(id, file) {
  const t = tenantRow(id);
  if (!t) throw new Error('Restaurant not found');
  const check = new DatabaseSync(file, { readOnly: true });
  try { check.prepare('SELECT COUNT(*) FROM settings').get(); check.prepare('SELECT COUNT(*) FROM orders').get(); }
  catch { throw new Error('That file is not a HazelPOS restaurant backup'); } finally { check.close(); }
  const botWasOn = hooks.waState(id) !== 'off';
  if (botWasOn) hooks.waStop?.(id); // the WhatsApp bot, when it runs in this process
  const dir = path.join(DATA_DIR, 'tenants', String(id)), target = path.join(dir, 'pos.db');
  close(id);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(target)) fs.renameSync(target, `${target}.before-restore-${Date.now()}`);
  for (const ext of ['-wal', '-shm']) fs.rmSync(target + ext, { force: true });
  fs.copyFileSync(file, target);
  dbFor(id); // reopens it (initTenant runs the migrations)
  if (botWasOn) try { hooks.waStart?.(id); } catch (e) { console.error(`Restore: bot did not restart for ${id}:`, e.message); }
  return t;
}

// Other modules (the WhatsApp bots) learn about a restaurant's status change here; vendor.js may call notifyStatus(id) after
// changing a status. The WhatsApp manager also re-checks every few seconds, so a change made elsewhere is picked up too.
const statusListeners = [];
const onStatusChange = fn => { statusListeners.push(fn); };
const notifyStatus = id => { for (const fn of statusListeners) try { fn(id); } catch (e) { console.error('Status listener:', e.message); } };
const hooks = { waState: () => 'off' }; // replaced by the WhatsApp manager (GET /api/vendor/tenants shows it as wa_state)

module.exports = { onStatusChange, notifyStatus, hooks, DATA_DIR, control, db, run, current, forEach, open: dbFor, createTenant, tenantRow, bySlug, backupAll, restoreTenant, close, sha256, SLUG };
