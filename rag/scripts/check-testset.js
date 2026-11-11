// Phase 5: checks every test case against the LIVE menu (products, sizes exist; setups apply) and writes a review
// sheet for the owner: each question with its expected answer worked out from today's prices.
//   node rag/scripts/check-testset.js
const fs = require('fs');
const path = require('path');
const { config, paths } = require('../src/config');
const { readPos } = require('../src/loaders/pos-db');
const { resolveCase } = require('../eval/expect');

const LANGS = ['en', 'roman_ur', 'ur', 'mixed'];
const TYPES = ['answer', 'clarify', 'not_on_menu', 'unavailable', 'order', 'handoff', 'refuse', 'greet'];
const file = path.join(paths.root, 'eval', 'datasets', 'questions.jsonl');
const cases = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => {
  try { return JSON.parse(l); } catch (e) { throw new Error(`questions.jsonl line ${i + 1}: ${e.message}`); }
});
const pos = readPos(paths.posDb, config.data);

const problems = [], rows = [], seen = new Set();
for (const tc of cases) {
  const bad = msg => problems.push(`${tc.id || '?'}: ${msg}`);
  if (!tc.id || seen.has(tc.id)) bad('missing or duplicate id');
  seen.add(tc.id);
  if (!LANGS.includes(tc.lang)) bad(`lang must be one of ${LANGS}`);
  if (!String(tc.q || '').trim()) bad('empty question');
  if (!TYPES.includes(tc.expect?.type)) bad(`expect.type must be one of ${TYPES}`);
  for (const h of tc.history || []) if (!['customer', 'bot'].includes(h.from) || !h.text) bad('history entries need from (customer/bot) and text');
  try { rows.push({ tc, ...resolveCase(pos, tc, config.context.currency) }); } catch (e) { bad(e.message); }
}

const count = key => Object.entries(cases.reduce((a, c) => { const k = key(c); a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
const table = pairs => pairs.map(([k, n]) => `${k} ${n}`).join(' · ');
const esc = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const LANG_NAME = { en: 'English', roman_ur: 'Roman Urdu', ur: 'Urdu', mixed: 'Mixed' };

const report = [
  '# Test set — review sheet', '',
  `${cases.length} questions · checked against the live menu ${new Date().toLocaleString()}`, '',
  `**Languages:** ${table(count(c => LANG_NAME[c.lang] || c.lang))}`, '',
  `**Topics:** ${table(count(c => c.cat))}`, '',
  `**Expected reply types:** ${table(count(c => c.expect?.type))}`, '',
  problems.length ? `## ⚠ Problems\n\n${problems.map(p => `- ${p}`).join('\n')}\n` : '',
  'Prices below are worked out from **today\'s** menu; if a price changes in the POS, the expectation changes with it.',
  'Please check each "correct reply" — mark anything you would answer differently.', '',
  '| # | Lang | Customer says | Correct reply |', '|---|---|---|---|',
  ...rows.map(({ tc, summary }) => {
    const ctx = [
      tc.history && `_(earlier: ${tc.history.map(h => `${h.from === 'customer' ? '👤' : '🤖'} ${h.text}`).join(' → ')})_`,
      tc.setup && `_(menu changed first: ${JSON.stringify(tc.setup)})_`,
    ].filter(Boolean).join(' ');
    return `| ${tc.id} | ${LANG_NAME[tc.lang]} | ${esc(tc.q)}${ctx ? ' ' + esc(ctx) : ''} | ${esc(summary)}${tc.note ? ` _(${esc(tc.note)})_` : ''} |`;
  }),
  '',
];
fs.mkdirSync(paths.reports, { recursive: true });
fs.writeFileSync(path.join(paths.reports, 'testset-review.md'), report.join('\n'));

console.log(`${cases.length} cases · ${table(count(c => LANG_NAME[c.lang] || c.lang))}`);
console.log(`Types: ${table(count(c => c.expect?.type))}`);
console.log(problems.length ? `\n${problems.length} problem(s):\n${problems.map(p => '  ' + p).join('\n')}` : 'All cases valid against the live menu.');
console.log('\nReview sheet: rag/eval/reports/testset-review.md');
process.exitCode = problems.length ? 1 : 0;
