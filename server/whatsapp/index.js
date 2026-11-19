// WhatsApp HTTP routes for the POS (cashier + admin). Mounted from server/index.js.
// pos = { createOrder, getOrder, printKitchen, getSettings }: the POS's own order functions, so a WhatsApp order is
// priced and checked exactly like one punched in at the counter.
const waStore = require('./store');
const waConnection = require('./connection');
const { createAssistant } = require('./assistant');
const createStt = require('./stt');
const { acceptedMessage, rejectedMessage } = require('./messages');
const { config } = require('../../rag/src/config');
const { ask } = require('../../rag/src/pipeline');

module.exports = function whatsapp(app, db, pos) {
  const store = waStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS stt_feedback (id INTEGER PRIMARY KEY, message_id INTEGER, file TEXT, model TEXT,
    transcript TEXT, corrected TEXT, rating INTEGER, at TEXT, by_user TEXT)`); // staff ratings/corrections = the STT test set
  let assistant;
  const stt = createStt(config.stt);
  // cloud_mode: the bot runs on HazelPOS Cloud, so this POS does not connect its own WhatsApp at start (server/index.js sets it)
  const wa = waConnection(store, { onIncoming: row => assistant.onIncoming(row), keepAudioDays: config.stt.keep_audio_days, autoConnect: () => store.meta.get('cloud_mode') !== '1' });
  const menuPictures = () => db.prepare('SELECT id, caption, mime, data FROM menu_images ORDER BY sort, id').all(); // table made in server/index.js
  assistant = createAssistant({ store, wa, ask, cfg: config.assistant, stt, sttCfg: config.stt, menuPictures, allowed: pos.aiAllowed || (() => true), deliveryStatus: pos.deliveryStatus || (() => null) });
  const fail = (res, e, code = 400) => res.status(code).json({ error: e.message });
  const cloudResult = (w, body) => pos.cloudCall ? pos.cloudCall(`/api/sync/wa-orders/${w.cloud_id}/result`, body).then(r => !!r.message_sent, () => false) : Promise.resolve(false);
  const chatId = req => req.params.id;

  // While the bot runs on HazelPOS Cloud (cloud/wa-host.js), the chats live there: the inbox and the replies go through
  // the cloud. WhatsApp orders, accepting and rejecting them stay here (the cloud's orders are copied in every 20 s).
  const CLOUD_ROUTES = /^(POST \/(connect|logout)|GET \/(status|chats)|GET \/chats\/[^/]+\/(messages|log)|POST \/chats\/[^/]+\/(read|handled|bot|send)|POST \/assistant|GET \/messages\/\d+\/audio|POST \/messages\/\d+\/transcript)$/;
  app.use('/api/whatsapp', async (req, res, next) => {
    if (!pos.cloudBot?.()) return next();
    const route = `${req.method} ${req.path}`;
    if (!CLOUD_ROUTES.test(route)) return next();
    const local = { cloud_bot: true, assistant_paused_unpaid: false, business_hours: config.assistant.business_hours, stt: stt.status(), orders_pending: store.counts().orders_pending };
    const url = '/api/sync/wa' + req.url; // keeps ?after=
    try {
      if (req.method === 'GET' && /\/audio$/.test(req.path)) {
        const r = await pos.cloudRaw(url);
        if (!r.ok) return res.status(r.status).json(await r.json().catch(() => ({ error: 'Voice note not available' })));
        return res.type('audio/ogg').send(Buffer.from(await r.arrayBuffer()));
      }
      const body = req.method === 'POST' ? { ...req.body, by: req.user.name } : undefined;
      const data = await pos.cloudCall(url, body);
      if (/^\/(status|connect|logout)$/.test(req.path)) return res.json({ ...data, ...local });
      if (/\/transcript$/.test(req.path) && data.message) {
        const m = data.message;
        db.prepare('INSERT INTO stt_feedback (message_id,file,model,transcript,corrected,rating,at,by_user) VALUES (?,?,?,?,?,?,?,?)')
          .run(m.id, m.meta?.file || '', m.meta?.stt_model || '', m.meta?.transcript || '', m.meta?.corrected ?? null, m.meta?.stt_rating ?? null, new Date().toISOString(), req.user.name);
        return res.json({ ok: true });
      }
      res.json(data);
    } catch (e) {
      if (req.path === '/status') return res.json({ status: 'reconnecting', error: e.message, unread: 0, offline_chats: 0, needs_attention: 0, ...local });
      res.status(503).json({ error: e.message });
    }
  });

  // Connection state + counts for badges and banners
  app.get('/api/whatsapp/status', (req, res) => res.json({ ...wa.status(), ...store.counts(), assistant: assistant.enabled(), assistant_paused_unpaid: !(pos.aiAllowed?.() ?? true) && !pos.cloudBot?.(), cloud_bot: !!pos.cloudBot?.(), business_hours: config.assistant.business_hours, stt: stt.status() }));
  app.post('/api/whatsapp/connect', async (req, res) => { try { await wa.connect(); res.json(wa.status()); } catch (e) { fail(res, e); } });
  app.post('/api/whatsapp/logout', async (req, res) => { await wa.logout(); res.json(wa.status()); });
  app.post('/api/whatsapp/assistant', (req, res) => { assistant.setEnabled(!!req.body.enabled); res.json({ assistant: assistant.enabled() }); });

  app.get('/api/whatsapp/chats', (req, res) => res.json(store.chats()));
  app.get('/api/whatsapp/chats/:id/messages', (req, res) => res.json(store.messages(chatId(req), +req.query.after || 0)));
  app.post('/api/whatsapp/chats/:id/read', (req, res) => { wa.markRead(chatId(req), store.markRead(chatId(req))); res.json({ ok: true }); });
  // "Done": staff contacted this customer another way (call, etc.); also clears "needs you"
  app.post('/api/whatsapp/chats/:id/handled', (req, res) => { store.resolveOffline(chatId(req), req.user.name); store.setChatFlag(chatId(req), 'needs_attention', 0); res.json({ ok: true }); });
  app.post('/api/whatsapp/chats/:id/bot', (req, res) => { store.setChatFlag(chatId(req), 'bot_paused', !!req.body.paused); res.json({ ok: true }); });
  app.get('/api/whatsapp/chats/:id/log', (req, res) => res.json(store.logFor(chatId(req))));
  app.get('/api/whatsapp/chats/:id/orders', (req, res) => res.json(store.ordersFor(chatId(req))));
  app.post('/api/whatsapp/chats/:id/send', async (req, res) => {
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Type a message first' });
    if (text.length > 4000) return res.status(400).json({ error: 'Message is too long' });
    try {
      const m = await wa.send(chatId(req), text, req.user.name, 'staff');
      store.setChatFlag(chatId(req), 'needs_attention', 0); // staff answered
      res.json(m);
    } catch (e) { fail(res, e); }
  });

  // --- Voice notes: listen, and rate/correct the transcript (corrections become the speech-to-text test set) ---
  app.get('/api/whatsapp/messages/:id/audio', (req, res) => {
    const m = store.message(+req.params.id);
    const file = m?.meta?.file && wa.mediaPath(m.meta.file);
    if (!file || !require('fs').existsSync(file)) return res.status(404).json({ error: 'Voice note not available (deleted after a while)' });
    res.type('audio/ogg').sendFile(file);
  });
  app.post('/api/whatsapp/messages/:id/transcript', (req, res) => {
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
  app.get('/api/whatsapp/orders', (req, res) => res.json(store.pendingOrders()));
  app.post('/api/whatsapp/orders/:id/accept', async (req, res) => {
    const w = store.getOrder(req.params.id);
    if (!w || w.status !== 'pending_cashier') return res.status(404).json({ error: 'This order was already handled' });
    const chat = store.chat(w.chat_id);
    let orderId;
    try {
      orderId = pos.createOrder({
        type: req.body.type === 'delivery' ? 'delivery' : 'takeaway', zone_id: req.body.zone_id,
        customer: req.body.customer ?? chat?.name ?? '', phone: req.body.phone ?? chat?.phone ?? '',
        address: req.body.address ?? w.address ?? (w.location ? `Location pin: https://maps.google.com/?q=${w.location.lat},${w.location.lng}` : ''),
        items: w.items.map(i => ({ product_id: i.product_id, size: i.size, qty: i.qty, mods: (i.mods || []).map(m => ({ group: m.group, name: m.name })) })),
        userName: req.user.name, note: 'WhatsApp order',
      });
    } catch (e) { return fail(res, e); }
    store.finishOrder(w.id, 'accepted', req.user.name, { order_id: orderId });
    const order = pos.getOrder(orderId);
    const kitchen_print = await pos.printKitchen(orderId, order.items, false);
    const text = acceptedMessage(order, w.lang, pos.getSettings().name);
    let message_sent = true;
    // An order the cloud bot took: the customer's chat is on the cloud, so the answer goes back through it
    if (w.cloud_id) message_sent = await cloudResult(w, { status: 'accepted', order_id: orderId, by: req.user.name, message: text });
    else try { await wa.send(w.chat_id, text, 'Order update', 'system'); }
    catch { message_sent = false; }
    res.json({ ok: true, order_id: orderId, total: order.total, kitchen_print, message_sent });
  });
  app.post('/api/whatsapp/orders/:id/reject', async (req, res) => {
    const w = store.getOrder(req.params.id);
    const reason = String(req.body.reason || '').slice(0, 200);
    if (!w || !store.finishOrder(w.id, 'rejected', req.user.name, { reason })) return res.status(404).json({ error: 'This order was already handled' });
    let message_sent = true;
    if (w.cloud_id) message_sent = await cloudResult(w, { status: 'rejected', reason, by: req.user.name, message: rejectedMessage(w.lang, reason) });
    else try { await wa.send(w.chat_id, rejectedMessage(w.lang, reason), 'Order update', 'system'); } catch { message_sent = false; }
    res.json({ ok: true, message_sent });
  });

  return { store, wa, assistant, stt };
};
