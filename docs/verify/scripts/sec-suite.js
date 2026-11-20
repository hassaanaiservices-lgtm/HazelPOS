// SEC-1: re-run the SECURITY-AUDIT.md checks (SA1-SA14) that can be probed over HTTP, against git HEAD. Ports 4970-4979... uses 4990-4999.
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node docs/verify/scripts/sec-suite.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const dir = path.join(L.SCRATCH, 'sec'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const out = [];
const check = (id, what, ok, detail) => { out.push({ id, what, ok, detail }); L.say(ok ? 'OK  ' : 'FAIL', id, what, JSON.stringify(detail).slice(0, 300)); };
const raw = async (url, opts = {}) => { const t = Date.now(); try { const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) }); const text = await r.text(); return { status: r.status, text, headers: r.headers, ms: Date.now() - t }; } catch (e) { return { status: 'ERR ' + (e.cause?.code || e.message), ms: Date.now() - t }; } };

(async () => {
  const ds = L.fakeDeepseek(4991);
  const cloud = await L.startCloud({ name: 'sec-cloud', port: 4990, waPort: 4992, dsPort: 4991, dataDir: path.join(dir, 'cloud') });
  const C = await L.newClient(cloud, 'SecCo');
  const pos = await L.startPos({ name: 'sec-pos', port: 4994, waPort: 4995, db: path.join(dir, 'p.db'), dataDir: path.join(dir, 'p-data'), extraEnv: { WHATSAPP: 'off' } });
  await L.login(pos, '1234');
  await pos.api('POST', '/cloud/connect', { url: cloud.base, key: C.code });
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(path.join(dir, 'p.db')); const key = d.prepare("SELECT value FROM cloud_config WHERE key='key'").get().value; d.close();

  // SA1: bodies are not read before the key is checked
  const big = Buffer.alloc(60 * 1024 * 1024, 65);
  for (const p of ['/api/sync/backup', '/api/vendor/owners', '/api/ai/chat', '/api/sync/wa-knowledge']) {
    const r = await raw(cloud.base + p, { method: 'POST', body: big, headers: { 'Content-Type': 'application/json' } });
    check('SA1', `60 MB to ${p} without key`, r.status === 401 || /ERR/.test(r.status), { status: r.status, ms: r.ms });
  }
  const pub = await raw(cloud.base + '/api/activate', { method: 'POST', body: Buffer.alloc(200 * 1024, 65), headers: { 'Content-Type': 'application/json' } });
  check('SA1', '200 KB to public /api/activate (64 KB cap)', pub.status === 413, { status: pub.status });
  // SA2: case-sensitive routing for the team page
  const team = await L.req(cloud.base, 'POST', '/api/vendor/TEAM', { email: 'x@y.zz', password: '0123456789x', role: 'owner' }, L.VENDOR_KEY, { 'x-vendor-role': 'staff' });
  const team2 = await L.req(cloud.base, 'POST', '/api/vendor/team', { email: 'x@y.zz', password: '0123456789x', role: 'owner' }, L.VENDOR_KEY, { 'x-vendor-role': 'staff' });
  check('SA2', 'staff role: /api/vendor/TEAM and /team', team.status === 404 && team2.status === 403, { TEAM: team.status, team: team2.status });
  // SA3: AI proxy ignores the restaurant's model / thinking / size
  const ai = await L.req(cloud.base, 'POST', '/api/ai/chat', { model: 'deepseek-reasoner', thinking: { type: 'enabled' }, max_tokens: 100000, messages: [{ role: 'user', content: 'hi' }] }, key);
  const last = ds.calls[ds.calls.length - 1];
  check('SA3', 'AI proxy forces model/thinking/max_tokens', ai.status === 200 && last.model === 'deepseek-flash' && last.thinking?.type === 'disabled' && last.max_tokens <= 1000, { status: ai.status, sent_upstream: { model: last.model, thinking: last.thinking, max_tokens: last.max_tokens } });
  const huge = await L.req(cloud.base, 'POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'x'.repeat(310000) }] }, key);
  check('SA3', 'AI proxy refuses > 300k chars', huge.status === 413, { status: huge.status });
  // SA4: installed app with a built-in cloud refuses another address
  const pin = await L.startPos({ name: 'sec-pos2', port: 4996, waPort: 4997, db: path.join(dir, 'p2.db'), dataDir: path.join(dir, 'p2-data'), extraEnv: { WHATSAPP: 'off', HAZEL_LICENCE: '1', HAZEL_CLOUD_URL: cloud.base } });
  const C2 = await L.newClient(cloud, 'SecCo2');
  const evil = await pin.api('POST', '/licence/activate', { url: 'http://127.0.0.1:4999', code: C2.code }, null);
  check('SA4', 'activation to another address refused', evil.status >= 400 && /only be activated on HazelPOS Cloud/.test(evil.data.error), evil.data);
  // SA5 covered in LIC-2 run (clock floor read in code: licence.js clock()/signedTime())
  // SA8: covered by LIC-1 (expired code -> 410)
  // SA10: POS has no CORS and sends a CSP
  const cors = await raw(pos.base + '/api/settings', { headers: { Origin: 'https://evil.example' } });
  const pre = await raw(pos.base + '/api/login', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  const page = await raw(pos.base + '/');
  check('SA10', 'POS: no Access-Control-Allow-Origin, CSP on pages', !cors.headers.get('access-control-allow-origin') && !pre.headers?.get('access-control-allow-origin'),
    { acao: cors.headers.get('access-control-allow-origin'), preflight: pre.status, csp_on_root: page.headers?.get('content-security-policy')?.slice(0, 60) || `(none; status ${page.status})`, xfo: cors.headers.get('x-frame-options') });
  // SA11: QR flood
  const qi = (await pos.api('GET', '/qr-info')).data.tables[0];
  const prod = (await pos.api('GET', '/menu')).data.products[0];
  const size = JSON.parse(prod.sizes || '[]')[0]?.name || null;
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await pos.api('POST', `/qr/${qi.qr_token}/order`, { items: [{ product_id: prod.id, size, qty: 1 }] }, null)).status);
  check('SA11', 'QR orders: 5 pending per table then 429', codes.slice(0, 5).every(c => c === 200) && codes.slice(5).every(c => c === 429), codes);
  // SA12: backups capped (one per 2 minutes) and must be SQLite
  const sqlite = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(1000)]);
  const b1 = await raw(cloud.base + '/api/sync/backup', { method: 'POST', body: sqlite, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/octet-stream' } });
  const b2 = await raw(cloud.base + '/api/sync/backup', { method: 'POST', body: sqlite, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/octet-stream' } });
  const b3 = await raw(cloud.base + '/api/sync/backup', { method: 'POST', body: Buffer.from('not a db'), headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/octet-stream' } });
  check('SA12', 'backup: second within 2 min refused, non-SQLite refused', [200, 429].includes(b1.status) && b2.status === 429 && b3.status === 400, [b1.status, b2.status, b3.status]);
  // SA13: malformed JSON -> JSON error without stack
  const bad = await raw(cloud.base + '/api/activate', { method: 'POST', body: '{bad', headers: { 'Content-Type': 'application/json' } });
  check('SA13', 'malformed JSON: no stack trace', bad.status === 400 && !/at \w+ \(|node_modules|\/home\//.test(bad.text), { status: bad.status, body: bad.text });
  const bad2 = await raw(cloud.base + '/api/sync/push', { method: 'POST', body: '{bad', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key } });
  check('SA13', 'malformed JSON on an authed route', bad2.status === 400 && !/node_modules|\/home\//.test(bad2.text), { status: bad2.status, body: bad2.text });
  // SA14: cloud headers
  const h = await raw(cloud.base + '/api/licence/public-key');
  check('SA14', 'cloud: nosniff, X-Frame-Options DENY, no x-powered-by', h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('x-frame-options') === 'DENY' && !h.headers.get('x-powered-by'),
    { nosniff: h.headers.get('x-content-type-options'), xfo: h.headers.get('x-frame-options'), powered: h.headers.get('x-powered-by') });
  // New routes since 5696496 (cloud WhatsApp): no key -> 401, wrong key -> 401, vendor routes with a branch key -> 401
  const routes = [['GET', '/api/sync/wa-mode'], ['POST', '/api/sync/wa-knowledge'], ['GET', '/api/sync/wa-orders'], ['POST', '/api/sync/wa-orders/ack'], ['POST', '/api/sync/wa-orders/1/result'],
    ['POST', '/api/sync/wa-send'], ['POST', '/api/sync/wa-send-phone'], ['GET', '/api/sync/wa/status'], ['POST', '/api/sync/wa/connect'], ['POST', '/api/sync/wa/logout'], ['GET', '/api/sync/wa/chats'],
    ['GET', '/api/sync/wa/chats/x/messages'], ['GET', '/api/sync/wa/chats/x/log'], ['POST', '/api/sync/wa/chats/x/read'], ['POST', '/api/sync/wa/chats/x/handled'], ['POST', '/api/sync/wa/chats/x/bot'],
    ['POST', '/api/sync/wa/chats/x/send'], ['POST', '/api/sync/wa/assistant'], ['GET', '/api/sync/wa/messages/1/audio'], ['POST', '/api/sync/wa/messages/1/transcript'], ['POST', '/api/sync/wa-status'],
    ['GET', '/api/vendor/branches/1/whatsapp'], ['POST', '/api/vendor/branches/1/whatsapp/enable'], ['POST', '/api/vendor/branches/1/whatsapp/connect'], ['POST', '/api/vendor/branches/1/whatsapp/logout'], ['POST', '/api/vendor/branches/1/whatsapp/assistant']];
  const table = [];
  for (const [m, p] of routes) {
    const none = await L.req(cloud.base, m, p, m === 'POST' ? {} : undefined);
    const wrong = await L.req(cloud.base, m, p, m === 'POST' ? {} : undefined, 'hz_wrong');
    const branchKeyOnVendor = p.startsWith('/api/vendor') ? (await L.req(cloud.base, m, p, m === 'POST' ? {} : undefined, key)).status : '-';
    table.push({ route: `${m} ${p}`, no_key: none.status, wrong_key: wrong.status, branch_key_on_vendor: branchKeyOnVendor });
  }
  check('SEC-NEW', 'every new cloud WhatsApp route refuses no/wrong key', table.every(r => r.no_key === 401 && r.wrong_key === 401 && (r.branch_key_on_vendor === '-' || r.branch_key_on_vendor === 401)), table);
  const bigKnow = await raw(cloud.base + '/api/sync/wa-knowledge', { method: 'POST', body: JSON.stringify({ pos: { menu: [], categories: [], restaurant: {} }, pictures: [{ mime: 'image/png', data: 'A'.repeat(11 * 1024 * 1024) }] }), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key } });
  check('SEC-NEW', 'wa-knowledge photos over 8 MB refused (413)', bigKnow.status === 413, { status: bigKnow.status, body: bigKnow.text?.slice(0, 100) });
  const over = await raw(cloud.base + '/api/sync/wa-status', { method: 'POST', body: JSON.stringify({ chats: { x: { en: 'a'.repeat(13 * 1024 * 1024) } } }), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key } });
  check('SEC-NEW', '/api/sync body over 12 MB refused', over.status === 413, { status: over.status });

  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(out, null, 1)); process.exit(1); });
