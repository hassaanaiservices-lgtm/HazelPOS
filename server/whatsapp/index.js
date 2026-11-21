// WhatsApp for the online server: one bot per restaurant, created lazily (Connect pressed, or saved login at server start).
// Each instance gets that restaurant's REAL database (never the tenancy proxy), its own folder
// DATA_DIR/tenants/<id>/wa/ (login, voice notes) and POS hooks that run inside tenancy.run(id, ...).
// The HTTP routes are registered once (manager.router) and pick the instance of the restaurant in the request.
const fs = require('fs');
const path = require('path');
const express = require('express');
const waStore = require('./store');
const waConnection = require('./connection');
const { createAssistant } = require('./assistant');
const createStt = require('./stt');
const { acceptedMessage, rejectedMessage } = require('./messages');
const { config } = require('../../rag/src/config');
const rag = require('../../rag/src/pipeline');
const { cleanupTranscript } = require('../../rag/src/generation/voice-cleanup');
const { readPosDb } = require('../../rag/src/loaders/pos-db');

const OFF = process.env.WHATSAPP === 'off';
const POS_TTL_MS = 60_000;
const STAGGER_MS = 2000;

// pos = { createOrder, getOrder, printKitchen, getSettings, deliveryStatus }: the POS's own functions (they use the
// tenancy proxy, so every call here is wrapped in tenancy.run).
module.exports = function whatsappManager({ tenancy, pos, askImpl = rag.ask }) {
  const live = new Map();     // tenant id -> instance
  const posCache = new Map(); // tenant id -> { pos, at }
  const log = (id, what) => console.log(`[wa ${id}] ${what} (running: ${live.size})`);
  const dirOf = id => path.join(tenancy.DATA_DIR, 'tenants', String(id), 'wa');
  const hasCreds = id => fs.existsSync(path.join(dirOf(id), 'auth', 'creds.json'));

  // Active (not suspended or cancelled) and the plan allows WhatsApp (default: yes)
  function allowed(id) {
    const t = tenancy.tenantRow(id);
    if (!t || ['suspended', 'cancelled'].includes(t.status)) return false;
    try { return JSON.parse(t.features || '{}').whatsapp !== false; } catch { return true; }
  }

  // What the assistant may know: this restaurant's menu, zones, FAQ. Cached 60 s or until invalidate(id)
  function posData(id) {
    const c = posCache.get(id);
    if (c && Date.now() - c.at < POS_TTL_MS) return c.pos;
    const data = readPosDb(tenancy.open(id), config.data);
    posCache.set(id, { pos: data, at: Date.now() });
    return data;
  }
  const invalidate = id => { posCache.delete(id); };

  function start(id) {
    if (live.has(id)) return live.get(id);
    if (!allowed(id)) throw new Error('WhatsApp is not available for this restaurant (account suspended or not in the plan)');
    const db = tenancy.open(id); // the real DatabaseSync
    const store = waStore(db);
    db.exec(`CREATE TABLE IF NOT EXISTS stt_feedback (id INTEGER PRIMARY KEY, message_id INTEGER, file TEXT, model TEXT,
      transcript TEXT, corrected TEXT, rating INTEGER, at TEXT, by_user TEXT)`);
    const wrap = fn => fn && ((...a) => tenancy.run(id, () => fn(...a)));
    const stt = createStt(config.stt);
    let assistant;
    const wa = waConnection(store, { dataDir: dirOf(id), onIncoming: row => assistant.onIncoming(row), keepAudioDays: config.stt.keep_audio_days, autoConnect: () => allowed(id) });
    const h = {
      id, db, store, wa, stt,
      hooks: { createOrder: wrap(pos.createOrder), getOrder: wrap(pos.getOrder), printKitchen: wrap(pos.printKitchen), getSettings: wrap(pos.getSettings), deliveryStatus: wrap(pos.deliveryStatus) },
    };
    assistant = createAssistant({
      store, wa, cfg: config.assistant, stt, sttCfg: config.stt,
      ask: args => askImpl({ ...args, pos: posData(id) }),
      cleanup: text => cleanupTranscript(text, posData(id)),
      menuPictures: () => db.prepare('SELECT id, caption, mime, data FROM menu_images ORDER BY sort, id').all(),
      allowed: () => allowed(id),
      deliveryStatus: h.hooks.deliveryStatus || (() => null),
      log: { error: (...a) => console.error(`[wa ${id}]`, ...a) },
    });
    h.assistant = assistant;
    live.set(id, h);
    log(id, 'started');
    return h;
  }
  function stop(id) {
    const h = live.get(id); if (!h) return false;
    h.wa.stop(); live.delete(id); posCache.delete(id);
    log(id, 'stopped');
    return true;
  }

  // Server start: only restaurants with a saved login, 2 s apart. WHATSAPP=off starts nothing.
  function startAll() {
    if (OFF) return;
    let n = 0;
    for (const t of tenancy.control.prepare('SELECT id FROM tenants').all()) {
      if (!hasCreds(t.id) || !allowed(t.id)) continue;
      setTimeout(() => { try { start(t.id); } catch (e) { console.error(`[wa ${t.id}] start:`, e.message); } }, n++ * STAGGER_MS).unref();
    }
  }
  // Suspend stops a bot (the login stays); activate starts it again if it was linked
  const paused = new Set(); // bots stopped because the restaurant was suspended: restart them on activate
  function reconcile(id) {
    if (OFF) return;
    const running = live.has(id), ok = allowed(id);
    if (running && !ok) { stop(id); paused.add(id); }
    else if (!running && ok && paused.has(id)) { paused.delete(id); if (hasCreds(id)) try { start(id); } catch (e) { console.error(`[wa ${id}] start:`, e.message); } } // only a linked bot comes back; a never-linked one stays off until Connect
  }
  tenancy.onStatusChange(reconcile);
  const sweep = setInterval(() => { for (const id of [...live.keys(), ...paused]) reconcile(id); }, 5000);
  sweep.unref();

  const stateOf = id => { const h = live.get(id); return h ? h.wa.status().status : 'off'; };
  tenancy.hooks.waState = stateOf;

  // ---- Routes (once). The restaurant comes from the request context ----
  const router = express.Router();
  const fail = (res, e, code = 400) => res.status(code).json({ error: e.message });
  const cur = () => live.get(tenancy.current()?.tenant.id);
  const statusBody = h => ({ ...h.wa.status(), state: h.wa.status().status, ...h.store.counts(), assistant: h.assistant.enabled(), assistant_paused_unpaid: false, business_hours: config.assistant.business_hours, stt: h.stt.status() });

  // Not linked yet: 'disconnected', so the WhatsApp screen shows and the owner can press Connect. 'off' only when the server turns WhatsApp off.
  router.get('/status', (req, res) => { const h = cur(); res.json(h ? statusBody(h) : OFF && process.env.DEMO !== '1' ? { state: 'off', status: 'off' } // the demo shows the screen; Connect explains
    : { state: 'disconnected', status: 'disconnected', unread: 0, offline_chats: 0, needs_attention: 0, orders_pending: 0, assistant: false, business_hours: config.assistant.business_hours }); });
  router.post('/connect', async (req, res) => {
    if (OFF) return res.status(400).json({ error: 'WhatsApp is turned off on this server (WHATSAPP=off).' });
    try { const h = start(tenancy.current().tenant.id); await h.wa.connect(); res.json(statusBody(h)); } catch (e) { fail(res, e); }
  });
  // Everything below needs an instance
  router.use((req, res, next) => {
    const h = cur();
    if (!h) return req.method === 'GET' && !/\/audio$/.test(req.path) ? res.json([]) : res.status(409).json({ error: 'Connect WhatsApp first' }); // lists are just empty until linked
    req.wa = h; next();
  });
  const chatId = req => req.params.id;
  router.post('/logout', async (req, res) => { await req.wa.wa.logout(); res.json(statusBody(req.wa)); });
  router.post('/assistant', (req, res) => { req.wa.assistant.setEnabled(!!req.body.enabled); res.json({ assistant: req.wa.assistant.enabled() }); });

  router.get('/chats', (req, res) => res.json(req.wa.store.chats()));
  router.get('/chats/:id/messages', (req, res) => res.json(req.wa.store.messages(chatId(req), +req.query.after || 0)));
  router.post('/chats/:id/read', (req, res) => { const { wa, store } = req.wa; wa.markRead(chatId(req), store.markRead(chatId(req))); res.json({ ok: true }); });
  // "Done": staff contacted this customer another way (call, etc.); also clears "needs you"
  router.post('/chats/:id/handled', (req, res) => { const { store } = req.wa; store.resolveOffline(chatId(req), req.user.name); store.setChatFlag(chatId(req), 'needs_attention', 0); res.json({ ok: true }); });
  router.post('/chats/:id/bot', (req, res) => { req.wa.store.setChatFlag(chatId(req), 'bot_paused', !!req.body.paused); res.json({ ok: true }); });
  router.get('/chats/:id/log', (req, res) => res.json(req.wa.store.logFor(chatId(req))));
  router.get('/chats/:id/orders', (req, res) => res.json(req.wa.store.ordersFor(chatId(req))));
  router.post('/chats/:id/send', async (req, res) => {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Type a message first' });
    if (text.length > 4000) return res.status(400).json({ error: 'Message is too long' });
    try {
      const m = await req.wa.wa.send(chatId(req), text, req.user.name, 'staff');
      req.wa.store.setChatFlag(chatId(req), 'needs_attention', 0); // staff answered
      res.json(m);
    } catch (e) { fail(res, e); }
  });

  // --- Voice notes: listen, and rate/correct the transcript (corrections become the speech-to-text test set) ---
  router.get('/messages/:id/audio', (req, res) => {
    const m = req.wa.store.message(+req.params.id);
    const file = m?.meta?.file && req.wa.wa.mediaPath(m.meta.file);
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'Voice note not available (deleted after a while)' });
    res.type('audio/ogg').sendFile(file);
  });
  router.post('/messages/:id/transcript', (req, res) => {
    const { store, db } = req.wa;
    const m = store.message(+req.params.id);
    if (!m?.meta?.file) return res.status(404).json({ error: 'Not a voice note' });
    const corrected = req.body.corrected == null ? null : String(req.body.corrected).trim().slice(0, 2000);
    const rating = [1, -1].includes(+req.body.rating) ? +req.body.rating : null;
    db.prepare('INSERT INTO stt_feedback (message_id,file,model,transcript,corrected,rating,at,by_user) VALUES (?,?,?,?,?,?,?,?)')
      .run(m.id, m.meta.file, m.meta.stt_model || '', m.meta.transcript || '', corrected, rating, new Date().toISOString(), req.user.name);
    store.updateMeta(m.id, { stt_rating: rating ?? m.meta.stt_rating ?? null, ...(corrected != null ? { corrected } : {}) });
    res.json({ ok: true });
  });

  // --- Orders the assistant took and the customer confirmed (YES) ---
  router.get('/orders', (req, res) => res.json(req.wa.store.pendingOrders()));
  router.post('/orders/:id/accept', async (req, res) => {
    const { store, wa, hooks } = req.wa;
    const w = store.getOrder(req.params.id);
    if (!w || w.status !== 'pending_cashier') return res.status(404).json({ error: 'This order was already handled' });
    const chat = store.chat(w.chat_id);
    let orderId;
    try {
      orderId = hooks.createOrder({
        type: req.body.type === 'delivery' ? 'delivery' : 'takeaway', zone_id: req.body.zone_id,
        customer: req.body.customer ?? chat?.name ?? '', phone: req.body.phone ?? chat?.phone ?? '',
        address: req.body.address ?? w.address ?? (w.location ? `Location pin: https://maps.google.com/?q=${w.location.lat},${w.location.lng}` : ''),
        items: w.items.map(i => ({ product_id: i.product_id, size: i.size, qty: i.qty, mods: (i.mods || []).map(m => ({ group: m.group, name: m.name })) })),
        userName: req.user.name, note: 'WhatsApp order',
      });
    } catch (e) { return fail(res, e); }
    store.finishOrder(w.id, 'accepted', req.user.name, { order_id: orderId });
    const order = hooks.getOrder(orderId);
    const kitchen_print = await hooks.printKitchen(orderId, order.items, false);
    const text = acceptedMessage(order, w.lang, hooks.getSettings().name);
    let message_sent = true;
    try { await wa.send(w.chat_id, text, 'Order update', 'system'); } catch { message_sent = false; }
    res.json({ ok: true, order_id: orderId, total: order.total, kitchen_print, message_sent });
  });
  router.post('/orders/:id/reject', async (req, res) => {
    const { store, wa } = req.wa;
    const w = store.getOrder(req.params.id);
    const reason = String(req.body.reason || '').slice(0, 200);
    if (!w || !store.finishOrder(w.id, 'rejected', req.user.name, { reason })) return res.status(404).json({ error: 'This order was already handled' });
    let message_sent = true;
    try { await wa.send(w.chat_id, rejectedMessage(w.lang, reason), 'Order update', 'system'); } catch { message_sent = false; }
    res.json({ ok: true, message_sent });
  });

  return { router, current: cur, get: id => live.get(id), live, start, stop, startAll, reconcile, invalidate, stateOf, posData };
};
