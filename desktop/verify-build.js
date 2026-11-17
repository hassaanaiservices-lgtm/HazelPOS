// Checks around the installer build (run by .github/workflows/desktop.yml, and by `npm run dist`).
//   node verify-build.js pre    before packaging: the pieces that go inside are right
//   node verify-build.js post   after packaging: the installer and its update files exist and look sane
// A release build (CI) fails on anything wrong. A local build only prints warnings for the settings that CI requires.
const fs = require('fs');
const path = require('path');

const phase = process.argv[2] || 'pre';
const CI = !!process.env.CI;
const root = path.join(__dirname, '..');
const pkg = require('./package.json');
const problems = [], warnings = [];
const bad = m => problems.push(m);
const need = (cond, m, soft) => { if (!cond) (soft && !CI ? warnings : problems).push(m); };

async function pre() {
  need(fs.existsSync(path.join(root, 'client', 'dist', 'index.html')), 'client/dist is missing: the POS screens were not built');
  need(fs.existsSync(path.join(root, 'server', 'node_modules')), 'server/node_modules is missing (npm --prefix server ci --omit=dev)');
  need(!!pkg.hazel?.cloudUrl, 'desktop/package.json → hazel.cloudUrl is empty: the installer would not know your cloud', true);
  need(!!pkg.hazel?.licencePublicKey, 'desktop/package.json → hazel.licencePublicKey is empty: the licence answers could not be verified (RISKS L4)', true);
  need(pkg.build?.publish?.[0]?.repo && pkg.build.publish[0].repo !== 'HazelPOS', 'publish repo must be the public releases repo, not the private code repo (RISKS D2)', true);
  // WhatsApp menu pictures go through sharp (a Baileys peer). It must be the Windows build, and it must really work.
  if (process.platform === 'win32') {
    need(fs.existsSync(path.join(root, 'server', 'node_modules', '@img', 'sharp-win32-x64')), 'server/node_modules has no Windows sharp (@img/sharp-win32-x64): install on a Windows machine');
    try {
      const sharp = require(path.join(root, 'server', 'node_modules', 'sharp'));
      const out = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff7a1a' } }).jpeg().toBuffer();
      need(out.length > 50, 'sharp ran but made an empty picture');
    } catch (e) { bad('sharp does not work on this machine: ' + e.message); }
  }
}

function post() {
  const dist = path.join(__dirname, 'dist');
  const files = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
  const exe = files.find(f => /^HazelPOS-Setup-.*\.exe$/.test(f) && !f.includes('__uninstaller'));
  console.log('desktop/dist: ' + files.join(', '));
  need(!!exe, 'no HazelPOS-Setup-<version>.exe in desktop/dist');
  need(files.some(f => f.endsWith('.exe.blockmap')), 'no .blockmap next to the installer: updates would download the whole file every time');
  need(files.includes('latest.yml'), 'no latest.yml: installed apps could not find updates');
  if (exe) {
    const mb = fs.statSync(path.join(dist, exe)).size / 1048576;
    need(mb < 150, `the installer is ${Math.round(mb)} MB (expected under 150): something large got packed`);
    console.log(`installer: ${exe}, ${mb.toFixed(1)} MB`);
    need(exe.includes(pkg.version), `the installer name does not contain the version ${pkg.version}`);
  }
  const res = path.join(dist, 'win-unpacked', 'resources', 'app', 'server', 'node_modules');
  if (fs.existsSync(res)) {
    const img = path.join(res, '@img');
    const names = fs.existsSync(img) ? fs.readdirSync(img) : [];
    console.log('packed @img: ' + names.join(', '));
    need(!names.some(n => /linux|darwin|wasm32/.test(n)), `foreign sharp parts inside the installer: ${names.filter(n => /linux|darwin|wasm32/.test(n)).join(', ')}`);
    const types = path.join(res, '@types'); // only size: a warning, never a stopper
    if (fs.existsSync(types) && fs.readdirSync(types).length) warnings.push('type files (@types) were packed: not needed, only size');
  }
}

(async () => {
  if (phase === 'pre') await pre(); else post();
  warnings.forEach(w => console.warn((CI ? '::warning::' : 'warning: ') + w));
  // On GitHub, problems become notes on the run page (readable without opening the log)
  if (CI) problems.forEach(p => console.log('::error::' + p.replace(/\n/g, ' ')));
  if (problems.length) { console.error('\nBuild check failed:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log(`build check (${phase}) ok`);
})();
