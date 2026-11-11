// Phase 6: runs every test question through the real pipeline (live menu + DeepSeek), scores each reply, and saves
// the full results. Each run is kept in rag/eval/reports/ so runs can be compared; latest.md is the newest.
//   node rag/scripts/run-eval.js                 all cases
//   node rag/scripts/run-eval.js --only order-   only cases whose id starts with "order-"
//   node rag/scripts/run-eval.js --parallel 4
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config, paths } = require('../src/config');
const { readPos } = require('../src/loaders/pos-db');
const { ask } = require('../src/pipeline');
const { applySetup, resolveCase } = require('../eval/expect');
const { scoreCase } = require('../eval/score');

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const only = arg('--only'), parallel = +arg('--parallel') || 4;

const cases = fs.readFileSync(path.join(paths.root, 'eval', 'datasets', 'questions.jsonl'), 'utf8')
  .split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).filter(c => !only || c.id.startsWith(only));
const livePos = readPos(paths.posDb, config.data);
const promptVersion = crypto.createHash('sha256').update(fs.readFileSync(path.join(paths.prompts, 'system.md'))).digest('hex').slice(0, 8);

async function runOne(tc) {
  const pos = applySetup(livePos, tc.setup);
  const { facts } = resolveCase(livePos, tc, config.context.currency);
  const res = await ask({ message: tc.q, history: tc.history || [], pos, location: tc.location || null, cart: tc.cart || null });
  return { id: tc.id, lang: tc.lang, cat: tc.cat, type: tc.expect.type, q: tc.q, res, ...scoreCase(tc, facts, res) };
}

async function runAll() {
  const out = Array.from({ length: cases.length });
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, cases.length) }, async () => {
    while (next < cases.length) {
      const i = next++;
      out[i] = await runOne(cases[i]);
      process.stdout.write(`\r${++done}/${cases.length} ${out[i].pass ? '✓' : '✗'} ${cases[i].id}          `);
    }
  }));
  process.stdout.write('\n');
  return out;
}

const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '—';
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))] || 0; };

function cost(usage, rates) {
  const hit = usage.prompt_cache_hit_tokens || 0, miss = usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens || 0) - hit;
  return (hit * rates.input_hit + miss * rates.input_miss + (usage.completion_tokens || 0) * rates.output) / 1e6;
}

(async () => {
  const t0 = Date.now();
  const results = await runAll();
  const n = results.length, passed = results.filter(r => r.pass).length;
  const groupBy = key => Object.entries(results.reduce((a, r) => { (a[r[key]] ||= []).push(r); return a; }, {}))
    .map(([k, rs]) => `| ${k} | ${rs.filter(r => r.pass).length}/${rs.length} | ${pct(rs.filter(r => r.pass).length, rs.length)} |`);
  const priceChecks = results.flatMap(r => r.checks.filter(c => /^says .* \d+$|^total /.test(c.name)));
  const orderChecks = results.flatMap(r => r.checks.filter(c => c.name === 'order items exactly right'));
  const invented = results.filter(r => r.res.guard?.invented?.length);
  const errors = results.filter(r => r.res.error);
  const ms = results.map(r => r.res.ms.total);
  const usage = results.map(r => r.res.usage || {});
  const sum = k => usage.reduce((s, u) => s + (u[k] || 0), 0);
  const costPeak = usage.reduce((s, u) => s + cost(u, config.llm.price_usd_per_million.peak), 0);
  const costOff = usage.reduce((s, u) => s + cost(u, config.llm.price_usd_per_million.off_peak), 0);

  const summary = {
    pass: `${passed}/${n} (${pct(passed, n)})`,
    prices_correct: `${priceChecks.filter(c => c.ok).length}/${priceChecks.length} (${pct(priceChecks.filter(c => c.ok).length, priceChecks.length)})`,
    orders_exact: `${orderChecks.filter(c => c.ok).length}/${orderChecks.length} (${pct(orderChecks.filter(c => c.ok).length, orderChecks.length)})`,
    invented_amounts: `${invented.length}/${n} (${pct(invented.length, n)})`,
    api_errors: errors.length,
    hedged_calls: results.filter(r => r.res.hedged).length,
    latency_ms: { p50: quantile(ms, 0.5), p95: quantile(ms, 0.95), max: Math.max(...ms) },
    tokens_per_message: { prompt: Math.round(sum('prompt_tokens') / n), cached: Math.round(sum('prompt_cache_hit_tokens') / n), output: Math.round(sum('completion_tokens') / n) },
    cost_per_1000_messages_usd: { peak: +(costPeak / n * 1000).toFixed(3), off_peak: +(costOff / n * 1000).toFixed(3) },
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fails = results.filter(r => !r.pass);
  const md = [
    `# Eval run ${new Date().toLocaleString()}`, '',
    `Model \`${config.llm.model}\` (thinking ${config.llm.thinking}) · prompt version \`${promptVersion}\` · ${n} cases · ${Math.round((Date.now() - t0) / 1000)} s`, '',
    '| Measure | Result | Target |', '|---|---|---|',
    `| Cases passed | **${summary.pass}** | — |`,
    `| Prices & totals correct | **${summary.prices_correct}** | 100% |`,
    `| Orders understood exactly | **${summary.orders_exact}** | — |`,
    `| Replies with an invented amount (blocked by the guard) | **${summary.invented_amounts}** | ≤ 2% |`,
    `| API errors | ${summary.api_errors} | 0 |`,
    `| Slow calls rescued by a second request | ${summary.hedged_calls} | — |`,
    `| Reply time p50 / p95 / max | ${summary.latency_ms.p50} / **${summary.latency_ms.p95}** / ${summary.latency_ms.max} ms | p95 ≤ 5,000 ms |`,
    `| Tokens per message (prompt / cached / reply) | ${summary.tokens_per_message.prompt} / ${summary.tokens_per_message.cached} / ${summary.tokens_per_message.output} | — |`,
    `| Cost per 1,000 messages | $${summary.cost_per_1000_messages_usd.off_peak} off-peak · $${summary.cost_per_1000_messages_usd.peak} peak | — |`, '',
    '## By expected reply type', '', '| Type | Passed | |', '|---|---|---|', ...groupBy('type'), '',
    '## By language', '', '| Language | Passed | |', '|---|---|---|', ...groupBy('lang'), '',
    `## Failures (${fails.length})`, '',
    ...fails.flatMap(r => [
      `### ${r.id} — ${r.q}`,
      ...r.checks.filter(c => !c.ok).map(c => `- ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`),
      `- intent \`${r.res.intent}\`, handoff ${r.res.handoff}${r.res.error ? `, error: ${r.res.error}` : ''}`,
      '```', r.res.reply, '```', '']),
  ].join('\n');

  fs.mkdirSync(paths.reports, { recursive: true });
  fs.writeFileSync(path.join(paths.reports, `run-${stamp}.md`), md);
  fs.writeFileSync(path.join(paths.reports, `run-${stamp}.jsonl`), results.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(paths.reports, 'latest.md'), md);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nReport: rag/eval/reports/latest.md (and run-${stamp}.md / .jsonl)`);
})();
