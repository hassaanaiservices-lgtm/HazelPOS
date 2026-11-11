// ask(): one customer message in, one checked reply out.
//   live knowledge (POS + FAQ) → DeepSeek (one call, JSON) → order priced by code → amount guard → final reply
// Every step's result and time is returned so it can be logged and tested.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config, paths } = require('../config');
const { readPos } = require('../loaders/pos-db');
const { loadFaq } = require('../loaders/faq');
const { buildKnowledge } = require('../context');
const { buildMessages } = require('../generation/prompt');
const { chatJson } = require('../generation/deepseek');
const { priceOrder } = require('../generation/order');
const { orderSummary, stripSummary } = require('../generation/summary');
const { inventedAmounts } = require('../generation/guard');
const { looksLikeAddress, fromCustomer } = require('../generation/address');

// The owner's behaviour text is part of the prompt, so it is part of the version logged with every reply
const promptVersion = (behaviour = '') => crypto.createHash('sha256').update(fs.readFileSync(path.join(paths.prompts, 'system.md'))).update(behaviour).digest('hex').slice(0, 8);
// Cost in US$ at DeepSeek's peak price (the higher one), for logging and the daily cap
function costUsd(u = {}) {
  const r = config.llm.price_usd_per_million.peak, hit = u.prompt_cache_hit_tokens || 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens || 0) - hit);
  return (hit * r.input_hit + miss * r.input_miss + (u.completion_tokens || 0) * r.output) / 1e6;
}
const INTENTS = ['answer', 'clarify', 'not_on_menu', 'unavailable', 'order', 'handoff', 'refuse', 'greet'];
const FALLBACK = { // the model failed or invented a price: ask again, never promise a person
  en: "Sorry, I didn't catch that. Could you send it again?",
  roman_ur: 'Maazrat, mujhe theek se samajh nahi aaya. Dobara bata dein?',
  ur: 'معذرت، مجھے ٹھیک سے سمجھ نہیں آیا۔ دوبارہ بتا دیں؟',
};
const addUsage = (a = {}, b = {}) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => typeof (a[k] ?? b[k]) === 'number').map(k => [k, (a[k] || 0) + (b[k] || 0)]));
// The typed part of a message (voice-note transcripts removed), for choosing the reply script
const typedPart = text => String(text).split('\n').filter(l => !l.startsWith('[Voice note')).join('\n');
const scriptLang = text => /[؀-ۿ]/.test(text) ? 'ur' : 'roman_ur';

// The model's text before the code-made summary, minus its sentences about what the code is about to ask
const TOPIC = { address: /address|adress|pata\b|location|landmark|ایڈریس|پتہ|پتا|لوکیشن/i, fulfilment: /delivery|takeaway|take away|pick ?up|ڈیلیوری|ٹیک اوے/i };
function leadText(raw, missing) {
  let t = stripSummary(raw);
  for (const m of missing) t = t.split(/(?<=[.!?؟۔])\s+/).filter(sentence => !TOPIC[m].test(sentence)).join(' ');
  t = t.trim().split(/(?<=[.!?؟۔])\s+/)[0] || ''; // before a summary, one short sentence is enough
  return t ? `${t}\n` : '';
}

// Delivery or takeaway, said in so many words (code, not the model)
function saidFulfilment(text) {
  if (/\b(take ?away|pick ?up|khud le|le ja[uo]n?g[ae]|aa kar le|a kar le)\b|ٹیک اوے|خود لے/i.test(text)) return 'takeaway';
  if (/\b(deliver(y|ed)?|ghar (pe |par )?bhej|home delivery)\b|ڈیلیوری/i.test(text)) return 'delivery';
  return null;
}
// The customer's message itself, used as the address when it looks like one (exactly as they wrote it)
const addressFromMessage = text => String(text).replace(/^\s*(my )?(address|adress|pata|پتہ)\s*[:\-–]?\s*/i, '').trim();

// What a complete order still needs. The address must look like an address AND come from the customer's own words;
// a WhatsApp location pin (sent in this chat) also counts.
function completeness(priced, customerTexts, location) {
  if (!priced.fulfilment) return { missing: ['fulfilment'] };
  if (priced.fulfilment !== 'delivery') return { missing: [] };
  const a = priced.address;
  if (a && looksLikeAddress(a) && fromCustomer(a, customerTexts)) return { missing: [] };
  if (location) { priced.address = null; priced.location = location; return { missing: [] }; }
  return { missing: ['address'], addressGiven: !!a };
}

