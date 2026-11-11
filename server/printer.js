// ESC/POS thermal printing: receipts and kitchen tickets.
// A printer target is either a network printer "192.168.1.50:9100" (tcp:// optional)
// or a device/file path such as "/dev/usb/lp0".
const net = require('net');
const fs = require('fs');

const ESC = '\x1b', GS = '\x1d';
const INIT = ESC + '@';
const LEFT = ESC + 'a0', CENTER = ESC + 'a1';
const BOLD = ESC + 'E1', NOBOLD = ESC + 'E0';
const BIG = GS + '!\x11', TALL = GS + '!\x01', NORMAL = GS + '!\x00';
const CUT = GS + 'V' + 'B' + '\x00';
const DRAWER = ESC + 'p' + '\x00' + '\x19' + '\xfa';

// Thermal printers in text mode only know ASCII; drop emoji and other symbols
const ascii = s => String(s ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim();
const money = n => 'Rs ' + Math.round(n || 0).toLocaleString('en-US');

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of ascii(text).split(/\s+/)) {
    if (!word) continue;
    if ((line + ' ' + word).trim().length > width) { if (line) out.push(line); line = word; }
    else line = (line + ' ' + word).trim();
    while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
  }
  if (line || !out.length) out.push(line);
  return out;
}
// "2 x Fajita (Large)........ Rs 3,100" with the name wrapping under itself
function cols(left, right, width) {
  right = ascii(right);
  const lines = wrap(left, width - right.length - 1);
  lines[0] = lines[0].padEnd(width - right.length) + right;
  return lines.join('\n');
}
const rule = width => '-'.repeat(width);
// Native ESC/POS QR code (GS ( k): model 2, module size 6, error correction M
function qr(data) {
  const d = ascii(data), len = d.length + 3, fn = (cn, fnc, ...a) => GS + '(k' + String.fromCharCode(a.length + 2, 0, cn, fnc, ...a);
  return fn(49, 65, 50, 0) + fn(49, 67, 6) + fn(49, 69, 49) + GS + '(k' + String.fromCharCode(len % 256, len >> 8, 49, 80, 48) + d + fn(49, 81, 48) + '\n';
}
const modLines = (i, width) => [
  ...(i.mods || []).map(m => wrap(`+ ${m.name}${m.price ? ' ' + money(m.price) : ''}`, width - 3).map(l => '   ' + l).join('\n')),
  ...(i.note ? [wrap(`* ${i.note}`, width - 3).map(l => '   ' + l).join('\n')] : []),
];

