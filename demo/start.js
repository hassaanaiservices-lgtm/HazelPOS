// Starts the free demo: a fresh copy of the demo restaurant, served with the POS screens, WhatsApp off.
//
//   npm run demo            -> http://localhost:4300
//
// Every start begins from demo/template.db again (built by `node demo/seed.js`), so whatever visitors changed is gone.
// One shared demo for now; private per-visitor demos come next.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'template.db');
const RUN = path.join(__dirname, 'run.db');
const PORT = process.env.DEMO_PORT || process.env.PORT || 4300;

if (!fs.existsSync(TEMPLATE)) { console.error('No demo/template.db yet. Build it first: node demo/seed.js'); process.exit(1); }
if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) { console.error('Build the screens first: npm --prefix client run build'); process.exit(1); }
for (const f of [RUN, RUN + '-wal', RUN + '-shm']) fs.rmSync(f, { force: true });
fs.copyFileSync(TEMPLATE, RUN);

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: path.join(ROOT, 'server'), stdio: 'inherit',
  env: { ...process.env, POS_DB: RUN, PORT: String(PORT), DEMO: '1', WHATSAPP: 'off' }, // never the real WhatsApp
});
console.log(`HazelPOS demo on http://localhost:${PORT}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.kill(); process.exit(); });
server.on('exit', code => process.exit(code ?? 0));
