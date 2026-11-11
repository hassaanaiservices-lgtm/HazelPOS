// Builds the messages for DeepSeek: [system rules + live knowledge] + recent chat + the new message.
// The system message comes first and only changes when the menu changes, so DeepSeek's prompt cache reuses it.
const fs = require('fs');
const path = require('path');

const { stripSummary } = require('./summary');
const { money } = require('../context/format');

const PROMPTS = path.join(__dirname, '..', '..', 'prompts');
const read = name => fs.readFileSync(path.join(PROMPTS, name), 'utf8');

function systemMessage(knowledge, restaurantName, behaviour = '') {
  return read('system.md').replace('{{RESTAURANT_NAME}}', restaurantName || 'the restaurant')
    .replace('{{BEHAVIOUR}}', String(behaviour).trim() || '(none: use the Rules above)').replace('{{KNOWLEDGE}}', knowledge.text);
}

// history: [{from: 'customer'|'bot', text}], oldest first
// Earlier bot replies are sent back as JSON ({"reply": ...}): given plain text, the model copies that and stops
// answering in JSON. Urdu-script messages get a reminder, because the model tends to drift into Roman Urdu.
// The order the system is holding for this chat (cart), told to the model each turn
function cartMessage(cart) {
  if (!cart?.lines?.length) return null;
  const lines = cart.lines.map(l => `- ${l.qty}× ${l.name} [#${l.product_id}${l.size ? `, size "${l.size}"` : ''}${l.mods?.length ? `, options ${JSON.stringify(l.mods.map(m => ({ group: m.group, name: m.name })))}` : ''}] ${money(l.total)}`);
  return ['CURRENT ORDER held by the system (not confirmed yet):', ...lines,
    `Delivery or takeaway: ${cart.fulfilment || '(not chosen yet)'}`,
    `Delivery address: ${cart.address || (cart.location ? 'location pin' : '(none yet)')}`,
    'Return these items in `order` (with any changes the customer asks for). To cancel the whole order, return {"items": []}.'].join('\n');
}

function buildMessages({ knowledge, restaurantName, behaviour, history = [], message, cart, maxTurns = 12 }) {
  const msgs = [
    { role: 'system', content: systemMessage(knowledge, restaurantName, behaviour) },
    ...history.slice(-maxTurns).map(h => h.from === 'customer'
      ? { role: 'user', content: h.text }
      : { role: 'assistant', content: JSON.stringify({ reply: stripSummary(h.text) || '(order summary shown)' }) }),
  ];
  const c = cartMessage(cart);
  if (c) msgs.push({ role: 'system', content: c });
  const typed = String(message).split('\n').filter(l => !l.startsWith('[Voice note')).join('\n');
  if (/[\u0600-\u06FF]/.test(typed)) msgs.push({ role: 'system', content: 'The customer wrote in Urdu script: write "reply" in Urdu script (اردو), not Roman Urdu.' });
  msgs.push({ role: 'user', content: message });
  return msgs;
}

module.exports = { buildMessages, systemMessage };
