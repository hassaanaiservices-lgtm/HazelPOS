// HazelPOS Admin: your own dashboard (restaurants, invoices, the HazelPOS WhatsApp number). A separate app with its own
// address and login. It holds the VENDOR_API_KEY and passes your requests on to the main HazelPOS server
// (/api/vendor/*), so the key never reaches a browser.
//
//   ADMIN_PASSWORD   the login here (12+ characters)
//   SERVER_URL       the main HazelPOS server, e.g. https://app.example.com (CLOUD_URL is still read as a fallback)
//   VENDOR_API_KEY   the same long secret as on the server (32+ characters)
//   PORT             default 4400
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || ''), VENDOR_API_KEY = String(process.env.VENDOR_API_KEY || '').trim(); // a pasted key may carry a space or new line
const SERVER_URL = String(process.env.SERVER_URL || process.env.CLOUD_URL || '').replace(/\/+$/, '');
const problems = [
  ADMIN_PASSWORD.length < 12 && 'ADMIN_PASSWORD must be at least 12 characters',
  !/^https?:\/\//.test(SERVER_URL) && 'SERVER_URL must be the HazelPOS server address, e.g. https://app.example.com',
  VENDOR_API_KEY.length < 32 && 'VENDOR_API_KEY must be the same 32+ character secret as on the server',
].filter(Boolean);
if (problems.length) { console.error('HazelPOS Admin cannot start:\n- ' + problems.join('\n- ')); process.exit(1); }

// A login lasts 30 days and survives restarts and deploys: the cookie carries its own expiry, signed with a key made from
// ADMIN_PASSWORD and VENDOR_API_KEY. Changing ADMIN_PASSWORD signs everyone out.
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_KEY = crypto.createHash('sha256').update('hz-admin-session|' + ADMIN_PASSWORD + '|' + VENDOR_API_KEY).digest();
const OWNER = { id: 0, email: '', name: 'Owner', role: 'owner' };
const signSession = exp => `${exp}.${crypto.createHmac('sha256', SESSION_KEY).update(String(exp)).digest('hex')}`;
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
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'admin' })); // Railway's health check
app.use(express.json({ limit: '4mb' })); // menu Excel files and menu pictures travel as base64

const cookie = req => Object.fromEntries((req.get('cookie') || '').split(';').map(c => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, v.join('=')]));
const setCookie = (req, res, value, maxAge) => res.set('Set-Cookie',
  `hz_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
const loggedIn = (req, res) => {
  const [exp, mac] = String(cookie(req).hz_admin || '').split('.');
  if (!exp || !mac || !/^\d+$/.test(exp) || +exp < Date.now()) return null;
  const want = Buffer.from(signSession(exp).split('.')[1], 'hex'), got = Buffer.from(mac, 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  if (res && +exp - Date.now() < SESSION_MS / 2) { const e = Date.now() + SESSION_MS; setCookie(req, res, signSession(e), SESSION_MS / 1000); } // used often: stays logged in
  return OWNER;
};
const server = (p, opts = {}) => fetch(SERVER_URL + '/api/vendor' + p, { ...opts, signal: AbortSignal.timeout(60000),
  headers: { Authorization: 'Bearer ' + VENDOR_API_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

app.post('/api/login', async (req, res) => {
  const f = fails.get(req.ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 60000)} min` });
  // shortcut: one shared ADMIN_PASSWORD. The Team page (own email and password per person) is hidden until there is a team.
  let user = null;
  if (crypto.timingSafeEqual(sha(req.body?.password || ''), sha(ADMIN_PASSWORD))) user = { id: 0, email: '', name: 'Owner', role: 'owner' };
  if (!user) {
    f.n++; if (f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60 * 1000; }
    fails.set(req.ip, f);
    return res.status(401).json({ error: 'Wrong password' });
  }
  fails.delete(req.ip);
  setCookie(req, res, signSession(Date.now() + SESSION_MS), SESSION_MS / 1000);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { setCookie(req, res, '', 0); res.json({ ok: true }); });
app.get('/api/me', (req, res) => { const u = loggedIn(req, res); res.json(u ? { ok: true, server: SERVER_URL, user: u } : { ok: false }); });
// (200 when logged out, so the browser console shows no red error)

// Everything else under /api goes to the HazelPOS server's vendor API. Writes must come from this app's own pages
// (the cookie is SameSite=Strict, and the header below can't be sent by a form on another site).
app.use('/api', async (req, res) => {
  const user = loggedIn(req);
  if (!user) return res.status(401).json({ error: 'Please log in' });
  if (req.method !== 'GET' && req.get('x-hazel-admin') !== '1') return res.status(403).json({ error: 'Not allowed' });
  // Only plain, known-shaped paths go to the server: no dot-dot, no encoded slashes or dots, no double slashes
  if (!/^\/[a-z0-9_\-]+(\/[a-z0-9_\-]+)*\/?$/i.test(req.path)) return res.status(400).json({ error: 'Bad address' });
  try {
    const r = await server(req.url, {
      method: req.method,
      headers: { 'X-Admin-User': user.email ? `${user.name} <${user.email}>` : user.name }, // who did it: the server's activity log
      body: req.method !== 'GET' ? JSON.stringify(req.body || {}) : undefined,
    });
    const body = Buffer.from(await r.arrayBuffer());
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(body);
  } catch (e) {
    res.status(502).json({ error: e.name === 'TimeoutError' ? 'The HazelPOS server took too long to answer' : `Can't reach the HazelPOS server (${SERVER_URL})` });
  }
});

// The screens (npm run build -> dist/)
const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST, { index: false, maxAge: '1h' }));
app.get(/.*/, (req, res) => fs.existsSync(path.join(DIST, 'index.html'))
  ? res.sendFile(path.join(DIST, 'index.html'))
  : res.status(503).send('Build the admin screens first: npm --prefix admin run build'));

const PORT = process.env.PORT || 4400;
app.listen(PORT, () => console.log(`HazelPOS Admin on http://localhost:${PORT} (server: ${SERVER_URL})`));
