// Phase 2: copy what customers may know from the POS database into rag/data/raw/ as readable JSON.
// The POS database is opened read-only; nothing in the POS changes.
//   node rag/scripts/export-pos.js
// Writes: menu.json, categories.json, delivery_zones.json, restaurant.json, promos.json, manifest.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config, paths } = require('../src/config');
const { readPos } = require('../src/loaders/pos-db');

function exportPos() {
  const { menu, categories, delivery_zones, restaurant, promos } = readPos(paths.posDb, config.data);
  const files = { 'menu.json': menu, 'categories.json': categories, 'delivery_zones.json': delivery_zones, 'restaurant.json': restaurant, 'promos.json': promos };
  fs.mkdirSync(paths.raw, { recursive: true });
  const manifest = { exported_at: new Date().toISOString(), source: paths.posDb, files: {} };
  for (const [name, data] of Object.entries(files)) {
    const text = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(path.join(paths.raw, name), text);
    manifest.files[name] = { count: Array.isArray(data) ? data.length : Object.keys(data).length, sha256: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
  }
  fs.writeFileSync(path.join(paths.raw, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

module.exports = { exportPos };

if (require.main === module) {
  const m = exportPos();
  console.log(`Exported from ${m.source} to rag/data/raw/`);
  for (const [f, i] of Object.entries(m.files)) console.log(`  ${f.padEnd(20)} ${String(i.count).padStart(3)} ${f === 'restaurant.json' ? 'fields' : 'rows'}`);
  if (!config.data.include_promo_codes) console.log('  (promo codes not exported: include_promo_codes is false in the config)');
}
