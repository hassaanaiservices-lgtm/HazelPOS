// HazelPOS's own back office API (/api/vendor/*), used by the admin panel (admin/). Sits outside the restaurant resolver:
// it needs the vendor key, not a restaurant. Restaurants, owners, monthly invoices, the status lifecycle and the
// HazelPOS WhatsApp number. Every write goes to control.db vendor_audit.
const express = require('express');
const crypto = require('crypto');
const tenancy = require('./tenancy');
const vendorWa = require('./vendor-wa');
const { hashPin } = require('./tenant-init');
const { isWeakPin } = require('./pin-rules');
const { normPhone, createOwnerLink, BASE_URL, hashPassword } = require('./auth');

const { control } = tenancy;
// Why a restaurant is in its status: 'manual' (set by hand in the admin panel: the lifecycle never undoes it), 'billing', 'trial'.
try { control.exec('ALTER TABLE tenants ADD COLUMN status_reason TEXT'); control.exec("UPDATE tenants SET status_reason='manual' WHERE status IN ('suspended','cancelled')"); } catch { /* column exists */ }
const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled'];
const TRIAL_DAYS = 14, GRACE_DAYS = 7;
const now = () => new Date().toISOString();
const day = (offsetDays = 0, from = Date.now()) => new Date(from + offsetDays * 864e5).toISOString().slice(0, 10);
const PAY_DETAILS = () => process.env.PAY_DETAILS || 'the account details we shared with you';

function audit(who, action, detail = {}) {
  control.prepare('INSERT INTO vendor_audit (at,who,action,detail) VALUES (?,?,?,?)').run(now(), who, action, JSON.stringify(detail));
}
const ownerOf = tenantId => control.prepare('SELECT o.* FROM owner_tenants ot JOIN owners o ON o.id=ot.owner_id WHERE ot.tenant_id=? ORDER BY ot.owner_id LIMIT 1').get(tenantId);
const tell = (tenantId, text) => { const o = ownerOf(tenantId); return o ? vendorWa.sendText(o.phone, text) : Promise.resolve({ sent: false }); };
const randomPin = () => { for (;;) { const p = String(crypto.randomInt(100000, 1000000)); if (!isWeakPin(p)) return p; } };
const money = n => Math.round(+n).toLocaleString('en-US');

// The date after which an unpaid restaurant is suspended. One function for the POS banner and every WhatsApp message.
// Oldest open invoice's due date + 7 days; with none, the trial end (or today) + 7 days.
function payBy(tenant) {
  const inv = control.prepare("SELECT MIN(due_date) d FROM invoices WHERE tenant_id=? AND status='open'").get(tenant.id).d;
  if (inv) return day(GRACE_DAYS, Date.parse(inv));
  return tenant.trial_ends ? day(GRACE_DAYS, Date.parse(tenant.trial_ends)) : day(GRACE_DAYS);
}

const slugify = name => {
  let s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34);
  if (s.length < 3) s = (s + '-pos').replace(/^-+/, '');
  if (s.length < 3) s = 'restaurant';
  return s;
};
function uniqueSlug(base) {
  let s = base, n = 2;
  while (tenancy.bySlug(s)) s = `${base.slice(0, 36)}-${n++}`;
  return s;
}

