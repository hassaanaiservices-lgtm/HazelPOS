// Live menu -> text grouped by category, the way the POS shows it. Every item carries its POS ID [#id] so an order
// can name the exact product. Hidden items are listed separately so the assistant can say "not available right now".
const { money, choiceRule } = require('./format');

function priceText(p, currency) {
  const sizes = p.sizes || [];
  if (sizes.length === 1 && /^regular$/i.test(sizes[0].name)) return money(sizes[0].price, currency);
  if (sizes.length) return sizes.map(s => `${s.name}${s.detail ? ` (${s.detail})` : ''} ${money(s.price, currency)}`).join(' | ');
  return money(p.price, currency);
}

function productLines(p, currency) {
  const lines = [`- ${p.name} [#${p.id}]: ${priceText(p, currency)}`];
  if (p.subtitle) lines.push(`  ${p.subtitle}`);
  if (p.description) lines.push(`  ${p.description}`);
  if (p.ingredients?.length) lines.push(`  Ingredients: ${p.ingredients.join(', ')}`);
  for (const g of p.modifiers || []) {
    const opts = (g.options || []).map(o => `${o.name}${+o.price ? ` +${money(o.price, currency)}` : ' (free)'}`).join(', ');
    lines.push(`  Options: ${g.name} (${choiceRule(g)}): ${opts}`);
  }
  return lines;
}

function menuSections({ menu, categories }, currency) {
  const out = [];
  for (const c of categories) {
    const items = menu.filter(p => p.category_id === c.id && p.active);
    if (items.length) out.push(`## MENU: ${c.name.toUpperCase()}`, ...items.flatMap(p => productLines(p, currency)), '');
  }
  const orphans = menu.filter(p => p.active && !categories.some(c => c.id === p.category_id));
  if (orphans.length) out.push('## MENU: OTHER', ...orphans.flatMap(p => productLines(p, currency)), '');
  const hidden = menu.filter(p => !p.active);
  out.push('## NOT AVAILABLE RIGHT NOW', ...(hidden.length ? hidden.map(p => `- ${p.name} [#${p.id}]`) : ['(everything on the menu is available)']), '');
  return out;
}

module.exports = { menuSections, priceText };
