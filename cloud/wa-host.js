// WhatsApp bot hosted on HazelPOS Cloud, so it keeps answering when the restaurant's PC is off.
//
// One WhatsApp connection per restaurant that you switch on in the admin app. It answers customers' questions from the
// menu, delivery zones, FAQ and menu photos that the restaurant's POS sends here whenever they change
// (POST /api/sync/wa-knowledge). Orders the customer confirms wait here until the POS takes them (GET /api/sync/wa-orders,
// every 20 s); the cashier's accept / reject, and later "ready" / "on the way" messages, are sent back through here.
//
// Each restaurant has its own folder (DATA_DIR/wa/<branch id>/): its WhatsApp login, voice notes, chats database and
// the last menu its POS sent. Nothing is shared between restaurants.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const waStore = require('../server/whatsapp/store');
const waConnection = require('../server/whatsapp/connection');
const { createAssistant } = require('../server/whatsapp/assistant');
const createStt = require('../server/whatsapp/stt');
const { config } = require('../rag/src/config');
const { ask } = require('../rag/src/pipeline');
const { cleanupTranscript } = require('../rag/src/generation/voice-cleanup');

const MAX_PICTURES_MB = 8;

module.exports = function waHost({ app, db, dataDir, branchAuth, vendorAuth, vendorBranch, membership, now }) {
  db.exec('CREATE TABLE IF NOT EXISTS wa_cloud (branch_id INTEGER PRIMARY KEY, enabled INTEGER DEFAULT 0, changed_at TEXT, changed_by TEXT)');
  const live = new Map(); // branch id -> { store, wa, assistant, sdb }
  module.exports.live = live; // tests drive the bot through this
  const dirOf = id => path.join(dataDir, 'wa', String(+id));
  const knowledgeFile = id => path.join(dirOf(id), 'knowledge.json');
  const cache = new Map(); // branch id -> { pos, pictures, at, hash }
  const statusTexts = new Map(); // branch id -> { chatId: { en, roman_ur, ur } }

  function knowledge(id) {
    if (cache.has(id)) return cache.get(id);
    let k = null;
    try {
      const j = JSON.parse(fs.readFileSync(knowledgeFile(id), 'utf8'));
      k = { ...j, pictures: (j.pictures || []).map(p => ({ ...p, data: Buffer.from(p.data, 'base64') })) };
    } catch { /* nothing sent yet */ }
    cache.set(id, k);
    return k;
  }
  const enabled = id => !!db.prepare('SELECT enabled FROM wa_cloud WHERE branch_id=?').get(id)?.enabled;
  const branch = id => db.prepare('SELECT * FROM branches WHERE id=?').get(id);

  function start(id) {
    if (live.has(id)) return live.get(id);
    fs.mkdirSync(dirOf(id), { recursive: true });
    const sdb = new DatabaseSync(path.join(dirOf(id), 'wa.db'));
    sdb.exec('PRAGMA journal_mode = WAL');
    const store = waStore(sdb);
    let assistant;
    const wa = waConnection(store, { dataDir: dirOf(id), onIncoming: row => assistant.onIncoming(row), keepAudioDays: config.stt.keep_audio_days });
    const pos = () => knowledge(id)?.pos;
    assistant = createAssistant({
      store, wa, cfg: config.assistant, stt: createStt(config.stt), sttCfg: config.stt,
      ask: args => ask({ ...args, pos: pos() }),
      cleanup: text => cleanupTranscript(text, pos()),
      menuPictures: () => knowledge(id)?.pictures || [],
      // Quiet until this restaurant's POS has sent its menu, and when its membership no longer covers the bot
      allowed: () => !!pos() && membership(branch(id)?.owner_id).ai_active !== false,
      // "Where is my order?": the live status the POS sends for today's delivery orders (POST /api/sync/wa-status)
      deliveryStatus: (chatId, lang) => { const t = statusTexts.get(id)?.[chatId]; return t ? t[lang] || t.roman_ur || null : null; },
      log: { error: (...a) => console.error(`[wa ${id}]`, ...a) },
    });
    const h = { store, wa, assistant, sdb };
    live.set(id, h);
    return h;
  }
  function stop(id) {
    const h = live.get(id); if (!h) return;
    h.wa.stop(); live.delete(id);
    try { h.sdb.close(); } catch { /* already closed */ }
  }
  // Restaurants switched on: start them (each reconnects by itself if it was linked before)
  for (const r of db.prepare('SELECT branch_id FROM wa_cloud WHERE enabled=1').all()) {
    try { start(r.branch_id); } catch (e) { console.error(`[wa ${r.branch_id}] start:`, e.message); }
  }

  // ---------- The POS sends its menu, zones, FAQ and menu photos (only when they changed) ----------
  app.post('/api/sync/wa-knowledge', branchAuth, (req, res) => {
    const { pos, pictures = [] } = req.body || {};
    if (!pos || !Array.isArray(pos.menu) || !Array.isArray(pos.categories) || typeof pos.restaurant !== 'object')
      return res.status(400).json({ error: 'Menu data is missing' });
    const pics = (Array.isArray(pictures) ? pictures : []).slice(0, 20)
      .filter(p => typeof p?.data === 'string' && /^image\/(jpeg|png|webp)$/.test(p.mime))
      .map(p => ({ id: +p.id || 0, caption: String(p.caption || '').slice(0, 200), mime: p.mime, data: p.data }));
    if (pics.reduce((n, p) => n + p.data.length * 0.75, 0) > MAX_PICTURES_MB * 1e6) return res.status(413).json({ error: `Menu photos are over ${MAX_PICTURES_MB} MB` });
    const id = req.branch.id;
    const body = { pos: { ...pos, menu_pictures: pics.length }, pictures: pics, at: now(), hash: String(req.body.hash || '').slice(0, 64) };
    fs.mkdirSync(dirOf(id), { recursive: true });
    const tmp = knowledgeFile(id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(body)); fs.renameSync(tmp, knowledgeFile(id));
    cache.delete(id);
    res.json({ ok: true });
  });
  // What the POS needs to know: the hash of the menu we have (so it only sends changes), and whether the bot runs
  // here (then the POS's own bot stays quiet, so a customer never gets two answers)
  app.get('/api/sync/wa-mode', branchAuth, (req, res) => {
    let hash = null;
    try { hash = JSON.parse(fs.readFileSync(knowledgeFile(req.branch.id), 'utf8')).hash || null; } catch { /* none yet */ }
    res.json({ cloud: enabled(req.branch.id), knowledge_hash: hash });
  });

  // ---------- Admin app: switch on, link by QR, see what the bot did ----------
  const view = id => {
    const h = live.get(id), k = knowledge(id);
    return {
      enabled: enabled(id),
      ...(h ? { ...h.wa.status(), ...h.store.counts(), assistant: h.assistant.enabled() } : { status: 'off' }),
      menu_at: k?.at || null, menu_items: k?.pos?.menu?.length || 0, menu_pictures: k?.pictures?.length || 0,
      log: h ? h.sdb.prepare('SELECT at, chat_id, in_text, action, reply, error FROM wa_bot_log ORDER BY id DESC LIMIT 20').all().map(r => ({ ...r })) : [],
    };
  };
  app.get('/api/vendor/branches/:id/whatsapp', vendorAuth, (req, res) => {
    const b = vendorBranch(req, res); if (!b) return;
    res.json(view(b.id));
  });
  app.post('/api/vendor/branches/:id/whatsapp/enable', vendorAuth, (req, res) => {
    const b = vendorBranch(req, res); if (!b) return;
    const on = !!req.body.enabled;
    db.prepare('INSERT INTO wa_cloud (branch_id, enabled, changed_at, changed_by) VALUES (?,?,?,?) ON CONFLICT(branch_id) DO UPDATE SET enabled=excluded.enabled, changed_at=excluded.changed_at, changed_by=excluded.changed_by')
      .run(b.id, on ? 1 : 0, now(), req.who);
    if (on) start(b.id); else stop(b.id);
    res.json(view(b.id));
  });
  const running = (req, res) => {
    const b = vendorBranch(req, res); if (!b) return null;
    const h = live.get(b.id);
    if (!h) res.status(400).json({ error: 'Switch on the cloud WhatsApp bot for this restaurant first' });
    return h && { b, h };
  };
  app.post('/api/vendor/branches/:id/whatsapp/connect', vendorAuth, async (req, res) => {
    const x = running(req, res); if (!x) return;
    try { await x.h.wa.connect(); res.json(view(x.b.id)); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/vendor/branches/:id/whatsapp/logout', vendorAuth, async (req, res) => {
    const x = running(req, res); if (!x) return;
    await x.h.wa.logout(); res.json(view(x.b.id));
  });
  app.post('/api/vendor/branches/:id/whatsapp/assistant', vendorAuth, (req, res) => {
    const x = running(req, res); if (!x) return;
    x.h.assistant.setEnabled(!!req.body.enabled); res.json(view(x.b.id));
  });

  // ---------- Orders: the POS takes the confirmed ones and sends the cashier's answer back ----------
  const liveFor = (req, res) => {
    const h = live.get(req.branch.id);
    if (!h) res.status(409).json({ error: 'The cloud WhatsApp bot is switched off for this restaurant' });
    return h;
  };
  app.get('/api/sync/wa-orders', branchAuth, (req, res) => {
    const h = live.get(req.branch.id);
    res.json(h ? h.store.ordersForPos() : []);
  });
  app.post('/api/sync/wa-orders/ack', branchAuth, (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    for (const id of (Array.isArray(req.body.ids) ? req.body.ids : []).slice(0, 50)) h.store.markPosReceived(+id);
    res.json({ ok: true });
  });
  // The cashier accepted (order_id = the POS order) or rejected it; message = what the customer gets, written by the POS
  app.post('/api/sync/wa-orders/:id/result', branchAuth, async (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    const status = req.body.status === 'accepted' ? 'accepted' : 'rejected';
    const w = h.store.getOrder(+req.params.id);
    if (!w || !h.store.finishOrder(w.id, status, String(req.body.by || 'POS').slice(0, 80),
      { order_id: status === 'accepted' ? +req.body.order_id || null : null, reason: String(req.body.reason || '').slice(0, 200) })) return res.status(404).json({ error: 'This order was already handled' });
    let message_sent = false;
    const text = String(req.body.message || '').slice(0, 4000);
    if (text) try { await h.wa.send(w.chat_id, text, 'Order update', 'system'); message_sent = true; } catch { /* WhatsApp not connected */ }
    res.json({ ok: true, message_sent });
  });
  // "Your order is ready" / "the rider is on the way": only to customers who already chat with this restaurant
  const sendTimes = new Map(); // branch id -> recent send times (at most 30 a minute)
  const tooMany = req => {
    const t = (sendTimes.get(req.branch.id) || []).filter(x => x > Date.now() - 60_000);
    if (t.length >= 30) return true;
    t.push(Date.now()); sendTimes.set(req.branch.id, t); return false;
  };
  app.post('/api/sync/wa-send', branchAuth, async (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    const chatId = String(req.body.chat_id || ''), text = String(req.body.text || '').trim().slice(0, 4000);
    if (!text || !h.store.chat(chatId)) return res.status(400).json({ error: 'Unknown chat' });
    if (tooMany(req)) return res.status(429).json({ error: 'Too many messages: try again in a minute' });
    try { await h.wa.send(chatId, text, String(req.body.label || 'Order update').slice(0, 40), 'system'); res.json({ ok: true }); }
    catch (e) { res.status(409).json({ error: e.message }); }
  });

  // The restaurant's own messages to a number (the rider's link, the owner's low-stock alert), from its own WhatsApp
  app.post('/api/sync/wa-send-phone', branchAuth, async (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    const jid = String(req.body.jid || ''), text = String(req.body.text || '').trim().slice(0, 4000);
    if (!/^\d{10,15}@s\.whatsapp\.net$/.test(jid) || !text) return res.status(400).json({ error: 'Bad number or empty message' });
    if (tooMany(req)) return res.status(429).json({ error: 'Too many messages: try again in a minute' });
    try { await h.wa.send(jid, text, String(req.body.label || 'Message').slice(0, 40), 'system'); res.json({ ok: true }); }
    catch (e) { res.status(409).json({ error: e.message }); }
  });

  // ---------- The POS's inbox and replies (POS → /api/whatsapp/* → here, while the cloud bot is on) ----------
  const W = '/api/sync/wa';
  const chatOf = (req, res, h) => { const c = h.store.chat(req.params.id); if (!c) res.status(404).json({ error: 'Chat not found' }); return c; };
  // The QR is passed on too: the owner can link the restaurant's number from the POS (it is their own branch key)
  app.get(`${W}/status`, branchAuth, (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    res.json({ ...h.wa.status(), ...h.store.counts(), assistant: h.assistant.enabled() });
  });
  app.post(`${W}/connect`, branchAuth, async (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    try { await h.wa.connect(); res.json(h.wa.status()); } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post(`${W}/logout`, branchAuth, async (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    await h.wa.logout(); res.json(h.wa.status());
  });
  app.get(`${W}/chats`, branchAuth, (req, res) => { const h = liveFor(req, res); if (h) res.json(h.store.chats()); });
  app.get(`${W}/chats/:id/messages`, branchAuth, (req, res) => { const h = liveFor(req, res); if (h) res.json(h.store.messages(req.params.id, +req.query.after || 0)); });
  app.get(`${W}/chats/:id/log`, branchAuth, (req, res) => { const h = liveFor(req, res); if (h) res.json(h.store.logFor(req.params.id)); });
  app.post(`${W}/chats/:id/read`, branchAuth, (req, res) => {
    const h = liveFor(req, res); if (!h || !chatOf(req, res, h)) return;
    h.wa.markRead(req.params.id, h.store.markRead(req.params.id)); res.json({ ok: true });
  });
  app.post(`${W}/chats/:id/handled`, branchAuth, (req, res) => {
    const h = liveFor(req, res); if (!h || !chatOf(req, res, h)) return;
    h.store.resolveOffline(req.params.id, String(req.body.by || 'POS').slice(0, 80)); h.store.setChatFlag(req.params.id, 'needs_attention', 0); res.json({ ok: true });
  });
  app.post(`${W}/chats/:id/bot`, branchAuth, (req, res) => {
    const h = liveFor(req, res); if (!h || !chatOf(req, res, h)) return;
    h.store.setChatFlag(req.params.id, 'bot_paused', !!req.body.paused); res.json({ ok: true });
  });
  app.post(`${W}/chats/:id/send`, branchAuth, async (req, res) => {
    const h = liveFor(req, res); if (!h || !chatOf(req, res, h)) return;
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Type a message first' });
    if (text.length > 4000) return res.status(400).json({ error: 'Message is too long' });
    try {
      const m = await h.wa.send(req.params.id, text, String(req.body.by || 'Staff').slice(0, 80), 'staff');
      h.store.setChatFlag(req.params.id, 'needs_attention', 0);
      res.json(m);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post(`${W}/assistant`, branchAuth, (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    h.assistant.setEnabled(!!req.body.enabled); res.json({ assistant: h.assistant.enabled() });
  });
  app.get(`${W}/messages/:id/audio`, branchAuth, (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    const m = h.store.message(+req.params.id);
    const file = m?.meta?.file && h.wa.mediaPath(m.meta.file);
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Voice note not available (deleted after a while)' });
    res.type('audio/ogg').sendFile(file);
  });
  app.post(`${W}/messages/:id/transcript`, branchAuth, (req, res) => {
    const h = liveFor(req, res); if (!h) return;
    const m = h.store.message(+req.params.id);
    if (!m?.meta?.file) return res.status(404).json({ error: 'Not a voice note' });
    const corrected = req.body.corrected == null ? null : String(req.body.corrected).trim().slice(0, 2000);
    const rating = [1, -1].includes(+req.body.rating) ? +req.body.rating : null;
    h.store.updateMeta(m.id, { stt_rating: rating ?? m.meta.stt_rating ?? null, ...(corrected != null ? { corrected } : {}) });
    res.json({ ok: true, message: h.store.message(m.id) });
  });
  // Today's delivery status per chat, in the three languages, so the cloud bot can answer "where is my order?"
  app.post('/api/sync/wa-status', branchAuth, (req, res) => {
    const out = {};
    for (const [chat, t] of Object.entries(req.body.chats || {}).slice(0, 500))
      if (t && typeof t === 'object') out[String(chat).slice(0, 120)] = Object.fromEntries(['en', 'roman_ur', 'ur'].map(l => [l, String(t[l] || '').slice(0, 1000)]));
    statusTexts.set(req.branch.id, out);
    res.json({ ok: true });
  });

  const statusOf = id => {
    if (!enabled(id)) return null;
    const h = live.get(id), w = h?.wa.status() || {};
    return { status: w.status || 'off', connected_at: w.connected_at || null, error: w.error || '', assistant: h ? h.assistant.enabled() : null, on_cloud: true };
  };

  return { statusOf, live, start, stop, knowledge, hashOf: v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex') };
};
