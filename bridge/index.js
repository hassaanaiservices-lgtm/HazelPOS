#!/usr/bin/env node
// HazelPOS Bridge CLI: runs on one PC in the shop. It fetches print jobs from the HazelPOS server (an outbound connection only,
// so the shop's router needs no setup) and sends them to the thermal printers on the shop's network or USB. The work is in bridge.js.
//   node bridge/index.js [--config bridge/config.json]      run
//   node bridge/index.js --check                            can it reach the server and the printers?
const fs = require('fs');
const path = require('path');
const { createBridge } = require('./bridge');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const configPath = path.resolve(opt('--config') || path.join(__dirname, 'config.json'));
let cfg;
try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
catch (e) { console.error(`Cannot read ${configPath}: ${e.message}\nExample: {"server":"https://hazelpos.example","key":"<printer helper key>","receipt":"192.168.1.50:9100","kitchen":"192.168.1.51:9100"}`); process.exit(1); }
if (!String(cfg.server || '').trim() || !cfg.key) { console.error('config.json needs "server" and "key"'); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const bridge = createBridge(cfg, log);
process.on('unhandledRejection', e => log('Error:', e?.message || e));
if (args.includes('--check')) bridge.check().then(r => process.exit(r.ok ? 0 : 1));
else bridge.start();
