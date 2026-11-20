// Screenshots of the POS WhatsApp link screen in PC mode and cloud mode, and the Activate screen (WA-ROOT-1, WA-AUTO-7, LIC-1).
// Needs the client built in the HEAD export (client/dist). Headless Chrome driven over CDP. Ports 5170-5179.
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node docs/verify/scripts/ui-shots.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const dir = path.join(L.SCRATCH, 'ui2'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const SHOTS = '/home/hassaan/Documents/HazelPOS-main/docs/verify/shots'; fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || '/home/hassaan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';

async function browser() {
  const p = spawn(CHROME, ['--headless', '--no-sandbox', '--remote-debugging-port=5169', `--user-data-dir=${dir}/chrome`, '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' });
  let list; for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch('http://127.0.0.1:5169/json')).json(); } catch { await L.sleep(200); } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', m => { const j = JSON.parse(m.data); if (j.id && wait.has(j.id)) { wait.get(j.id)(j); wait.delete(j.id); } });
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd('Page.enable'); await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  return {
    go: async url => { await cmd('Page.navigate', { url }); await L.sleep(2500); },
    js: async expr => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value,
    shot: async name => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); return path.join(SHOTS, name); },
    close: () => { ws.close(); p.kill('SIGKILL'); },
  };
}

(async () => {
  L.fakeDeepseek(5171);
  const cloud = await L.startCloud({ name: 'ui2-cloud', port: 5170, waPort: 5172, dsPort: 5171, dataDir: path.join(dir, 'cloud') });
  const A = await L.newClient(cloud, 'UiCo');
  const opts = { name: 'ui2-pos', port: 5174, waPort: 5175, db: path.join(dir, 'p.db'), dataDir: path.join(dir, 'p-data') };
  let pos = await L.startPos(opts);
  const out = {};
  const lg = await L.login(pos, '1111');
  const own = await pos.api('POST', '/login', { pin: '1234' }, null);
  out.connect = (await pos.api('POST', '/cloud/connect', { url: cloud.base, key: A.code }, own.data.token)).status;
  await L.sleep(4000);
  await pos.wa('/scan', { id: 'local' }); // PC-linked number (the incident set-up)
  const b = await browser();
  const openWa = async (p, user) => {
    await b.go(p.base + '/');
    await b.js(`localStorage.setItem('pos_token', ${JSON.stringify(p.token)}); localStorage.setItem('pos_user', ${JSON.stringify(JSON.stringify(user))}); localStorage.setItem('pos_seen', '{"tour":1}'); true`);
    await b.go(p.base + '/');
    await b.js(`[...document.querySelectorAll('button')].find(x => /Skip tour/.test(x.innerText))?.click(); true`); await L.sleep(500);
    await b.js(`document.querySelector('#nav-whatsapp')?.click(); true`);
    await L.sleep(3000);
    return b.js(`document.querySelector('.wa-link')?.innerText || document.querySelector('.wa-conn')?.innerText || document.querySelector('.wa-root')?.innerText?.slice(0, 400)`);
  };
  out.pc_linked_text = await openWa(pos, lg.data.user);
  out.pc_linked_banner = await b.js(`!!document.querySelector('#wa-move-cloud')`);
  out.pc_linked_shot = await b.shot('v2-pos-pc-linked-move-banner.png');
  const tMove = Date.now();
  await b.js(`document.querySelector('#wa-move-cloud').click(); true`); await L.sleep(800);
  out.move_confirm_text = await b.js(`document.querySelector('[role=dialog], .modal, dialog')?.innerText || ''`);
  out.move_confirm_shot = await b.shot('v2-pos-move-confirm.png');
  await b.js(`[...document.querySelectorAll('[role=dialog] button, .modal button, dialog button')].find(x => !/cancel/i.test(x.innerText))?.click(); true`);
  await L.sleep(3500);
  out.after_move_status = (({ status, cloud_bot }) => ({ status, cloud_bot }))((await pos.api('GET', '/whatsapp/status', undefined, lg.data.token)).data);
  out.after_move_local_events = fs.readFileSync(path.join(L.SCRATCH, 'ui2-pos-wa.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.ms >= tMove).map(e => e.type);
  out.after_move_text = await b.js(`document.querySelector('.wa-link')?.innerText || document.querySelector('.wa-root')?.innerText?.slice(0, 400)`);
  out.after_move_shot = await b.shot('v2-pos-after-move-link-screen.png');
  await b.js(`document.querySelector('#wa-link-btn')?.click(); true`); await L.sleep(2500);
  out.after_move_link_qr = await b.js(`document.querySelector('#wa-qr-img')?.src?.slice(0, 60) || 'no QR img'`);
  out.after_move_link_shot = await b.shot('v2-pos-cloud-qr.png');
  // A POS with no cloud: the warning on the link screen
  const np = await L.startPos({ name: 'ui2-nocloud', port: 5176, waPort: 5177, db: path.join(dir, 'n.db'), dataDir: path.join(dir, 'n-data') });
  const nl = await L.login(np, '1111');
  out.nocloud_text = await openWa(np, nl.data.user);
  out.nocloud_shot = await b.shot('v2-pos-no-cloud-warning.png');
  await b.js(`document.querySelector('#wa-link-btn')?.click(); true`); await L.sleep(2500);
  out.nocloud_link_qr = await b.js(`document.querySelector('#wa-qr-img')?.src?.slice(0, 60) || 'no QR img'`);
  await np.wa('/scan', { id: 'local' }); await L.sleep(3000);
  out.nocloud_inbox_banner = await b.js(`document.querySelector('.wa-conn')?.innerText || '(no banner in the inbox)'`);
  out.nocloud_inbox_shot = await b.shot('v2-pos-no-cloud-inbox.png');
  await L.stopProc(np.p);
  // Activate screen (LIC-1)
  const lp = await L.startPos({ name: 'ui2-lic', port: 5178, waPort: 5179, db: path.join(dir, 'l.db'), dataDir: path.join(dir, 'l-data'), extraEnv: { HAZEL_LICENCE: '1', WHATSAPP: 'off' } });
  await b.go(lp.base + '/'); await L.sleep(1500);
  out.activate_text = await b.js(`document.body.innerText.slice(0, 500)`);
  out.activate_shot = await b.shot('v2-pos-activate.png');
  b.close();
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
