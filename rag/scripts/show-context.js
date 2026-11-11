// Phase 4: print the live knowledge the assistant reads with every message, exactly as DeepSeek will see it.
//   node rag/scripts/show-context.js          print it + size; save to rag/data/processed/context.txt
//   node rag/scripts/show-context.js --diff   only show what changed since the last saved copy
const fs = require('fs');
const path = require('path');
const { config, paths } = require('../src/config');
const { loadKnowledge } = require('../src/context');

const k = loadKnowledge(paths, config);
const file = path.join(paths.processed, 'context.txt');
const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

if (process.argv.includes('--diff')) {
  const a = before.split('\n'), b = k.text.split('\n');
  const removed = a.filter(l => !b.includes(l)), added = b.filter(l => !a.includes(l));
  if (!removed.length && !added.length) console.log('No change since the last saved copy.');
  removed.forEach(l => console.log(`- ${l}`));
  added.forEach(l => console.log(`+ ${l}`));
} else {
  console.log(k.text);
}
const s = k.stats;
console.log(`\n[version ${k.version} · ${s.chars} chars ≈ ${s.approx_tokens} tokens · ${s.available_items} available, ${s.hidden_items} hidden items · ` +
  `${s.faq} FAQ · ${s.delivery_areas} delivery areas]`);
if (s.approx_tokens > config.context.warn_tokens) console.log(`WARNING: over ${config.context.warn_tokens} tokens; consider search (embedding) for the FAQ part`);
fs.mkdirSync(paths.processed, { recursive: true });
fs.writeFileSync(file, k.text);
