// Builds the restaurant knowledge the assistant reads with every message: restaurant info, FAQ, delivery areas,
// promo codes, the menu by category, and what's unavailable. Read live, so a change in the POS shows up in the
// very next reply.
//
// Sections go from least to most often changed. DeepSeek caches the start of a prompt, so a menu change only
// "uncaches" the part after it.
const crypto = require('crypto');
const { readPos } = require('../loaders/pos-db');
const { loadFaq } = require('../loaders/faq');
const { menuSections } = require('./menu-section');
const { restaurantSection, faqSection, deliverySection, promoSection } = require('./info-sections');

// pos = { menu, categories, delivery_zones, restaurant, promos } (shape of readPos); faqDocs from the FAQ loader
function buildKnowledge(pos, faqDocs, cfg) {
  const cur = cfg.currency;
  const lines = [
    ...restaurantSection(pos.restaurant),
    ...faqSection(faqDocs),
    ...deliverySection(pos.delivery_zones, cur),
    ...promoSection(pos.promos, cur),
    ...menuSections(pos, cur),
  ];
  const text = lines.join('\n').trim() + '\n';
  return {
    text,
    version: crypto.createHash('sha256').update(text).digest('hex').slice(0, 12),
    stats: {
      chars: text.length,
      approx_tokens: Math.ceil(text.length / 3.5), // rough; DeepSeek reports the real count in phase 6
      available_items: pos.menu.filter(p => p.active).length,
      hidden_items: pos.menu.filter(p => !p.active).length,
      faq: faqDocs.length,
      delivery_areas: pos.delivery_zones.length,
    },
  };
}

// Reads the POS database and the FAQ files right now and builds the knowledge
function loadKnowledge(paths, config) {
  return buildKnowledge(readPos(paths.posDb, config.data), loadFaq(paths.faq).documents, config.context);
}

module.exports = { buildKnowledge, loadKnowledge };
