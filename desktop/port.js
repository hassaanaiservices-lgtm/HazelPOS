// Which port the POS server listens on. 4000 when it is free; if another program already uses it, the next free port
// (4001…). The choice is remembered in the data folder (port.txt), so the kitchen tablet's bookmark keeps working
// after a restart, and the tray's "Connect other screens" always shows the real address.
const fs = require('fs');
const net = require('net');
const path = require('path');

const DEFAULT_PORT = 4000, SCAN = 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const free = port => new Promise(resolve => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(port);
});

// -> { port, saved, changed }  changed = true when it is not the port the restaurant used last time (or 4000 on a first run)
async function pickPort(dataDir, preferred = DEFAULT_PORT) {
  const file = path.join(dataDir, 'port.txt');
  let saved = 0;
  try { saved = parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch { /* first run */ }
  const order = [...new Set([saved, preferred, ...Array.from({ length: SCAN }, (_, i) => preferred + 1 + i)])].filter(p => p >= 1024 && p <= 65535);
  let port = 0;
  for (const [i, p] of order.entries()) {
    // The first choice gets a few more tries: our own server from a moment ago may still be letting go of it (updates, restarts)
    for (let t = 0; t < (i === 0 ? 6 : 1); t++) { if (await free(p)) { port = p; break; } if (i === 0) await sleep(500); }
    if (port) break;
  }
  if (!port) port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); }); // nothing free in the range: let the system choose
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file, String(port)); } catch { /* read-only folder: still works this time */ }
  return { port, saved, changed: port !== (saved || preferred) };
}

module.exports = { pickPort, DEFAULT_PORT };
