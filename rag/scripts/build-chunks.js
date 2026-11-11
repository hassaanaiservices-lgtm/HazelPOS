// Phase 3: export from the POS, load, chunk, check. Writes rag/data/processed/chunks.jsonl and
// rag/eval/reports/chunks.md (every chunk, readable). Exit code 1 if a check fails.
//   node rag/scripts/build-chunks.js [--no-export]
const fs = require('fs');
const path = require('path');
const { config, paths } = require('../src/config');
const { exportPos } = require('./export-pos');
const { loadAll } = require('../src/loaders');
const { chunkDocuments } = require('../src/chunking');
const { checkChunks } = require('../src/chunking/check');

function buildChunks({ exportFirst = true } = {}) {
  if (exportFirst) exportPos();
  const { documents } = loadAll(paths);
  const chunks = chunkDocuments(documents, config.chunking);
  fs.mkdirSync(paths.processed, { recursive: true });
  fs.writeFileSync(path.join(paths.processed, 'chunks.jsonl'), chunks.map(c => JSON.stringify(c)).join('\n') + '\n');
  return { documents, chunks, ...checkChunks(documents, chunks, config.chunking) };
}

module.exports = { buildChunks };

if (require.main === module) {
  const { chunks, fail, stats } = buildChunks({ exportFirst: !process.argv.includes('--no-export') });
  const report = ['# Chunks', '', `Built ${new Date().toLocaleString()} · ${stats.chunks} chunks from ${stats.documents} documents · ` +
    `length ${stats.chars.min}–${stats.chars.max} chars (median ${stats.chars.median}) · ${stats.split_documents} document(s) split`, '',
    fail.length ? `**${fail.length} check(s) failed:**\n\n${fail.map(f => `- ${f}`).join('\n')}` : '**All checks passed.**', '',
    ...chunks.flatMap(c => [`### ${c.id}${c.active ? '' : ' (hidden in POS)'}${c.parts > 1 ? ` — part ${c.part}/${c.parts}` : ''}`, '```', c.text, '```', ''])];
  fs.mkdirSync(paths.reports, { recursive: true });
  fs.writeFileSync(path.join(paths.reports, 'chunks.md'), report.join('\n'));
  console.log(`${stats.chunks} chunks from ${stats.documents} documents (${Object.entries(stats.byType).map(([t, n]) => `${n} ${t}`).join(', ')})`);
  console.log(`Length ${stats.chars.min}–${stats.chars.max} chars, median ${stats.chars.median}; ${stats.split_documents} document(s) split`);
  console.log(fail.length ? `\nFAILED:\n${fail.map(f => '  ' + f).join('\n')}` : 'All checks passed.');
  console.log('\nSaved: rag/data/processed/chunks.jsonl, rag/eval/reports/chunks.md');
  process.exitCode = fail.length ? 1 : 0;
}
