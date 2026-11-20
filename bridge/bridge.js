// The Bridge as a module, used by the CLI (bridge/index.js) and the HazelPOS Printer app (desktop/).
//   const b = createBridge({ server, key, receipt, kitchen }, log);  b.on('status', s => ...);  b.start();  b.stop();
// status: { state: 'idle'|'connected'|'printing'|'retrying'|'stopped', message }
const fs = require('fs');
const net = require('net');
const { EventEmitter } = require('events');
const printer = require('../server/printer'); // the same send() the POS used to call

const sleep = ms => new Promise(r => setTimeout(r, ms));
// host:port, or a device on this PC (/dev/usb/lp0, COM3, \\.\USB001). Anything else is refused: never an arbitrary file.
const TARGET = /^(?:tcp:\/\/)?[\w.-]+:\d+$|^\/dev\/usb\/lp\d+$|^COM\d+$|^\\\\\.\\.+$/i;

function createBridge(cfg, log = () => {}) {
  const server = String(cfg.server || '').replace(/\/+$/, '');
  const ev = new EventEmitter();
  let running = false, ctl = null, status = { state: 'idle', message: '' };
  const targetFor = kind => (kind === 'kitchen' ? cfg.kitchen : cfg.receipt); // test pages go to the receipt printer
  const setStatus = (state, message = '') => { status = { state, message }; ev.emit('status', status); };

  async function call(url, body, timeoutMs = 40000) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (ctl) signals.push(ctl.signal);
    const r = await fetch(server + url, { method: body ? 'POST' : 'GET', headers: { 'X-Device': cfg.key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.any(signals) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Server answered ${r.status}`), { status: r.status });
    return data;
  }

  async function handle(job) {
    const target = String(targetFor(job.kind) || '').trim();
    let ok = false, error = '';
    if (!TARGET.test(target)) error = 'Not a printer address';
    else try { await printer.send(target, Buffer.from(job.data, 'base64')); ok = true; } catch (e) { error = e.message; }
    log(`${ok ? 'printed' : 'FAILED '} #${job.id} ${job.label} -> ${target || '(none)'}${ok ? '' : ': ' + error}`);
    for (let i = 0; i < 5 && running; i++) { // tell the server; if it cannot be reached, keep trying so the ticket is not printed twice
      try { await call(`/api/bridge/jobs/${job.id}/done`, ok ? { ok: true } : { ok: false, error }, 10000); return; } catch (e) { await sleep(1000 * (i + 1)); }
    }
  }

  async function loop() {
    log(`HazelPOS Bridge -> ${server}`);
    let wait = 2000;
    while (running) {
      try {
        const t0 = Date.now();
        const jobs = await call('/api/bridge/jobs?wait=25');
        wait = 2000;
        setStatus('connected');
        for (const j of jobs) { setStatus('printing', j.label || ''); await handle(j); }
        if (jobs.length) setStatus('connected');
        if (!jobs.length && Date.now() - t0 < 1000) await sleep(1000); // never a tight loop
      } catch (e) {
        if (!running) break;
        log(`Server not reachable (${e.message}). Trying again in ${wait / 1000} s`);
        setStatus('retrying', e.message);
        await sleep(wait); wait = Math.min(30000, wait * 2);
      }
    }
  }

  // Can it reach the server and the printers? -> { ok, server:{ok,message}, printers:[{name,target,ok,message}] }
  async function check() {
    const res = { ok: true, server: {}, printers: [] };
    try { const p = await call('/api/bridge/ping', null, 8000); res.server = { ok: true, message: `${p.restaurant} (${p.name})` }; log(`Server OK: ${res.server.message}`); }
    catch (e) { res.ok = false; res.server = { ok: false, message: e.message }; log(`Server NOT reachable or key refused: ${e.message}`); }
    for (const [name, t] of [['receipt', cfg.receipt], ['kitchen', cfg.kitchen]]) {
      if (!t) { log(`${name} printer: not set`); continue; }
      if (!TARGET.test(t)) { res.ok = false; res.printers.push({ name, target: t, ok: false, message: 'Not a printer address' }); log(`${name} printer ${t}: Not a printer address`); continue; }
      const m = /^(?:tcp:\/\/)?([\w.-]+):(\d+)$/.exec(t);
      const ok = await new Promise(done => {
        if (!m) return fs.access(t, fs.constants.W_OK, e => done(!e));
        const s = net.connect({ host: m[1], port: +m[2] }); s.setTimeout(3000, () => { s.destroy(); done(false); });
        s.on('connect', () => { s.destroy(); done(true); }); s.on('error', () => done(false));
      });
      if (!ok) res.ok = false;
      res.printers.push({ name, target: t, ok, message: ok ? 'OK' : 'NOT reachable' });
      log(`${name} printer ${t}: ${ok ? 'OK' : 'NOT reachable'}`);
    }
    return res;
  }

  // A test page straight to one printer (kind 'receipt' | 'kitchen')
  async function testPage(kind) {
    const target = String(targetFor(kind) || '').trim();
    if (!TARGET.test(target)) throw new Error('Not a printer address');
    await printer.send(target, printer.testPage({ name: 'HazelPOS Printer', paper_width: cfg.paper_width || '80' }));
  }

  return Object.assign(ev, {
    start() { if (running) return; running = true; ctl = new AbortController(); loop().catch(e => log('Error:', e?.message || e)); },
    stop() { running = false; ctl?.abort(); setStatus('stopped'); },
    get status() { return status; },
    check, testPage,
  });
}

module.exports = { createBridge, TARGET };
