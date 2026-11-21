// Starts the free demo: a fresh copy of the demo restaurant (its own DATA_DIR, demo/run-data), served with the POS screens, WhatsApp off.
//
//   npm run demo            -> http://localhost:4300
//
// Every start begins from demo/template/ again (built by `node demo/seed.js`), so whatever visitors changed is gone.
// One shared demo for now; private per-visitor demos come next.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'template');
const RUN = process.env.DEMO_DATA_DIR || path.join(__dirname, 'run-data');
const PORT = process.env.DEMO_PORT || process.env.PORT || 4300;

if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'demo'; // sample data only: the production checks are for the real POS
if (!fs.existsSync(TEMPLATE)) { // e.g. a fresh server: build the sample restaurant first (3 s, through the real API)
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit', env: { ...process.env, PORT: '' } });
  if (!r || r.status !== 0 || !fs.existsSync(TEMPLATE)) { console.error('Could not build the demo restaurant (node demo/seed.js)'); process.exit(1); }
}
if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) { console.error('Build the screens first: npm --prefix client run build'); process.exit(1); }
fs.rmSync(RUN, { recursive: true, force: true });
fs.cpSync(TEMPLATE, RUN, { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: path.join(ROOT, 'server'), stdio: 'inherit',
  env: { ...process.env, DATA_DIR: RUN, PORT: String(PORT), DEMO: '1', WHATSAPP: 'off' }, // never the real WhatsApp
});
console.log(`HazelPOS demo on http://localhost:${PORT}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.kill(); process.exit(); });
server.on('exit', code => process.exit(code ?? 0));
