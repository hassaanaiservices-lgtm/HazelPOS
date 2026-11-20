// Shared rig for the verify scripts: a local cloud + POS servers from an export of git HEAD, fake WhatsApp, fake DeepSeek.
// HEAD export: HZ_HEAD (default /tmp/claude-1000/hz-verify/head). Scratch: HZ_SCRATCH (default /tmp/claude-1000/hz-verify/run).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HEAD = process.env.HZ_HEAD || '/tmp/claude-1000/hz-verify/head';
const SCRATCH = process.env.HZ_SCRATCH || '/tmp/claude-1000/hz-verify/run';
const NODE = process.env.HZ_NODE || '/tmp/claude-1000/hz-verify/bin/node';
const FAKEWA = path.join(__dirname, 'fake-wa.js');
const VENDOR_KEY = 'test-vendor-key-0123456789abcdefghijklmnop'; // 32+ chars = vendor mode
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const ts = () => `+${((Date.now() - T0) / 1000).toFixed(1)}s`;
const say = (...a) => console.log(ts(), ...a);
fs.mkdirSync(SCRATCH, { recursive: true });

async function req(base, method, p, body, token, extraHeaders = {}) {
  const t = Date.now();
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, ms: Date.now() - t };
}
const procs = [];
function startProc(name, script, env, cwd) {
  const logFile = path.join(SCRATCH, `${name}.log`);
  const out = fs.openSync(logFile, 'a');
  const p = spawn(NODE, ['-r', FAKEWA, script], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ['ignore', out, out] });
  p.logFile = logFile; p.name = name;
  procs.push(p);
  return p;
}
async function waitUp(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.status < 500) return true; } catch { /* not yet */ } await sleep(300); }
  throw new Error('not up: ' + url);
}
async function stopProc(p) { if (!p || p.exitCode !== null) return; p.kill('SIGTERM'); for (let i = 0; i < 30 && p.exitCode === null; i++) await sleep(100); if (p.exitCode === null) p.kill('SIGKILL'); }
process.on('exit', () => { for (const p of procs) try { p.kill('SIGKILL'); } catch { /* gone */ } });
process.on('SIGINT', () => process.exit(1));

// ---------- fake DeepSeek: answers from the menu in the prompt; logs every prompt ----------
function fakeDeepseek(port, logFile) {
  const calls = [];
  const srv = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', c => { b += c; }); rq.on('end', () => {
      const j = JSON.parse(b || '{}');
      const sys = (j.messages || []).filter(m => m.role === 'system').map(m => m.content).join('\n');
      const user = [...(j.messages || [])].reverse().find(m => m.role === 'user')?.content || '';
      const lines = sys.split('\n').filter(l => /^- .+ \[#\d+\]: /.test(l));
      const words = user.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
      const hit = lines.find(l => words.some(w => l.toLowerCase().includes(w)));
      let out = { reply: 'Ji, farmaiye. Kya chahiye?', intent: 'greet', lang: 'roman_ur', order: null, handoff: false, send_menu_pictures: false };
      if (hit) {
        const [, name, id, price] = /^- (.+) \[#(\d+)\]: (.+)$/.exec(hit);
        if (/chahiye|order|de do|bhej/i.test(user)) {
          out = { reply: `${name} add kar diya.`, intent: 'order', lang: 'roman_ur', handoff: false, send_menu_pictures: false,
            order: { items: [{ product_id: +id, size: / Rs [\d,]+ \| /.test(price) ? price.split(' | ')[0].replace(/ \(.*$/, '').replace(/ Rs .*$/, '') : null, qty: 1, options: [] }], fulfilment: /takeaway|take away/i.test(user) ? 'takeaway' : null, address: null } };
        } else out = { reply: `${name}: ${price}`, intent: 'answer', lang: 'roman_ur', order: null, handoff: false, send_menu_pictures: false };
      } else if (/menu/i.test(user)) out.send_menu_pictures = true;
      calls.push({ at: new Date().toISOString(), model: j.model, max_tokens: j.max_tokens, thinking: j.thinking, user, reply: out.reply, menu_lines: lines.length, zinger_line: lines.find(l => /zinger burger \[/i.test(l)) || null });
      if (logFile) fs.appendFileSync(logFile, JSON.stringify(calls[calls.length - 1]) + '\n');
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(JSON.stringify({ model: 'fake', choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 1000, completion_tokens: 50 } }));
    });
  }).listen(port, '127.0.0.1');
  return { calls, close: () => srv.close() };
}

// ---------- cloud ----------
async function startCloud({ name = 'cloud', port, waPort, dsPort, dataDir, extraEnv = {} }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const p = startProc(name, path.join(HEAD, 'cloud/index.js'), {
    DATA_DIR: dataDir, VENDOR_API_KEY: VENDOR_KEY, PORT: String(port), DEEPSEEK_API_KEY: 'fake', DEEPSEEK_BASE_URL: `http://127.0.0.1:${dsPort}`,
    FAKEWA_PORT: String(waPort), FAKEWA_TAG: name, FAKEWA_LOG: path.join(SCRATCH, `${name}-wa.jsonl`), ...extraEnv,
  }, path.join(HEAD, 'cloud'));
  const base = `http://127.0.0.1:${port}`;
  await waitUp(base + '/api/licence/public-key');
  const v = (method, p2, body) => req(base, method, '/api/vendor' + p2, body, VENDOR_KEY, { 'x-vendor-user': 'verifier', 'x-vendor-role': 'owner' });
  const wa = (p2, body) => req(`http://127.0.0.1:${waPort}`, body === undefined ? 'GET' : 'POST', p2, body);
  return { p, base, v, wa, port, dataDir };
}
// A client with one branch: { owner_id, branch_id, code }
async function newClient(cloud, name, extra = {}) {
  const o = await cloud.v('POST', '/owners', { name, phone: '03001234567', ...extra });
  const b = await cloud.v('POST', `/owners/${o.data.id}/branches`, { name: name + ' main' });
  return { owner_id: o.data.id, branch_id: b.data.id, code: b.data.code };
}

// ---------- POS ----------
async function startPos({ name, port, waPort, db, dataDir, extraEnv = {} }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const p = startProc(name, path.join(HEAD, 'server/index.js'), {
    POS_DB: db, PORT: String(port), HAZEL_DATA_DIR: dataDir, FAKEWA_PORT: String(waPort), FAKEWA_TAG: name,
    FAKEWA_LOG: path.join(SCRATCH, `${name}-wa.jsonl`), ...extraEnv,
  }, path.join(HEAD, 'server'));
  const base = `http://127.0.0.1:${port}`;
  await waitUp(base + '/api/settings');
  const pos = { p, base, port, db, dataDir, token: null,
    api: (method, p2, body, token) => req(base, method, '/api' + p2, body, token === undefined ? pos.token : token),
    wa: (p2, body) => req(`http://127.0.0.1:${waPort}`, body === undefined ? 'GET' : 'POST', p2, body),
  };
  return pos;
}
async function login(pos, pin) { const r = await pos.api('POST', '/login', { pin }, null); if (r.status === 200) pos.token = r.data.token; return r; }

async function waitFor(fn, ms, step = 1000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); }
}
const results = {};
const record = (id, status, evidence) => { results[id] = { status, evidence }; say(`== ${id}: ${status}`); };
function saveResults(file) { fs.writeFileSync(file, JSON.stringify(results, null, 1)); }

module.exports = { HEAD, SCRATCH, NODE, VENDOR_KEY, sleep, say, ts, req, startProc, stopProc, waitUp, fakeDeepseek, startCloud, newClient, startPos, login, waitFor, record, results, saveResults };
