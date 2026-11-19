// WhatsApp bot hosted on HazelPOS Cloud, so it keeps answering when the restaurant's PC is off.
//
// Phase 1: one WhatsApp connection per restaurant that you switch on in the admin app. It answers customers' questions
// from the menu, delivery zones, FAQ and menu photos that the restaurant's POS sends here whenever they change
// (POST /api/sync/wa-knowledge). Orders the customer confirms are kept here; sending them to the POS is phase 2.
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

  return { live, start, stop, knowledge, hashOf: v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex') };
};
