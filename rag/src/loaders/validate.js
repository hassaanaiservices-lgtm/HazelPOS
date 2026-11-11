// Checks the loaded data before anything is indexed.
//   error   = the assistant would give wrong answers; fix before going live
//   warning = the assistant will be weaker or unable to answer some questions
//   info    = good to know
function validate({ documents, raw, problems = [] }) {
  const out = [...problems];
  const add = (level, where, msg) => out.push({ level, where, msg });
  const { products, categories, zones, restaurant, faqFiles } = raw;

  // --- Menu ---
  const activeNames = new Map();
  for (const p of products) {
    const where = `product ${p.id} "${p.name || '?'}"`;
    if (!String(p.name || '').trim()) add('error', where, 'has no name');
    if (!categories.some(c => c.id === p.category_id)) add('error', where, `category ${p.category_id} does not exist`);
    if (!(p.price > 0) && !p.sizes.length) add('error', where, 'has no price and no sizes');
    for (const s of p.sizes) if (!s.name || !(s.price > 0)) add('error', where, `size "${s.name || '?'}" has no name or no price`);
    if (p.sizes.length && !p.sizes.some(s => s.price === p.price)) add('info', where, `base price ${p.price} matches none of its sizes; the POS charges the size price`);
    for (const g of p.modifiers) for (const o of g.options || []) if (o.price < 0) add('error', where, `option "${o.name}" has a negative price`);
    if (p.active) {
      const key = String(p.name).trim().toLowerCase();
      if (activeNames.has(key)) add('error', where, `same name as product ${activeNames.get(key)}; customers can't tell them apart`);
      activeNames.set(key, p.id);
      if (!p.description.trim()) add('warning', where, 'no description: questions like "what is in it" / "is it spicy" can\'t be answered');
      if (!p.ingredients.length) add('warning', where, 'no ingredients listed');
    }
  }
  const hidden = products.filter(p => !p.active).length;
  if (hidden) add('info', 'menu', `${hidden} hidden product(s): the assistant will say they are not available right now`);
  for (const c of categories) if (!products.some(p => p.category_id === c.id && p.active)) add('warning', `category "${c.name}"`, 'has no available products');

  // --- Delivery ---
  if (!zones.length) add('warning', 'delivery', 'no delivery areas set up in the POS (Settings → Delivery Zones): "do you deliver to X?" can\'t be answered');
  for (const z of zones) if (!(z.fee >= 0)) add('error', `delivery area "${z.name}"`, 'fee is missing');

  // --- Restaurant ---
  for (const [k, v] of Object.entries(restaurant)) if (!String(v).trim()) add('warning', 'restaurant', `"${k}" is empty in POS Settings`);

  // --- FAQ (owner-written) ---
  if (!faqFiles.length) add('warning', 'faq', 'no FAQ files yet (rag/data/raw/faq/): opening hours, payment methods, halal, etc. can\'t be answered');
  for (const d of documents.filter(d => d.type === 'faq')) {
    if (!d.data.answer) add('error', d.source, `"${d.data.question}" has no answer`);
    if (/\bTODO\b/.test(d.data.answer)) add('error', d.source, `"${d.data.question}" still says TODO`);
    if (/\b(rs\.?|pkr|rupees?)\s*\d|\d+\s*(rs|pkr|rupees?)\b/i.test(d.data.answer)) add('warning', d.source, `"${d.data.question}" mentions a price: prices belong in the POS menu, or this answer goes stale when prices change`);
  }

  // --- Documents ---
  const ids = new Set();
  for (const d of documents) {
    if (ids.has(d.id)) add('error', d.id, 'duplicate document ID');
    ids.add(d.id);
    if (!d.text) add('error', d.id, 'empty text');
  }

  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

module.exports = { validate };
