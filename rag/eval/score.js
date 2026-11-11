// Scores one reply against its test case. Automatic, rule-based checks only (no LLM judging another LLM), so a
// score means the same thing every run. Returns { pass, checks: [{name, ok, detail}] }.
const { toLatin } = require('../src/generation/guard');

const lower = s => toLatin(String(s || '')).toLowerCase();
const digitsIn = (text, n) => lower(text).replace(/(\d),(\d{3})/g, '$1$2').match(/\d+/g)?.includes(String(n)) || false;
const hasAny = (text, words) => words.some(w => lower(text).includes(lower(w)));
const NEGATION = ['not', "don't", 'do not', 'sorry', 'unfortunately', 'nahi', 'nahin', 'nai ', 'mojood nahi', 'available nahi', 'نہیں', 'معذرت', 'افسوس'];
const ASKS = /[?؟]/;

function scoreCase(tc, facts, res) {
  const e = tc.expect, reply = res.reply || '', checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

  // --- on every reply ---
  add('no invented amounts', !res.guard?.invented?.length, res.guard?.invented?.length ? `invented: ${res.guard.invented.join(', ')}` : '');
  const urduScript = /[؀-ۿ]/.test(res.raw || reply);
  if (tc.lang === 'ur') add('replied in Urdu script', urduScript);
  if (tc.lang === 'en' || tc.lang === 'roman_ur') add('replied in Latin script', !urduScript);
  for (const w of e.not_says || []) add(`does not say "${w}"`, !lower(reply).includes(lower(w)));
  if (!['order', 'clarify'].includes(e.type) && !(e.type === 'answer' && tc.cat === 'follow_up')) add('no order taken', !res.order_ok);
  if (/\b(confirm(ed)? (hai|ho gaya)|order (is )?(placed|confirmed)|on (its|the) way)\b/i.test(res.raw || '')) add('does not claim the order is confirmed', false, res.raw);

  // --- by expected type ---
  switch (e.type) {
    case 'answer':
      for (const p of facts.prices) add(`says ${p.label} ${p.amount}`, digitsIn(reply, p.amount));
      for (const g of e.says || []) add(`mentions ${g.join('/')}`, hasAny(reply, g));
      add('answered (no handoff)', !res.handoff && !['handoff', 'refuse'].includes(res.intent), res.intent);
      break;
    case 'clarify':
      add('asks a question', ASKS.test(res.raw || reply));
      for (const g of e.asks || []) add(`asks about ${g.join('/')}`, hasAny(res.raw, g));
      add('does not guess an order', !res.order_ok);
      break;
    case 'not_on_menu':
    case 'unavailable':
      add('says we don\'t have it', hasAny(reply, NEGATION) || ['not_on_menu', 'unavailable'].includes(res.intent), res.intent);
      if (facts.suggest.length) add(`suggests one of ${facts.suggest.join('/')}`, hasAny(reply, facts.suggest.map(n => n.split(' ')[0])));
      for (const g of e.says || []) add(`mentions ${g.join('/')}`, hasAny(reply, g));
      break;
    case 'order': {
      const want = facts.items.map(i => `${i.qty}× ${i.name}`).sort();
      const got = (res.order?.lines || []).map(l => `${l.qty}× ${l.name}`).sort();
      add('order items exactly right', res.order_ok && JSON.stringify(want) === JSON.stringify(got), `want ${want.join(', ')} | got ${got.join(', ') || 'nothing'}${res.order?.errors?.length ? ' | errors: ' + res.order.errors.map(x => x.error).join('; ') : ''}`);
      if (facts.total != null) add(`total ${facts.total} in summary`, res.order_ok && res.order.subtotal === facts.total && digitsIn(reply, facts.total));
      for (const g of e.says || []) add(`mentions ${g.join('/')}`, hasAny(reply, g));
      add('exactly one order summary', (reply.match(/🧾/g) || []).length === 1, `${(reply.match(/🧾/g) || []).length} summaries`);
      if (e.needs) {
        const asks = (reply.match(e.needs === 'address' ? /address|pata\b|location pin|ایڈریس|پتہ/gi : /takeaway|ٹیک اوے/gi) || []).length;
        add(`asks for ${e.needs} only once`, asks <= (e.needs === 'address' ? 2 : 1), `${asks} mentions`);
        add(`asks for ${e.needs} (code)`, (res.missing || []).includes(e.needs), `missing: ${JSON.stringify(res.missing)}`);
        add('no YES before the order is complete', !res.order_complete && !/\bYES\b/.test(reply));
      }
      if (e.complete) add('order complete → YES offered', res.order_complete && /\bYES\b/.test(reply), `missing: ${JSON.stringify(res.missing)}`);
      if (e.fulfilment) add(`fulfilment = ${e.fulfilment}`, res.order?.fulfilment === e.fulfilment, String(res.order?.fulfilment));
      for (const w of e.address_has || []) add(`address has "${w}"`, lower(res.order?.address).includes(lower(w)), String(res.order?.address));
      if (e.pin) add('location pin used as address', !!res.order?.location);
      break;
    }
    case 'handoff': // missing info: the bot handles it itself (no staff on WhatsApp), says it doesn't know, never guesses
      add('handles it itself (no handoff)', !res.handoff, res.intent);
      add("says it doesn't have that detail", hasAny(reply, NEGATION), reply.slice(0, 80));
      add('never promises a person', !/team member|hamari team|ہماری ٹیم|staff will/i.test(reply), reply.slice(0, 80));
      break;
    case 'refuse':
      add('declines', ['refuse', 'handoff'].includes(res.intent) || hasAny(reply, NEGATION), res.intent);
      break;
    case 'greet':
      add('greets / offers help', ['greet', 'answer'].includes(res.intent), res.intent);
      break;
  }
  return { pass: checks.every(c => c.ok), checks };
}

module.exports = { scoreCase };
