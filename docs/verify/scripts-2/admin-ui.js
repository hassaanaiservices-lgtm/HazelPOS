// Admin app (built from the worktree) in headless Chromium over CDP: Set PIN dialog checkbox -> force_change, rider phone/fee
// inputs in the setup Staff tab, WhatsApp bot tab. Ports 5152-5159. Screenshots -> docs/verify/shots/admin-*.png
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const dir = path.join(L.SCRATCH, 'adminui'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const SHOTS = '/home/hassaan/Documents/HazelPOS-main/docs/verify/shots';
const CHROME = process.env.CHROME || '/home/hassaan/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const q = (file, sql, ...a) => { const d = new DatabaseSync(file); d.exec('PRAGMA busy_timeout = 8000'); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const E = {}; const ev = (k, v) => { E[k] = v; L.say(k, String(JSON.stringify(v)).slice(0, 600)); };

async function browser() {
  const p = spawn(CHROME, ['--headless', '--no-sandbox', '--remote-debugging-port=5158', `--user-data-dir=${dir}/chrome`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  let list; for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch('http://127.0.0.1:5158/json')).json(); } catch { await L.sleep(200); } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', m => { const j = JSON.parse(m.data); if (j.id && wait.has(j.id)) { wait.get(j.id)(j); wait.delete(j.id); } });
  const cmd = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd('Page.enable'); await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  return {
    go: async url => { await cmd('Page.navigate', { url }); await L.sleep(2000); },
    js: async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return 'JS ERROR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300); return r.result?.result?.value; },
    shot: async name => { const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.result.data, 'base64')); return path.join(SHOTS, name); },
    type: text => cmd('Input.insertText', { text }),
    close: () => { ws.close(); p.kill('SIGKILL'); },
  };
}
// helpers run in the page
const PAGE_HELPERS = `
window.__set = (el, v) => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
window.__btn = (re, root = document) => [...root.querySelectorAll('button')].find(b => re.test(b.innerText.trim()));
true`;

