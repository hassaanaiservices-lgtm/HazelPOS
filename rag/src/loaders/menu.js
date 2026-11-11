// menu.json + categories.json -> one document per product, and one overview document per category
const fs = require('fs');
const path = require('path');
const { makeDocument } = require('./document');

const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

function loadMenu(rawDir) {
  const categories = read(rawDir, 'categories.json');
  const products = read(rawDir, 'menu.json');
  const catName = id => categories.find(c => c.id === id)?.name || '';

  const productDocs = products.map(p => {
    const category = catName(p.category_id);
    const lines = [
      `${p.name}${category ? ` (${category})` : ''}`,
      p.subtitle,
      p.description,
      p.ingredients.length && `Ingredients: ${p.ingredients.join(', ')}`,
      p.sizes.length && `Sizes: ${p.sizes.map(s => s.detail ? `${s.name} (${s.detail})` : s.name).join(', ')}`,
      ...p.modifiers.map(g => `${g.name}: ${(g.options || []).map(o => o.name).join(', ')}`),
    ].filter(Boolean);
    return makeDocument({
      id: `product:${p.id}`, type: 'product', title: p.name, text: lines.join('\n'), active: p.active, source: 'menu.json',
      data: { product_id: p.id, category, price: p.price, sizes: p.sizes, modifiers: p.modifiers },
    });
  });

  // "What burgers do you have?" -> a list of the category's available items
  const categoryDocs = categories.map(c => {
    const items = products.filter(p => p.category_id === c.id && p.active).map(p => p.name);
    return makeDocument({
      id: `category:${c.id}`, type: 'category', title: c.name, source: 'categories.json', active: items.length > 0,
      text: `${c.name} menu: ${items.join(', ') || 'nothing available right now'}`,
      data: { category_id: c.id, product_ids: products.filter(p => p.category_id === c.id && p.active).map(p => p.id) },
    });
  });

  return { documents: [...productDocs, ...categoryDocs], raw: { products, categories } };
}

module.exports = { loadMenu };
