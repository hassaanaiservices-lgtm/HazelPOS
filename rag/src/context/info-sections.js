// Restaurant info, owner-written FAQ, delivery areas and (optional) promo codes -> text sections. Data only:
// how the assistant should use them is written in rag/prompts/, not here.
const { money } = require('./format');

function restaurantSection(r) {
  const facts = [r.name && `Name: ${r.name}`, r.address && `Address: ${r.address}`, r.phone && `Phone: ${r.phone}`].filter(Boolean);
  return ['## RESTAURANT', ...facts, ''];
}

function faqSection(faqDocs) {
  if (!faqDocs.length) return ['## FREQUENTLY ASKED', '(no answers written yet)', ''];
  return ['## FREQUENTLY ASKED', ...faqDocs.flatMap(d => [`### ${d.data.question}`, d.data.answer]), ''];
}

function deliverySection(zones, currency) {
  if (!zones.length) return ['## DELIVERY AREAS', '(no delivery areas listed)', ''];
  return ['## DELIVERY AREAS', ...zones.map(z => {
    const parts = [`delivery fee ${money(z.fee, currency)}`];
    if (z.min_order) parts.push(`minimum order ${money(z.min_order, currency)}`);
    if (z.free_above) parts.push(`free delivery above ${money(z.free_above, currency)}`);
    if (z.eta_min) parts.push(`about ${z.eta_min} minutes`);
    return `- ${z.name}: ${parts.join(', ')}`;
  }), ''];
}

function promoSection(promos, currency) {
  if (!promos.length) return [];
  return ['## PROMO CODES', ...promos.map(p => `- ${p.code}: ${p.type === 'percent' ? `${p.value}% off` : `${money(p.value, currency)} off`}` +
    `${p.max_discount ? ` (max ${money(p.max_discount, currency)})` : ''}${p.min_order ? `, minimum order ${money(p.min_order, currency)}` : ''}${p.expires ? `, until ${p.expires}` : ''}`), ''];
}

module.exports = { restaurantSection, faqSection, deliverySection, promoSection };
