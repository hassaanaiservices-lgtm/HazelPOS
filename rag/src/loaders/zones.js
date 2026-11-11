// delivery_zones.json -> one document per delivery area (fees stay in data, read live later)
const fs = require('fs');
const path = require('path');
const { makeDocument } = require('./document');

function loadZones(rawDir) {
  const zones = JSON.parse(fs.readFileSync(path.join(rawDir, 'delivery_zones.json'), 'utf8'));
  const documents = zones.map(z => makeDocument({
    id: `delivery_zone:${z.id}`, type: 'delivery_zone', title: z.name, source: 'delivery_zones.json',
    text: `Home delivery to ${z.name}. Delivery time about ${z.eta_min} minutes.`,
    data: { zone_id: z.id, fee: z.fee, min_order: z.min_order, free_above: z.free_above, eta_min: z.eta_min },
  }));
  return { documents, raw: { zones } };
}

module.exports = { loadZones };
