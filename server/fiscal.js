// Fiscal invoicing (PRA e-IMS / FBR POS integration). Each paid order is reported to the tax authority and the
// returned fiscal invoice number is printed on the receipt with a QR code.
// The request follows the FBR IMS POS JSON format, which PRA's e-IMS mirrors. Confirm the field names and the
// endpoint against the sandbox credentials the authority issues before going live.
// Offline-safe: if the call fails, the order is marked 'pending' and retried every 2 minutes.
const PAYMENT_MODE = { cash: 1, card: 2, online: 5 };

module.exports = function fiscal(db, { getSettings, secret, getOrder }) {
  for (const sql of ['ALTER TABLE orders ADD COLUMN fiscal_no TEXT', 'ALTER TABLE orders ADD COLUMN fiscal_status TEXT', 'ALTER TABLE orders ADD COLUMN fiscal_error TEXT'])
    try { db.exec(sql); } catch { /* column exists */ }
  const enabled = () => ['pra', 'fbr'].includes(getSettings().fiscal_mode);

  function payload(o, s) {
    const ratio = o.subtotal ? (o.subtotal - o.discount - o.promo_amount - o.points_amount) / o.subtotal : 1; // spread bill-level discounts over lines
    const items = o.items.map(i => {
      const sale = Math.round(i.price * i.qty * ratio * 100) / 100, rate = +s.tax_rate || 0;
      return {
        ItemCode: String(i.product_id), ItemName: i.name, Quantity: i.qty, PCTCode: s.fiscal_pct_code || '', TaxRate: rate,
        SaleValue: sale, TaxCharged: Math.round(sale * rate) / 100, TotalAmount: Math.round(sale * (100 + rate)) / 100,
        Discount: Math.round(i.price * i.qty * (1 - ratio) * 100) / 100, FurtherTax: 0, InvoiceType: 1, RefUSIN: null,
      };
    });
    return {
      InvoiceNumber: '', POSID: +s.fiscal_pos_id || s.fiscal_pos_id, USIN: o.invoice_no, DateTime: (o.paid_at || o.created_at).replace('T', ' ').slice(0, 19),
      BuyerNTN: '', BuyerCNIC: '', BuyerName: o.customer || '', BuyerPhoneNumber: o.phone || '',
      TotalBillAmount: o.total - (o.delivery_fee || 0), TotalQuantity: o.items.reduce((n, i) => n + i.qty, 0),
      TotalSaleValue: o.subtotal - o.discount - o.promo_amount - o.points_amount, TotalTaxCharged: o.tax,
      Discount: o.discount + o.promo_amount + o.points_amount, FurtherTax: 0, PaymentMode: PAYMENT_MODE[o.payment_method] || 1,
      RefUSIN: null, InvoiceType: 1, Items: items,
    };
  }

  // Returns the fiscal number, or throws; the order row records the outcome either way
  async function submit(orderId) {
    const s = getSettings(), o = getOrder(orderId);
    if (!enabled() || !o || o.status !== 'paid' || o.fiscal_no) return o?.fiscal_no;
    try {
      if (!s.fiscal_url || !s.fiscal_pos_id) throw new Error('Fiscal integration is not set up');
      const r = await fetch(s.fiscal_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(secret('fiscal_token') ? { Authorization: `Bearer ${secret('fiscal_token')}` } : {}) },
        body: JSON.stringify(payload(o, s)), signal: AbortSignal.timeout(8000),
      }).catch(() => { throw new Error('Tax server not reachable'); });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || (data.Code && String(data.Code) !== '100') || !data.InvoiceNumber) throw new Error(data.Response || data.Errors || `Tax server replied ${r.status}`);
      db.prepare("UPDATE orders SET fiscal_no=?, fiscal_status='ok', fiscal_error=NULL WHERE id=?").run(String(data.InvoiceNumber), o.id);
      return String(data.InvoiceNumber);
    } catch (e) {
      db.prepare("UPDATE orders SET fiscal_status='pending', fiscal_error=? WHERE id=?").run(String(e.message).slice(0, 300), o.id);
      throw e;
    }
  }

  setInterval(async () => {
    if (!enabled()) return;
    for (const { id } of db.prepare("SELECT id FROM orders WHERE status='paid' AND fiscal_status='pending' ORDER BY id LIMIT 50").all())
      try { await submit(id); } catch { break; } // still offline: wait for the next round
  }, 2 * 60 * 1000).unref();

  return {
    enabled, submit, payload,
    onPaid: id => { if (enabled()) db.prepare("UPDATE orders SET fiscal_status='pending' WHERE id=? AND fiscal_no IS NULL").run(id); },
    pending: () => db.prepare("SELECT id, invoice_no, fiscal_error FROM (SELECT id, 'INV-' || strftime('%Y', created_at) || '-' || printf('%04d', id) invoice_no, fiscal_error FROM orders WHERE status='paid' AND fiscal_status='pending') ORDER BY id").all(),
  };
};
