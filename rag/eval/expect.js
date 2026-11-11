// Turns a test case's expectations into concrete facts using the LIVE menu, so tests never hardcode prices.
// Used by the test-set checker now, and by the scorer in phase 6.
const { money } = require('../src/context/format');

const clone = x => JSON.parse(JSON.stringify(x));

// Applies a case's `setup` (price change / hide / add) to a copy of the POS data, in memory
function applySetup(pos, setup) {
  const p = clone(pos);
  if (!setup) return p;
  for (const ch of setup.price || []) {
    const item = p.menu.find(m => m.id === ch.p);
    if (!item) throw new Error(`setup.price: product ${ch.p} not found`);
    if (ch.size) { const s = item.sizes.find(s => s.name === ch.size); if (!s) throw new Error(`setup.price: ${item.name} has no size "${ch.size}"`); s.price = ch.value; }
    else item.price = ch.value;
  }
  for (const id of setup.hide || []) {
    const item = p.menu.find(m => m.id === id);
    if (!item) throw new Error(`setup.hide: product ${id} not found`);
    item.active = false;
  }
  let nextId = Math.max(0, ...p.menu.map(m => m.id)) + 1;
  for (const a of setup.add || []) p.menu.push({ id: nextId++, active: true, subtitle: '', description: '', ingredients: [], sizes: [], modifiers: [], ...a });
  return p;
}

const product = (pos, ref) => typeof ref === 'string' && ref.startsWith('new:')
  ? pos.menu.find(m => m.name === ref.slice(4))
  : pos.menu.find(m => m.id === ref);

// {p, size?} -> [{label, amount}] (no size = every size)
function resolvePrice(pos, ref) {
  const item = product(pos, ref.p);
  if (!item) throw new Error(`product ${JSON.stringify(ref.p)} not found`);
  if (!item.sizes.length) { if (ref.size) throw new Error(`${item.name} has no sizes`); return [{ label: item.name, amount: item.price }]; }
  const sizes = ref.size ? item.sizes.filter(s => s.name === ref.size) : item.sizes;
  if (!sizes.length) throw new Error(`${item.name} has no size "${ref.size}" (has: ${item.sizes.map(s => s.name).join(', ')})`);
  return sizes.map(s => ({ label: `${item.name} ${s.name}`, amount: s.price }));
}

// Order line -> unit price, same rule as the POS (one size = that size; several = must name one)
function linePrice(pos, line) {
  const item = product(pos, line.p);
  if (!item) throw new Error(`product ${line.p} not found`);
  if (!item.active) throw new Error(`${item.name} is hidden in this case`);
  if (!item.sizes.length) return { name: item.name, unit: item.price };
  const s = line.size ? item.sizes.find(s => s.name === line.size) : item.sizes.length === 1 ? item.sizes[0] : null;
  if (!s) throw new Error(line.size ? `${item.name}: size "${line.size}" not found (has: ${item.sizes.map(s => s.name).join(', ')})`
    : `${item.name}: an order line needs a size (has: ${item.sizes.map(s => s.name).join(', ')})`);
  const showSize = item.sizes.length > 1 || s.name !== 'Regular'; // same naming rule as the POS bill
  return { name: showSize ? `${item.name} (${s.name})` : item.name, unit: s.price };
}

// A case -> plain-language expected answer + the facts the scorer will check
function resolveCase(posLive, tc, currency = 'Rs') {
  const pos = applySetup(posLive, tc.setup);
  const e = tc.expect;
  const facts = { prices: [], items: [], total: null, suggest: [] };
  for (const ref of e.prices || []) facts.prices.push(...resolvePrice(pos, ref));
  for (const line of e.items || []) { const lp = linePrice(pos, line); facts.items.push({ ...lp, qty: line.qty, line: lp.unit * line.qty }); }
  if (e.total) facts.total = facts.items.reduce((s, i) => s + i.line, 0);
  for (const id of e.suggest || []) { const it = product(pos, id); if (!it) throw new Error(`suggest: product ${id} not found`); facts.suggest.push(it.name); }

  const m = n => money(n, currency);
  const words = groups => groups.map(g => g.join(' / ')).join('; ');
  const parts = {
    answer: () => [facts.prices.length && `Prices: ${facts.prices.map(p => `${p.label} ${m(p.amount)}`).join(', ')}`, e.says && `Mentions: ${words(e.says)}`].filter(Boolean).join(' · ') || 'Answers from the menu',
    clarify: () => `Asks first${e.asks ? ` (about: ${words(e.asks)})` : ''}; does not guess`,
    not_on_menu: () => `Says we don't have it${facts.suggest.length ? `; suggests e.g. ${facts.suggest.join(' / ')}` : ''}`,
    unavailable: () => `Says it's not available right now${facts.suggest.length ? `; suggests e.g. ${facts.suggest.join(' / ')}` : ''}`,
    order: () => `Order: ${facts.items.map(i => `${i.qty}× ${i.name} @ ${m(i.unit)}`).join(', ')}${facts.total != null ? ` · Total (by code) ${m(facts.total)}` : ''}${e.says ? ` · Mentions: ${words(e.says)}` : ''}`,
    handoff: () => `Doesn't invent; says it doesn't have that detail and carries on, no handover (missing info: ${e.topic})`,
    refuse: () => 'Politely declines, stays on restaurant topics',
    greet: () => 'Greets / thanks and offers help',
  };
  if (!parts[e.type]) throw new Error(`unknown expect.type "${e.type}"`);
  let summary = parts[e.type]();
  if (e.not_says) summary += ` · Must NOT say: ${e.not_says.join(', ')}`;
  return { summary, facts, pos };
}

module.exports = { applySetup, resolvePrice, linePrice, resolveCase };
