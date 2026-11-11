// Phase 2: export from the POS, load every source, check it, and save what was loaded so a person can read it.
//   node rag/scripts/validate-data.js            (export fresh from the POS first)
//   node rag/scripts/validate-data.js --no-export
// Writes rag/data/processed/documents.jsonl and rag/eval/reports/data-validation.md. Exit code 1 if there are errors.
const fs = require('fs');
const path = require('path');
const { paths } = require('../src/config');
const { exportPos } = require('./export-pos');
const { loadAll } = require('../src/loaders');
const { validate } = require('../src/loaders/validate');

if (!process.argv.includes('--no-export')) exportPos();
const loaded = loadAll(paths);
const issues = validate(loaded);
const { documents } = loaded;

fs.mkdirSync(paths.processed, { recursive: true });
fs.writeFileSync(path.join(paths.processed, 'documents.jsonl'), documents.map(d => JSON.stringify(d)).join('\n') + '\n');

const count = l => issues.filter(i => i.level === l).length;
const byType = Object.entries(documents.reduce((a, d) => ({ ...a, [d.type]: (a[d.type] || 0) + 1 }), {}));
const manifest = JSON.parse(fs.readFileSync(path.join(paths.raw, 'manifest.json'), 'utf8'));
const report = [
  '# Data validation report', '',
  `Run: ${new Date().toLocaleString()} · POS export: ${new Date(manifest.exported_at).toLocaleString()}`, '',
  `**${count('error')} errors · ${count('warning')} warnings · ${count('info')} info**`, '',
  '## Documents loaded', '', '| Type | Count |', '|---|---|', ...byType.map(([t, n]) => `| ${t} | ${n} |`), `| **total** | **${documents.length}** |`, '',
  '## Issues', '',
  issues.length ? ['| Level | Where | Problem |', '|---|---|---|', ...issues.map(i => `| ${i.level} | ${i.where} | ${i.msg} |`)].join('\n') : 'None.', '',
  '## Example documents (what search will read)', '',
  ...['product', 'category', 'restaurant', 'delivery_zone', 'faq'].map(t => documents.find(d => d.type === t)).filter(Boolean)
    .flatMap(d => [`**${d.id}** (${d.source})`, '```', d.text, '```', '']),
];
fs.mkdirSync(paths.reports, { recursive: true });
fs.writeFileSync(path.join(paths.reports, 'data-validation.md'), report.join('\n'));

console.log(`${documents.length} documents (${byType.map(([t, n]) => `${n} ${t}`).join(', ')})`);
console.log(`${count('error')} errors, ${count('warning')} warnings, ${count('info')} info\n`);
for (const i of issues) console.log(`${i.level.toUpperCase().padEnd(7)} ${i.where}: ${i.msg}`);
console.log('\nSaved: rag/data/processed/documents.jsonl, rag/eval/reports/data-validation.md');
process.exitCode = count('error') ? 1 : 0;
