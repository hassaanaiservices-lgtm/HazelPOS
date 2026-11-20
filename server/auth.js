// Owner sign-in (/api/auth/*): phone + password, plus a 6-digit code on a device the owner has not used before.
// These routes need no restaurant header: the owner's account (control.db) says which restaurants they own.
const express = require('express');
const crypto = require('crypto');
const tenancy = require('./tenancy');
const vendorWa = require('./vendor-wa');

const { control, sha256 } = tenancy;
const now = () => new Date().toISOString();
const OTP_MINUTES = 10, OTP_MAX_TRIES = 5, WINDOW_MS = 15 * 60 * 1000, MAX_PASSWORD_TRIES = 10, MAX_CODES = 3, MAX_CODES_PER_IP = 20; // several owners can share one NAT
const HOUR_MS = 60 * 60 * 1000;
const OWNER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const normPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('92') ? '0' + d.slice(2) : d; };

const hashPassword = pw => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `s1$${salt}$${crypto.scryptSync(String(pw), salt, 32).toString('hex')}`;
};
const passwordMatches = (pw, stored) => {
  const [v, salt, hash] = String(stored || '').split('$');
  if (v !== 's1' || !hash) return false;
  const ok = p => crypto.timingSafeEqual(crypto.scryptSync(p, salt, 32), Buffer.from(hash, 'hex'));
  // Phones add a space after autocomplete: the trimmed password is tried too (passwords are saved trimmed)
  return ok(String(pw)) || (String(pw).trim() !== String(pw) && ok(String(pw).trim()));
};

const DUMMY_HASH = 's1$00000000000000000000000000000000$' + '0'.repeat(64);

// Sent from HazelPOS's own WhatsApp number; when that isn't linked, vendor-wa logs the text on the server console instead.
function sendOtp(phone, code) {
  vendorWa.sendText(phone, `Your HazelPOS sign-in code is ${code}. It expires in 10 minutes. Don't share it with anyone.`);
}
const BASE_URL = () => String(process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, '');

// Rate limits, per phone and per IP. Shared across restaurants on purpose: they guard the owner accounts, not a restaurant.
const hits = new Map(); // "kind:key" -> times
function hitCount(kind, key, win = WINDOW_MS) {
  const k = `${kind}:${key}`, recent = (hits.get(k) || []).filter(t => Date.now() - t < HOUR_MS);
  if (win < HOUR_MS) return recent.filter(t => Date.now() - t < win).length;
  hits.set(k, recent);
  if (hits.size > 5000) for (const [kk, ts] of hits) if (!ts.some(t => Date.now() - t < HOUR_MS)) hits.delete(kk);
  return recent.length;
}
const addHit = (kind, key) => hits.set(`${kind}:${key}`, [...(hits.get(`${kind}:${key}`) || []), Date.now()]);
const limited = (kind, phone, ip, max, maxIp = max) => hitCount(kind, 'p' + phone, kind === 'forgot' ? HOUR_MS : WINDOW_MS) >= max || hitCount(kind, 'i' + ip, kind === 'forgot' ? HOUR_MS : WINDOW_MS) >= maxIp;
const countHit = (kind, phone, ip) => { addHit(kind, 'p' + phone); addHit(kind, 'i' + ip); };

const restaurantsOf = ownerId => control.prepare(`SELECT t.slug, t.name FROM owner_tenants ot JOIN tenants t ON t.id = ot.tenant_id
  WHERE ot.owner_id=? AND t.status != 'cancelled' ORDER BY t.name`).all(ownerId);
const newOwnerSession = ownerId => {
  const token = crypto.randomBytes(32).toString('hex');
  control.prepare('INSERT INTO owner_sessions (token,owner_id,created_at,last_seen) VALUES (?,?,?,?)').run(token, ownerId, now(), now());
  return { owner_token: token, restaurants: restaurantsOf(ownerId) };
};
const ownerOfToken = token => {
  const s = token && control.prepare('SELECT * FROM owner_sessions WHERE token=?').get(String(token));
  if (!s || Date.now() - Date.parse(s.last_seen) > OWNER_SESSION_MS) return null;
  control.prepare('UPDATE owner_sessions SET last_seen=? WHERE token=?').run(now(), s.token);
  return control.prepare('SELECT * FROM owners WHERE id=?').get(s.owner_id);
};

