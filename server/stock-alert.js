// End-of-day WhatsApp message to the owner when ingredients are really low (Settings → Alerts).
// Sent once a day at the set time from the restaurant's linked WhatsApp to the numbers in the settings.
// "Really low": stock at or below <percent>% of the ingredient's own "Alert below" level, and only when at least
// <min items> ingredients are that low. Nothing low = no message.
//
// settings: low_stock_alert ('1' on), low_stock_alert_to ('0300 1234567, 0321 …'), low_stock_alert_time ('22:00'),
//           low_stock_alert_percent ('50'), low_stock_alert_min_items ('1'), low_stock_alert_last (YYYY-MM-DD, set by us)

// 0300 1234567 / +92 300 1234567 / 923001234567 -> 923001234567@s.whatsapp.net (null when it isn't a phone number)
function toJid(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(2);
  if (d.startsWith('0')) d = '92' + d.slice(1);
  return /^\d{10,15}$/.test(d) ? d + '@s.whatsapp.net' : null;
}

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const num = n => Number.isInteger(n) ? String(n) : (+n).toFixed(2).replace(/\.?0+$/, '');

module.exports = function stockAlert(db, { getSettings, wa, log = console }) {
  const setSetting = (k, v) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

  // The ingredients low enough to report, with the message text
  function report(s = getSettings()) {
    const pct = Math.max(1, Math.min(100, +s.low_stock_alert_percent || 50)) / 100;
    const low = db.prepare('SELECT name, unit, stock, low_level FROM ingredients WHERE low_level > 0 AND stock <= low_level * ? ORDER BY stock / low_level, name').all(pct);
    const text = [`*${s.name || 'HazelPOS'}*: low stock, ${localDay()}`, '',
      ...low.map(i => `• ${i.name}: ${num(i.stock)} ${i.unit} left (alert at ${num(i.low_level)})`),
      '', 'Order more before tomorrow. (HazelPOS)'].join('\n');
    return { low, text, enough: low.length >= Math.max(1, +s.low_stock_alert_min_items || 1) };
  }

  // force: the "Send a test now" button (ignores the time and the once-a-day rule)
  async function run({ force = false } = {}) {
    const s = getSettings();
    if (!force && (s.low_stock_alert !== '1' || hhmm() < (s.low_stock_alert_time || '22:00') || s.low_stock_alert_last === localDay())) return { skipped: true };
    const to = String(s.low_stock_alert_to || '').split(/[,;\n]/).map(toJid).filter(Boolean);
    if (!to.length) return { error: 'Add the owner\'s WhatsApp number first' };
    const r = report(s);
    if (!r.enough) { if (!force) setSetting('low_stock_alert_last', localDay()); return { sent: 0, low: r.low.length, message: 'Nothing low enough today, so no message' }; }
    if (!wa.isConnected()) return { error: 'WhatsApp is not linked or not connected, so the alert waits until it is' }; // retried every minute until midnight
    let sent = 0;
    for (const jid of to) {
      try { await wa.send(jid, r.text, 'Low-stock alert', 'system'); sent++; } catch (e) { log.error?.('Low-stock alert:', e.message); }
    }
    if (sent && !force) setSetting('low_stock_alert_last', localDay());
    return { sent, low: r.low.length };
  }

  setInterval(() => run().catch(e => log.error?.('Low-stock alert:', e.message)), 60 * 1000).unref();
  return { run, report, toJid };
};
