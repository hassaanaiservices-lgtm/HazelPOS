// HazelPOS's OWN WhatsApp number (not a restaurant's): sends sign-in codes, welcome and reset links and invoices.
// Linked once by scanning a QR in the admin panel (Settings -> HazelPOS WhatsApp). Reuses the per-restaurant connection code
// with its own folder (DATA_DIR/vendor-wa/) and a minimal store: no chats are kept, nothing is answered.
// When the number is not linked, sendText only logs "VENDOR-WA (not connected) to <phone>: <text>" and callers carry on.
const fs = require('fs');
const path = require('path');
const waConnection = require('./whatsapp/connection');
const { DATA_DIR } = require('./tenancy');

const dir = path.join(DATA_DIR, 'vendor-wa');
const OFF = process.env.WHATSAPP === 'off';
const metaFile = path.join(dir, 'meta.json');
const metaStore = () => { try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { return {}; } };
const store = {
  meta: {
    get: k => metaStore()[k],
    set: (k, v) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(metaFile, JSON.stringify({ ...metaStore(), [k]: v })); },
  },
  chatIdByPhone: () => null, upsertChat() {}, addMessage: () => null, setStatus() {}, updateMeta() {},
};

let conn = null;
const linked = () => fs.existsSync(path.join(dir, 'auth', 'creds.json'));
function connection() {
  fs.mkdirSync(dir, { recursive: true });
  return conn || (conn = waConnection(store, { dataDir: dir, allowWhenOff: true, autoConnect: () => !OFF })); // incoming messages are never handled (no onIncoming)
}
if (linked() && !OFF) connection(); // reconnects by itself after a restart

// 0300 1234567 / +92 300 1234567 -> { local: '03001234567', jid: '923001234567@s.whatsapp.net' }
function normalise(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('92')) d = '0' + d.slice(2);
  if (!/^03\d{9}$/.test(d)) return null;
  return { local: d, jid: '92' + d.slice(1) + '@s.whatsapp.net' };
}

let tail = Promise.resolve(), lastSent = 0;
function sendText(phone, text) {
  const n = normalise(phone);
  if (!n) { console.log(`VENDOR-WA (bad number) to ${phone}: ${text}`); return Promise.resolve({ sent: false }); }
  const c = conn;
  if (!c || !c.isConnected()) { console.log(`VENDOR-WA (not connected) to ${n.local}: ${text}`); return Promise.resolve({ sent: false }); }
  // At most one message a second
  const job = tail.then(async () => {
    const wait = lastSent + 1000 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastSent = Date.now();
    try { await c.send(n.jid, text, 'vendor', 'system'); return { sent: true }; }
    catch (e) { console.log(`VENDOR-WA (send failed: ${e.message}) to ${n.local}: ${text}`); return { sent: false }; }
  });
  tail = job.catch(() => {});
  return job;
}

// { state: 'not_linked' | 'connecting' | 'qr' | 'connected' | 'reconnecting', phone?, qr?, error? }
function status() {
  if (!conn) return { state: 'not_linked' };
  const s = conn.status();
  const state = s.status === 'disconnected' ? 'not_linked' : s.status;
  return { state, phone: s.me || undefined, qr: s.qr || undefined, error: s.error || undefined };
}
async function link() {
  const c = connection();
  if (!c.isConnected()) await c.connect();
  return status();
}
async function logout() { if (conn || linked()) await connection().logout(); return status(); }

module.exports = { sendText, status, link, logout, normalise };