const r = express.Router();
const bad = (res, status, error, extra) => res.status(status).json({ error, ...extra });

r.post('/owner/login', (req, res) => {
  const phone = normPhone(req.body.phone), device = String(req.body.device_id || '');
  if (!phone || !req.body.password || !device) return bad(res, 400, 'Enter your phone number and password');
  if (limited('pw', phone, req.ip, MAX_PASSWORD_TRIES)) return bad(res, 429, 'Too many tries. Please wait a few minutes');
  const owner = control.prepare('SELECT * FROM owners WHERE phone=?').get(phone);
  if (!owner) passwordMatches(req.body.password, DUMMY_HASH); // same work as a known phone, so timing doesn't reveal it
  if (!owner || !passwordMatches(req.body.password, owner.pass_hash)) {
    countHit('pw', phone, req.ip);
    return bad(res, 401, 'Wrong phone number or password');
  }
  const trusted = control.prepare('SELECT 1 FROM owner_devices WHERE owner_id=? AND device_hash=?').get(owner.id, sha256(device));
  // The code goes out on HazelPOS's WhatsApp. While that number isn't linked, the password alone signs in.
  // shortcut: link the HazelPOS WhatsApp number in the admin panel to switch the 6-digit code on.
  if (trusted || process.env.OTP_OFF === '1' || vendorWa.status().state !== 'connected') return res.json(newOwnerSession(owner.id));
  if (limited('otp', phone, req.ip, MAX_CODES, MAX_CODES_PER_IP)) return bad(res, 429, 'Too many codes sent. Please wait a few minutes');
  countHit('otp', phone, req.ip);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  control.prepare('INSERT OR REPLACE INTO otps (phone, code_hash, purpose, expires_at, tries, device_hash) VALUES (?,?,?,?,0,?)')
    .run(phone, sha256(code), 'login', new Date(Date.now() + OTP_MINUTES * 60000).toISOString(), sha256(device));
  sendOtp(phone, code);
  res.json({ otp_required: true });
});

r.post('/owner/otp', (req, res) => {
  const phone = normPhone(req.body.phone), device = String(req.body.device_id || '');
  const o = control.prepare("SELECT * FROM otps WHERE phone=? AND purpose='login'").get(phone);
  const owner = control.prepare('SELECT * FROM owners WHERE phone=?').get(phone);
  if (!o || !owner || !device || Date.parse(o.expires_at) < Date.now() || o.tries >= OTP_MAX_TRIES || o.device_hash !== sha256(device))
    return bad(res, 401, 'That code has expired. Sign in again to get a new one');
  const given = sha256(String(req.body.code || '').trim());
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(o.code_hash))) {
    control.prepare("UPDATE otps SET tries=tries+1 WHERE phone=? AND purpose='login'").run(phone);
    return bad(res, 401, 'Wrong code');
  }
  control.prepare("DELETE FROM otps WHERE phone=? AND purpose='login'").run(phone);
  control.prepare('INSERT OR REPLACE INTO owner_devices (owner_id, device_hash, trusted_at) VALUES (?,?,?)').run(owner.id, sha256(device), now());
  res.json(newOwnerSession(owner.id));
});

r.post('/owner/enter', (req, res) => {
  const owner = ownerOfToken(req.body.owner_token);
  if (!owner) return bad(res, 401, 'Please sign in again');
  const t = tenancy.bySlug(req.body.slug);
  const link = t && control.prepare('SELECT * FROM owner_tenants WHERE owner_id=? AND tenant_id=?').get(owner.id, t.id);
  if (!link) return bad(res, 403, 'You do not have access to that restaurant');
  const out = tenancy.run(t.id, () => {
    const u = tenancy.db.prepare('SELECT id,name,role FROM users WHERE id=?').get(link.user_id);
    if (!u) return null;
    const token = crypto.randomBytes(32).toString('hex');
    tenancy.db.prepare('INSERT INTO sessions (token,user_id,created_at,last_seen) VALUES (?,?,?,?)').run(token, u.id, now(), now());
    tenancy.db.prepare('INSERT INTO audit_log (at,user_id,user_name,role,ip,action,status,detail) VALUES (?,?,?,?,?,?,?,?)')
      .run(now(), u.id, u.name, u.role, req.ip, 'OWNER SIGN-IN', 200, '');
    return { token, user: { id: u.id, name: u.name, role: u.role, must_change_pin: false }, restaurant: { slug: t.slug, name: t.name } };
  });
  out ? res.json(out) : bad(res, 403, 'Your login in that restaurant no longer exists');
});

