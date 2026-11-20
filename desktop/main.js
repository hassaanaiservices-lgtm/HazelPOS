// HazelPOS Printer: a small tray app for the PC that has the thermal printers. It does not run the POS. It runs the Bridge
// (bridge/bridge.js): fetches print jobs from the HazelPOS server and sends them to the printers on this PC's network or USB.
// Settings live in the user's app-data folder, so updates never touch them. HAZEL_PRINTER_DIR overrides that folder (tests).
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.env.HAZEL_PRINTER_DIR) app.setPath('userData', path.resolve(process.env.HAZEL_PRINTER_DIR));
if (!app.requestSingleInstanceLock()) app.quit(); // a second click on the icon just shows the open window

const DEFAULT_SERVER = process.env.HAZEL_SERVER_URL || require('./package.json').hazel?.serverUrl || '';
// Packaged: bridge.js and printer.js are copied to resources/app (package.json "extraResources"); from source they are in the repo.
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
const { createBridge, TARGET } = require(path.join(ROOT, 'bridge', 'bridge.js'));
const { findPrinters } = require('./scan');
const ICON = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '..', 'brand', 'hazelpos-logo', 'hazelpos-logo.png');
const CONFIG = path.join(app.getPath('userData'), 'config.json');
const LOG_FILE = path.join(app.getPath('userData'), 'printer.log');

let cfg = { server: '', key: '', restaurant: null, receipt: '', kitchen: '', autostart: true };
let bridge = null, win = null, tray = null, quitting = false, status = { state: 'idle', message: '' }, updateReady = false;

try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) }; } catch { /* first run */ }
const save = () => { fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 }); };
const paired = () => !!(cfg.server && cfg.key);

function log(...a) {
  const line = `${new Date().toISOString()} ${a.join(' ')}\n`;
  try { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 500_000) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); fs.appendFileSync(LOG_FILE, line); } catch { /* logging must never break printing */ }
  if (!app.isPackaged) process.stdout.write(line);
}

// ---------- Bridge ----------
function startBridge() {
  bridge?.stop(); bridge = null;
  if (!paired()) { setStatus({ state: 'idle', message: '' }); return; }
  bridge = createBridge({ server: cfg.server, key: cfg.key, receipt: cfg.receipt, kitchen: cfg.kitchen }, log);
  bridge.on('status', setStatus);
  bridge.start();
  setStatus({ state: 'retrying', message: 'Connecting…' });
}

// ---------- Tray ----------
// Amber while printing or briefly retrying; red ("offline") once the server has been unreachable for a minute
const COLOURS = { connected: [46, 160, 67], printing: [217, 154, 0], busy: [217, 154, 0], retrying: [217, 154, 0], offline: [214, 69, 65], idle: [140, 140, 140], stopped: [140, 140, 140] };
const TEXT = { connected: 'Connected', printing: 'Printing…', retrying: 'Connecting to HazelPOS…', offline: 'Cannot reach HazelPOS, trying again', idle: 'Not set up yet', stopped: 'Stopped' };
const OFFLINE_AFTER_MS = 60_000;
let retryingSince = 0, offlineTimer = null;
const dot = ([r, g, b]) => { // a round coloured icon, drawn pixel by pixel (BGRA), so no image files are needed
  const n = 32, buf = Buffer.alloc(n * n * 4), c = (n - 1) / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x - c, y - c), o = (y * n + x) * 4, a = d <= 14 ? 255 : d <= 15 ? 128 : 0;
    buf[o] = b; buf[o + 1] = g; buf[o + 2] = r; buf[o + 3] = a;
  }
  return nativeImage.createFromBitmap(buf, { width: n, height: n });
};
function setStatus(s) {
  if (s.state === 'retrying') {
    if (!retryingSince) retryingSince = Date.now();
    if (Date.now() - retryingSince >= OFFLINE_AFTER_MS) s = { ...s, state: 'offline' };
    else if (!offlineTimer) offlineTimer = setTimeout(() => { offlineTimer = null; if (status.state === 'retrying') setStatus(status); }, OFFLINE_AFTER_MS - (Date.now() - retryingSince) + 50);
  } else if (s.state !== 'offline') { retryingSince = 0; clearTimeout(offlineTimer); offlineTimer = null; }
  status = s;
  tray?.setImage(dot(COLOURS[s.state] || COLOURS.idle));
  tray?.setToolTip(`HazelPOS Printer: ${TEXT[s.state] || s.state}`);
  tray?.setContextMenu(trayMenu());
  win?.webContents.send('status', publicStatus());
}
const publicStatus = () => ({ ...status, text: TEXT[status.state] || status.state, colour: status.state === 'connected' ? 'ok' : ['printing', 'busy', 'retrying'].includes(status.state) ? 'warn' : status.state === 'offline' ? 'bad' : 'off' });

const trayMenu = () => Menu.buildFromTemplate([
  { label: `Status: ${TEXT[status.state] || status.state}`, enabled: false },
  { label: 'Open', click: showWindow },
  { label: 'Print test page', enabled: paired(), click: () => testPage('receipt').catch(() => {}) },
  { type: 'separator' },
  { label: 'Start with Windows', type: 'checkbox', checked: !!cfg.autostart, click: i => setAutostart(i.checked) },
  ...(updateReady ? [{ label: 'Restart to update', click: () => { quitting = true; updater?.quitAndInstall(true, true); } }] : []),
  { type: 'separator' },
  { label: 'Quit', click: () => { quitting = true; app.quit(); } },
]);
function setAutostart(on) {
  cfg.autostart = !!on; save();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: cfg.autostart });
  tray?.setContextMenu(trayMenu());
}