function receipt(order, s, { openDrawer = false } = {}) {
  const w = s.paper_width === '58' ? 32 : 48;
  const p = [INIT, CENTER, BOLD, BIG, ascii(s.name), '\n', NORMAL, NOBOLD];
  for (const line of [s.address, s.phone && 'Tel: ' + s.phone]) if (ascii(line)) p.push(wrap(line, w).join('\n'), '\n');
  const tax = [s.ntn && 'NTN: ' + s.ntn, s.strn && 'STRN: ' + s.strn, s.pos_id && 'POS ID: ' + s.pos_id].filter(x => ascii(x));
  if (tax.length) p.push(tax.map(ascii).join('\n'), '\n');
  p.push(BOLD, order.tax > 0 ? 'SALES TAX INVOICE' : 'RECEIPT', NOBOLD, '\n', LEFT, rule(w), '\n');
  p.push(cols('Invoice: ' + order.invoice_no, '#' + order.id, w), '\n');
  p.push(cols(new Date(order.paid_at || order.created_at).toLocaleString('en-PK'), '', w), '\n');
  p.push(ascii([order.type, order.tableName, order.customer].filter(Boolean).join(' / ')), '\n');
  if (order.phone) p.push(ascii('Ph: ' + order.phone), '\n');
  if (order.address) p.push(wrap(order.address, w).join('\n'), '\n');
  if (order.user_name) p.push(ascii('Served by: ' + order.user_name), '\n');
  p.push(rule(w), '\n');
  for (const i of order.items) {
    p.push(cols(`${i.qty} x ${i.name}`, money(i.qty * i.price), w), '\n');
    for (const m of modLines(i, w)) p.push(m, '\n');
  }
  p.push(rule(w), '\n', cols('Subtotal', money(order.subtotal), w), '\n');
  if (order.discount > 0) p.push(cols('Discount', '-' + money(order.discount), w), '\n');
  if (order.promo_amount > 0) p.push(cols(`Promo ${order.promo_code}`, '-' + money(order.promo_amount), w), '\n');
  if (order.points_amount > 0) p.push(cols(`Points used (${order.points_used})`, '-' + money(order.points_amount), w), '\n');
  p.push(cols(`Sales tax${s.tax_rate ? ' ' + s.tax_rate + '%' : ''}`, money(order.tax), w), '\n');
  if (order.delivery_fee > 0) p.push(cols(`Delivery${order.zone ? ' (' + order.zone + ')' : ''}`, money(order.delivery_fee), w), '\n');
  p.push(BOLD, TALL, cols('TOTAL', money(order.total), w), NORMAL, NOBOLD, '\n');
  if (order.status === 'paid') {
    p.push(cols(`Paid (${order.payment_method})`, money(order.paid), w), '\n');
    if (order.change_ > 0) p.push(cols('Change', money(order.change_), w), '\n');
  } else if (order.status === 'refunded') {
    p.push(cols(`Paid (${order.payment_method})`, money(order.paid), w), '\n');
    p.push(CENTER, BOLD, 'REFUNDED', NOBOLD, LEFT, '\n');
    if (order.refund_reason) p.push(wrap('Reason: ' + order.refund_reason, w).join('\n'), '\n');
  } else p.push(CENTER, BOLD, 'UNPAID - BILL', NOBOLD, LEFT, '\n');
  if (order.points_earned > 0) p.push(rule(w), '\n', cols(`Points earned: ${order.points_earned}`, `Balance: ${order.customer_points ?? 0}`, w), '\n');
  if (order.fiscal_no) p.push(rule(w), '\n', CENTER, BOLD, `${(s.fiscal_mode || '').toUpperCase()} INVOICE NO.`, NOBOLD, '\n', ascii(order.fiscal_no), '\n', qr(order.fiscal_no), LEFT);
  p.push(rule(w), '\n', CENTER, wrap(s.footer || '', w).join('\n'), '\n\n\n\n', CUT);
  if (openDrawer) p.push(DRAWER);
  return Buffer.from(p.join(''), 'latin1');
}

// items = only the lines the kitchen has not seen yet (or all of them on a reprint)
function kitchenTicket(order, items, { addOn = false, s = {} } = {}) {
  const w = s.paper_width === '58' ? 32 : 48;
  const p = [INIT, CENTER, BOLD, BIG, addOn ? 'ADD-ON' : 'KITCHEN', '\n', TALL];
  p.push(ascii(`#${order.id}  ${order.tableName || order.type}`), '\n', NORMAL, NOBOLD);
  p.push(new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }), '\n');
  if (order.customer) p.push(ascii(order.customer), '\n');
  p.push(LEFT, rule(w), '\n');
  for (const i of items) {
    p.push(BOLD, TALL, wrap(`${i.qty} x ${i.name}`, w).join('\n'), NORMAL, NOBOLD, '\n');
    for (const m of modLines({ ...i, mods: (i.mods || []).map(x => ({ name: x.name })) }, w)) p.push(m, '\n');
  }
  p.push(rule(w), '\n\n\n\n', CUT);
  return Buffer.from(p.join(''), 'latin1');
}

function testPage(s) {
  const w = s.paper_width === '58' ? 32 : 48;
  return Buffer.from([INIT, CENTER, BOLD, BIG, 'TEST PRINT', NORMAL, NOBOLD, '\n', ascii(s.name), '\n',
    LEFT, rule(w), '\n', `Paper: ${s.paper_width || 80}mm (${w} chars)`, '\n', '1234567890'.repeat(5).slice(0, w), '\n',
    rule(w), '\n\n\n\n', CUT].join(''), 'latin1');
}

function send(target, buf) {
  target = String(target || '').trim();
  if (!target) return Promise.reject(new Error('No printer set up'));
  const m = /^(?:tcp:\/\/)?([\w.-]+):(\d+)$/.exec(target);
  if (!m) return fs.promises.writeFile(target, buf);
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: m[1], port: +m[2] });
    sock.setTimeout(5000, () => sock.destroy(new Error('Printer did not respond')));
    sock.on('error', e => reject(new Error(`Printer ${target}: ${e.message}`)));
    sock.on('connect', () => sock.end(buf, resolve));
  });
}

module.exports = { receipt, kitchenTicket, testPage, send };
