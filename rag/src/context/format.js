// Small text helpers shared by the knowledge sections. Output must be identical for identical data (no dates,
// no random order) so DeepSeek's prompt cache can reuse it.
const money = (n, currency = 'Rs') => `${currency} ${Math.round(+n || 0).toLocaleString('en-US')}`;

// "choose 1", "optional, up to 3"… from the POS's option-group rules (min / max)
function choiceRule(g) {
  const min = +g.min || 0, max = +g.max || 0;
  if (min && max && min === max) return `choose ${min}`;
  if (min && max) return `choose ${min} to ${max}`;
  if (min) return `choose at least ${min}`;
  if (max) return `optional, up to ${max}`;
  return 'optional';
}

module.exports = { money, choiceRule };
