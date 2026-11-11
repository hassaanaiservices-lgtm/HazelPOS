// Tests for the money-amount guard (no API calls). Run after changing rag/src/generation/guard.js:
//   node rag/scripts/test-guard.js
const { amountsIn } = require('../src/generation/guard');

const cases = [
  ['Nuggets 6 Rs 450 / 12 Rs 800', [450, 800]], // counts before "Rs" are not money
  ['Rs 1,550', [1550]], ['Rs. 2,050 ka hai', [2050]], ['PKR 900', [900]],
  ['1550 rupay', [1550]], ['total 4,380 rupees', [4380]], ['500/- Rs', [500]],
  ['۱۵۵۰ روپے', [1550]], ['قیمت 1,600 روپے ہے', [1600]],
  ['Coke 1.5L Rs 280', [280]], ['2 large pizza', []], ['12 inch pizza', []],
];
let ok = 0;
for (const [text, want] of cases) {
  const got = amountsIn(text);
  if (JSON.stringify(got) === JSON.stringify(want)) ok++;
  else console.log(`✗ "${text}" -> ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}
console.log(`${ok}/${cases.length} guard cases right`);
process.exitCode = ok === cases.length ? 0 : 1;
