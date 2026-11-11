// The restaurant's WhatsApp number, linked to the POS by scanning a QR code (like WhatsApp Web), through Baileys.
// The login is kept in server/whatsapp/auth/ so the POS reconnects by itself after a restart or after the internet
// comes back. The POS never waits on WhatsApp: if there is no internet, this module just keeps retrying quietly.
//
// Offline messages: while the POS is offline, customers' messages wait on WhatsApp's servers. When we reconnect
// they are delivered; anything sent before this connection opened is flagged `offline` so the cashier contacts them.
// Note: Baileys is an unofficial WhatsApp Web client. Replying to customers who message first is the normal, low-risk use;
// bulk or spam-like sending can get a number restricted by WhatsApp.
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const AUTH_DIR = path.join(__dirname, 'auth');
// WHATSAPP=off: never connect (test copies, the demo server). Two servers on one WhatsApp login push each other off,
// and the second one could answer real customers from the wrong database.
const OFF = process.env.WHATSAPP === 'off';
const MEDIA_DIR = path.join(__dirname, 'media'); // voice notes, so staff can listen and the engine can transcribe
const HEARTBEAT_MS = 30_000;        // how often we note "still online", to know later what we missed
const OFFLINE_GRACE_MS = 20_000;    // messages this close to the connection opening count as live
const HISTORY_MARGIN_MS = 120_000;  // ignore messages older than our last moment online (they're history, not missed)
const silent = { level: 'silent', child() { return silent; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

// 923001234567@s.whatsapp.net -> 03001234567
const phoneOf = jid => { const d = String(jid || '').split('@')[0].split(':')[0]; return d.startsWith('92') ? '0' + d.slice(2) : d; };
const tsOf = m => 1000 * Number(m.messageTimestamp?.toNumber?.() ?? m.messageTimestamp ?? 0) || Date.now();
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// WhatsApp message content -> what the cashier sees. null = nothing to show (reactions, deletes, key exchanges…)
function parse(c) {
  if (!c) return null;
  const t = c.conversation || c.extendedTextMessage?.text;
  if (t) return { kind: 'text', text: t };
  if (c.imageMessage) return { kind: 'image', text: '📷 Photo' + (c.imageMessage.caption ? `\n${c.imageMessage.caption}` : '') };
  if (c.videoMessage) return { kind: 'video', text: '🎥 Video' + (c.videoMessage.caption ? `\n${c.videoMessage.caption}` : '') };
  if (c.audioMessage) return { kind: c.audioMessage.ptt ? 'voice' : 'audio', text: `🎤 Voice message (${c.audioMessage.seconds || 0}s)`, meta: { seconds: +c.audioMessage.seconds || 0 } };
  if (c.documentMessage) return { kind: 'document', text: '📄 ' + (c.documentMessage.fileName || 'Document') };
  if (c.documentWithCaptionMessage) return parse(c.documentWithCaptionMessage.message);
  if (c.stickerMessage) return { kind: 'sticker', text: '🏷️ Sticker' };
  const loc = c.locationMessage || c.liveLocationMessage;
  if (loc) return { kind: 'location', text: '📍 ' + (loc.name || loc.address || 'Location'), meta: { lat: loc.degreesLatitude, lng: loc.degreesLongitude } };
  if (c.contactMessage) return { kind: 'contact', text: '👤 Contact: ' + (c.contactMessage.displayName || '') };
  const pick = c.buttonsResponseMessage?.selectedDisplayText || c.listResponseMessage?.title || c.templateButtonReplyMessage?.selectedDisplayText;
  if (pick) return { kind: 'text', text: pick };
  return null;
}

// hooks.onIncoming(row): called for every new live customer message (not for messages that arrived while offline)
module.exports = function waConnection(store, hooks = {}) {
  let sock = null, status = 'disconnected', qr = null, me = null, error = '';
  let wanted = false, retryMs = 4000, connectedAt = 0, acceptFrom = 0, heartbeat = null, retryTimer = null;

  const goOnline = () => {
    const prev = Date.parse(store.meta.get('last_online') || '') || 0;
    connectedAt = Date.now();
    // Accept what arrived since we were last online; on a brand-new link, only new messages
    acceptFrom = (prev || connectedAt) - HISTORY_MARGIN_MS;
    store.meta.set('last_online', new Date().toISOString());
    clearInterval(heartbeat);
    heartbeat = setInterval(() => store.meta.set('last_online', new Date().toISOString()), HEARTBEAT_MS);
    heartbeat.unref();
  };
  const goOffline = () => { if (heartbeat && connectedAt) store.meta.set('last_online', new Date().toISOString()); clearInterval(heartbeat); heartbeat = null; };

  function onMessages(B, { messages }) {
    for (const m of messages) {
      const jid = m.key?.remoteJid || '';
      if (!jid || jid.endsWith('@g.us') || jid.includes('broadcast') || jid.endsWith('@newsletter')) continue; // 1:1 chats only
      const at = tsOf(m);
      if (at < acceptFrom) continue; // history from before our last time online
      const p = parse(B.normalizeMessageContent(m.message)); // unwraps disappearing / view-once / edited wrappers
      if (!p) continue;
      const phoneJid = [m.key.remoteJid, m.key.remoteJidAlt].find(j => j?.endsWith('@s.whatsapp.net'));
      const phone = phoneJid ? phoneOf(phoneJid) : '';
      const chatId = (phone && store.chatIdByPhone(phone)) || jid; // keep one chat per customer even if WhatsApp switches IDs
      store.upsertChat(chatId, phone, m.key.fromMe ? '' : m.pushName);
      const row = store.addMessage({
        wa_id: m.key.id, chat_id: chatId, at: new Date(at).toISOString(), ...p,
        direction: m.key.fromMe ? 'out' : 'in', sender: m.key.fromMe ? 'phone' : 'customer', status: m.key.fromMe ? 1 : 0,
        offline: !m.key.fromMe && at < connectedAt - OFFLINE_GRACE_MS,
      });
      if (!row) continue;
      const tell = r => { if (r.direction === 'in' && !r.offline) try { hooks.onIncoming?.(r); } catch (e) { console.error('WhatsApp assistant:', e.message); } };
      // Voice notes are saved first (staff can listen; the assistant transcribes them), then handed on
      if (['voice', 'audio'].includes(row.kind)) saveAudio(B, m, row).then(tell, e => { console.error('WhatsApp voice note:', e.message); tell(row); });
      else tell(row);
    }
  }

  // Downloads from WhatsApp fail now and then on a weak connection: retry after 2, 5 and 10 s before giving up
  async function saveAudio(B, m, row) {
    let buffer, lastErr;
    for (const wait of [0, 2000, 5000, 10000]) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      try { buffer = await B.downloadMediaMessage(m, 'buffer', {}, { logger: silent, reuploadRequest: sock?.updateMediaMessage }); break; }
      catch (e) { lastErr = e; }
    }
    if (!buffer) { store.updateMeta(row.id, { download_error: lastErr?.message || 'download failed' }); throw lastErr || new Error('download failed'); }
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const file = `${String(row.wa_id).replace(/[^\w-]/g, '')}.ogg`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), buffer);
    return store.updateMeta(row.id, { file });
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => connect().catch(() => {}), retryMs);
    retryMs = Math.min(retryMs * 2, 60_000);
  }

  async function connect() {
    if (OFF) throw new Error('WhatsApp is turned off on this server (WHATSAPP=off).');
    wanted = true;
    if (sock) return;
    clearTimeout(retryTimer);
    if (status !== 'reconnecting') status = 'connecting';
    try {
      const B = await import('@whiskeysockets/baileys');
      const { state, saveCreds } = await B.useMultiFileAuthState(AUTH_DIR);
      const { version } = await withTimeout(B.fetchLatestBaileysVersion(), 5000).catch(() => ({}));
      sock = B.default({ auth: state, version, browser: B.Browsers.ubuntu('HazelPOS'), logger: silent, markOnlineOnConnect: false, syncFullHistory: false });
      const s = sock;
      s.ev.on('creds.update', saveCreds);
      s.ev.on('connection.update', async u => {
        if (s !== sock) return;
        if (u.qr) { status = 'qr'; qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 }); }
        if (u.connection === 'open') { status = 'connected'; qr = null; me = phoneOf(s.user?.id); error = ''; retryMs = 4000; goOnline(); }
        if (u.connection === 'close') {
          const code = u.lastDisconnect?.error?.output?.statusCode;
          const linked = !!state.creds?.registered || !!me;
          sock = null; qr = null; goOffline();
          if (code === B.DisconnectReason.loggedOut) {
            status = 'disconnected'; me = null; wanted = false; error = 'This POS was logged out from the phone. Link again to continue.';
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } else if (code === B.DisconnectReason.connectionReplaced) {
            status = 'disconnected'; wanted = false; error = 'WhatsApp was opened for this number on another computer. Press Reconnect to use it here.';
          } else if (code === B.DisconnectReason.restartRequired) {
            connect().catch(() => {}); // normal right after scanning the QR
          } else if (linked && wanted) {
            status = 'reconnecting'; error = 'No connection to WhatsApp (internet?). Retrying automatically…'; scheduleRetry();
          } else {
            status = 'disconnected'; wanted = false; error = linked ? '' : 'The QR code expired. Press "Link WhatsApp" to get a new one.';
          }
        }
      });
      s.ev.on('messages.upsert', ev => { try { onMessages(B, ev); } catch (e) { console.error('WhatsApp message:', e.message); } });
      s.ev.on('messages.update', updates => {
        for (const { key, update } of updates) {
          if (key?.fromMe && update?.status != null) store.setStatus(key.id, Math.min(3, Math.max(1, update.status - 1))); // 2 server, 3 delivered, 4+ read
        }
      });
    } catch (e) {
      sock = null;
      if (fs.existsSync(path.join(AUTH_DIR, 'creds.json')) && wanted) { status = 'reconnecting'; error = e.message; scheduleRetry(); }
      else { status = 'disconnected'; error = e.message; throw e; }
    }
  }

  // sender: 'staff' (typed in the POS), 'bot' (the assistant) or 'system' (automatic order updates)
  async function send(chatId, text, byUser, sender = 'staff') {
    if (!sock || status !== 'connected') throw new Error('WhatsApp is not connected right now (internet?). Try again in a moment.');
    const r = await sock.sendMessage(chatId, { text });
    return store.addMessage({ wa_id: r?.key?.id || `local-${Date.now()}`, chat_id: chatId, direction: 'out', sender, by_user: byUser, text, status: 1 }, { override: true });
  }
  // "typing…" on the customer's phone
  const typing = (chatId, on = true) => { if (sock && status === 'connected') sock.sendPresenceUpdate(on ? 'composing' : 'paused', chatId).catch(() => {}); };
  const isConnected = () => !!sock && status === 'connected';

  // Blue ticks on the customer's phone for messages the cashier has now seen
  const markRead = (chatId, waIds) => { if (sock && status === 'connected' && waIds.length) sock.readMessages(waIds.map(id => ({ remoteJid: chatId, id, fromMe: false }))).catch(() => {}); };

  async function logout() {
    wanted = false; clearTimeout(retryTimer);
    const s = sock; sock = null;
    try { await s?.logout(); } catch { /* already gone */ }
    goOffline(); store.meta.set('last_online', ''); status = 'disconnected'; qr = null; me = null; error = '';
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }

  // Voice notes are kept for a while, then deleted
  const cleanMedia = () => {
    try { for (const f of fs.readdirSync(MEDIA_DIR)) { const p = path.join(MEDIA_DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > (hooks.keepAudioDays || 14) * 864e5) fs.rmSync(p); } }
    catch { /* no folder yet */ }
  };
  cleanMedia(); setInterval(cleanMedia, 864e5).unref();

  // Already linked before: reconnect by itself when the POS starts
  if (!OFF && fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) setTimeout(() => connect().catch(e => console.error('WhatsApp reconnect:', e.message)), 1500);

  return {
    connect, send, typing, isConnected, markRead, logout, mediaPath: file => path.join(MEDIA_DIR, path.basename(file)),
    status: () => ({ status, qr, me, error, connected_at: connectedAt ? new Date(connectedAt).toISOString() : null, last_online: store.meta.get('last_online') }),
  };
};
