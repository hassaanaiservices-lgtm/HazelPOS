// New in 1.0.9 + fixes: Link on POS -> cloud bot on, Move to cloud, POS without cloud, unpaid -> 402, start-up gating and
// offline fallback, cloud-bot AI usage counted and capped, a real Baileys QR from the cloud. Ports 5100-5129.
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node v109-suite.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dir = path.join(L.SCRATCH, 'v109'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(L.SCRATCH)) if (/^v9-/.test(f)) fs.rmSync(path.join(L.SCRATCH, f), { force: true });
const E = {};
const ev = (id, k, v) => { (E[id] ||= {})[k] = v; L.say(id, k, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 700)); };
const q = (file, sql, ...a) => { const d = new DatabaseSync(file); d.exec('PRAGMA busy_timeout = 8000'); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const jsonl = f => { try { return fs.readFileSync(path.join(L.SCRATCH, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const evs = (name, t) => jsonl(name + '-wa.jsonl').filter(e => e.ms >= t);
const tl = (name, t) => evs(name, t).map(e => `${((e.ms - t) / 1000).toFixed(1)}s ${e.type}${e.autoConnect !== undefined ? ' autoConnect=' + e.autoConnect : ''}`);
const CH = n => `9230022200${String(n).padStart(2, '0')}@s.whatsapp.net`;
const popts = (n, port, extraEnv = {}) => ({ name: 'v9-' + n, port, waPort: port + 1, db: path.join(dir, n + '.db'), dataDir: path.join(dir, n + '-data'), extraEnv });
const keyOf = db => q(db, "SELECT value FROM cloud_config WHERE key='key'")[0].value;
const meta = (db, k) => q(db, 'SELECT value FROM wa_meta WHERE key=?', k)[0]?.value;

(async () => {
  L.fakeDeepseek(5101, path.join(dir, 'ds.jsonl'));
  let cloud = await L.startCloud({ name: 'v9-cloud', port: 5100, waPort: 5102, dsPort: 5101, dataDir: path.join(dir, 'cloud') });
  const view = id => cloud.v('GET', `/branches/${id}/whatsapp`).then(r => r.data);
  const cloudSends = (t, chat) => evs('v9-cloud', t).filter(e => e.chat === chat && /^send/.test(e.type)).length;

  // ---------- T1: Link WhatsApp on a cloud-connected POS that never had WhatsApp ----------
  const C1 = await L.newClient(cloud, 'LinkCo');
  const o1 = popts('p1', 5110); let p1 = await L.startPos(o1); await L.login(p1, '1234');
  ev('T1', 'cloud connect', (await p1.api('POST', '/cloud/connect', { url: cloud.base, key: C1.code })).status);
  const s0 = (await p1.api('GET', '/whatsapp/status')).data;
  ev('T1', 'status before link', { status: s0.status, cloud_bot: s0.cloud_bot, cloud_available: s0.cloud_available });
  ev('T1', 'vendor view before', (({ enabled, status, menu_at }) => ({ enabled, status, menu_at }))(await view(C1.branch_id)));
  let t = Date.now();
  const link = await p1.api('POST', '/whatsapp/connect', {});
  ev('T1', 'POST /whatsapp/connect', { http: link.status, ms: link.ms, status: link.data.status, qr: link.data.qr, cloud_bot: link.data.cloud_bot, error: link.data.error });
  const v1 = await view(C1.branch_id);
  const posProducts = (await p1.api('GET', '/menu')).data.products.length;
  ev('T1', 'vendor view after', { enabled: v1.enabled, status: v1.status, qr: v1.qr, menu_at: v1.menu_at, menu_items: v1.menu_items, pos_active_products: posProducts });
  ev('T1', 'POS local socket events after link', tl('v9-p1', t));
  ev('T1', 'POS meta cloud_mode', meta(o1.db, 'cloud_mode'));
  const s1 = (await p1.api('GET', '/whatsapp/status')).data;
  ev('T1', 'POS status after link (forwarded)', { status: s1.status, qr: s1.qr, cloud_bot: s1.cloud_bot });
  const scan = (await cloud.wa('/scan', { id: String(C1.branch_id) })).data;
  ev('T1', 'owner scans cloud QR', scan.status);
  const s1b = (await p1.api('GET', '/whatsapp/status')).data;
  ev('T1', 'POS status after scan', { status: s1b.status, cloud_bot: s1b.cloud_bot });
  // Restart: stays in cloud mode, local socket never connects
  await L.stopProc(p1.p); t = Date.now(); p1 = await L.startPos(o1); await L.login(p1, '1234');
  const cb = await L.waitFor(async () => (await p1.api('GET', '/whatsapp/status')).data.cloud_bot, 20000, 500);
  ev('T1', 'after POS restart: cloud_bot seen after s', cb ? ((Date.now() - t) / 1000).toFixed(1) : 'not in 20 s');
  await L.sleep(12000);
  ev('T1', 'after POS restart: local socket timeline', tl('v9-p1', t));

  // ---------- T2: Move to cloud on a POS whose own WhatsApp is linked ----------
  const C2 = await L.newClient(cloud, 'MoveCo');
  const o2 = popts('p2', 5112); let p2 = await L.startPos(o2); await L.login(p2, '1234');
  await p2.api('POST', '/cloud/connect', { url: cloud.base, key: C2.code });
  await L.sleep(4000);
  ev('T2', 'local scan', (await p2.wa('/scan', { id: 'local' })).data.status);
  ev('T2', 'local assistant on', (await p2.api('POST', '/whatsapp/assistant', { enabled: true })).data);
  t = Date.now();
  await p2.wa('/inbound', { id: 'local', chat: CH(1), text: 'zinger burger kitna ka hai?' });
  await L.sleep(9000);
  ev('T2', 'baseline (PC mode): local replies', evs('v9-p2', t).filter(e => e.chat === CH(1) && /^send/.test(e.type)).length);
  const s2 = (await p2.api('GET', '/whatsapp/status')).data;
  ev('T2', 'status before move (banner shows when connected && !cloud_bot && cloud_available)', { status: s2.status, cloud_bot: s2.cloud_bot, cloud_available: s2.cloud_available });
  t = Date.now();
  const mv = await p2.api('POST', '/whatsapp/cloud', { enabled: true });
  ev('T2', 'POST /whatsapp/cloud {enabled:true}', [mv.status, mv.data, mv.ms + ' ms']);
  ev('T2', 'local socket events after move', tl('v9-p2', t));
  const v2 = await view(C2.branch_id);
  ev('T2', 'vendor view after move', { enabled: v2.enabled, status: v2.status, menu_at: v2.menu_at, menu_items: v2.menu_items });
  ev('T2', 'local auth kept', fs.existsSync(path.join(o2.dataDir, 'whatsapp', 'auth', 'creds.json')));
  const lk2 = await p2.api('POST', '/whatsapp/connect', {});
  ev('T2', 'Link after move -> cloud QR', { status: lk2.data.status, qr: lk2.data.qr, cloud_bot: lk2.data.cloud_bot });
  await cloud.wa('/scan', { id: String(C2.branch_id) });
  ev('T2', 'cloud assistant on via POS (forwarded)', (await p2.api('POST', '/whatsapp/assistant', { enabled: true })).data);
  // No double answers: force the local socket connected (worst case) and send the same message to both
  await p2.wa('/force', { id: 'local' });
  t = Date.now();
  const ordersBefore = q(o2.db, 'SELECT COUNT(*) c FROM orders')[0].c;
  await cloud.wa('/inbound', { id: String(C2.branch_id), chat: CH(2), text: 'zinger burger kitna ka hai?', wa_id: 'dup-2' });
  await p2.wa('/inbound', { id: 'local', chat: CH(2), text: 'zinger burger kitna ka hai?', wa_id: 'dup-2' });
  await L.sleep(10000);
  ev('T2', 'same message to both sockets after move: replies', { cloud: cloudSends(t, CH(2)), local: evs('v9-p2', t).filter(e => e.chat === CH(2) && /^send/.test(e.type)).length,
    local_bot_log: q(o2.db, 'SELECT action FROM wa_bot_log WHERE chat_id=?', CH(2)).map(r => r.action), pos_orders_created: q(o2.db, 'SELECT COUNT(*) c FROM orders')[0].c - ordersBefore });
  // Restart: the POS must not reconnect its own number
  await L.stopProc(p2.p); t = Date.now(); p2 = await L.startPos(o2); await L.login(p2, '1234');
  await L.sleep(15000);
  ev('T2', 'after restart (cloud mode, local linked): local timeline 15 s', tl('v9-p2', t));

  // ---------- T3: POS not connected to the cloud ----------
  const o3 = popts('p3', 5114); const p3 = await L.startPos(o3); await L.login(p3, '1234');
  const s3 = (await p3.api('GET', '/whatsapp/status')).data;
  ev('T3', 'status', { status: s3.status, cloud_bot: s3.cloud_bot, cloud_available: s3.cloud_available });
  const mv3 = await p3.api('POST', '/whatsapp/cloud', { enabled: true });
  ev('T3', 'POST /whatsapp/cloud {enabled:true}', [mv3.status, mv3.data]);
  t = Date.now();
  const lk3 = await p3.api('POST', '/whatsapp/connect', {});
  ev('T3', 'Link -> local QR', { http: lk3.status, status: lk3.data.status, qr: lk3.data.qr, cloud_bot: lk3.data.cloud_bot });
  ev('T3', 'local events', tl('v9-p3', t));
  await L.stopProc(p3.p);

  // ---------- T4: membership not active -> 402 ----------
  const C4 = await L.newClient(cloud, 'UnpaidCo');
  const o4 = popts('p4', 5116); const p4 = await L.startPos(o4); await L.login(p4, '1234');
  await p4.api('POST', '/cloud/connect', { url: cloud.base, key: C4.code });
  ev('T4', 'owner marked unpaid (paid_until 2026-01-01)', (await cloud.v('POST', `/owners/${C4.owner_id}`, { paid_until: '2026-01-01' })).data);
  const key4 = keyOf(o4.db);
  const r402 = await L.req(cloud.base, 'POST', '/api/sync/wa-mode', { enabled: true }, key4);
  ev('T4', 'POST /api/sync/wa-mode {enabled:true} (branch key)', [r402.status, r402.data]);
  ev('T4', 'POST /api/sync/wa-mode {enabled:false} (branch key)', (await L.req(cloud.base, 'POST', '/api/sync/wa-mode', { enabled: false }, key4)).status);
  ev('T4', 'POST /api/sync/wa-mode no key / wrong key', [(await L.req(cloud.base, 'POST', '/api/sync/wa-mode', { enabled: true })).status, (await L.req(cloud.base, 'POST', '/api/sync/wa-mode', { enabled: true }, 'x'.repeat(40))).status]);
  t = Date.now();
  const lk4 = await p4.api('POST', '/whatsapp/connect', {});
  ev('T4', 'POS Link while unpaid', [lk4.status, lk4.data]);
  ev('T4', 'POS local events', tl('v9-p4', t));
  ev('T4', 'vendor enabled after', (await view(C4.branch_id)).enabled);
  await L.stopProc(p4.p);

  // ---------- T5: start-up gating and offline fallback ----------
  const C5 = await L.newClient(cloud, 'PcCo');
  const o5 = popts('p5', 5118); let p5 = await L.startPos(o5); await L.login(p5, '1234');
  await p5.api('POST', '/cloud/connect', { url: cloud.base, key: C5.code });
  await p5.wa('/scan', { id: 'local' });
  await L.sleep(4000);
  await L.stopProc(p5.p); t = Date.now(); p5 = await L.startPos(o5);
  await L.sleep(12000);
  ev('T5', 'PC mode, cloud up: restart timeline (expect connect after the first answer ~3 s, not the 1.5 s auto-connect)', tl('v9-p5', t));
  // switched OFF->ON->OFF while the PC was off is covered by wa-suite; here: cloud down
  await L.stopProc(cloud.p);
  await L.stopProc(p5.p); t = Date.now(); p5 = await L.startPos(o5);
  await L.sleep(15000);
  ev('T5', 'PC mode, cloud DOWN: restart timeline (expect connect at ~10 s fallback)', tl('v9-p5', t));
  ev('T5', 'PC mode, cloud down: status', (({ status, cloud_bot }) => ({ status, cloud_bot }))((await p5.api('GET', '/whatsapp/status', undefined, (await L.login(p5, '1234')).data.token)).data));
  await L.stopProc(p2.p); t = Date.now(); p2 = await L.startPos(o2); await L.login(p2, '1234');
  await L.sleep(15000);
  const st2 = (await p2.api('GET', '/whatsapp/status')).data;
  ev('T5', 'cloud mode saved, cloud DOWN: restart timeline (expect no connect)', tl('v9-p2', t));
  ev('T5', 'cloud mode saved, cloud DOWN: status', { status: st2.status, cloud_bot: st2.cloud_bot, assistant_paused_unpaid: st2.assistant_paused_unpaid });
  await p2.wa('/force', { id: 'local' }); t = Date.now();
  await p2.wa('/inbound', { id: 'local', chat: CH(3), text: 'zinger burger kitna ka hai?' });
  await L.sleep(8000);
  ev('T5', 'cloud mode saved, cloud DOWN, local forced connected: local replies (after 10 s fallback)', { replies: evs('v9-p2', t).filter(e => e.chat === CH(3) && /^send/.test(e.type)).length, log: q(o2.db, 'SELECT action FROM wa_bot_log WHERE chat_id=?', CH(3)).map(r => r.action) });
  cloud = await L.startCloud({ name: 'v9-cloud', port: 5100, waPort: 5102, dsPort: 5101, dataDir: path.join(dir, 'cloud') });
  await Promise.all([L.stopProc(p1.p), L.stopProc(p2.p), L.stopProc(p5.p)]);
  await L.stopProc(cloud.p);

  // ---------- T6: cloud bot AI usage counted and capped (AI_DAILY_LIMIT=3) ----------
  L.fakeDeepseek(5121);
  const c6 = await L.startCloud({ name: 'v9-cloud6', port: 5120, waPort: 5122, dsPort: 5121, dataDir: path.join(dir, 'cloud6'), extraEnv: { AI_DAILY_LIMIT: '3' } });
  const C6 = await L.newClient(c6, 'LimitCo');
  const o6 = popts('p6', 5124); const p6 = await L.startPos(o6); await L.login(p6, '1234');
  await p6.api('POST', '/cloud/connect', { url: c6.base, key: C6.code });
  ev('T6', 'link (cloud on + menu)', (await p6.api('POST', '/whatsapp/connect', {})).data.qr);
  await c6.wa('/scan', { id: String(C6.branch_id) });
  await p6.api('POST', '/whatsapp/assistant', { enabled: true });
  const t6 = Date.now(); const per = [];
  for (let i = 1; i <= 5; i++) {
    const ti = Date.now();
    await c6.wa('/inbound', { id: String(C6.branch_id), chat: CH(10 + i), text: 'zinger burger kitna ka hai?' });
    await L.sleep(7000);
    per.push(evs('v9-cloud6', ti).filter(e => e.chat === CH(10 + i) && /^send/.test(e.type)).length);
  }
  const cdb6 = path.join(dir, 'cloud6', 'cloud.db');
  ev('T6', 'replies per message (limit 3)', per);
  ev('T6', 'ai_usage rows', q(cdb6, 'SELECT kind, ok, tokens_in, tokens_out FROM ai_usage WHERE branch_id=?', C6.branch_id));
  ev('T6', 'bot log', (await c6.v('GET', `/branches/${C6.branch_id}/whatsapp`)).data.log.map(l => `${l.action}${l.error ? ' (' + l.error + ')' : ''}`));
  const k6 = keyOf(o6.db);
  ev('T6', '/api/ai/chat with the branch key after the bot used the budget', await L.req(c6.base, 'POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'hi' }] }, k6).then(r => [r.status, r.data.error]));
  ev('T6', 'vendor AI usage page for the branch', (await c6.v('GET', '/ai-usage')).data?.branches?.find?.(b => b.id === C6.branch_id) || '(see /ai-usage)');
  void t6;
  await L.stopProc(p6.p); await L.stopProc(c6.p);

  // ---------- T7: a real Baileys QR from the cloud (no fake socket on the cloud) ----------
  const c7dir = path.join(dir, 'cloud7'); fs.mkdirSync(c7dir, { recursive: true });
  const c7 = L.startProc('v9-cloud7', path.join(L.HEAD, 'cloud/index.js'), { NOFAKE: '1', DATA_DIR: c7dir, VENDOR_API_KEY: L.VENDOR_KEY, PORT: '5126', DEEPSEEK_API_KEY: 'fake', DEEPSEEK_BASE_URL: 'http://127.0.0.1:5121' }, path.join(L.HEAD, 'cloud'));
  await L.waitUp('http://127.0.0.1:5126/api/licence/public-key');
  const v7 = (m, p, b) => L.req('http://127.0.0.1:5126', m, '/api/vendor' + p, b, L.VENDOR_KEY, { 'x-vendor-user': 'verifier', 'x-vendor-role': 'owner' });
  const o7 = await v7('POST', '/owners', { name: 'RealQr', phone: '03001234567' }); const b7 = await v7('POST', `/owners/${o7.data.id}/branches`, { name: 'RealQr main' });
  const op7 = popts('p7', 5128); const p7 = await L.startPos(op7); await L.login(p7, '1234');
  await p7.api('POST', '/cloud/connect', { url: 'http://127.0.0.1:5126', key: b7.data.code });
  const lk7 = await p7.api('POST', '/whatsapp/connect', {});
  const qr7 = await L.waitFor(async () => { const s = (await p7.api('GET', '/whatsapp/status')).data; return s.qr ? s : null; }, 45000, 1500);
  ev('T7', 'real cloud: POS Link response', { http: lk7.status, status: lk7.data.status, error: lk7.data.error, cloud_bot: lk7.data.cloud_bot });
  ev('T7', 'real cloud: QR on POS status', qr7 ? { status: qr7.status, qr_prefix: qr7.qr.slice(0, 30), qr_len: qr7.qr.length } : 'no QR within 45 s');
  if (qr7) fs.writeFileSync(path.join(dir, 'real-qr.txt'), qr7.qr);
  await L.stopProc(p7.p); await L.stopProc(c7);

  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1));
  L.say('done; evidence in', path.join(dir, 'evidence.json'));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1)); process.exit(1); });
