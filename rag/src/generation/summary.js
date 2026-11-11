// The order summary the customer confirms. Written by code, so items, totals and the address are always exactly right.
// While something is missing (delivery or takeaway? which address?) it shows the items and total and asks for that,
// instead of "reply YES" — so a customer can only confirm a complete order.
const { money } = require('../context/format');

const TEXT = { // kept short on purpose: WhatsApp, read on a phone
  en: { title: 'Your order', total: 'Total', delivery: 'Delivery to', pin: 'your location pin', takeaway: 'Takeaway',
    confirm: 'Reply *YES* to confirm.', extra: '+ delivery charge, if any',
    ask_fulfilment: '*Delivery* or *takeaway*?',
    ask_address: 'Send your address (house, street, area) or a location pin 📍.',
    unclear_address: 'Address incomplete.' },
  roman_ur: { title: 'Aapka order', total: 'Total', delivery: 'Delivery', pin: 'aapki location pin', takeaway: 'Takeaway',
    confirm: 'Confirm karne ke liye *YES* likhein.', extra: '+ delivery charges, agar hon',
    ask_fulfilment: '*Delivery* ya *takeaway*?',
    ask_address: 'Address bhej dein (ghar, gali, area) ya location pin 📍.',
    unclear_address: 'Address adhoora hai.' },
  ur: { title: 'آپ کا آرڈر', total: 'کل', delivery: 'ڈیلیوری', pin: 'آپ کی لوکیشن پن', takeaway: 'ٹیک اوے',
    confirm: 'تصدیق کے لیے *YES* لکھیں۔', extra: '+ ڈیلیوری چارجز، اگر ہوں',
    ask_fulfilment: '*ڈیلیوری* یا *ٹیک اوے*؟',
    ask_address: 'پتہ بھیج دیں (مکان، گلی، علاقہ) یا لوکیشن پن 📍۔',
    unclear_address: 'پتہ نامکمل ہے۔' },
};
const text = lang => TEXT[lang] || TEXT.en;

// missing: [] | ['fulfilment'] | ['address']; addressGiven: the customer tried but it wasn't usable
function orderSummary(priced, lang, currency = 'Rs', { missing = [], addressGiven = false } = {}) {
  const t = text(lang);
  const lines = [`🧾 *${t.title}*`, ...priced.lines.map(l => `${l.qty}× ${l.name} — ${money(l.total, currency)}`), `*${t.total}: ${money(priced.subtotal, currency)}*`];
  if (missing.includes('fulfilment')) return [...lines, t.ask_fulfilment].join('\n');
  if (missing.includes('address')) return [...lines, `${addressGiven ? t.unclear_address + ' ' : ''}${t.ask_address}`].join('\n');
  if (priced.fulfilment === 'delivery') lines.push(`📍 ${t.delivery}: ${priced.location && !priced.address ? t.pin : priced.address} (${t.extra})`);
  else lines.push(`🛍️ ${t.takeaway}`);
  return [...lines, t.confirm].join('\n');
}

// Code-made summaries in earlier bot messages are removed before the model sees them (so it never copies them), and
// anything the model writes from "🧾 Order summary" on is dropped (only the code's summary counts)
const SUMMARY_START = /(^|\n)[ \t*]*(🧾|order summary|your order|aapka order|آپ کا آرڈر|آرڈر کا خلاصہ)/i;
const stripSummary = t => { const i = String(t || '').search(SUMMARY_START); return (i >= 0 ? t.slice(0, i) : String(t || '')).trim(); };

module.exports = { orderSummary, stripSummary };
