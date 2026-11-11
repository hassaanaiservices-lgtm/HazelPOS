// Look at the chunks without opening files.
//   node rag/scripts/inspect-chunks.js              list every chunk: id, length, first line
//   node rag/scripts/inspect-chunks.js product:4    show one chunk (or all parts of a split document) in full
//   node rag/scripts/inspect-chunks.js --find zinger   chunks whose text contains a word
const fs = require('fs');
const path = require('path');
const { paths } = require('../src/config');

const file = path.join(paths.processed, 'chunks.jsonl');
if (!fs.existsSync(file)) { console.error('No chunks yet. Run: node rag/scripts/build-chunks.js'); process.exit(1); }
const chunks = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const [arg, value] = process.argv.slice(2);

const show = c => console.log(`── ${c.id}  [${c.type}${c.active ? '' : ', HIDDEN'}${c.parts > 1 ? `, part ${c.part}/${c.parts}` : ''}, ${c.text.length} chars, hash ${c.hash}]\n${c.text}\n`);

if (!arg) {
  for (const c of chunks) console.log(`${c.id.padEnd(34)} ${String(c.text.length).padStart(5)}  ${c.active ? ' ' : 'H'} ${c.text.split('\n')[0].slice(0, 70)}`);
  console.log(`\n${chunks.length} chunks. H = hidden in POS. Show one: node rag/scripts/inspect-chunks.js <id>`);
} else if (arg === '--find') {
  const hits = chunks.filter(c => c.text.toLowerCase().includes(String(value || '').toLowerCase()));
  hits.forEach(show);
  console.log(`${hits.length} chunk(s) contain "${value}"`);
} else {
  const hits = chunks.filter(c => c.id === arg || c.doc_id === arg);
  if (!hits.length) { console.error(`No chunk "${arg}". List them: node rag/scripts/inspect-chunks.js`); process.exit(1); }
  hits.forEach(show);
}
