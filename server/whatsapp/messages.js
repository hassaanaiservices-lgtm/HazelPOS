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
  on_the_way: {
    en: '🛵 Your order #{id} is on its way with {rider}!',
    roman_ur: '🛵 Aapka order #{id} rider {rider} ke saath nikal gaya hai!',
    ur: '🛵 آپ کا آرڈر #{id} رائیڈر {rider} کے ساتھ نکل گیا ہے!',
  },
  ready_pickup: {
    en: '🛍️ Your order #{id} is ready! You can pick it up from {name} now.',
    roman_ur: '🛍️ Aapka order #{id} tayyar hai! Aap abhi {name} se le sakte hain.',
    ur: '🛍️ آپ کا آرڈر #{id} تیار ہے! آپ ابھی {name} سے لے سکتے ہیں۔',
  },
  track: { en: 'See where the rider is: {link}', roman_ur: 'Rider kahan hai, yahan dekhein: {link}', ur: 'رائیڈر کہاں ہے، یہاں دیکھیں: {link}' },
  status_out: {
    en: '🛵 Your order #{id} is on its way with {rider}, left {min} min ago.',
    roman_ur: '🛵 Aapka order #{id} raste mein hai, rider {rider} {min} min pehle nikla hai.',
    ur: '🛵 آپ کا آرڈر #{id} راستے میں ہے، رائیڈر {rider} {min} منٹ پہلے نکلا ہے۔',
  },
  status_delivered: {
    en: '✅ Your order #{id} was delivered {min} min ago. Enjoy your meal!',
    roman_ur: '✅ Aapka order #{id} {min} min pehle deliver ho gaya hai. Khana mazay se khayein!',
    ur: '✅ آپ کا آرڈر #{id} {min} منٹ پہلے ڈیلیور ہو گیا ہے۔ کھانا مزے سے کھائیں!',
  },
  status_ready: {
    en: '👨‍🍳 Your order #{id} is packed and the rider is about to leave.',
    roman_ur: '👨‍🍳 Aapka order #{id} tayyar hai, rider abhi nikalne wala hai.',
    ur: '👨‍🍳 آپ کا آرڈر #{id} تیار ہے، رائیڈر ابھی نکلنے والا ہے۔',
  },
  status_cooking: {
    en: '👨‍🍳 Your order #{id} is being prepared in the kitchen; a rider will leave soon.',
    roman_ur: '👨‍🍳 Aapka order #{id} kitchen mein ban raha hai, thori der mein rider nikal jayega.',
    ur: '👨‍🍳 آپ کا آرڈر #{id} کچن میں بن رہا ہے، تھوڑی دیر میں رائیڈر نکل جائے گا۔',
  },
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
const fill = (key, lang, vars) => Object.entries(vars).reduce((t, [k, v]) => t.split(`{${k}}`).join(String(v ?? '')), pick(key, lang));
// The order just left: who is bringing it, and the live-tracking link when the cloud is connected
const onTheWayMessage = (order, lang, riderName, link) => [fill('on_the_way', lang, { id: order.id, rider: riderName }), link && fill('track', lang, { link })].filter(Boolean).join('\n');
// "Where is my order?": its live status (status = cooking | ready | out | delivered)
const statusMessage = (order, lang, status, riderName, minutes, link) => [fill('status_' + status, lang, { id: order.id, rider: riderName || '', min: minutes }),
  status === 'out' && link && fill('track', lang, { link })].filter(Boolean).join('\n');
const readyPickupMessage = (order, lang, name) => fill('ready_pickup', lang, { id: order.id, name: name || 'the restaurant' });
const rejectedMessage = (lang, reason) => pick('rejected', lang).replace('{reason}', reason ? ` (${reason})` : '');

module.exports = { pick, acceptedMessage, rejectedMessage, onTheWayMessage, statusMessage, readyPickupMessage };
