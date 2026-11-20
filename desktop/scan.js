// "Find printers": tries TCP port 9100 on every address of this PC's local /24 networks, all at once, with a short timeout.
const net = require('net');
const os = require('os');

const subnets = () => {
  const set = new Set();
  for (const i of Object.values(os.networkInterfaces()).flat())
    if (i && i.family === 'IPv4' && !i.internal) set.add(i.address.split('.').slice(0, 3).join('.'));
  return [...set];
};

const probe = (host, port, ms) => new Promise(res => {
  const s = net.connect({ host, port });
  const done = ok => { s.destroy(); res(ok); };
  s.setTimeout(ms, () => done(false));
  s.on('connect', () => done(true));
  s.on('error', () => done(false));
});

// -> ['192.168.1.50:9100', ...]; finishes in about `ms` (default 1.2 s) plus connection set-up
async function findPrinters({ port = 9100, ms = 1200, hosts } = {}) {
  const list = hosts || subnets().flatMap(p => Array.from({ length: 254 }, (_, n) => `${p}.${n + 1}`));
  const found = [];
  await Promise.all(list.map(async h => { if (await probe(h, port, ms)) found.push(`${h}:${port}`); }));
  return found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
module.exports = { findPrinters, subnets };