r.post('/owner/logout', (req, res) => {
  control.prepare('DELETE FROM owner_sessions WHERE token=?').run(String(req.body.owner_token || ''));
  res.json({ ok: true });
});

// ---------- Welcome and reset links (sent on WhatsApp; single use) ----------
const LINK_MS = { welcome: 7 * 24 * HOUR_MS, reset: HOUR_MS };
// A new link replaces the owner's earlier unused links of the same kind. The token is shown once; only its hash is kept.
function createOwnerLink(ownerId, purpose) {
  const token = crypto.randomBytes(24).toString('hex');
  control.prepare('UPDATE owner_links SET used_at=? WHERE owner_id=? AND purpose=? AND used_at IS NULL').run(now(), ownerId, purpose);
  control.prepare('INSERT INTO owner_links (token_hash,owner_id,purpose,expires_at,used_at,created_at) VALUES (?,?,?,?,NULL,?)')
    .run(sha256(token), ownerId, purpose, new Date(Date.now() + LINK_MS[purpose]).toISOString(), now());
  return { token, url: `${BASE_URL()}/${purpose === 'welcome' ? 'welcome' : 'reset'}/${token}` };
}
const GONE = 'This link has expired or was already used. Ask HazelPOS for a new one.';
const usableLink = token => {
  const l = control.prepare('SELECT * FROM owner_links WHERE token_hash=?').get(sha256(String(token || '')));
  return l && !l.used_at && Date.parse(l.expires_at) > Date.now() ? l : null;
};

r.post('/owner/forgot', (req, res) => {
  const phone = normPhone(req.body.phone);
  const tooMany = limited('forgot', phone, req.ip, 3, 20);
  countHit('forgot', phone, req.ip);
  const owner = phone && !tooMany && control.prepare('SELECT * FROM owners WHERE phone=?').get(phone);
  if (owner) vendorWa.sendText(owner.phone, `Reset your HazelPOS password: ${createOwnerLink(owner.id, 'reset').url}`);
  res.json({ ok: true }); // the same answer for every phone number
});
r.get('/owner/link/:token', (req, res) => {
  const l = usableLink(req.params.token);
  if (!l) return res.json({ valid: false, reason: GONE }); // 200, so the browser console stays clean
  const o = control.prepare('SELECT * FROM owners WHERE id=?').get(l.owner_id);
  res.json({ purpose: l.purpose, name: o.name, phone_masked: o.phone.slice(0, 4) + '•••' + o.phone.slice(-3) });
});
r.post('/owner/link/:token', (req, res) => {
  const device = String(req.body.device_id || ''), password = String(req.body.password || '').trim();
  if (limited('link', 'x', req.ip, 30)) return bad(res, 429, 'Too many tries. Please wait a few minutes');
  countHit('link', 'x', req.ip);
  const l = usableLink(req.params.token);
  if (!l) return bad(res, 410, GONE);
  if (password.length < 8) return bad(res, 400, 'The password needs at least 8 characters');
  if (!device) return bad(res, 400, 'This browser could not be recognised. Reload the page');
  control.prepare('UPDATE owner_links SET used_at=? WHERE token_hash=? AND used_at IS NULL').run(now(), l.token_hash);
  control.prepare('UPDATE owners SET pass_hash=? WHERE id=?').run(hashPassword(password), l.owner_id);
  control.prepare('DELETE FROM owner_sessions WHERE owner_id=?').run(l.owner_id);
  // also sign the owner out of every till login they hold, in every restaurant
  for (const ot of control.prepare('SELECT tenant_id, user_id FROM owner_tenants WHERE owner_id=?').all(l.owner_id))
    tenancy.run(ot.tenant_id, () => tenancy.db.prepare('DELETE FROM sessions WHERE user_id=?').run(ot.user_id));
  control.prepare('INSERT OR REPLACE INTO owner_devices (owner_id, device_hash, trusted_at) VALUES (?,?,?)').run(l.owner_id, sha256(device), now());
  res.json(newOwnerSession(l.owner_id));
});

module.exports = { router: r, createOwnerLink, BASE_URL, hashPassword, normPhone, restaurantsOf };
