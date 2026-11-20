// Screenshots of the POS WhatsApp link screen in PC mode and cloud mode, and the Activate screen (WA-ROOT-1, WA-AUTO-7, LIC-1).
// Needs the client built in the HEAD export (client/dist). Headless Chrome driven over CDP. Ports 4970-4979.
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node docs/verify/scripts/ui-shots.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const dir = path.join(L.SCRATCH, 'ui'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const SHOTS = path.join(__dirname, '..', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || '/home/hassaan/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';

async function browser() {
  const p = spawn(CHROME, ['--headless', '--no-sandbox', '--remote-debugging-port=4979', `--user-data-dir=${dir}/chrome`, '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' });
  let list; for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch('http://127.0.0.1:4979/json')).json(); } catch { await L.sleep(200); } }
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
  L.fakeDeepseek(4971);
  const cloud = await L.startCloud({ name: 'ui-cloud', port: 4970, waPort: 4972, dsPort: 4971, dataDir: path.join(dir, 'cloud') });
  const A = await L.newClient(cloud, 'UiCo');
  const opts = { name: 'ui-pos', port: 4974, waPort: 4975, db: path.join(dir, 'p.db'), dataDir: path.join(dir, 'p-data') };
  let pos = await L.startPos(opts);
  const out0 = {};
  const lg = await L.login(pos, '1111'); // cashier: the WhatsApp screen is in the cashier's menu
  const own = await pos.api('POST', '/login', { pin: '1234' }, null);
  out0.connect = (await pos.api('POST', '/cloud/connect', { url: cloud.base, key: A.code }, own.data.token)).status;
  const b = await browser();
  const out = out0;
  const openWa = async () => {
    await b.go(pos.base + '/');
    await b.js(`localStorage.setItem('pos_token', ${JSON.stringify(pos.token)}); localStorage.setItem('pos_user', ${JSON.stringify(JSON.stringify(lg.data.user))}); localStorage.setItem('pos_seen', '{"tour":1}'); true`);
    await b.go(pos.base + '/');
    await b.js(`[...document.querySelectorAll('button')].find(x => /Skip tour/.test(x.innerText))?.click(); true`); await L.sleep(500);
    await b.js(`document.querySelector('#nav-whatsapp')?.click(); true`);
    await L.sleep(2500);
    return b.js(`document.querySelector('.wa-link')?.innerText || document.querySelector('.wa-root')?.innerText || document.body.innerText.slice(0, 400)`);
  };
  out.pc_mode_text = await openWa();
  out.pc_mode_shot = await b.shot('pos-link-pc-mode.png');
  // cloud mode: switch on, restart the POS so its first check (15 s) sees it
  await cloud.v('POST', `/branches/${A.branch_id}/whatsapp/enable`, { enabled: true });
  await L.stopProc(pos.p); pos = await L.startPos(opts); pos.token = lg.data.token;
  out.cloud_bot_seen = await L.waitFor(async () => { const r = await pos.api('GET', '/whatsapp/status'); return r.data.cloud_bot; }, 60000, 3000);
  out.cloud_mode_text = await openWa();
  out.cloud_mode_shot = await b.shot('pos-link-cloud-mode.png');
  await b.js(`document.querySelector('#wa-link-btn')?.click(); true`); await L.sleep(2500);
  out.cloud_mode_after_link_click = await b.js(`document.querySelector('#wa-qr-img')?.src?.slice(0, 60) || 'no QR img'`);
  out.cloud_mode_after_link_shot = await b.shot('pos-link-cloud-mode-qr.png');
  // Activate screen
  const lp = await L.startPos({ name: 'ui-lic', port: 4976, waPort: 4977, db: path.join(dir, 'l.db'), dataDir: path.join(dir, 'l-data'), extraEnv: { HAZEL_LICENCE: '1', WHATSAPP: 'off' } });
  await b.go(lp.base + '/'); await L.sleep(1500);
  out.activate_text = await b.js(`document.body.innerText.slice(0, 500)`);
  out.activate_shot = await b.shot('pos-activate.png');
  await b.js(`(() => { const ins = document.querySelectorAll('input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(ins[0], 'HZ-AAAA-BBBB'); ins[0].dispatchEvent(new Event('input', { bubbles: true })); if (ins[1]) { set.call(ins[1], '${cloud.base}'); ins[1].dispatchEvent(new Event('input', { bubbles: true })); } return true })()`);
  await b.js(`[...document.querySelectorAll('button')].find(x => /activ/i.test(x.innerText))?.click(); true`); await L.sleep(2500);
  out.activate_wrong_code_text = await b.js(`document.body.innerText.slice(0, 600)`);
  out.activate_wrong_code_shot = await b.shot('pos-activate-wrong-code.png');
  b.close();
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
