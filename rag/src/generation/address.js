// Delivery address checks, done in code so a vague or invented line is never accepted as an address.
//   1. looksLikeAddress: enough detail for a rider (a number or an address word like gali / street / block / near…)
//   2. fromCustomer:     the words really come from the customer's own messages (the LLM can't invent or "fill in" one)

// Words that show up in real Pakistani addresses (English, Roman Urdu, Urdu)
const ADDRESS_WORDS = [
  'house', 'h#', 'h.no', 'hno', 'flat', 'apartment', 'apt', 'plot', 'floor', 'street', 'st', 'st#', 'gali', 'galli', 'road', 'rd',
  'lane', 'block', 'blk', 'sector', 'phase', 'ph', 'town', 'colony', 'society', 'scheme', 'mohalla', 'muhalla', 'plaza', 'market',
  'tower', 'villa', 'bungalow', 'near', 'nearby', 'opposite', 'opp', 'behind', 'nazd', 'nazdeek', 'samne', 'saamne', 'qareeb',
  'qarib', 'pass', 'peeche', 'boulevard', 'avenue', 'enclave', 'cantt', 'residency', 'heights', 'gardens', 'garden', 'chowk', 'masjid', 'mosque', 'school', 'hospital', 'park', 'stop', 'bazar', 'bazaar',
  'مکان', 'فلیٹ', 'گلی', 'سڑک', 'روڈ', 'بلاک', 'سیکٹر', 'فیز', 'ٹاؤن', 'کالونی', 'سوسائٹی', 'محلہ', 'نزد', 'سامنے', 'قریب',
  'پلازہ', 'مارکیٹ', 'چوک', 'مسجد', 'سکول', 'ہسپتال', 'پارک', 'نمبر',
];
// Ordering talk, never part of an address
const ORDER_TALK = /\b(add|order|cancel|kitne|kitna|kitni|price|rate|chahiye|chahye|same address|last time|pichli dafa|pehle wala)\b|آرڈر|چاہیے|کتنے/i;
// Things customers say that are not an address
const NOT_ADDRESS = /^(ghar|ghr|mera ghar|meray ghar|ghar pe|ghar par|home|my home|same|same as before|wahi|wohi|pehle wala|purana|pata hai|aap ko pata hai|you know|ok|okay|yes|haan|ji|address|location|delivery|گھر|میرا گھر|وہی)$/i;

const words = s => String(s || '').toLowerCase().replace(/[,،.#:/\\()\-]+/g, ' ').split(/\s+/).filter(Boolean);

function looksLikeAddress(text) {
  const t = String(text || '').trim();
  if (t.length < 12 || NOT_ADDRESS.test(t.toLowerCase().replace(/[.!?؟۔]+$/, '').trim())) return false;
  const w = words(t);
  if (w.length < 3) return false;
  // Must name a place the way addresses do (house, gali, block, near…); a number alone is not enough
  // ("aur 1 coke 500 add kar do" has numbers too), and anything that reads like ordering is not an address
  if (ORDER_TALK.test(t)) return false;
  return w.some(x => ADDRESS_WORDS.includes(x)) || /\bh\s*#|\bst\s*#/i.test(t);
}

// Every number in the address (house, street, phase…) must be exactly what the customer wrote, and at least 70% of
// its words must appear in the customer's messages
function fromCustomer(address, customerTexts) {
  const said = new Set(words(customerTexts.join(' ')));
  const w = words(address).filter(x => x.length > 1 || /\d/.test(x));
  if (!w.length) return false;
  if (w.some(x => /\d/.test(x) && !said.has(x))) return false;
  return w.filter(x => said.has(x)).length / w.length >= 0.7;
}

module.exports = { looksLikeAddress, fromCustomer };
