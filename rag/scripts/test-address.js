// Tests for the delivery-address checks (no API calls):  node rag/scripts/test-address.js
const { looksLikeAddress, fromCustomer } = require('../src/generation/address');

const good = [
  'House 12, Street 4, DHA Phase 5', 'H# 45 Gali 3 Shadman', 'flat 3B Askari 11 Lahore', 'Model Town block C 23',
  'near Imtiaz store, Johar Town', 'Gulberg 3, main boulevard, opposite Hafeez Centre', 'plot 7 sector G-11/2 Islamabad',
  'مکان نمبر 12 گلی 4 گلبرگ', 'jamia masjid ke samne wali gali, Samanabad', 'House 5 Street 9 Gulberg',
];
const bad = ['ghar', 'mera ghar', 'same as before', 'ok', 'DHA', 'Gulberg', 'pata hai aap ko', 'asdfgh', '123', 'ghar pe bhej do',
  'delivery', 'گھر', 'Lahore', 'aap ko pata hai', 'aur 1 coke 500 bhi add kar do', '2 zinger single delivery, same address as last time',
  '2 large fajita aur 1 coke', 'pichli dafa wala address', '3 pizza bhej do 12 inch'];

let ok = 0, n = 0;
for (const a of good) { n++; if (looksLikeAddress(a)) ok++; else console.log(`✗ should accept: "${a}"`); }
for (const a of bad) { n++; if (!looksLikeAddress(a)) ok++; else console.log(`✗ should reject: "${a}"`); }

// The address must come from the customer's own words
const said = ['2 zinger bhej do', 'delivery', 'House 12 Street 4 DHA Phase 5'];
const origin = [
  ['House 12, Street 4, DHA Phase 5', true],
  ['House 12 Street 4 DHA Phase 6, Lahore', false],              // "Phase 6, Lahore" was never said
  ['Commercial Market, Block B, Main Boulevard', false],         // the restaurant's own address
];
for (const [a, want] of origin) { n++; if (fromCustomer(a, said) === want) ok++; else console.log(`✗ fromCustomer("${a}") should be ${want}`); }

console.log(`${ok}/${n} address cases right`);
process.exitCode = ok === n ? 0 : 1;