// pos: optional POS data (tests pass a changed copy); default = read live from the POS database
// location: {lat, lng} of a location pin the customer sent recently in this chat, if any
// cart: the order the system is holding for this chat ({items|lines, fulfilment, address, location}), if any
async function ask({ message, history = [], pos, location = null, cart = null }) {
  const t0 = Date.now();
  pos = pos || readPos(paths.posDb, config.data);
  const knowledge = buildKnowledge(pos, loadFaq(paths.faq).documents, config.context);
  // The held cart is re-priced from the live menu every turn
  const heldItems = cart && (cart.lines || cart.items || []).map(i => ({ product_id: i.product_id, size: i.size, qty: i.qty, options: i.mods || i.options || [] }));
  const held = heldItems?.length ? priceOrder(pos.menu, { items: heldItems }) : null;
  if (held) Object.assign(held, { fulfilment: cart.fulfilment || null, address: cart.address || null, location: cart.location || null });
  const messages = buildMessages({ knowledge, restaurantName: pos.restaurant.name, behaviour: pos.behaviour, history, message, cart: held });
  const tKnowledge = Date.now() - t0;

  let llm;
  try {
    llm = await chatJson(config.llm, messages);
    // Language check in code: an Urdu-script message must get an Urdu-script reply. The model drifts into Roman Urdu
    // now and then; ask once more, firmly.
    const wantsUrdu = /[\u0600-\u06FF]/.test(typedPart(message)); // voice-note transcripts are Urdu script; the customer may type Roman
    if (wantsUrdu && llm.json?.reply && !/[\u0600-\u06FF]/.test(llm.json.reply)) {
      const again = await chatJson(config.llm, [...messages, { role: 'assistant', content: JSON.stringify(llm.json) },
        { role: 'system', content: 'Rewrite exactly the same JSON, but write "reply" in Urdu script (اردو رسم الخط). Keep product names and prices as they are.' }]);
      llm = { ...again, ms: llm.ms + again.ms, usage: addUsage(llm.usage, again.usage), lang_retry: true };
    }
  }
  catch (e) {
    const lang = scriptLang(message);
    return { reply: FALLBACK[lang], lang, intent: 'clarify', handoff: false, error: e.message, knowledge_version: knowledge.version, ms: { knowledge: tKnowledge, total: Date.now() - t0 } };
  }

  const j = llm.json || {};
  const lang = ['en', 'roman_ur', 'ur'].includes(j.lang) ? j.lang : scriptLang(message);
  const intent = INTENTS.includes(j.intent) ? j.intent : 'answer';
  const raw = String(j.reply || '').replace(/\s*\[#\d+\]/g, '').trim(); // menu IDs are for the system, not customers
  const cancelled = Array.isArray(j.order?.items) && j.order.items.length === 0 && !!held;
  let priced = j.order?.items?.length ? priceOrder(pos.menu, j.order) : null;
  // The model left the order out but the customer is just adding details (delivery, address, pin): keep the held cart
  const detailsOnly = !priced && held && !cancelled && !['refuse', 'not_on_menu', 'unavailable'].includes(intent)
    && (saidFulfilment(message) || location || (held.fulfilment === 'delivery' && looksLikeAddress(addressFromMessage(message))) || intent === 'order');
  if (detailsOnly) priced = { ...held, lines: held.lines, errors: held.errors };
  const orderOk = priced && priced.lines.length && !priced.errors.length;

  // Order details checked by code: delivery or takeaway, and for delivery a real address from the customer
  let check = { missing: [] };
  if (orderOk) {
    const customerTexts = [...history.filter(h => h.from === 'customer').map(h => h.text), message];
    priced.fulfilment = (['delivery', 'takeaway'].includes(j.order?.fulfilment) ? j.order.fulfilment : null) || saidFulfilment(message) || held?.fulfilment || null;
    // Address: the model's (if it checks out), else this message as written, else the one already held
    const fromModel = String(j.order?.address || '').trim().slice(0, 300);
    const fromMsg = addressFromMessage(message).slice(0, 300);
    priced.address = [fromModel, fromMsg, held?.address].find(a => a && looksLikeAddress(a) && fromCustomer(a, customerTexts)) || fromModel || null;
    check = completeness(priced, customerTexts, location || held?.location || null);
  }

  // Guard: any money amount that isn't real means the reply is not sent as written
  const invented = inventedAmounts(raw, pos, orderOk ? priced : null, message);
  let reply = raw || FALLBACK[lang], handoff = false; // the assistant handles every chat itself
  if (invented.length) reply = FALLBACK[lang];
  else if (orderOk) {
    reply = `${leadText(raw, check.missing)}${orderSummary(priced, lang, config.context.currency, check)}`;
  }
  return {
    reply, raw, lang, intent, handoff,
    order: priced, order_ok: !!orderOk, order_complete: !!orderOk && !check.missing.length, missing: check.missing, cancelled,
    prompt_version: promptVersion(pos.behaviour || ''), cost_usd: costUsd(llm.usage),
    guard: { invented },
    knowledge_version: knowledge.version,
    usage: llm.usage, attempts: llm.attempts, hedged: !!llm.hedged, lang_retry: !!llm.lang_retry,
    ms: { knowledge: tKnowledge, llm: llm.ms, total: Date.now() - t0 },
  };
}

module.exports = { ask };
