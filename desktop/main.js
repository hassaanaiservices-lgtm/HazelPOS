// HazelPOS desktop app: installs like any program, starts the POS server on this PC and opens it in its own window.
// The server keeps running in the tray when the window is closed, so kitchen screens, tablets and WhatsApp keep working.
// Data (database, WhatsApp login, voice notes, logs) lives in the user's app-data folder, so updates never touch it.
const { app, BrowserWindow, Tray, Menu, dialog, shell, nativeImage } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const crypto = require('crypto');

const PORT = 4000;
// Your HazelPOS Cloud, built into the installer, so the restaurant only types its activation code (package.json "hazel")
const CLOUD_URL = require('./package.json').hazel?.cloudUrl || '';
const LOCAL = `http://localhost:${PORT}`;
// Packaged: server/, client/dist and rag/ are copied to resources/app (see package.json "extraResources").
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
const ICON = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '..', 'brand', 'hazelpos-logo', 'hazelpos-logo.png');

if (!app.requestSingleInstanceLock()) app.quit(); // a second click on the icon just shows the open window

const DATA = app.getPath('userData');
const LOG_DIR = path.join(DATA, 'logs');
let server, win, tray, quitting = false;
// Shared secret between this app and its own server, for the update routes (/api/internal/*)
const INTERNAL = crypto.randomBytes(24).toString('hex');
const starts = []; // recent server start times, to stop restarting a server that crashes straight away

function startServer() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(LOG_DIR, 'server.log'), { flags: 'a' });
  log.write(`\n--- ${new Date().toISOString()} starting HazelPOS ${app.getVersion()}\n`);
  starts.push(Date.now());
  // Electron's own Node runs the server, so the restaurant never installs Node.
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: path.join(ROOT, 'server'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), POS_DB: path.join(DATA, 'pos.db'), HAZEL_DATA_DIR: DATA, HAZEL_LICENCE: '1', // licence: server/licence.js
      HAZEL_VERSION: app.getVersion(), HAZEL_CLOUD_URL: CLOUD_URL, HAZEL_INTERNAL_TOKEN: INTERNAL },
    windowsHide: true,
  });
  server.stdout.pipe(log, { end: false });
  server.stderr.pipe(log, { end: false });
  server.on('exit', code => {
    log.write(`--- server stopped (code ${code})\n`);
    if (quitting) return;
    const recent = starts.filter(t => Date.now() - t < 60_000);
    if (recent.length >= 3) { // crashing in a loop: say so instead of hiding it
      dialog.showErrorBox('HazelPOS could not start', `The POS server keeps stopping. Details are in:\n${path.join(LOG_DIR, 'server.log')}\n\n${tail(path.join(LOG_DIR, 'server.log'))}`);
      return quit();
    }
    setTimeout(startServer, 2000);
  });
}

const tail = file => { try { return fs.readFileSync(file, 'utf8').split('\n').slice(-12).join('\n'); } catch { return ''; } };

async function waitForServer(ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    try { if ((await fetch(`${LOCAL}/api/settings`)).ok) return true; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

function showWindow() {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
  win = new BrowserWindow({ width: 1366, height: 860, minWidth: 900, minHeight: 600, icon: ICON, autoHideMenuBar: true, show: false, title: 'HazelPOS' });
  win.loadURL(LOCAL);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // Map links, table QR links etc. open in the normal browser, not inside the POS window
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } }); // keep serving the kitchen screen and WhatsApp
  win.on('closed', () => { win = null; });
}

const lanUrls = () => Object.values(os.networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORT}`);

// A small window with a QR code per network address: scan it on the kitchen screen or a tablet on the same WiFi.
async function showConnect() {
  const urls = lanUrls();
  const blocks = await Promise.all(urls.map(async u => `<figure><img src="${await QRCode.toDataURL(u, { width: 260, margin: 1 })}" alt=""><figcaption>${u}</figcaption></figure>`));
  const html = `<!doctype html><meta charset="utf-8"><title>Connect other screens</title>