(async () => {
  L.fakeDeepseek(5153);
  const cloud = await L.startCloud({ name: 'au-cloud', port: 5152, waPort: 5154, dsPort: 5153, dataDir: path.join(dir, 'cloud') });
  const cdb = path.join(dir, 'cloud', 'cloud.db');
  const A = await L.newClient(cloud, 'AdminUiCo');
  const B = await L.newClient(cloud, 'SetupOnlyCo');
  const PASS = crypto.randomBytes(12).toString('hex');
  const adm = L.startProc('au-admin', path.join(L.HEAD, 'admin/server.js'), { NOFAKE: '1', ADMIN_PASSWORD: PASS, CLOUD_URL: cloud.base, VENDOR_API_KEY: L.VENDOR_KEY, PORT: '5155' }, path.join(L.HEAD, 'admin'));
  const ABASE = 'http://127.0.0.1:5155';
  await L.waitUp(ABASE + '/api/me');
  const posOpts = { name: 'au-pos', port: 5156, waPort: 5157, db: path.join(dir, 'p.db'), dataDir: path.join(dir, 'p-data'), extraEnv: { WHATSAPP: 'off' } };
  const pos = await L.startPos(posOpts); await L.login(pos, '1234');
  ev('pos cloud connect', (await pos.api('POST', '/cloud/connect', { url: cloud.base, key: A.code })).status);
  const users = await L.waitFor(async () => { const r = await cloud.v('GET', `/branches/${A.branch_id}/pins`); return r.data.length ? r.data : null; }, 90000, 3000);
  ev('cloud knows POS logins', users && users.map(u => `${u.id}:${u.name}/${u.role}`));

  const b = await browser();
  await b.go(ABASE + '/');
  ev('admin login', await b.js(`fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ${JSON.stringify(PASS)} }) }).then(r => r.status)`));
  await b.go(`${ABASE}/#/branch/${A.branch_id}`); await b.js(PAGE_HELPERS);
  await b.js(`location.reload(); true`); await L.sleep(2500); await b.js(PAGE_HELPERS);
  ev('branch page tabs', await b.js(`[...document.querySelectorAll('[role=tab]')].map(t => t.innerText)`));

  // ---- Set PIN dialog ----
  await b.js(`__btn(/^Staff$/).click(); true`); await L.sleep(2500);
  const cashier = users.find(u => u.role === 'cashier');
  await b.js(`(() => { const tr = [...document.querySelectorAll('tr')].find(r => r.innerText.includes(${JSON.stringify(cashier.name)}) && r.querySelector('button')); __btn(/^Set PIN$/, tr).click(); return true })()`);
  await L.sleep(800);
  const dlg = await b.js(`(() => { const f = document.querySelector('form.modal'); if (!f) return null; const cb = f.querySelector('input[type=checkbox]'); return { text: f.innerText, checkbox: !!cb, checked: cb?.checked, label: cb?.closest('label')?.innerText?.trim() } })()`);
  ev('Set PIN dialog', dlg);
  await b.js(`(() => { const f = document.querySelector('form.modal'); __set(f.querySelector('input:not([type=checkbox])'), 'tmpq7788'); return true })()`);
  await L.sleep(300);
  ev('shot dialog', await b.shot('admin-setpin-dialog.png'));
  const t0 = Date.now();
  await b.js(`__btn(/^Set PIN$/, document.querySelector('form.modal')).click(); true`); await L.sleep(1500);
  ev('toast after Set PIN', await b.js(`document.querySelector('.toasts')?.innerText || ''`));
  ev('cloud pin_resets row (checkbox ticked)', q(cdb, 'SELECT id, user_id, force_change, applied_at FROM pin_resets WHERE branch_id=? ORDER BY id DESC LIMIT 1', A.branch_id)[0]);
  const applied = await L.waitFor(async () => q(cdb, 'SELECT applied_at, result FROM pin_resets WHERE branch_id=? ORDER BY id DESC LIMIT 1', A.branch_id)[0]?.applied_at ? q(cdb, 'SELECT applied_at, result FROM pin_resets WHERE branch_id=? ORDER BY id DESC LIMIT 1', A.branch_id)[0] : null, 120000, 2000);
  ev('applied on POS', applied && { after_s: ((Date.parse(applied.applied_at) - t0) / 1000).toFixed(1), result: applied.result });
  const lg = await pos.api('POST', '/login', { pin: 'tmpq7788' }, null);
  ev('POS login with the admin-set PIN', { status: lg.status, must_change_pin: lg.data.user?.must_change_pin });
  ev('POS: work blocked until changed', lg.data.token && (await pos.api('GET', '/orders', undefined, lg.data.token)).data);
  ev('POS: choose own PIN', lg.data.token && (await pos.api('POST', '/me/pin', { pin: 'mine5577' }, lg.data.token)).status);
  // unticked
  await b.js(`(() => { const tr = [...document.querySelectorAll('tr')].find(r => r.innerText.includes(${JSON.stringify(cashier.name)}) && r.querySelector('button')); __btn(/^Set PIN$/, tr).click(); return true })()`);
  await L.sleep(800);
  await b.js(`(() => { const f = document.querySelector('form.modal'); __set(f.querySelector('input:not([type=checkbox])'), 'keep4455'); f.querySelector('input[type=checkbox]').click(); return f.querySelector('input[type=checkbox]').checked })()`);
  await L.sleep(300);
  ev('shot dialog unticked', await b.shot('admin-setpin-unticked.png'));
  await b.js(`__btn(/^Set PIN$/, document.querySelector('form.modal')).click(); true`); await L.sleep(1500);
  ev('cloud pin_resets row (checkbox unticked)', q(cdb, 'SELECT id, user_id, force_change FROM pin_resets WHERE branch_id=? ORDER BY id DESC LIMIT 1', A.branch_id)[0]);
  ev('shot staff', await b.shot('admin-staff-pins.png'));

  // ---- WhatsApp bot tab ----
  await b.js(`__btn(/^WhatsApp bot$/).click(); true`); await L.sleep(2500);
  ev('WhatsApp bot tab text (off)', await b.js(`document.querySelector('main')?.innerText?.slice(0, 1200) || document.body.innerText.slice(0, 1200)`));
  ev('shot wa tab off', await b.shot('admin-wa-tab-off.png'));
  await pos.api('POST', '/whatsapp/connect', {}).catch(() => {}); // WHATSAPP=off on the POS only stops its own socket; Link switches the cloud bot on
  await L.sleep(3000);
  await b.js(`__btn(/^Staff$/).click(); true`); await L.sleep(500); await b.js(`__btn(/^WhatsApp bot$/).click(); true`); await L.sleep(3000);
  ev('WhatsApp bot tab text (after Link on the POS)', await b.js(`document.querySelector('main')?.innerText?.slice(0, 1200) || document.body.innerText.slice(0, 1200)`));
  ev('shot wa tab on', await b.shot('admin-wa-tab-on.png'));

  // ---- Setup Staff: rider phone + fee (branch not activated yet) ----
  await b.go(`${ABASE}/#/branch/${B.branch_id}`); await b.js(`location.reload(); true`); await L.sleep(2500); await b.js(PAGE_HELPERS);
  await b.js(`__btn(/^Staff$/).click(); true`); await L.sleep(1500);
  await b.js(`__btn(/Add person/).click(); true`); await L.sleep(400);
  const before = await b.js(`[...document.querySelectorAll('input[aria-label="Rider phone"], input[aria-label="Rider delivery fee"]')].length`);
  await b.js(`(() => { const sel = [...document.querySelectorAll('select[aria-label=Role]')].pop(); __set(sel, 'rider'); return true })()`); await L.sleep(400);
  const after = await b.js(`[...document.querySelectorAll('input[aria-label="Rider phone"], input[aria-label="Rider delivery fee"]')].map(i => i.placeholder)`);
  ev('rider inputs (before role=rider, after)', { before, after });
  const fill = async (rowIdx, sel, v) => { await b.js(`(() => { const rows = document.querySelectorAll('.staff-row'); const r = rows[${rowIdx} < 0 ? rows.length - 1 : ${rowIdx}]; const el = r.querySelector('${sel}'); el.focus(); el.select(); return true })()`); await b.type(v); await L.sleep(300); };
  for (let k = 0; k < 2; k++) { await b.js(`document.querySelectorAll('.staff-row')[1].querySelector('button.danger').click(); true`); await L.sleep(500); } // keep Owner + the new row
  await fill(0, 'input[aria-label=PIN]', 'own3r77'); await L.sleep(400);
  ev('rows before rider fill', await b.js(`[...document.querySelectorAll('.staff-row')].map(r => [...r.querySelectorAll('input,select')].map(i => i.value).join('|'))`));
  await fill(-1, 'input[aria-label=Name]', 'Rider Bilal');
  await fill(-1, 'input[aria-label=PIN]', 'ride7788');
  await fill(-1, 'input[aria-label="Rider phone"]', '03001112222');
  await fill(-1, 'input[aria-label="Rider delivery fee"]', '150abc');
  await L.sleep(400);
  ev('rows after fill', await b.js(`[...document.querySelectorAll('.staff-row')].map(r => [...r.querySelectorAll('input,select')].map(i => i.value).join('|'))`));
  ev('fee input keeps digits only', await b.js(`document.querySelector('input[aria-label="Rider delivery fee"]').value`));
  ev('shot rider', await b.shot('admin-staff-rider.png'));
  await b.js(`__btn(/^Save staff$/).click(); true`); await L.sleep(2000);
  ev('toast after save', await b.js(`document.querySelector('.toasts')?.innerText || ''`));
  ev('cloud setup staff', (await cloud.v('GET', `/branches/${B.branch_id}/setup`)).data.setup?.staff);

  b.close();
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1));
  L.say('done', path.join(dir, 'evidence.json'));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1)); process.exit(1); });