// ---------- Lifecycle ----------
// Trial over: free restaurants go active, paying ones past_due. Active -> past_due once an invoice is past its due date;
// suspended 7 days after that. past_due and suspended are recomputed on every run (so a paid or voided invoice heals them).
// cancelled is never touched here.
function runLifecycle(today = day()) {
  const changes = [];
  const set = (t, status, why, msg) => {
    control.prepare('UPDATE tenants SET status=?, status_reason=? WHERE id=?').run(status, status === 'active' ? null : why.startsWith('trial') ? 'trial' : 'billing', t.id);
    audit('system', 'tenant.status', { id: t.id, slug: t.slug, from: t.status, to: status, why });
    changes.push({ id: t.id, slug: t.slug, from: t.status, to: status });
    if (msg) tell(t.id, msg);
  };
  const cutoff = day(-GRACE_DAYS, Date.parse(today));
  for (const t of control.prepare("SELECT * FROM tenants WHERE status IN ('trial','active','past_due','suspended') AND COALESCE(status_reason,'') != 'manual'").all()) {
    const overdue = control.prepare("SELECT MIN(due_date) d FROM invoices WHERE tenant_id=? AND status='open' AND due_date < ?").get(t.id, today).d;
    const paidAny = control.prepare("SELECT 1 FROM invoices WHERE tenant_id=? AND status='paid'").get(t.id);
    let to = null, why = '', msg = '';
    if (t.status === 'past_due' || t.status === 'suspended') {
      const trialOpen = t.status_reason === 'trial' && t.monthly_fee > 0 && t.trial_ends && t.trial_ends < today && !paidAny;
      to = !overdue ? (trialOpen ? 'past_due' : 'active') : overdue < cutoff ? 'suspended' : 'past_due';
      why = to === 'past_due' && !overdue ? 'trial recomputed' : 'recomputed';
    } else if (overdue && overdue < cutoff) { to = 'suspended'; why = 'invoice more than 7 days overdue'; }
    else if (overdue) { to = 'past_due'; why = 'invoice overdue'; }
    else if (t.status === 'trial' && t.trial_ends && t.trial_ends < today && !paidAny) {
      if (!(t.monthly_fee > 0)) { to = 'active'; why = 'trial ended, no fee'; }
      else { to = 'past_due'; why = 'trial ended'; }
    }
    if (!to || to === t.status) continue;
    if (to === 'suspended') msg = `Your HazelPOS account is suspended because an invoice is unpaid (due ${overdue}). New orders are blocked. Pay by ${PAY_DETAILS()} and send the receipt here to switch it back on.`;
    else if (to === 'past_due') msg = `Your HazelPOS payment is overdue. Please pay by ${payBy(t)} to avoid interruption.`;
    else if (to === 'active' && t.status !== 'trial') msg = 'Your HazelPOS account is active again. Thank you.';
    set(t, to, why, msg);
  }
  return changes;
}

// ---------- Router ----------
const router = express.Router();
const wrap = fn => (req, res, next) => { try { Promise.resolve(fn(req, res)).catch(next); } catch (e) { next(e); } };
const fail = (res, status, error) => res.status(status).json({ error });

router.use((req, res, next) => {
  const key = String(process.env.VENDOR_API_KEY || '').trim();
  if (key.length < 32) return fail(res, 503, 'The vendor API is switched off (VENDOR_API_KEY is not set)');
  const given = (req.get('authorization') || '').replace(/^Bearer /, '');
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(key).digest();
  if (!given || !crypto.timingSafeEqual(a, b)) return fail(res, 401, 'Wrong or missing key');
  req.who = String(req.get('x-admin-user') || 'vendor').slice(0, 80);
  next();
});

function tenantRowFull(t) {
  const owner = ownerOf(t.id);
  const stats = tenancy.run(t.id, () => ({
    wa_state: tenancy.hooks.waState(t.id),
    last_active: tenancy.db.prepare('SELECT MAX(last_seen) m FROM sessions').get().m || null,
    orders_today: tenancy.db.prepare("SELECT COUNT(*) c FROM orders WHERE date(created_at,'localtime')=date('now','localtime')").get().c,
    bridge_online: !!tenancy.db.prepare("SELECT 1 FROM devices WHERE kind='bridge' AND revoked_at IS NULL AND last_seen > ?").get(new Date(Date.now() - 30_000).toISOString()),
  }));
  const inv = control.prepare("SELECT id,month,amount,due_date FROM invoices WHERE tenant_id=? AND status='open' ORDER BY due_date LIMIT 1").get(t.id) || null;
  let features = {}; try { features = JSON.parse(t.features || '{}'); } catch { /* keep {} */ }
  return { id: t.id, slug: t.slug, name: t.name, status: t.status, plan: t.plan, features, monthly_fee: t.monthly_fee || 0, created_at: t.created_at,
    status_reason: t.status_reason || null, trial_ends: t.trial_ends, paid_until: t.paid_until, owner: owner ? { name: owner.name, phone: owner.phone } : null, ...stats, open_invoice: inv };
}

