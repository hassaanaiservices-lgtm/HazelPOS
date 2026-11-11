// restaurant.json (+ promos.json when enabled) -> restaurant info document(s)
const fs = require('fs');
const path = require('path');
const { makeDocument } = require('./document');

function loadRestaurant(rawDir) {
  const r = JSON.parse(fs.readFileSync(path.join(rawDir, 'restaurant.json'), 'utf8'));
  const promos = JSON.parse(fs.readFileSync(path.join(rawDir, 'promos.json'), 'utf8'));
  const documents = [makeDocument({
    id: 'restaurant:info', type: 'restaurant', title: r.name || 'Restaurant', source: 'restaurant.json',
    text: [r.name && `Restaurant: ${r.name}`, r.address && `Address / location: ${r.address}`, r.phone && `Phone: ${r.phone}`].filter(Boolean).join('\n'),
    data: r,
  })];
  for (const p of promos) documents.push(makeDocument({
    id: `promo:${p.code}`, type: 'promo', title: p.code, source: 'promos.json',
    text: `Promo code ${p.code}: discount offer${p.expires ? `, valid until ${p.expires}` : ''}.`, data: p,
  }));
  return { documents, raw: { restaurant: r, promos } };
}

module.exports = { loadRestaurant };
