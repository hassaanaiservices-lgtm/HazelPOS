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
  const wa = waConnection(store, { onIncoming: row => assistant.onIncoming(row), keepAudioDays: config.stt.keep_audio_days });
  assistant = createAssistant({ store, wa, ask, cfg: config.assistant, stt, sttCfg: config.stt });
  const fail = (res, e, code = 400) => res.status(code).json({ error: e.message });
  const chatId = req => req.params.id;

  // Connection state + counts for badges and banners
  app.get('/api/whatsapp/status', (req, res) => res.json({ ...wa.status(), ...store.counts(), assistant: assistant.enabled(), business_hours: config.assistant.business_hours, stt: stt.status() }));
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
    let message_sent = true;
    try { await wa.send(w.chat_id, acceptedMessage(order, w.lang, pos.getSettings().name), 'Order update', 'system'); }
    catch { message_sent = false; }
    res.json({ ok: true, order_id: orderId, total: order.total, kitchen_print, message_sent });
  });
  app.post('/api/whatsapp/orders/:id/reject', async (req, res) => {
    const w = store.getOrder(req.params.id);
    const reason = String(req.body.reason || '').slice(0, 200);
    if (!w || !store.finishOrder(w.id, 'rejected', req.user.name, { reason })) return res.status(404).json({ error: 'This order was already handled' });
    let message_sent = true;
    try { await wa.send(w.chat_id, rejectedMessage(w.lang, reason), 'Order update', 'system'); } catch { message_sent = false; }
    res.json({ ok: true, message_sent });
  });

  return { store, wa, assistant, stt };
};
