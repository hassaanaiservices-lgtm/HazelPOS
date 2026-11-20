// Checks around the installer build (run by .github/workflows/desktop.yml, and by `npm run dist`).
//   node verify-build.js pre    before packaging: server address, bridge code and publish repo are set
//   node verify-build.js post   after packaging: the installer and its update files exist
const fs = require('fs');
const path = require('path');
const phase = process.argv[2] || 'pre';
const CI = !!process.env.CI;
const pkg = require('./package.json');
const problems = [], warnings = [];
const need = (cond, m, soft) => { if (!cond) (soft && !CI ? warnings : problems).push(m); };

if (phase === 'pre') {
  need(fs.existsSync(path.join(__dirname, '..', 'bridge', 'bridge.js')), 'bridge/bridge.js is missing');
  need(fs.existsSync(path.join(__dirname, '..', 'server', 'printer.js')), 'server/printer.js is missing');
  need(/^https:\/\//.test(pkg.hazel?.serverUrl || ''), 'desktop/package.json → hazel.serverUrl must be the https address of the HazelPOS server', true);
  need(pkg.build?.publish?.[0]?.repo && pkg.build.publish[0].repo !== 'HazelPOS', 'publish repo must be the public releases repo, not the private code repo', true);
  need(pkg.build?.productName === 'HazelPOS Printer', 'productName must be "HazelPOS Printer"');
} else {
  const dist = path.join(__dirname, 'dist');
  const files = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
  console.log('desktop/dist: ' + files.join(', '));
  need(files.some(f => /^HazelPOS-Printer-Setup-.*\.exe$/.test(f) && !f.includes('__uninstaller')), 'no HazelPOS-Printer-Setup-<version>.exe in desktop/dist');
  need(files.some(f => f.endsWith('.exe.blockmap')), 'no .blockmap next to the installer');
  need(files.includes('latest.yml'), 'no latest.yml: installed apps could not find updates');
}
warnings.forEach(w => console.warn('warning: ' + w));
if (problems.length) { problems.forEach(p => console.error('PROBLEM: ' + p)); process.exit(1); }
console.log(`verify ${phase}: OK`);
