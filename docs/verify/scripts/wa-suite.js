// WA-ROOT-1 (API part), WA-ROOT-2, WA-AUTO-1..10 against git HEAD, with fake WhatsApp sockets (fake-wa.js) and a fake
// DeepSeek (lib.js). Ports 4930-4959. Takes ~25 min (real 120 s sync loops).
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node docs/verify/scripts/wa-suite.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { statusMessage } = require(path.join(L.HEAD, 'server/whatsapp/messages.js'));

const dir = path.join(L.SCRATCH, 'wa'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
for (const f of ['wa-cloud', 'wa-posA', 'wa-posB']) for (const s of ['.log', '-wa.jsonl']) fs.rmSync(path.join(L.SCRATCH, f + s), { force: true });
const E = {}; // evidence per task
const ev = (id, k, v) => { (E[id] ||= {})[k] = v; L.say(id, k, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 600)); };
const CH = n => `9230011100${String(n).padStart(2, '0')}@s.whatsapp.net`;
const jsonl = f => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const posEvents = () => jsonl(path.join(L.SCRATCH, 'wa-posA-wa.jsonl'));
const cloudEvents = () => jsonl(path.join(L.SCRATCH, 'wa-cloud-wa.jsonl'));
const q = (file, sql, ...a) => { const d = new DatabaseSync(file); d.exec('PRAGMA busy_timeout = 8000'); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

let cloud, posA, posB, A, B;
const ds = L.fakeDeepseek(4931, path.join(dir, 'deepseek.jsonl'));
const cloudOpts = { name: 'wa-cloud', port: 4930, waPort: 4932, dsPort: 4931, dataDir: path.join(dir, 'cloud') };
const posAOpts = { name: 'wa-posA', port: 4940, waPort: 4941, db: path.join(dir, 'a.db'), dataDir: path.join(dir, 'a-data') };
const posBOpts = { name: 'wa-posB', port: 4950, waPort: 4951, db: path.join(dir, 'b.db'), dataDir: path.join(dir, 'b-data') };
const startA = async () => { posA = await L.startPos(posAOpts); await L.login(posA, '1234'); return Date.now(); };
const stopA = () => L.stopProc(posA.p);
const keyOf = db => q(db, "SELECT value FROM cloud_config WHERE key='key'")[0].value;
const sync = (key, method, p, body) => L.req(cloud.base, method, p, body, key);
const view = id => cloud.v('GET', `/branches/${id}/whatsapp`).then(r => r.data);

// A customer message to the cloud bot of branch `bid`; resolves with the bot's sends to that chat (waits `ms`)
async function askCloud(bid, chat, text, ms = 9000) {
  const t = Date.now();
  await cloud.wa('/inbound', { id: String(bid), chat, text });
  await L.sleep(ms);
  return cloudEvents().filter(e => e.ms >= t && e.id === String(bid) && e.chat === chat && /^send/.test(e.type));
}
async function placeCloudOrder(chat, item = 'coke') {
  const s1 = await askCloud(1, chat, `mujhe 1 ${item} chahiye takeaway`);
  const s2 = await askCloud(1, chat, 'yes');
  return { summary: s1.map(e => e.text), confirm: s2.map(e => e.text), confirmed_at: Date.now() };
}

(async () => {
  // ---------- P0: rig ----------
  cloud = await L.startCloud(cloudOpts);
  A = await L.newClient(cloud, 'Client A'); B = await L.newClient(cloud, 'Client B');
  await startA();
  posB = await L.startPos(posBOpts); await L.login(posB, '1234');
  ev('SETUP', 'connectA', (await posA.api('POST', '/cloud/connect', { url: cloud.base, key: A.code })).status);
  ev('SETUP', 'connectB', (await posB.api('POST', '/cloud/connect', { url: cloud.base, key: B.code })).status);
  const keyA = keyOf(posAOpts.db), keyB = keyOf(posBOpts.db);
  // PC mode on POS A: linked locally (the incident setup) and auto-reply on
  ev('SETUP', 'posA local scan', (await posA.wa('/scan', { id: 'local' })).data);
  ev('SETUP', 'posA local assistant on', (await posA.api('POST', '/whatsapp/assistant', { enabled: true })).data);

  // ---------- WA-ROOT-1 (API part) ----------
  ev('WA-ROOT-1', 'vendor /whatsapp A1 (bot never switched on)', await view(A.branch_id));
  const st0 = await posA.api('GET', '/whatsapp/status');
  ev('WA-ROOT-1', 'POS A /api/whatsapp/status', { cloud_bot: st0.data.cloud_bot, status: st0.data.status, me: st0.data.me });
  const owners = await cloud.v('GET', '/owners');
  ev('WA-ROOT-1', 'vendor /owners branch health.whatsapp (bot off)', owners.data.find(o => o.id === A.owner_id).branches[0].health);

  // ---------- WA-ROOT-2 ----------
  await stopA();
  const tSwitch = Date.now();
  ev('WA-ROOT-2', 'enable A1 with POS A stopped', (await cloud.v('POST', `/branches/${A.branch_id}/whatsapp/enable`, { enabled: true })).data);
  await cloud.wa('/scan', { id: String(A.branch_id) });
  await cloud.v('POST', `/branches/${A.branch_id}/whatsapp/assistant`, { enabled: true });
  const v1 = await view(A.branch_id);
  ev('WA-ROOT-2', 'after switch-on, POS off', { menu_at: v1.menu_at, menu_items: v1.menu_items, status: v1.status, assistant: v1.assistant });
  const pre = await askCloud(A.branch_id, CH(1), 'zinger burger kitna ka hai?');
  const preLog = (await view(A.branch_id)).log.filter(l => l.chat_id === CH(1));
  ev('WA-ROOT-2', 'bot reply before menu (sends)', pre.length);
  ev('WA-ROOT-2', 'bot log before menu', preLog.map(l => l.action));
  const tStart = await startA();
  ev('WA-ROOT-2', 'POS A started (s after switch-on)', ((tStart - tSwitch) / 1000).toFixed(1));
  const menuView = await L.waitFor(async () => { const v = await view(A.branch_id); return v.menu_at ? v : null; }, 150000, 2000);
  const tMenu = Date.now();
  const posMenu = (await posA.api('GET', '/menu')).data.products.length;
  const posMenuAll = (await posA.api('GET', '/menu?all=1')).data.products.length;
  ev('WA-ROOT-2', 'menu arrived', { seconds_after_pos_start: menuView ? ((tMenu - tStart) / 1000).toFixed(1) : 'never (150 s)', menu_at: menuView?.menu_at, menu_items: menuView?.menu_items, menu_pictures: menuView?.menu_pictures, pos_active_products: posMenu, pos_all_products: posMenuAll });
  // WA-AUTO-6 evidence: POS A came up linked with cloud_mode not yet known -> did it connect its own socket first?
  const restartTimeline = posEvents().filter(e => e.ms >= tStart - 5000).map(e => `${((e.ms - tStart) / 1000).toFixed(1)}s ${e.type}${e.autoConnect !== undefined ? ' autoConnect=' + e.autoConnect : ''}`);
  ev('WA-AUTO-6', 'POS A start after cloud switched on while it was off (local socket timeline)', restartTimeline);

  // ---------- WA-AUTO-1: price from the pushed menu ----------
  const a1 = await askCloud(A.branch_id, CH(2), 'zinger burger kitna ka hai?');
  ev('WA-AUTO-1', 'reply 1', a1.map(e => e.text));
  ev('WA-AUTO-1', 'prompt zinger line 1', ds.calls[ds.calls.length - 1]?.zinger_line);

  // ---------- WA-AUTO-2: confirmed order reaches the POS ----------
  const o1 = await placeCloudOrder(CH(3));
  ev('WA-AUTO-2', 'order 1 conversation', o1);
  const seen1 = await L.waitFor(async () => (await posA.api('GET', '/whatsapp/orders')).data.find(o => o.chat_id === CH(3)), 60000, 2000);
  ev('WA-AUTO-2', 'order 1 visible on POS after s', seen1 ? ((Date.now() - o1.confirmed_at) / 1000).toFixed(1) : 'not within 60 s');
  ev('WA-AUTO-2', 'POS wa_orders row', seen1 && { id: seen1.id, cloud_id: seen1.cloud_id, status: seen1.status, items: seen1.items, fulfilment: seen1.fulfilment, phone: seen1.phone });
  ev('WA-AUTO-2', 'cloud queue after ack (GET /api/sync/wa-orders)', (await sync(keyA, 'GET', '/api/sync/wa-orders')).data);

  // ---------- WA-AUTO-3: accept / ready / reject through the cloud ----------
  const tAcc = Date.now();
  const acc1 = await posA.api('POST', `/whatsapp/orders/${seen1.id}/accept`, { type: 'takeaway' });
  ev('WA-AUTO-3', 'accept response', acc1.data);
  await posA.api('POST', `/kitchen/${acc1.data.order_id}`, { status: 'ready' });
  await L.sleep(3000);
  const o2 = await placeCloudOrder(CH(4), 'fries');
  const seen2 = await L.waitFor(async () => (await posA.api('GET', '/whatsapp/orders')).data.find(o => o.chat_id === CH(4)), 60000, 2000);
  const rej = await posA.api('POST', `/whatsapp/orders/${seen2.id}/reject`, { reason: 'Kitchen band hai' });
  ev('WA-AUTO-3', 'reject response', rej.data);
  await L.sleep(3000);
  // Delivery order: accepted as delivery, then out with a rider (also used for WA-AUTO-5)
  const o3 = await placeCloudOrder(CH(5), 'nuggets');
  const seen3 = await L.waitFor(async () => (await posA.api('GET', '/whatsapp/orders')).data.find(o => o.chat_id === CH(5)), 60000, 2000);
  const zone = (await posA.api('GET', '/delivery-zones')).data[0];
  const acc3 = await posA.api('POST', `/whatsapp/orders/${seen3.id}/accept`, { type: 'delivery', zone_id: zone?.id, address: 'House 12, Street 4, DHA Phase 5' });
  ev('WA-AUTO-3', 'accept delivery response', acc3.data);
  const rider = (await posA.api('POST', '/riders', { name: 'Rider Ali', phone: '03005556677', delivery_fee: 100 })).data;
  // WA-AUTO-5: status at each step
  const where = async (stage, wait = 45000) => {
    await L.sleep(wait); // pushWaStatus runs every 20 s
    const r = await askCloud(A.branch_id, CH(5), 'mera order kahan hai?');
    const o = (await posA.api('GET', `/orders/${acc3.data.order_id}`)).data;
    const expected = statusMessage({ id: acc3.data.order_id }, 'roman_ur', stage, 'Rider Ali', 0, 'LINK');
    const norm = s => String(s || '').replace(/https?:\S+/g, 'LINK').replace(/\d+ min/g, 'N min').split('\n')[0];
    return { stage, reply: r.map(e => e.text), expected_first_line: norm(expected), match: r.some(e => norm(e.text) === norm(expected)), pos_status: { kitchen: o.kitchen_status, delivery: o.delivery_status } };
  };
  const w = [];
  w.push(await where('cooking'));
  await posA.api('POST', `/kitchen/${acc3.data.order_id}`, { status: 'ready' });
  w.push(await where('ready'));
  const disp = await posA.api('POST', `/orders/${acc3.data.order_id}/dispatch`, { rider_id: rider.id });
  ev('WA-AUTO-3', 'dispatch status', disp.status);
  w.push(await where('out'));
  await posA.api('POST', `/orders/${acc3.data.order_id}/delivered`, {});
  w.push(await where('delivered'));
  ev('WA-AUTO-5', 'where-is-my-order per stage', w);
  const sendsAfter = cloudEvents().filter(e => e.ms >= tAcc && e.sender === 'system').map(e => ({ t: ((e.ms - tAcc) / 1000).toFixed(1), chat: e.chat, text: e.text.split('\n')[0] }));
  ev('WA-AUTO-3', 'cloud socket system sends since first accept', sendsAfter);
  ev('WA-AUTO-3', 'POS A local socket sends since first accept', posEvents().filter(e => e.ms >= tAcc && /^send/.test(e.type)).length);
  ev('WA-AUTO-3', 'POS A audit of cloud calls', 'see POS log: ' + posA.p.logFile);

  // ---------- WA-AUTO-1 part 2: price change reaches the cloud ----------
  const zinger = (await posA.api('GET', '/menu?all=1')).data.products.find(p => p.name === 'Zinger Burger');
  const sizes = JSON.parse(zinger.sizes); sizes[0].price = 777;
  const tPrice = Date.now();
  const save = await posA.api('POST', '/products', { ...zinger, price: 777, sizes: JSON.stringify(sizes) });
  ev('WA-AUTO-1', 'price change saved', save.status);
  const before = (await view(A.branch_id)).menu_at;
  const newMenu = await L.waitFor(async () => { const v = await view(A.branch_id); return v.menu_at !== before ? v : null; }, 150000, 2000);
  ev('WA-AUTO-1', 'menu re-pushed after s', newMenu ? ((Date.now() - tPrice) / 1000).toFixed(1) : 'not within 150 s');
  const a2 = await askCloud(A.branch_id, CH(2), 'zinger burger kitna ka hai?');
  ev('WA-AUTO-1', 'reply 2', a2.map(e => e.text));
  ev('WA-AUTO-1', 'menu_items vs POS active products', { cloud: newMenu?.menu_items, pos: (await posA.api('GET', '/menu')).data.products.length });

  // ---------- WA-AUTO-4: inbox routes while ON ----------
  await askCloud(A.branch_id, CH(9), 'hello, kisi insaan se baat karni hai', 6000); // a chat that exists only on the cloud
  const msgId = (await sync(keyA, 'GET', `/api/sync/wa/chats/${encodeURIComponent(CH(9))}/messages`)).data[0]?.id;
  const c9 = encodeURIComponent(CH(9));
  const routesOn = [
    ['GET', '/whatsapp/status'], ['GET', '/whatsapp/chats'], ['GET', `/whatsapp/chats/${c9}/messages`], ['GET', `/whatsapp/chats/${c9}/log`],
    ['POST', `/whatsapp/chats/${c9}/read`, {}], ['POST', `/whatsapp/chats/${c9}/handled`, {}], ['POST', `/whatsapp/chats/${c9}/bot`, { paused: false }],
    ['POST', `/whatsapp/chats/${c9}/send`, { text: 'Ji, main cashier hoon' }], ['POST', '/whatsapp/assistant', { enabled: true }],
    ['GET', `/whatsapp/messages/${msgId}/audio`], ['POST', `/whatsapp/messages/${msgId}/transcript`, { rating: 1 }],
    ['GET', `/whatsapp/chats/${c9}/orders`],
  ];
  const routeTable = async label => {
    const out = [];
    for (const [m, p, b] of routesOn) {
      const t = Date.now();
      const r = await posA.api(m, p, b);
      const cloudSend = cloudEvents().filter(e => e.ms >= t && /^send|markRead/.test(e.type)).map(e => e.type + ':' + e.id);
      const localSend = posEvents().filter(e => e.ms >= t && /^send|markRead/.test(e.type)).map(e => e.type);
      const body = JSON.stringify(r.data);
      out.push({ route: `${m} ${p.replace(c9, '<chat9>')}`, status: r.status,
        sees_cloud_only_chat: /chats$/.test(p) ? body.includes(CH(9)) : p.endsWith('/messages') ? body.includes('kisi insaan') : undefined,
        cloud_bot_flag: /status$/.test(p) ? r.data.cloud_bot : undefined, cloudSocket: cloudSend.join(',') || undefined, localSocket: localSend.join(',') || undefined, body: body.slice(0, 120) });
    }
    return out;
  };
  ev('WA-AUTO-4', 'routes with bot ON', await routeTable('on'));

  // ---------- WA-AUTO-7 (ON): link from the POS gives the cloud's QR ----------
  ev('WA-AUTO-7', 'POS logout (forwarded) ->', (await posA.api('POST', '/whatsapp/logout', {})).data.status);
  const link = await posA.api('POST', '/whatsapp/connect', {});
  ev('WA-AUTO-7', 'POS connect with bot ON', { status: link.status, qr: link.data.qr, cloud_bot: link.data.cloud_bot });
  ev('WA-AUTO-7', 'vendor view after POS link', (({ status, qr }) => ({ status, qr }))(await view(A.branch_id)));
  await cloud.wa('/scan', { id: String(A.branch_id) });

  // ---------- WA-AUTO-8 (ON): rider link + low-stock alert via the cloud ----------
  const ing = (await posA.api('GET', '/ingredients')).data;
  const ing0 = Array.isArray(ing) ? ing[0] : null;
  if (ing0) await posA.api('POST', '/ingredients', { ...ing0, low_level: 1e9 });
  await posA.api('POST', '/settings', { low_stock_alert_to: '03009998877' });
  await L.sleep(3000); // the rider link needs the cloud rider sync
  const t8 = Date.now();
  const rl = await posA.api('POST', `/riders/${rider.id}/send-link`, {});
  const ls = await posA.api('POST', '/low-stock-alert/test', {});
  await L.sleep(1500);
  ev('WA-AUTO-8', 'bot ON: responses', { rider_link: [rl.status, rl.data], low_stock: [ls.status, ls.data] });
  ev('WA-AUTO-8', 'bot ON: cloud sends', cloudEvents().filter(e => e.ms >= t8 && e.type === 'send').map(e => `${e.id} -> ${e.chat}: ${e.text.slice(0, 50)}`));
  ev('WA-AUTO-8', 'bot ON: POS local sends', posEvents().filter(e => e.ms >= t8 && /^send/.test(e.type)).map(e => `${e.chat}: ${e.text.slice(0, 40)}`));

  // ---------- WA-AUTO-10: local socket forced connected, same inbound to both ----------
  await posA.wa('/force', { id: 'local' });
  const t10 = Date.now();
  const ordersBefore = q(posAOpts.db, 'SELECT COUNT(*) c FROM orders')[0].c;
  await cloud.wa('/inbound', { id: String(A.branch_id), chat: CH(10), text: 'mujhe 1 coke chahiye takeaway', wa_id: 'dup-1' });
  await posA.wa('/inbound', { id: 'local', chat: CH(10), text: 'mujhe 1 coke chahiye takeaway', wa_id: 'dup-1' });
  await L.sleep(10000);
  ev('WA-AUTO-10', 'replies', { cloud: cloudEvents().filter(e => e.ms >= t10 && e.chat === CH(10) && e.type === 'send').length,
    local: posEvents().filter(e => e.ms >= t10 && e.chat === CH(10) && /^send/.test(e.type)).length });
  ev('WA-AUTO-10', 'local bot log', q(posAOpts.db, 'SELECT action FROM wa_bot_log WHERE chat_id=?', CH(10)).map(r => r.action));
  ev('WA-AUTO-10', 'POS orders created', q(posAOpts.db, 'SELECT COUNT(*) c FROM orders')[0].c - ordersBefore);

  // ---------- WA-AUTO-9: branch isolation ----------
  await cloud.v('POST', `/branches/${B.branch_id}/whatsapp/enable`, { enabled: true });
  await cloud.wa('/scan', { id: String(B.branch_id) });
  await cloud.v('POST', `/branches/${B.branch_id}/whatsapp/assistant`, { enabled: true });
  await cloud.wa('/inbound', { id: String(B.branch_id), chat: CH(50), text: 'B customer hello' });
  await L.sleep(4000);
  const aOrderId = q(path.join(cloudOpts.dataDir, 'wa', String(A.branch_id), 'wa.db'), 'SELECT id FROM wa_orders ORDER BY id DESC LIMIT 1')[0]?.id;
  const aMsg = q(path.join(cloudOpts.dataDir, 'wa', String(A.branch_id), 'wa.db'), "SELECT id FROM wa_messages WHERE chat_id=? ORDER BY id LIMIT 1", CH(9))[0]?.id;
  const t9 = Date.now();
  const tries = [
    ['GET', '/api/sync/wa-orders'], ['POST', `/api/sync/wa-orders/${aOrderId}/result`, { status: 'rejected', message: 'x' }],
    ['POST', '/api/sync/wa-orders/ack', { ids: [aOrderId] }], ['POST', '/api/sync/wa-send', { chat_id: CH(3), text: 'leak?' }],
    ['GET', '/api/sync/wa/chats'], ['GET', `/api/sync/wa/chats/${encodeURIComponent(CH(3))}/messages`], ['GET', `/api/sync/wa/chats/${encodeURIComponent(CH(3))}/log`],
    ['POST', `/api/sync/wa/chats/${encodeURIComponent(CH(3))}/send`, { text: 'leak?' }], ['POST', `/api/sync/wa/chats/${encodeURIComponent(CH(3))}/read`, {}],
    ['GET', `/api/sync/wa/messages/${aMsg}/audio`], ['POST', `/api/sync/wa/messages/${aMsg}/transcript`, { rating: 1 }],
    ['POST', '/api/sync/wa-send-phone', { jid: '923001110003@s.whatsapp.net', text: 'B writes to A\'s customer number' }],
  ];
  const iso = [];
  for (const [m, p, b] of tries) { const r = await sync(keyB, m, p, b); iso.push({ req: `B key: ${m} ${p}`, status: r.status, body: JSON.stringify(r.data).slice(0, 140) }); }
  for (const [m, p] of [['GET', `/api/vendor/branches/${A.branch_id}/whatsapp`], ['POST', `/api/vendor/branches/${A.branch_id}/whatsapp/enable`]]) {
    const r = await L.req(cloud.base, m, p, m === 'POST' ? { enabled: false } : undefined, keyB); iso.push({ req: `B key on vendor: ${m} ${p}`, status: r.status }); }
  for (const p of ['/api/sync/wa-orders', '/api/sync/wa/chats', '/api/sync/wa-mode']) { const r = await L.req(cloud.base, 'GET', p); iso.push({ req: `no key: GET ${p}`, status: r.status }); }
  ev('WA-AUTO-9', 'cross-branch table', iso);
  ev('WA-AUTO-9', 'sends while B probed', cloudEvents().filter(e => e.ms >= t9 && /^send/.test(e.type)).map(e => `${e.id} -> ${e.chat}`));
  ev('WA-AUTO-9', 'cloud wa folders', fs.readdirSync(path.join(cloudOpts.dataDir, 'wa')));
  const vA = await view(A.branch_id), vB = await view(B.branch_id);
  ev('WA-AUTO-9', 'vendor logs per branch: chats seen', { A: [...new Set(vA.log.map(l => l.chat_id))], B: [...new Set(vB.log.map(l => l.chat_id))] });

  // ---------- WA-AUTO-2 part 2: POS offline, then online; re-delivery must not duplicate ----------
  await stopA();
  const o4 = await placeCloudOrder(CH(6), 'ice cream');
  ev('WA-AUTO-2', 'order 4 placed with POS off', o4.confirm);
  await L.sleep(60000);
  const tRe = await startA();
  ev('WA-AUTO-6', 'POS A restarted while ON: local socket events', posEvents().filter(e => e.ms >= tRe - 3000 && e.ms < tRe + 20000).map(e => `${((e.ms - tRe) / 1000).toFixed(1)}s ${e.type}${e.autoConnect !== undefined ? ' autoConnect=' + e.autoConnect : ''}`));
  const seen4 = await L.waitFor(async () => (await posA.api('GET', '/whatsapp/orders')).data.find(o => o.chat_id === CH(6)), 90000, 2000);
  ev('WA-AUTO-2', 'order 4 visible after POS start (s)', seen4 ? ((Date.now() - tRe) / 1000).toFixed(1) : 'not in 90 s');
  // Simulate a lost ack: the cloud offers the same order again
  q(path.join(cloudOpts.dataDir, 'wa', String(A.branch_id), 'wa.db'), 'UPDATE wa_orders SET pos_received_at=NULL WHERE id=? RETURNING id', seen4?.cloud_id);
  await L.sleep(45000);
  ev('WA-AUTO-2', 'rows on POS for order 4 after re-offer', q(posAOpts.db, 'SELECT COUNT(*) c FROM wa_orders WHERE cloud_id=?', seen4?.cloud_id)[0].c);

  // ---------- WA-AUTO-6: switch OFF while POS runs ----------
  const tOff = Date.now();
  await cloud.v('POST', `/branches/${A.branch_id}/whatsapp/enable`, { enabled: false });
  const reconnect = await L.waitFor(async () => posEvents().find(e => e.ms >= tOff && e.type === 'connect'), 150000, 2000);
  ev('WA-AUTO-6', 'switch OFF -> local connect() after s', reconnect ? ((reconnect.ms - tOff) / 1000).toFixed(1) + ` (linked=${reconnect.linked})` : 'never within 150 s');
  const stOff = await posA.api('GET', '/whatsapp/status');
  ev('WA-AUTO-6', 'POS status after switch OFF', { status: stOff.data.status, qr: !!stOff.data.qr, cloud_bot: stOff.data.cloud_bot });
  ev('WA-AUTO-4', 'routes with bot OFF', await routeTable('off'));
  const linkOff = await posA.api('POST', '/whatsapp/connect', {});
  ev('WA-AUTO-7', 'POS connect with bot OFF', { status: linkOff.status, body: linkOff.data.status, qr: linkOff.data.qr, cloud_bot: (await posA.api('GET', '/whatsapp/status')).data.cloud_bot });
  const t8b = Date.now();
  const rl2 = await posA.api('POST', `/riders/${rider.id}/send-link`, {});
  const ls2 = await posA.api('POST', '/low-stock-alert/test', {});
  await L.sleep(1500);
  ev('WA-AUTO-8', 'bot OFF: responses', { rider_link: [rl2.status, rl2.data], low_stock: [ls2.status, ls2.data] });
  ev('WA-AUTO-8', 'bot OFF: cloud sends', cloudEvents().filter(e => e.ms >= t8b && e.type === 'send').map(e => `${e.id} -> ${e.chat}`));
  ev('WA-AUTO-8', 'bot OFF: POS local sends', posEvents().filter(e => e.ms >= t8b && e.type === 'send').map(e => `${e.chat}: ${e.text.slice(0, 40)}`));

  // ---------- WA-AUTO-6: switch ON while POS runs ----------
  const tOn = Date.now();
  await cloud.v('POST', `/branches/${A.branch_id}/whatsapp/enable`, { enabled: true });
  await cloud.wa('/scan', { id: String(A.branch_id) });
  const stopEv = await L.waitFor(async () => posEvents().find(e => e.ms >= tOn && e.type === 'stop'), 150000, 2000);
  ev('WA-AUTO-6', 'switch ON -> local stop() after s', stopEv ? ((stopEv.ms - tOn) / 1000).toFixed(1) : 'never within 150 s');
  ev('WA-AUTO-6', 'local auth kept after stop()', fs.existsSync(path.join(posAOpts.dataDir, 'whatsapp', 'auth', 'creds.json')));

  // ---------- WA-AUTO-6 edge: switched OFF while the POS was off ----------
  await stopA();
  await cloud.v('POST', `/branches/${A.branch_id}/whatsapp/enable`, { enabled: false });
  const tEdge = await startA();
  await L.sleep(140000);
  const edge = posEvents().filter(e => e.ms >= tEdge - 3000).map(e => `${((e.ms - tEdge) / 1000).toFixed(1)}s ${e.type}${e.autoConnect !== undefined ? ' autoConnect=' + e.autoConnect : ''}`);
  const stEdge = await posA.api('GET', '/whatsapp/status');
  ev('WA-AUTO-6', 'switched OFF while POS off: timeline 140 s after start', edge);
  ev('WA-AUTO-6', 'switched OFF while POS off: status', { status: stEdge.data.status, cloud_bot: stEdge.data.cloud_bot, cloud_mode_meta: q(posAOpts.db, "SELECT value FROM wa_meta WHERE key='cloud_mode'")[0]?.value });

  // ---------- WA-AUTO-5: cloud restart (status map is memory-only) ----------
  await cloud.v('POST', `/branches/${A.branch_id}/whatsapp/enable`, { enabled: true });
  const onAgain = await L.waitFor(async () => (await posA.api('GET', '/whatsapp/status')).data.cloud_bot, 150000, 3000);
  ev('WA-AUTO-5', 'POS back in cloud mode', !!onAgain);
  await L.sleep(45000);
  const beforeRestart = await askCloud(A.branch_id, CH(5), 'mera order kahan hai?');
  ev('WA-AUTO-5', 'before cloud restart', beforeRestart.map(e => e.text));
  await L.stopProc(cloud.p);
  const tCr = Date.now();
  cloud = await L.startCloud(cloudOpts);
  await L.sleep(4000);
  const afterRestart = await askCloud(A.branch_id, CH(5), 'mera order kahan hai?');
  ev('WA-AUTO-5', 'right after cloud restart', afterRestart.map(e => e.text));
  let back = null;
  for (let i = 0; i < 12 && !back; i++) {
    await L.sleep(60000);
    const r = await askCloud(A.branch_id, CH(5), 'mera order kahan hai?');
    if (r.some(e => /deliver ho gaya/.test(e.text))) back = ((Date.now() - tCr) / 1000).toFixed(0);
    L.say('after restart', i, r.map(e => e.text));
  }
  ev('WA-AUTO-5', 'status answers again after cloud restart (s)', back || 'not within 12 min');

  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1));
  L.say('done; evidence in', path.join(dir, 'evidence.json'));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1)); process.exit(1); });