router.get('/tenants', (req, res) => res.json(control.prepare('SELECT * FROM tenants ORDER BY id DESC').all().map(tenantRowFull)));
router.get('/tenants/:id', (req, res) => {
  const t = tenancy.tenantRow(+req.params.id);
  if (!t) return fail(res, 404, 'Restaurant not found');
  res.json({ ...tenantRowFull(t), invoices: control.prepare('SELECT * FROM invoices WHERE tenant_id=? ORDER BY month DESC, id DESC').all(t.id) });
});

router.get('/owners/lookup', (req, res) => {
  const o = control.prepare('SELECT name FROM owners WHERE phone=?').get(normPhone(req.query.phone));
  res.json({ exists: !!o, name: o ? o.name : null });
});

router.post('/tenants', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim(), ownerName = String(req.body.owner_name || '').trim();
  const phone = normPhone(req.body.owner_phone), fee = req.body.monthly_fee === undefined || req.body.monthly_fee === '' ? 0 : Number(req.body.monthly_fee);
  if (!name) return fail(res, 400, 'Enter the restaurant name');
  if (!ownerName) return fail(res, 400, "Enter the owner's name");
  if (!vendorWa.normalise(phone)) return fail(res, 400, "Enter the owner's mobile number, like 03001234567");
  if (!Number.isFinite(fee) || fee < 0) return fail(res, 400, 'The monthly fee must be a number');
  const ownerPassword = req.body.owner_password ? String(req.body.owner_password) : '';
  if (ownerPassword && ownerPassword.length < 8) return fail(res, 400, 'The owner password needs at least 8 characters');
  let slug = String(req.body.slug || '').trim().toLowerCase();
  if (slug) { if (!tenancy.SLUG.test(slug)) return fail(res, 400, 'The restaurant code must be 3 to 40 lowercase letters, numbers or dashes'); if (tenancy.bySlug(slug)) return fail(res, 400, 'That restaurant code is already used'); }
  else slug = uniqueSlug(slugify(name));
  const existing = control.prepare('SELECT * FROM owners WHERE phone=?').get(phone);
  if (existing && req.body.confirm_existing_owner !== true) return res.status(409).json({ error: `This phone already belongs to ${existing.name}`, code: 'owner_exists', owner_name: existing.name });
  const id = tenancy.createTenant({ slug, name, plan: String(req.body.plan || 'standard') });
  control.prepare('UPDATE tenants SET status=?, trial_ends=?, monthly_fee=? WHERE id=?').run('trial', day(TRIAL_DAYS), fee, id);
  let owner = control.prepare('SELECT * FROM owners WHERE phone=?').get(phone);
  if (!owner) {
    const oid = Number(control.prepare('INSERT INTO owners (phone,name,pass_hash,created_at) VALUES (?,?,NULL,?)').run(phone, ownerName, now()).lastInsertRowid);
    owner = control.prepare('SELECT * FROM owners WHERE id=?').get(oid);
  }
  // A password set here by HazelPOS: the owner signs in with it straight away (no welcome link needed)
  if (ownerPassword && !owner.pass_hash) {
    control.prepare('UPDATE owners SET pass_hash=? WHERE id=?').run(hashPassword(ownerPassword), owner.id);
    owner = control.prepare('SELECT * FROM owners WHERE id=?').get(owner.id);
  }
  const pin = randomPin();
  const userId = tenancy.run(id, () => Number(tenancy.db.prepare('INSERT INTO users (name,pin,role) VALUES (?,?,?)').run(owner.name || ownerName, hashPin(pin), 'admin').lastInsertRowid));
  control.prepare('INSERT INTO owner_tenants (owner_id, tenant_id, user_id) VALUES (?,?,?)').run(owner.id, id, userId);
  let link = null, text;
  if (ownerPassword) text = `Welcome to HazelPOS, ${owner.name}! Sign in at ${BASE_URL()} with your phone number ${owner.phone} and password ${ownerPassword}. Your till PIN is ${pin}.`;
  else if (!owner.pass_hash) { link = createOwnerLink(owner.id, 'welcome').url; text = `Welcome to HazelPOS, ${owner.name}! Set your password: ${link}. Your till PIN is ${pin}.`; }
  else text = `${name} is now on your HazelPOS account. Sign in at ${BASE_URL()} with your usual password. Your till PIN for ${name} is ${pin}.`;
  const r = await vendorWa.sendText(owner.phone, text);
  audit(req.who, 'tenant.create', { id, slug, name, owner_phone: phone, monthly_fee: fee });
  res.json({ tenant: tenantRowFull(tenancy.tenantRow(id)), welcome_sent: r.sent, welcome_link: link, till_pin: pin, message: text });
}));

