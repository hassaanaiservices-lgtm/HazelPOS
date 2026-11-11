// Safety net on every reply: finds money amounts the LLM wrote that are not real (not on the menu, not a delivery fee,
// not the code-calculated total). Such a reply must not be sent as it is.
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹', ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toLatin = s => String(s).replace(/[۰-۹٠-٩]/g, d => String(URDU_DIGITS.includes(d) ? URDU_DIGITS.indexOf(d) : ARABIC_DIGITS.indexOf(d)));

const CUR = '(?:rs\\.?|pkr|rupees?|rupay[ae]?|rupaye|روپے|روپیہ|روپ)';
const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+)';
// "Rs 450" or "450 rupay"; in "Nuggets 6 Rs 450" the 6 is a count, not money (a number follows the currency word)
const AMOUNT = new RegExp(`${CUR}\\s*${NUM}|${NUM}\\s*(?:\\/-)?\\s*${CUR}(?!\\s*\\d)`, 'giu');

function amountsIn(text) {
  const out = [];
  for (const m of toLatin(text).matchAll(AMOUNT)) out.push(+((m[1] || m[2]).replace(/,/g, '')));
  return out;
}

// Every amount a correct reply may contain
function allowedAmounts(pos, priced) {
  const ok = new Set();
  for (const p of pos.menu) {
    ok.add(+p.price);
    for (const s of p.sizes || []) ok.add(+s.price);
    for (const g of p.modifiers || []) for (const o of g.options || []) ok.add(+o.price);
  }
  for (const z of pos.delivery_zones || []) { ok.add(+z.fee); ok.add(+z.min_order); ok.add(+z.free_above); }
  if (priced) { ok.add(priced.subtotal); for (const l of priced.lines) { ok.add(l.unit); ok.add(l.total); } }
  return ok;
}

// customerText: amounts the customer wrote may be repeated back ("Rs 500 nahi ho sakta")
function inventedAmounts(reply, pos, priced, customerText = '') {
  const ok = allowedAmounts(pos, priced);
  for (const a of amountsIn(customerText)) ok.add(a);
  return amountsIn(reply).filter(a => !ok.has(a));
}

module.exports = { inventedAmounts, amountsIn, toLatin };
