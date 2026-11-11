// Runs every loader and returns all documents together.
const { loadMenu } = require('./menu');
const { loadZones } = require('./zones');
const { loadRestaurant } = require('./restaurant');
const { loadFaq } = require('./faq');

function loadAll(paths) {
  const menu = loadMenu(paths.raw), zones = loadZones(paths.raw), restaurant = loadRestaurant(paths.raw), faq = loadFaq(paths.faq);
  return {
    documents: [...restaurant.documents, ...menu.documents, ...zones.documents, ...faq.documents],
    raw: { ...menu.raw, ...zones.raw, ...restaurant.raw, faqFiles: faq.files },
    problems: faq.problems,
  };
}

module.exports = { loadAll };
