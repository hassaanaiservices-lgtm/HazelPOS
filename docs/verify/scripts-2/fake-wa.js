// Preload (node -r fake-wa.js): replaces server/whatsapp/connection.js with a fake WhatsApp socket, in the POS and in
// the cloud (cloud/wa-host.js requires the same file). Nothing ever talks to WhatsApp.
// Control server on FAKEWA_PORT:
//   GET  /events                 every connect/stop/send/... as JSON lines
//   GET  /ids                    the connections made in this process ("local" on the POS, "<branch id>" on the cloud)
//   POST /link   {id}            mark as linked earlier (writes auth/creds.json), no connect
//   POST /scan   {id}            the owner scanned the QR: linked + connected
//   POST /force  {id}            force status connected (simulate a stop() race)
//   POST /inbound {id, chat, text, name}   a customer message arrives (store + assistant, like onMessages)
const Module = require('module');
const path = require('path');
const fs = require('fs');
const http = require('http');

const TAG = process.env.FAKEWA_TAG || 'proc';
const events = [];
const conns = new Map();
const log = (id, type, extra = {}) => {
  const e = { t: new Date().toISOString(), ms: Date.now(), proc: TAG, id, type, ...extra };
  events.push(e);
  if (process.env.FAKEWA_LOG) fs.appendFileSync(process.env.FAKEWA_LOG, JSON.stringify(e) + '\n');
};

function fakeConnection(store, hooks = {}) {
  const dir = hooks.dataDir || (process.env.HAZEL_DATA_DIR ? path.join(process.env.HAZEL_DATA_DIR, 'whatsapp') : path.join(__dirname, 'wa-local'));
  const id = hooks.dataDir ? path.basename(hooks.dataDir) : 'local';
  const AUTH = path.join(dir, 'auth'), CREDS = path.join(AUTH, 'creds.json'), MEDIA = path.join(dir, 'media');
  let status = 'disconnected', qr = null, me = null, connectedAt = 0, error = '';
  const linked = () => fs.existsSync(CREDS);
  async function connect() {
    if (process.env.WHATSAPP === 'off') throw new Error('WhatsApp is turned off on this server (WHATSAPP=off).');
    log(id, 'connect', { linked: linked() });
    if (linked()) { status = 'connected'; qr = null; me = '03001112233'; connectedAt = Date.now(); }
    else { status = 'qr'; qr = `data:image/png;base64,FAKEQR-${TAG}-${id}`; }
  }
  async function send(chatId, text, byUser, sender = 'staff') {
    if (status !== 'connected') { log(id, 'send-refused', { chat: chatId, text, sender }); throw new Error('WhatsApp is not connected right now (internet?). Try again in a moment.'); }
    log(id, 'send', { chat: chatId, text, sender, by: byUser });
    return store.addMessage({ wa_id: `fake-${TAG}-${Date.now()}-${Math.random()}`, chat_id: chatId, direction: 'out', sender, by_user: byUser, text, status: 1 }, { override: true });
  }
  async function sendImage(chatId, { caption = '' }, byUser, sender = 'staff', meta = null) {
    if (status !== 'connected') throw new Error('WhatsApp is not connected right now (internet?). Try again in a moment.');
    log(id, 'sendImage', { chat: chatId, caption, sender });
    return store.addMessage({ wa_id: `fake-img-${Date.now()}-${Math.random()}`, chat_id: chatId, direction: 'out', sender, by_user: byUser, kind: 'image', text: '📷 ' + (caption || 'Menu picture'), meta, status: 1 }, { override: true });
  }
  async function logout() { log(id, 'logout'); fs.rmSync(AUTH, { recursive: true, force: true }); status = 'disconnected'; qr = null; me = null; }
  function stop() { log(id, 'stop', { was: status }); status = 'disconnected'; qr = null; }
  const api = {
    stop, connect, send, sendImage, logout, linked,
    typing: () => {}, isConnected: () => status === 'connected',
    markRead: (chat, ids) => log(id, 'markRead', { chat, n: (ids || []).length }),
    mediaPath: f => path.join(MEDIA, path.basename(f)),
    status: () => ({ status, qr, me, error, connected_at: connectedAt ? new Date(connectedAt).toISOString() : null, last_online: store.meta.get('last_online') }),
  };
  conns.set(id, { store, hooks, api, link: () => { fs.mkdirSync(AUTH, { recursive: true }); fs.writeFileSync(CREDS, '{"fake":true}'); },
    force: () => { status = 'connected'; me = '03001112233'; connectedAt = Date.now(); } });
  const auto = hooks.autoConnect?.() !== false;
  log(id, 'created', { autoConnect: auto, linked: linked() });
  if (process.env.WHATSAPP !== 'off' && auto && linked()) setTimeout(() => { log(id, 'auto-connect'); connect().catch(() => {}); }, 1500);
  return api;
}

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  let file = '';
  try { file = Module._resolveFilename(request, parent, isMain); } catch { /* not a file */ }
  if (/[\\/]server[\\/]whatsapp[\\/]connection\.js$/.test(file)) return fakeConnection;
  return origLoad.apply(this, arguments);
};

if (process.env.FAKEWA_PORT) {
  http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const j = body ? JSON.parse(body) : {};
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/events') return send(200, events);
      if (req.url === '/ids') return send(200, [...conns.keys()]);
      const c = conns.get(String(j.id));
      if (!c) return send(404, { error: 'no connection ' + j.id });
      if (req.url === '/link') { c.link(); return send(200, { ok: true }); }
      if (req.url === '/scan') { c.link(); c.api.connect().then(() => send(200, c.api.status()), e => send(400, { error: e.message })); return; }
      if (req.url === '/force') { c.force(); log(j.id, 'forced-connected'); return send(200, c.api.status()); }
      if (req.url === '/inbound') {
        const chat = j.chat, phone = chat.split('@')[0].replace(/^92/, '0');
        c.store.upsertChat(chat, phone, j.name || 'Customer');
        const row = c.store.addMessage({ wa_id: j.wa_id || `in-${Date.now()}-${Math.random()}`, chat_id: chat, at: new Date().toISOString(), kind: j.kind || 'text', text: j.text,
          meta: j.meta || null, direction: 'in', sender: 'customer', status: 0, offline: false });
        log(j.id, 'inbound', { chat, text: j.text, stored: !!row });
        if (row && c.api.isConnected()) c.hooks.onIncoming?.(row); // the real socket only delivers while connected
        return send(200, { ok: true, row });
      }
      send(404, { error: 'unknown' });
    });
  }).listen(+process.env.FAKEWA_PORT, '127.0.0.1');
}