router.post('/tenants/:id', (req, res) => {
  const t = tenancy.tenantRow(+req.params.id);
  if (!t) return fail(res, 404, 'Restaurant not found');
  const b = req.body, sets = [], vals = [];
  if (b.name !== undefined) { if (!String(b.name).trim()) return fail(res, 400, 'The name cannot be empty'); sets.push('name=?'); vals.push(String(b.name).trim()); }
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return fail(res, 400, `Status must be one of ${STATUSES.join(', ')}`); sets.push('status=?', 'status_reason=?'); vals.push(b.status, ['suspended', 'cancelled'].includes(b.status) ? 'manual' : null); }
  for (const k of ['trial_ends', 'paid_until']) if (b[k] !== undefined) { if (b[k] !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(b[k]))) return fail(res, 400, `${k} must look like 2026-12-31`); sets.push(`${k}=?`); vals.push(b[k]); }
  if (b.plan !== undefined) { sets.push('plan=?'); vals.push(String(b.plan)); }
  if (b.monthly_fee !== undefined) { const f = Number(b.monthly_fee); if (!Number.isFinite(f) || f < 0) return fail(res, 400, 'The monthly fee must be a number'); sets.push('monthly_fee=?'); vals.push(f); }
  if (b.features !== undefined) { if (typeof b.features !== 'object' || b.features === null) return fail(res, 400, 'Features must be an object'); sets.push('features=?'); vals.push(JSON.stringify(b.features)); }
  if (!sets.length) return fail(res, 400, 'Nothing to change');
  control.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id=?`).run(...vals, t.id);
  if (b.name !== undefined) tenancy.run(t.id, () => tenancy.db.prepare("INSERT INTO settings (key,value) VALUES ('name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(b.name).trim()));
  audit(req.who, 'tenant.update', { id: t.id, slug: t.slug, ...b });
  res.json(tenantRowFull(tenancy.tenantRow(t.id)));
});

async function sendLink(req, res, purpose) {
  const t = tenancy.tenantRow(+req.params.id);
  if (!t) return fail(res, 404, 'Restaurant not found');
  const owner = ownerOf(t.id);
  if (!owner) return fail(res, 400, 'This restaurant has no owner');
  const link = createOwnerLink(owner.id, purpose).url;
  const r = await vendorWa.sendText(owner.phone, purpose === 'welcome' ? `Welcome to HazelPOS, ${owner.name}! Set your password: ${link}` : `Reset your HazelPOS password: ${link}`);
  audit(req.who, purpose === 'welcome' ? 'tenant.resend-welcome' : 'tenant.owner-reset', { id: t.id, slug: t.slug });
  res.json({ sent: r.sent, link });
}
router.get('/tenants/:id/backups', (req, res) => {
  const t = tenancy.tenantRow(+req.params.id);
  if (!t) return fail(res, 404, 'Restaurant not found');
  res.json(require('./backup').listFor(t.slug));
});
router.post('/tenants/:id/restore', (req, res) => { // this restaurant only; the server and every other restaurant keep running
  const t = tenancy.tenantRow(+req.params.id);
  if (!t) return fail(res, 404, 'Restaurant not found');
  const file = require('./backup').fileFor(t.slug, req.body?.backup);
  if (!file || !require('fs').existsSync(file)) return fail(res, 400, 'Choose one of the backups in the list');
  try { tenancy.restoreTenant(t.id, file); } catch (e) { return fail(res, 400, e.message); }
  audit(req.who, 'tenant.restore', { id: t.id, slug: t.slug, backup: req.body.backup });
  res.json({ ok: true });
});
// HazelPOS sets (or resets) the owner's password by hand; all their sessions end
router.post('/tenants/:id/owner-password', (req, res) => {
  const t = tenancy.tenantRow(+req.params.id);
  if (!t) return fail(res, 404, 'Restaurant not found');
  const pw = String(req.body.password || '');
  if (pw.length < 8) return fail(res, 400, 'The password needs at least 8 characters');
  const ot = control.prepare('SELECT owner_id FROM owner_tenants WHERE tenant_id=? LIMIT 1').get(t.id);
  if (!ot) return fail(res, 400, 'This restaurant has no owner');
  control.prepare('UPDATE owners SET pass_hash=? WHERE id=?').run(hashPassword(pw), ot.owner_id);
  control.prepare('DELETE FROM owner_sessions WHERE owner_id=?').run(ot.owner_id);
  audit(req.who, 'tenant.owner-password', { id: t.id, slug: t.slug });
  res.json({ ok: true });
});
router.post('/tenants/:id/resend-welcome', wrap((req, res) => sendLink(req, res, 'welcome')));
router.post('/tenants/:id/owner-reset', wrap((req, res) => sendLink(req, res, 'reset')));

// ---------- Invoices ----------
const invoiceRows = where => control.prepare(`SELECT i.*, t.name tenant_name, t.slug tenant_slug, t.status tenant_status FROM invoices i JOIN tenants t ON t.id=i.tenant_id ${where} ORDER BY i.due_date, i.id`);
router.get('/invoices', (req, res) => {
  const st = req.query.status;
  res.json(st ? invoiceRows('WHERE i.status=?').all(String(st)) : invoiceRows('').all());
});
router.post('/invoices/generate', wrap(async (req, res) => {
  const month = String(req.body.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(res, 400, 'Month must look like 2026-12');
  const due = req.body.due_date ? String(req.body.due_date) : `${month}-10`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail(res, 400, 'Due date must look like 2026-12-10');
  const created = [];
  for (const t of control.prepare("SELECT * FROM tenants WHERE status != 'cancelled' AND monthly_fee > 0").all()) {
    if (t.trial_ends && t.trial_ends > `${month}-31`) continue; // still in trial for that whole month
    if (control.prepare("SELECT 1 FROM invoices WHERE tenant_id=? AND month=? AND status != 'void'").get(t.id, month)) continue;
    const id = Number(control.prepare('INSERT INTO invoices (tenant_id,month,amount,due_date,status,created_at) VALUES (?,?,?,?,?,?)').run(t.id, month, t.monthly_fee, due, 'open', now()).lastInsertRowid);
    created.push(id);
    await tell(t.id, `Your HazelPOS invoice for ${month}: Rs ${money(t.monthly_fee)}, due ${due}. Pay by JazzCash/Easypaisa/bank transfer to ${PAY_DETAILS()} and send the receipt here.`);
  }
  audit(req.who, 'invoices.generate', { month, created: created.length });
  res.json({ created: created.length, invoices: created.map(id => invoiceRows('WHERE i.id=?').get(id)) });
}));
router.post('/invoices/:id/paid', (req, res) => {
  const inv = control.prepare('SELECT * FROM invoices WHERE id=?').get(+req.params.id);
  if (!inv) return fail(res, 404, 'Invoice not found');
  if (inv.status !== 'open') return fail(res, 400, 'This invoice is not open');
  const method = String(req.body.method || '').trim(), ref = String(req.body.ref || '').trim();
  if (!method) return fail(res, 400, 'Choose how it was paid');
  control.prepare("UPDATE invoices SET status='paid', paid_at=?, method=?, ref=?, marked_by=? WHERE id=?").run(now(), method, ref, req.who, inv.id);
  const t = tenancy.tenantRow(inv.tenant_id);
  control.prepare('UPDATE tenants SET paid_until=? WHERE id=?').run(day(30, Date.parse(inv.due_date)), t.id);
  audit(req.who, 'invoice.paid', { id: inv.id, tenant: t.slug, month: inv.month, amount: inv.amount, method, ref });
  // Back to active when nothing else is overdue
  if (['trial', 'past_due', 'suspended'].includes(t.status) && t.status_reason !== 'manual' && !control.prepare("SELECT 1 FROM invoices WHERE tenant_id=? AND status='open' AND due_date < ?").get(t.id, day())) {
    control.prepare("UPDATE tenants SET status='active', status_reason=NULL WHERE id=?").run(t.id);
    audit(req.who, 'tenant.status', { id: t.id, slug: t.slug, from: t.status, to: 'active', why: 'invoice paid' });
    tell(t.id, `Thank you, we received your HazelPOS payment for ${inv.month}. Your account is active.`);
  }
  res.json({ ...control.prepare('SELECT * FROM invoices WHERE id=?').get(inv.id), tenant_status: tenancy.tenantRow(t.id).status });
});
router.post('/invoices/:id/void', (req, res) => {
  const inv = control.prepare('SELECT * FROM invoices WHERE id=?').get(+req.params.id);
  if (!inv) return fail(res, 404, 'Invoice not found');
  if (inv.status !== 'open') return fail(res, 400, 'This invoice is not open');
  control.prepare("UPDATE invoices SET status='void' WHERE id=?").run(inv.id);
  audit(req.who, 'invoice.void', { id: inv.id, month: inv.month });
  res.json({ ok: true });
});

router.post('/lifecycle/run', (req, res) => {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.today || '')) ? req.body.today : day();
  const changes = runLifecycle(today);
  audit(req.who, 'lifecycle.run', { today, changes: changes.length });
  res.json({ changes });
});

// ---------- HazelPOS's own WhatsApp number ----------
router.get('/wa', (req, res) => res.json(vendorWa.status()));
router.post('/wa/link', wrap(async (req, res) => {
  try { const s = await vendorWa.link(); audit(req.who, 'wa.link'); res.json(s); }
  catch (e) { fail(res, 409, `Could not start linking: ${e.message}`); }
}));
router.post('/wa/logout', wrap(async (req, res) => { const s = await vendorWa.logout(); audit(req.who, 'wa.logout'); res.json(s); }));

router.get('/audit', (req, res) => res.json(control.prepare('SELECT * FROM vendor_audit ORDER BY id DESC LIMIT ?').all(Math.min(1000, Math.max(1, +req.query.limit || 200)))));
router.use((req, res) => fail(res, 404, `Unknown address: ${req.method} ${req.originalUrl}`));

// Once a day (and a minute after start): move restaurants along trial -> past_due -> suspended. Messages only go out on a change.
const startLifecycle = () => { setTimeout(() => { try { runLifecycle(); } catch (e) { console.error('Lifecycle:', e.message); } }, 60_000).unref(); setInterval(() => { try { runLifecycle(); } catch (e) { console.error('Lifecycle:', e.message); } }, 6 * 3600_000).unref(); };

module.exports = { router, runLifecycle, startLifecycle, payBy };
