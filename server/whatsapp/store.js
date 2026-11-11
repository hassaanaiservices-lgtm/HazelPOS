// WhatsApp chats and messages in the POS database. Knows nothing about Baileys.
//
// Every message is stored once, keyed by its WhatsApp ID (wa_id), so a message that WhatsApp delivers again after a
// reconnect can never appear twice. Messages that customers sent while the POS was offline are flagged `offline=1`
// until a staff member contacts them (replies, or presses "Done").
module.exports = function waStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_chats (
      id TEXT PRIMARY KEY,          -- WhatsApp chat ID (jid) used to send replies
      phone TEXT DEFAULT '',        -- 03001234567 when WhatsApp tells us the number
      name TEXT DEFAULT '',         -- the customer's WhatsApp profile name
      unread INTEGER DEFAULT 0,
      last_text TEXT DEFAULT '',
      last_at TEXT
    );
    CREATE TABLE IF NOT EXISTS wa_messages (
      id INTEGER PRIMARY KEY,
      wa_id TEXT UNIQUE,            -- WhatsApp's own message ID: the dedupe key
      chat_id TEXT NOT NULL,
      direction TEXT NOT NULL,      -- 'in' (customer) | 'out' (us)
      sender TEXT NOT NULL,         -- 'customer' | 'staff' (POS) | 'phone' (typed on the linked phone) | 'bot' (assistant) | 'system' (order updates)
      by_user TEXT DEFAULT '',      -- POS user who sent it
      kind TEXT DEFAULT 'text',     -- text | image | video | voice | audio | document | sticker | location | contact
      text TEXT DEFAULT '',
      meta TEXT,                    -- JSON extras, e.g. location {lat, lng}
      at TEXT NOT NULL,             -- when it was sent (WhatsApp's timestamp)
      received_at TEXT NOT NULL,    -- when the POS got it
      status INTEGER DEFAULT 0,     -- outgoing ticks: 1 sent, 2 delivered, 3 read
      offline INTEGER DEFAULT 0,    -- 1 = customer wrote while the POS was offline
      handled_at TEXT,
      handled_by TEXT
    );
    CREATE INDEX IF NOT EXISTS wa_messages_chat ON wa_messages (chat_id, id);
    CREATE INDEX IF NOT EXISTS wa_messages_offline ON wa_messages (offline, handled_at);
    CREATE TABLE IF NOT EXISTS wa_meta (key TEXT PRIMARY KEY, value TEXT);
    -- Orders the assistant took. building (details missing) -> awaiting_customer -> (customer says YES) -> pending_cashier
    --   -> accepted | rejected. replaced / cancelled = superseded or dropped by the customer
    CREATE TABLE IF NOT EXISTS wa_orders (
      id INTEGER PRIMARY KEY,
      chat_id TEXT NOT NULL,
      status TEXT NOT NULL,         -- awaiting_customer | pending_cashier | accepted | rejected | replaced
      items TEXT NOT NULL,          -- JSON [{product_id, size, qty, mods:[{group,name}], name, unit, total}]
      subtotal REAL,
      fulfilment TEXT,              -- delivery | takeaway | null
      address TEXT,
      lang TEXT,
      created_at TEXT, confirmed_at TEXT, handled_at TEXT, handled_by TEXT,
      order_id INTEGER,             -- the real POS order, once accepted
      reason TEXT                   -- why it was rejected
    );
    CREATE INDEX IF NOT EXISTS wa_orders_chat ON wa_orders (chat_id, status);
    -- One row per customer turn the assistant saw: what it did and why (or why it stayed quiet)
    CREATE TABLE IF NOT EXISTS wa_bot_log (
      id INTEGER PRIMARY KEY, at TEXT, chat_id TEXT, in_text TEXT, action TEXT, reply TEXT, intent TEXT, lang TEXT,
      handoff INTEGER, order_json TEXT, invented TEXT, knowledge_version TEXT, prompt_version TEXT,
      ms_total INTEGER, ms_llm INTEGER, prompt_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, error TEXT
    );
  `);
  // Columns added after the first version of wa_chats
  for (const sql of ['ALTER TABLE wa_chats ADD COLUMN bot_paused INTEGER DEFAULT 0', 'ALTER TABLE wa_chats ADD COLUMN needs_attention INTEGER DEFAULT 0',
    'ALTER TABLE wa_orders ADD COLUMN location TEXT']) {
    try { db.exec(sql); } catch { /* already there */ }
  }
  const now = () => new Date().toISOString();

  const meta = {
    get: k => db.prepare('SELECT value FROM wa_meta WHERE key=?').get(k)?.value ?? null,
    set: (k, v) => db.prepare('INSERT INTO wa_meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v)),
  };

  function upsertChat(id, phone, name) {
    db.prepare(`INSERT INTO wa_chats (id, phone, name) VALUES (?,?,?)
      ON CONFLICT(id) DO UPDATE SET phone=COALESCE(NULLIF(excluded.phone,''), phone), name=COALESCE(NULLIF(excluded.name,''), name)`)
      .run(id, phone || '', name || '');
  }

  // Returns the stored row, or null when this WhatsApp ID was already stored.
  // `override` (used by POS sends) lets the send result win over the echo of the same message.
  function addMessage(m, { override = false } = {}) {
    const row = { wa_id: m.wa_id, chat_id: m.chat_id, direction: m.direction, sender: m.sender, by_user: m.by_user || '',
      kind: m.kind || 'text', text: m.text || '', meta: m.meta ? JSON.stringify(m.meta) : null, at: m.at || now(),
      received_at: now(), status: m.status || 0, offline: m.offline ? 1 : 0 };
    const cols = Object.keys(row);
    const r = db.prepare(`INSERT INTO wa_messages (${cols}) VALUES (${cols.map(() => '?')})
      ON CONFLICT(wa_id) DO ${override ? 'UPDATE SET sender=excluded.sender, by_user=excluded.by_user' : 'NOTHING'}`).run(...Object.values(row));
    if (!r.changes) return null;
    if (override && !r.lastInsertRowid) return db.prepare('SELECT * FROM wa_messages WHERE wa_id=?').get(m.wa_id);
    const preview = (m.direction === 'out' ? '✓ ' : '') + row.text.slice(0, 200);
    db.prepare('UPDATE wa_chats SET last_text=?, last_at=? WHERE id=? AND (last_at IS NULL OR last_at <= ?)').run(preview, row.at, m.chat_id, row.at);
    if (m.direction === 'in') db.prepare('UPDATE wa_chats SET unread = unread + 1 WHERE id=?').run(m.chat_id);
    // Replying to a customer counts as contacting them: their offline messages are no longer pending
    if (m.direction === 'out') resolveOffline(m.chat_id, m.by_user || (m.sender === 'phone' ? 'reply from phone' : 'reply'));
    return db.prepare('SELECT * FROM wa_messages WHERE id=?').get(r.lastInsertRowid);
  }

  const chatIdByPhone = phone => db.prepare('SELECT id FROM wa_chats WHERE phone=? ORDER BY last_at DESC LIMIT 1').get(phone)?.id;

  // Merge fields into a message's meta (e.g. voice note file, transcript); returns the updated row
  function updateMeta(id, extra, text) {
    const m = db.prepare('SELECT * FROM wa_messages WHERE id=?').get(id);
    if (!m) return null;
    const meta = { ...(m.meta ? JSON.parse(m.meta) : {}), ...extra };
    db.prepare('UPDATE wa_messages SET meta=?, text=COALESCE(?, text) WHERE id=?').run(JSON.stringify(meta), text ?? null, id);
    if (text != null) db.prepare('UPDATE wa_chats SET last_text=? WHERE id=? AND last_at=?').run(text.slice(0, 200), m.chat_id, m.at);
    return { ...m, meta, text: text ?? m.text };
  }
  const message = id => { const m = db.prepare('SELECT * FROM wa_messages WHERE id=?').get(id); return m && { ...m, meta: m.meta ? JSON.parse(m.meta) : null }; };

  const setStatus = (waId, status) => db.prepare('UPDATE wa_messages SET status=? WHERE wa_id=? AND status < ?').run(status, waId, status);

  const resolveOffline = (chatId, by) => db.prepare(`UPDATE wa_messages SET handled_at=?, handled_by=?
    WHERE chat_id=? AND offline=1 AND handled_at IS NULL`).run(now(), by, chatId);

  const chats = () => db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM wa_messages m WHERE m.chat_id=c.id AND m.offline=1 AND m.handled_at IS NULL) offline_pending,
      (SELECT COUNT(*) FROM wa_orders o WHERE o.chat_id=c.id AND o.status='pending_cashier') orders_pending
    FROM wa_chats c WHERE c.last_text != '' ORDER BY c.last_at DESC LIMIT 300`).all();

  const messages = (chatId, afterId = 0) => db.prepare(`SELECT * FROM (SELECT * FROM wa_messages WHERE chat_id=? AND id>? ORDER BY id DESC LIMIT 300) ORDER BY at, id`)
    .all(chatId, afterId).map(m => ({ ...m, meta: m.meta ? JSON.parse(m.meta) : null }));

  // Marks a chat read in the POS; returns the incoming message IDs to send blue ticks for
  function markRead(chatId) {
    const unread = db.prepare('SELECT unread FROM wa_chats WHERE id=?').get(chatId)?.unread || 0;
    db.prepare('UPDATE wa_chats SET unread=0 WHERE id=?').run(chatId);
    return unread ? db.prepare(`SELECT wa_id FROM wa_messages WHERE chat_id=? AND direction='in' ORDER BY id DESC LIMIT ?`).all(chatId, unread).map(r => r.wa_id) : [];
  }

  const counts = () => db.prepare(`SELECT
      (SELECT COALESCE(SUM(unread),0) FROM wa_chats) unread,
      (SELECT COUNT(DISTINCT chat_id) FROM wa_messages WHERE offline=1 AND handled_at IS NULL) offline_chats,
      (SELECT COUNT(*) FROM wa_orders WHERE status='pending_cashier') orders_pending,
      (SELECT COUNT(*) FROM wa_chats WHERE needs_attention=1) needs_attention`).get();

  // --- assistant state ---
  const chat = id => db.prepare('SELECT * FROM wa_chats WHERE id=?').get(id);
  const setChatFlag = (id, col, v) => { if (['bot_paused', 'needs_attention'].includes(col)) db.prepare(`UPDATE wa_chats SET ${col}=? WHERE id=?`).run(v ? 1 : 0, id); };
  // Last n messages before a given message id, oldest first, as {from, text} for the assistant
  const historyBefore = (chatId, beforeId, n = 12) => db.prepare(`SELECT * FROM (SELECT id, direction, text FROM wa_messages
      WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT ?) ORDER BY id`).all(chatId, beforeId, n)
    .map(m => ({ from: m.direction === 'in' ? 'customer' : 'bot', text: m.text }));
  const lastOutAt = (chatId, senders) => db.prepare(`SELECT MAX(at) at FROM wa_messages WHERE chat_id=? AND direction='out' AND sender IN (${senders.map(() => '?')})`).get(chatId, ...senders)?.at;
  const botRepliesSince = (chatId, sinceIso) => db.prepare("SELECT COUNT(*) n FROM wa_messages WHERE chat_id=? AND sender='bot' AND at>=?").get(chatId, sinceIso).n;

  // --- orders the assistant took ---
  const orderRow = r => r && { ...r, items: JSON.parse(r.items), location: r.location ? JSON.parse(r.location) : null };
  // The customer's most recent location pin in this chat, if sent after sinceIso
  const latestLocation = (chatId, sinceIso) => {
    const m = db.prepare("SELECT meta FROM wa_messages WHERE chat_id=? AND direction='in' AND kind='location' AND at>=? ORDER BY id DESC LIMIT 1").get(chatId, sinceIso);
    const g = m?.meta && JSON.parse(m.meta);
    return g && Number.isFinite(g.lat) && Number.isFinite(g.lng) ? { lat: g.lat, lng: g.lng } : null;
  };
  // The chat's cart: one open order per chat, either still 'building' or complete and 'awaiting_customer'
  function saveDraft(chatId, priced, lang, status = 'awaiting_customer') {
    db.prepare("UPDATE wa_orders SET status='replaced' WHERE chat_id=? AND status IN ('building','awaiting_customer')").run(chatId);
    return db.prepare('INSERT INTO wa_orders (chat_id,status,items,subtotal,fulfilment,address,location,lang,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(chatId, status, JSON.stringify(priced.lines), priced.subtotal, priced.fulfilment || null, priced.address || null,
        priced.location ? JSON.stringify(priced.location) : null, lang, now()).lastInsertRowid;
  }
  const openDraft = (chatId, sinceIso) => orderRow(db.prepare("SELECT * FROM wa_orders WHERE chat_id=? AND status='awaiting_customer' AND created_at>=? ORDER BY id DESC LIMIT 1").get(chatId, sinceIso));
  const openCart = (chatId, sinceIso) => orderRow(db.prepare("SELECT * FROM wa_orders WHERE chat_id=? AND status IN ('building','awaiting_customer') AND created_at>=? ORDER BY id DESC LIMIT 1").get(chatId, sinceIso));
  const cancelCart = chatId => db.prepare("UPDATE wa_orders SET status='cancelled' WHERE chat_id=? AND status IN ('building','awaiting_customer')").run(chatId);
  const confirmDraft = id => db.prepare("UPDATE wa_orders SET status='pending_cashier', confirmed_at=? WHERE id=? AND status='awaiting_customer'").run(now(), id).changes;
  const getOrder = id => orderRow(db.prepare('SELECT * FROM wa_orders WHERE id=?').get(id));
  const ordersFor = chatId => db.prepare("SELECT * FROM wa_orders WHERE chat_id=? AND status IN ('pending_cashier','accepted','rejected') ORDER BY id DESC LIMIT 10").all(chatId).map(orderRow);
  const pendingOrders = () => db.prepare("SELECT o.*, c.name chat_name, c.phone FROM wa_orders o JOIN wa_chats c ON c.id=o.chat_id WHERE o.status='pending_cashier' ORDER BY o.id").all().map(orderRow);
  const finishOrder = (id, status, by, extra = {}) => db.prepare(`UPDATE wa_orders SET status=?, handled_at=?, handled_by=?, order_id=?, reason=?
    WHERE id=? AND status='pending_cashier'`).run(status, now(), by, extra.order_id ?? null, extra.reason ?? null, id).changes;

  function log(row) {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO wa_bot_log (${cols}) VALUES (${cols.map(() => '?')})`).run(...cols.map(k => row[k] ?? null));
  }
  const spentSince = sinceIso => db.prepare('SELECT COALESCE(SUM(cost_usd),0) s FROM wa_bot_log WHERE at>=?').get(sinceIso).s;
  const logFor = (chatId, n = 50) => db.prepare('SELECT * FROM wa_bot_log WHERE chat_id=? ORDER BY id DESC LIMIT ?').all(chatId, n);

  return {
    updateMeta, message,
    meta, upsertChat, chatIdByPhone, addMessage, setStatus, resolveOffline, chats, messages, markRead, counts,
    chat, setChatFlag, historyBefore, lastOutAt, botRepliesSince, latestLocation,
    saveDraft, openDraft, openCart, cancelCart, confirmDraft, getOrder, ordersFor, pendingOrders, finishOrder, log, spentSince, logFor,
  };
};