// ---------- Window ----------
function showWindow() {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
  win = new BrowserWindow({ width: 520, height: 720, minWidth: 420, minHeight: 560, autoHideMenuBar: true, title: 'HazelPOS Printer', show: false,
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'window', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } }); // keep printing from the tray
  win.on('closed', () => { win = null; });
}

// ---------- Actions from the window ----------
const cleanServer = s => String(s || DEFAULT_SERVER).trim().replace(/\/+$/, '');
const validServer = s => { try { return ['https:', 'http:'].includes(new URL(s).protocol); } catch { return false; } };
const fail = message => ({ ok: false, error: message });

async function post(server, url, body, headers = {}) {
  const r = await fetch(server + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}
const unreachable = 'Cannot reach the HazelPOS server. Check this PC\'s internet connection.';

async function finishPairing(server, key, restaurant) {
  cfg = { ...cfg, server, key, restaurant: restaurant || null }; save();
  startBridge();
  return { ok: true };
}

ipcMain.handle('state', () => ({
  paired: paired(), server: cfg.server || DEFAULT_SERVER, defaultServer: DEFAULT_SERVER, restaurant: cfg.restaurant, receipt: cfg.receipt, kitchen: cfg.kitchen,
  autostart: !!cfg.autostart, status: publicStatus(), version: app.getVersion(), host: os.hostname(),
}));

ipcMain.handle('pair', async (_e, code, serverUrl) => {
  const server = cleanServer(serverUrl);
  code = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return fail('The code is 6 digits.');
  if (!validServer(server)) return fail('The server address is not valid.');
  try {
    const { status: st, data } = await post(server, '/api/bridge/pair', { code, name: os.hostname() });
    if (st === 429) return fail('Too many tries. Wait a few minutes and try again.');
    if (st !== 200 || !data.device_key) return fail('That code did not work. It may have expired: make a new one in HazelPOS → Settings → Printers.');
    return finishPairing(server, data.device_key, data.restaurant);
  } catch { return fail(unreachable); }
});

ipcMain.handle('use-key', async (_e, key, serverUrl) => {
  const server = cleanServer(serverUrl);
  key = String(key || '').trim();
  if (!key) return fail('Paste the key first.');
  if (!validServer(server)) return fail('The server address is not valid.');
  try {
    const { status: st, data } = await post(server, '/api/bridge/ping', null, { 'X-Device': key });
    if (st !== 200) return fail(data.error || 'The server did not accept that key.');
    return finishPairing(server, key, { slug: '', name: data.restaurant || '' });
  } catch { return fail(unreachable); }
});

ipcMain.handle('find', async () => ({ ok: true, found: await findPrinters() }));

ipcMain.handle('save', (_e, p) => {
  const receipt = String(p?.receipt || '').trim(), kitchen = String(p?.kitchen || '').trim();
  for (const t of [receipt, kitchen]) if (t && !TARGET.test(t)) return fail(`"${t}" is not a printer address. Use something like 192.168.1.50:9100.`);
  cfg.receipt = receipt; cfg.kitchen = kitchen; save();
  startBridge();
  return { ok: true };
});

async function testPage(kind) {
  if (!bridge) throw new Error('Pair with HazelPOS first.');
  await bridge.testPage(kind);
}
ipcMain.handle('test-page', async (_e, kind) => {
  try { await testPage(kind === 'kitchen' ? 'kitchen' : 'receipt'); return { ok: true }; }
  catch (e) { return fail(e.message); }
});
ipcMain.handle('unpair', () => { cfg.key = ''; cfg.restaurant = null; save(); startBridge(); return { ok: true }; });
ipcMain.handle('autostart', (_e, on) => { setAutostart(on); return { ok: true }; });

// ---------- Updates (from the public releases repo) ----------
let updater = null;
function setupUpdater() {
  if (!app.isPackaged) return;
  try { updater = require('electron-updater').autoUpdater; } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true; // quitting from the tray also installs a downloaded update
  updater.on('update-downloaded', () => { updateReady = true; tray?.setContextMenu(trayMenu()); });
  updater.on('error', e => log('update:', e?.message || e));
  const check = () => updater.checkForUpdates().catch(() => {});
  check(); setInterval(check, 6 * 60 * 60 * 1000);
}

app.on('second-instance', showWindow);
app.on('window-all-closed', e => e.preventDefault()); // closing the window never stops printing
app.on('before-quit', () => { quitting = true; bridge?.stop(); });

app.whenReady().then(() => {
  tray = new Tray(dot(COLOURS.idle));
  tray.on('click', showWindow);
  const firstRun = !fs.existsSync(CONFIG);
  if (firstRun) { cfg.autostart = true; save(); }
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!cfg.autostart });
  startBridge();
  setStatus(status);
  if (!paired() || process.env.HAZEL_PRINTER_SHOW) showWindow(); // first run: the setup window; later: just the tray
  setupUpdater();
});