<style>body{font:16px system-ui,sans-serif;margin:24px;background:#fff;color:#1a1a1a;text-align:center}figure{display:inline-block;margin:12px}
figcaption{font:600 18px ui-monospace,monospace;margin-top:8px}p{color:#555;max-width:440px;margin:8px auto}</style>
<h2>Connect other screens</h2><p>On the kitchen screen or a tablet on the same WiFi, scan the code or type the address into the browser.</p>
${blocks.join('') || '<p><b>This PC is not on a network.</b> Connect it to the restaurant WiFi or router first.</p>'}`;
  const w = new BrowserWindow({ width: 520, height: 640, icon: ICON, autoHideMenuBar: true, title: 'Connect other screens' });
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function quit() { quitting = true; server?.kill(); app.quit(); }

async function confirmQuit() {
  const { response } = await dialog.showMessageBox({
    type: 'warning', buttons: ['Keep running', 'Quit'], defaultId: 0, cancelId: 0, title: 'Quit HazelPOS?',
    message: 'Quit HazelPOS?', detail: 'Kitchen screens, tablets and the WhatsApp assistant stop working until you open it again.',
  });
  if (response === 1) quit();
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('HazelPOS is running');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open HazelPOS', click: showWindow },
    { label: 'Connect other screens…', click: showConnect },
    { type: 'separator' },
    { label: 'Start with this computer', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Open data folder', click: () => shell.openPath(DATA) },
    { type: 'separator' },
    { label: 'Quit HazelPOS', click: confirmQuit },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', showWindow);
}

// ---------- Updates ----------
// Downloaded in the background (never interrupts service). Installed only: when the owner presses "Update now"
// (Settings → Updates), or by itself at night (3–5 AM) when there are no open orders. Before installing: a backup on
// the cloud and a copy of the database on this PC (data folder → backups), then the server stops cleanly and the new
// version starts by itself. Data lives outside the install folder, so an update never touches it.
let updater = null, update = { state: 'idle' };
const internal = (p, body) => fetch(`${LOCAL}/api/internal/${p}`, {
  method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Hazel-Internal': INTERNAL }, body: body && JSON.stringify(body),
  signal: AbortSignal.timeout(90_000),
}).then(r => r.json());
const report = patch => { update = { ...update, ...patch, at: new Date().toISOString() }; internal('update-state', update).catch(() => {}); };

function setupUpdater() {
  if (!app.isPackaged) return;
  try { updater = require('electron-updater').autoUpdater; } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true; // quitting from the tray also installs a downloaded update
  updater.on('checking-for-update', () => report({ state: 'checking', error: '' }));
  updater.on('update-not-available', () => report({ state: 'none', version: app.getVersion() }));
  updater.on('update-available', i => report({ state: 'downloading', version: i.version, percent: 0 }));
  updater.on('download-progress', p => report({ state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', i => report({ state: 'ready', version: i.version, percent: 100 }));
  updater.on('error', e => report({ state: 'error', error: String(e?.message || e).slice(0, 300) }));
}
function checkUpdates() { updater?.checkForUpdates().catch(() => {}); }

let installing = false;
async function installUpdate() {
  if (installing || update.state !== 'ready') return;
  installing = true;
  report({ state: 'installing' });
  try { await internal('prepare-update', {}); } catch { /* the cloud backup is best effort; the local copy below always happens */ }
  quitting = true;
  await new Promise(resolve => { if (!server || server.exitCode !== null) return resolve(); server.once('exit', resolve); server.kill(); setTimeout(resolve, 15_000); });
  // The database is closed now: copy it (with its WAL files) to data folder → backups, keep the newest 5
  const dir = path.join(DATA, 'backups', `before-${update.version || 'update'}-${Date.now()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['pos.db', 'pos.db-wal', 'pos.db-shm']) if (fs.existsSync(path.join(DATA, f))) fs.copyFileSync(path.join(DATA, f), path.join(dir, f));
    const all = fs.readdirSync(path.join(DATA, 'backups')).filter(d => d.startsWith('before-')).sort();
    for (const old of all.slice(0, -5)) fs.rmSync(path.join(DATA, 'backups', old), { recursive: true, force: true });
  } catch { /* a failed copy must not block the update; the cloud backup above is the second copy */ }
  updater.quitAndInstall(true, true); // silent install, then start the new version
}

// Every 15 s: did the owner press "Update now" / "Check now"? At night with an update ready and no open orders: install.
async function updateLoop() {
  try {
    const r = await internal('update-request');
    if (r.check) checkUpdates();
    const h = new Date().getHours();
    // allowed: false = HazelPOS is still testing this version with a few restaurants (admin app → Updates)
    if (update.state === 'ready' && r.allowed !== false && (r.install || (h >= 3 && h < 5 && r.open_orders === 0))) await installUpdate();
  } catch { /* server restarting */ }
}

app.on('second-instance', showWindow);
app.on('window-all-closed', e => e.preventDefault()); // closing the window never stops the server
app.on('before-quit', () => { quitting = true; server?.kill(); });

app.whenReady().then(async () => {
  // First run: start with the computer, so the POS is up when the restaurant opens.
  const firstRun = !fs.existsSync(path.join(DATA, 'pos.db'));
  if (firstRun && app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  startServer();
  buildTray();
  if (!(await waitForServer())) {
    dialog.showErrorBox('HazelPOS is taking too long to start', `Details are in:\n${path.join(LOG_DIR, 'server.log')}\n\n${tail(path.join(LOG_DIR, 'server.log'))}`);
  }
  showWindow();
  setupUpdater();
  checkUpdates();
  setInterval(checkUpdates, 6 * 60 * 60 * 1000);
  setInterval(updateLoop, 15_000);
});
