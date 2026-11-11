// Checks the order lines the LLM produced against the live menu and prices them — the same rules the POS uses for
// a bill (size required when there are several; option groups' min/max). The LLM never calculates money.
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, '');
// "Large (12 inch)" -> "large": the menu text shows size details in brackets and the LLM sometimes copies them
const sizeKey = s => norm(String(s ?? '').replace(/\s*\([^)]*\)\s*$/, ''));

function priceLine(menu, line) {
  const p = menu.find(m => m.id === +line.product_id);
  if (!p) return { error: `unknown product #${line.product_id}` };
  if (!p.active) return { error: `${p.name} is not available right now` };
  const qty = parseInt(line.qty, 10);
  if (!(qty >= 1 && qty <= 99)) return { error: `${p.name}: quantity ${line.qty} is not valid` };

  const sizes = p.sizes || [];
  let size = null;
  if (sizes.length) {
    size = line.size ? sizes.find(s => sizeKey(s.name) === sizeKey(line.size)) : sizes.length === 1 ? sizes[0] : null;
    if (!size) return { error: line.size ? `${p.name} has no size "${line.size}"` : `${p.name}: size not chosen`, needs: 'size' };
  }
  const picked = Array.isArray(line.options) ? line.options : [];
  const mods = [];
  for (const g of p.modifiers || []) {
    const chosen = (g.options || []).filter(o => picked.some(m => norm(m.group) === norm(g.name) && norm(m.name) === norm(o.name)));
    if (chosen.length < (+g.min || 0)) return { error: `${p.name}: choose ${g.name}`, needs: 'option' };
    if (+g.max && chosen.length > +g.max) return { error: `${p.name}: at most ${g.max} for ${g.name}` };
    chosen.forEach(o => mods.push({ group: g.name, name: o.name, price: +o.price || 0 }));
  }
  if (mods.length !== picked.length) return { error: `${p.name}: an option is not on the menu` };

  const showSize = size && (sizes.length > 1 || size.name !== 'Regular'); // same naming as the POS bill
  const unit = (size ? +size.price : +p.price) + mods.reduce((s, m) => s + m.price, 0);
  return {
    product_id: p.id, size: size?.name ?? null, qty, mods, unit, total: unit * qty,
    name: p.name + (showSize ? ` (${size.name})` : '') + (mods.length ? ` + ${mods.map(m => m.name).join(', ')}` : ''),
  };
}

// -> { lines, subtotal, errors }  (errors = lines that could not be priced; the order is then not shown)
function priceOrder(menu, order) {
  const lines = [], errors = [];
  for (const l of order?.items || []) {
    const r = priceLine(menu, l);
    if (r.error) errors.push(r); else lines.push(r);
  }
  return { lines, errors, subtotal: lines.reduce((s, l) => s + l.total, 0) };
}

module.exports = { priceOrder };
