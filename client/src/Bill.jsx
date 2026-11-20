import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { rs, modsText, includesText } from './lib'

// The bill: restaurant, order, items, totals, payment and, for a delivery, the customer, phone and address.
// One component shows it in the receipt window (idAttr "receipt") and prints it (printOrder, #print-bill).
export function Bill({ order, s, idAttr }) {
  const [fiscalQr, setFiscalQr] = useState('')
  useEffect(() => { if (order.fiscal_no) QRCode.toDataURL(order.fiscal_no, { margin: 1, width: 120 }).then(setFiscalQr); else setFiscalQr('') }, [order.fiscal_no])
  const paid = order.status === 'paid' || order.status === 'refunded' || !!order.paid_at
  const when = order.paid_at || order.created_at
  return (
    <div className="receipt" id={idAttr}>
      {s.logo_image ? <><img className="receipt-logo" src={s.logo_image} alt="" /><h3>{s.name}</h3></> : <h3>{s.logo} {s.name}</h3>}
      {s.address && <p>{s.address}</p>}
      {s.phone && <p>Tel: {s.phone}</p>}
      {s.ntn && <p>NTN: {s.ntn}</p>}
      {s.strn && <p>STRN: {s.strn}</p>}
      {s.pos_id && <p>POS ID: {s.pos_id}</p>}
      <p><b>{!paid ? 'Bill' : order.tax > 0 ? 'Sales tax invoice' : 'Receipt'}</b>{order.invoice_no ? ` · ${order.invoice_no}` : ''}</p>
      <p>Order #{order.id} · {order.type}{order.tableName ? ' · ' + order.tableName : ''}{order.customer ? ' · ' + order.customer : ''}</p>
      {order.type === 'delivery' && <>
        {order.customer && <p>Customer: {order.customer}</p>}
        {order.phone && <p>Phone: {order.phone}</p>}
      </>}
      {order.address && <p>{order.type === 'delivery' ? 'Address: ' : ''}{order.address}</p>}
      <p>{when ? new Date(when).toLocaleString() : ''}{order.user_name ? ' · ' + order.user_name : ''}</p>
      <hr />
      {(order.items || []).map(i => <div key={i.id}>
        <div className="r-line"><span>{i.qty} × {i.name}</span><span>{rs(i.qty * i.price)}</span></div>
        {i.mods?.length > 0 && <div className="r-sub">+ {modsText(i.mods)}</div>}
        {i.includes?.length > 0 && <div className="r-sub">{includesText(i.includes)}</div>}
      </div>)}
      <hr />
      <div className="r-line"><span>Subtotal</span><span>{rs(order.subtotal)}</span></div>
      {order.discount > 0 && <div className="r-line"><span>Discount</span><span>-{rs(order.discount)}</span></div>}
      {order.promo_amount > 0 && <div className="r-line"><span>Promo {order.promo_code}</span><span>-{rs(order.promo_amount)}</span></div>}
      {order.points_amount > 0 && <div className="r-line"><span>Points used ({order.points_used})</span><span>-{rs(order.points_amount)}</span></div>}
      <div className="r-line"><span>Sales tax{s.tax_rate ? ` ${s.tax_rate}%` : ''}</span><span>{rs(order.tax)}</span></div>
      {order.delivery_fee > 0 && <div className="r-line"><span>Delivery{order.zone ? ` (${order.zone})` : ''}</span><span>{rs(order.delivery_fee)}</span></div>}
      <div className="r-line big"><span>Total</span><span>{rs(order.total)}</span></div>
      {paid
        ? <div className="r-line"><span>Paid ({order.payment_method})</span><span>{rs(order.paid)}</span></div>
        : <div className="r-line"><span>Payment</span><span>{order.payment_method ? `${order.payment_method} · ` : ''}not paid yet</span></div>}
      {order.change_ > 0 && <div className="r-line"><span>Change</span><span>{rs(order.change_)}</span></div>}
      {order.status === 'refunded' && <p><b>Refunded</b> · {new Date(order.refunded_at).toLocaleString()}{order.refund_reason ? ' · ' + order.refund_reason : ''}</p>}
      {order.fiscal_no && <div className="fiscal"><p><b>{(s.fiscal_mode || '').toUpperCase()} Invoice No.</b><br />{order.fiscal_no}</p>{fiscalQr && <img src={fiscalQr} alt="" />}</div>}
      {!order.fiscal_no && order.fiscal_status === 'pending' && <p className="muted">Tax invoice no. pending — will be reported automatically</p>}
      {order.points_earned > 0 && <p>Points earned: {order.points_earned}, balance {order.customer_points}</p>}
      <p className="thanks">{s.footer}</p>
    </div>
  )
}

// printOrder(order, settings): the browser's print dialog showing ONLY this bill (print CSS in App.css hides the rest).
// <PrintHost /> is mounted once in main.jsx. The bill stays in the page until the dialog closes (afterprint).
let host = null
export function printOrder(order, s) {
  if (!host) return window.print()
  host({ order, s })
  setTimeout(() => window.print(), 50) // let the bill render first
}
export function PrintHost() {
  const [job, setJob] = useState(null)
  useEffect(() => {
    host = setJob
    const done = () => setJob(null)
    window.addEventListener('afterprint', done)
    return () => { host = null; window.removeEventListener('afterprint', done) }
  }, [])
  return job ? createPortal(<div id="print-bill"><Bill order={job.order} s={job.s} /></div>, document.body) : null
}
