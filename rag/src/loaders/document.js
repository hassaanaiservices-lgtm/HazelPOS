// The one shape every loader returns. Everything after loading (chunking, embedding, search) only sees this.
//
//   id      stable ID, e.g. "product:4", "faq:delivery#do-you-deliver-to-dha" (same item -> same ID every run)
//   type    product | category | delivery_zone | restaurant | faq | promo
//   title   short name shown in reports
//   text    what search reads. Prices are deliberately NOT in here: they change, and the answer step reads
//           them live from the POS by `data.product_id`
//   data    structured facts (prices, sizes, IDs) for code to use
//   source  file it came from
//   active  false = hidden in the POS (assistant says "not available right now")
const clean = s => String(s ?? '').normalize('NFC').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

function makeDocument({ id, type, title, text, data = {}, source, active = true }) {
  return { id, type, title: clean(title), text: clean(text), data, source, active };
}

module.exports = { makeDocument, clean };
