// HazelPOS Admin: your own dashboard (clients, onboarding, memberships, health, AI usage). A separate app with its own
// address and login. It holds the cloud's VENDOR_API_KEY on the server and passes your requests on to HazelPOS Cloud
// (/api/vendor/*), so the key never reaches a browser.
//
//   ADMIN_PASSWORD   the main owner login here (12+ characters; leave the email empty). Team members (Team page)
//                    log in with their own email and password, kept on the cloud.
//   CLOUD_URL        your HazelPOS Cloud, e.g. https://cloud.example.com
//   VENDOR_API_KEY   the same long secret as on the cloud (32+ characters)
//   PORT             default 4400
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { ADMIN_PASSWORD = '', VENDOR_API_KEY = '' } = process.env;
const CLOUD_URL = String(process.env.CLOUD_URL || '').replace(/\/+$/, '');
const problems = [
  ADMIN_PASSWORD.length < 12 && 'ADMIN_PASSWORD must be at least 12 characters',
  !/^https?:\/\//.test(CLOUD_URL) && 'CLOUD_URL must be the cloud address, e.g. https://cloud.example.com',
  VENDOR_API_KEY.length < 32 && 'VENDOR_API_KEY must be the same 32+ character secret as on the cloud',
].filter(Boolean);
if (problems.length) { console.error('HazelPOS Admin cannot start:\n- ' + problems.join('\n- ')); process.exit(1); }

const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // token -> { seen, user: {id, email, name, role} }; in memory, so a restart means logging in again
const fails = new Map();    // ip -> { n, until }
const sha = s => crypto.createHash('sha256').update(String(s)).digest();

const app = express();
app.set('trust proxy', 1); // Railway / any HTTPS proxy in front: real client IP and https
app.disable('x-powered-by');
app.set('case sensitive routing', true);
app.use((req, res, next) => {
  res.set({ 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.use(express.json({ limit: '4mb' })); // menu Excel files and menu pictures travel as base64

const cookie = req => Object.fromEntries((req.get('cookie') || '').split(';').map(c => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, v.join('=')]));
const setCookie = (req, res, value, maxAge) => res.set('Set-Cookie',
  `hz_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
const loggedIn = req => {
  const t = cookie(req).hz_admin, s = t && sessions.get(t);
  if (!s || Date.now() - s.seen > SESSION_IDLE_MS) { if (t) sessions.delete(t); return null; }
  s.seen = Date.now();
  return s.user;
};
const cloud = (p, opts = {}) => fetch(CLOUD_URL + '/api/vendor' + p, { ...opts, signal: AbortSignal.timeout(60000),
  headers: { Authorization: 'Bearer ' + VENDOR_API_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

app.post('/api/login', async (req, res) => {
  const f = fails.get(req.ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 60000)} min` });
  const email = String(req.body?.email || '').trim().toLowerCase();
  let user = null;
  if (!email) { // the main owner password
    if (crypto.timingSafeEqual(sha(req.body?.password || ''), sha(ADMIN_PASSWORD))) user = { id: 0, email: '', name: 'Owner', role: 'owner' };
  } else { // a team member: checked by the cloud
    try { const r = await cloud('/team/login', { method: 'POST', body: JSON.stringify({ email, password: req.body?.password || '' }) }); if (r.ok) user = await r.json(); }
    catch { return res.status(502).json({ error: `Can't reach HazelPOS Cloud (${CLOUD_URL})` }); }
  }
  if (!user) {
    f.n++; if (f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60 * 1000; }
    fails.set(req.ip, f);
    return res.status(401).json({ error: email ? 'Wrong email or password' : 'Wrong password' });
  }
  fails.delete(req.ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { seen: Date.now(), user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  setCookie(req, res, token, SESSION_IDLE_MS / 1000);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { sessions.delete(cookie(req).hz_admin); setCookie(req, res, '', 0); res.json({ ok: true }); });
app.get('/api/me', (req, res) => { const u = loggedIn(req); u ? res.json({ ok: true, cloud: CLOUD_URL, user: u }) : res.status(401).json({ error: 'Please log in' }); });

// Everything else under /api goes to the cloud's vendor API. Writes must come from this app's own pages
// (the cookie is SameSite=Strict, and the header below can't be sent by a form on another site).
app.use('/api', async (req, res) => {
  const user = loggedIn(req);
  if (!user) return res.status(401).json({ error: 'Please log in' });
  if (req.method !== 'GET' && req.get('x-hazel-admin') !== '1') return res.status(403).json({ error: 'Not allowed' });
  // Only plain, known-shaped paths go to the cloud: no dot-dot, no encoded slashes or dots, no double slashes
  if (!/^\/[a-z0-9_\-]+(\/[a-z0-9_\-]+)*\/?$/i.test(req.path)) return res.status(400).json({ error: 'Bad address' });
  if (/^\/team(\/|$)/i.test(req.path) && user.role !== 'owner') return res.status(403).json({ error: 'Only an owner can manage the team' });
  try {
    const r = await cloud(req.url, {
      method: req.method,
      headers: { 'X-Vendor-User': user.email ? `${user.name} <${user.email}>` : user.name, 'X-Vendor-Role': user.role }, // who did it: the cloud's activity log and the owner-only team routes
      body: req.method !== 'GET' ? JSON.stringify(req.body || {}) : undefined,
    });
    const body = Buffer.from(await r.arrayBuffer());
    // A team member switched off or given a new password: sign them out everywhere straight away
    const m = /^\/team\/(\d+)$/.exec(req.path);
    if (r.ok && m && req.method === 'POST' && (req.body?.active === false || req.body?.password !== undefined))
      for (const [t, s] of sessions) if (s.user.id === +m[1]) sessions.delete(t);
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ error: e.name === 'TimeoutError' ? 'HazelPOS Cloud took too long to answer' : `Can't reach HazelPOS Cloud (${CLOUD_URL})` });
  }
});

// The screens (npm run build -> dist/)
const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST, { index: false, maxAge: '1h' }));
app.get(/.*/, (req, res) => fs.existsSync(path.join(DIST, 'index.html'))
  ? res.sendFile(path.join(DIST, 'index.html'))
  : res.status(503).send('Build the admin screens first: npm --prefix admin run build'));

const PORT = process.env.PORT || 4400;
app.listen(PORT, () => console.log(`HazelPOS Admin on http://localhost:${PORT} (cloud: ${CLOUD_URL})`));
