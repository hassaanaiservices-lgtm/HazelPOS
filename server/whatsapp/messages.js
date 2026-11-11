// Fixed messages the system sends (not written by the LLM), in the customer's language.
const { money } = require('../../rag/src/context/format');

const T = {
  confirmed: {
    en: '✅ Thank you! Your order has been sent to our team. You will get a message as soon as it is accepted.',
    roman_ur: '✅ Shukriya! Aapka order hamari team ko bhej diya gaya hai. Accept hote hi aapko message aa jayega.',
    ur: '✅ شکریہ! آپ کا آرڈر ہماری ٹیم کو بھیج دیا گیا ہے۔ قبول ہوتے ہی آپ کو پیغام آ جائے گا۔',
  },
  media: {
    en: 'Sorry, I can only read text and voice notes, not pictures or files. Please type what you need. 🙏',
    roman_ur: 'Maazrat, main tasveer ya file nahi dekh sakta, sirf message aur voice note. Please type kar dein kya chahiye. 🙏',
    ur: 'معذرت، میں تصویر یا فائل نہیں دیکھ سکتا، صرف میسج اور وائس نوٹ۔ براہ کرم ٹائپ کر دیں کیا چاہیے۔ 🙏',
  },
  voice_failed: {
    en: 'Sorry, your voice note didn\'t come through properly. Please send it again, or type your message. 🙏',
    roman_ur: 'Maazrat, aapka voice note theek se nahi aaya. Please dobara bhej dein, ya message type kar dein. 🙏',
    ur: 'معذرت، آپ کا وائس نوٹ ٹھیک سے نہیں آیا۔ براہ کرم دوبارہ بھیج دیں، یا میسج ٹائپ کر دیں۔ 🙏',
  },
  voice_unclear: {
    en: 'Sorry, I couldn\'t make out your voice note. Could you say it again, or type it? 🙏',
    roman_ur: 'Maazrat, voice note samajh nahi aaya. Please dobara bol dein, ya type kar dein. 🙏',
    ur: 'معذرت، وائس نوٹ سمجھ نہیں آیا۔ براہ کرم دوبارہ بول دیں، یا ٹائپ کر دیں۔ 🙏',
  },
  voice_ack: {
    en: '🎧 Got your voice note, listening now — one moment please.',
    roman_ur: '🎧 Voice note mil gaya, sun raha hoon — bas ek lamha.',
    ur: '🎧 وائس نوٹ مل گیا، سن رہا ہوں — بس ایک لمحہ۔',
  },
  accepted_title: { en: 'Your order #{id} is confirmed!', roman_ur: 'Aapka order #{id} confirm ho gaya hai!', ur: 'آپ کا آرڈر #{id} کنفرم ہو گیا ہے!' },
  delivery: { en: 'Delivery', roman_ur: 'Delivery', ur: 'ڈیلیوری' },
  tax: { en: 'Tax', roman_ur: 'Tax', ur: 'ٹیکس' },
  total: { en: 'Total', roman_ur: 'Total', ur: 'کل' },
  thanks: { en: 'Thank you for ordering from {name}!', roman_ur: '{name} se order karne ka shukriya!', ur: '{name} سے آرڈر کرنے کا شکریہ!' },
  rejected: {
    en: 'Sorry, we can\'t take this order right now.{reason} You can order something else here any time.',
    roman_ur: 'Maazrat, hum abhi yeh order nahi le sakte.{reason} Aap yahin kuch aur order kar sakte hain.',
    ur: 'معذرت، ہم ابھی یہ آرڈر نہیں لے سکتے۔{reason} آپ یہیں کچھ اور آرڈر کر سکتے ہیں۔',
  },
};
const pick = (key, lang) => T[key][lang] || T[key].roman_ur;

// Built from the real POS order, so the total includes delivery fee and tax exactly as billed
function acceptedMessage(order, lang, restaurantName) {
  const lines = order.items.map(i => `${i.qty}× ${i.name} — ${money(i.price * i.qty)}`);
  if (order.delivery_fee) lines.push(`${pick('delivery', lang)} — ${money(order.delivery_fee)}`);
  if (order.tax) lines.push(`${pick('tax', lang)} — ${money(order.tax)}`);
  return [`✅ *${pick('accepted_title', lang).replace('{id}', order.id)}*`, ...lines, `*${pick('total', lang)}: ${money(order.total)}*`,
    pick('thanks', lang).replace('{name}', restaurantName || '')].join('\n');
}
const rejectedMessage = (lang, reason) => pick('rejected', lang).replace('{reason}', reason ? ` (${reason})` : '');

module.exports = { pick, acceptedMessage, rejectedMessage };
