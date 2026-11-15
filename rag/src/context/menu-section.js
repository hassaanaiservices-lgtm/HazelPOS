// Live menu -> text grouped by category, the way the POS shows it. Every item carries its POS ID [#id] so an order
// can name the exact product. Hidden items are listed separately so the assistant can say "not available right now".
const { money, choiceRule } = require('./format');

function priceText(p, currency) {
  const sizes = p.sizes || [];
  if (sizes.length === 1 && /^regular$/i.test(sizes[0].name)) return money(sizes[0].price, currency);
  if (sizes.length) return sizes.map(s => `${s.name}${s.detail ? ` (${s.detail})` : ''} ${money(s.price, currency)}`).join(' | ');
  return money(p.price, currency);
}

// menu: the whole menu, to name the items inside a deal
function productLines(p, currency, menu = []) {
  const lines = [`- ${p.name} [#${p.id}]: ${priceText(p, currency)}`];
  const inside = (p.deal_items || []).filter(d => d?.product_id).map(d => {
    const item = menu.find(x => x.id === +d.product_id);
    return item ? `${Math.max(1, +d.qty || 1)}x ${item.name}${d.size ? ` (${d.size})` : ''}` : null;
  }).filter(Boolean);
  if (inside.length) lines.push(`  Deal includes: ${inside.join(', ')}`);
  const base = p.combo_for && menu.find(x => x.id === +p.combo_for);
  if (base) lines.push(`  Combo offered with: ${base.name}`);
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
    if (items.length) out.push(`## MENU: ${c.name.toUpperCase()}`, ...items.flatMap(p => productLines(p, currency, menu)), '');
  }
  const orphans = menu.filter(p => p.active && !categories.some(c => c.id === p.category_id));
  if (orphans.length) out.push('## MENU: OTHER', ...orphans.flatMap(p => productLines(p, currency, menu)), '');
  const hidden = menu.filter(p => !p.active);
  out.push('## NOT AVAILABLE RIGHT NOW', ...(hidden.length ? hidden.map(p => `- ${p.name} [#${p.id}]`) : ['(everything on the menu is available)']), '');
  return out;
}

module.exports = { menuSections, priceText };
