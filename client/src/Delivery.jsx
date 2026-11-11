import { useEffect, useState } from 'react'
import { api, rs, run } from './lib'
import { Icon } from './ui'
import { toastError, confirmBox } from './notify'

const mins = iso => iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 0
const mapUrl = address => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || '')}`

// Dispatch board: send riders, track who is on the way, and take the cash for each delivered COD order
export default function Delivery({ notify }) {
  const [orders, setOrders] = useState([])
  const [riders, setRiders] = useState([])
  const [pick, setPick] = useState({})
  const load = () => { api('/deliveries').then(setOrders); api('/riders').then(setRiders) }
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [])

  const dispatch = run(async o => {
    const rider = riders.find(r => r.id === +(pick[o.id] || riders[0]?.id))
    if (!rider) return toastError('Add a rider first: open Staff, add a person, and set their job to "Rider"')
    if (['new', 'preparing'].includes(o.kitchen_status)
      && !await confirmBox('The kitchen has not marked this order ready. Send the rider anyway?', { confirmLabel: 'Send anyway' })) return
    await api(`/orders/${o.id}/dispatch`, { rider_id: rider.id })
    notify(`#${o.id} out with ${rider.name}`); load()
  })
  const delivered = run(async o => { await api(`/orders/${o.id}/delivered`, {}); load() })
  const printBill = run(async o => { await api(`/print/receipt/${o.id}`, {}); notify('Bill printed') })
  const cashIn = run(async o => {
    if (!await confirmBox(`Mark #${o.id} paid: ${rs(o.total)} cash received from ${o.rider?.name || 'the rider'}?`, { confirmLabel: 'Cash received' })) return
    await api(`/riders/${o.rider_id}/settle`, { order_ids: [o.id] }); notify(`#${o.id} paid: ${rs(o.total)} cash`); load()
  })
  const settle = run(async r => {
    if (!await confirmBox(`Collect ${rs(r.cash_due)} cash from ${r.name} for ${r.cod_orders} order(s)?`)) return
    const s = await api(`/riders/${r.id}/settle`, {}); notify(`Collected ${rs(s.total)} from ${r.name}`); load()
  })

  const waiting = orders.filter(o => !o.delivery_status)
  const out = orders.filter(o => o.delivery_status === 'out')
  const done = orders.filter(o => o.delivery_status === 'delivered')
  const card = (o, actions) => (
    <div key={o.id} className={'ticket' + (o.delivery_status === 'out' && mins(o.dispatched_at) > 45 ? ' late' : '')}>
      <div className="t-head"><b>#{o.id}</b><span className="pill">{o.zone || 'Delivery'}</span>
        <span className={o.status === 'paid' ? 'ok-tag' : 'cod-tag'}>{o.status === 'paid' ? 'Paid' : (o.delivery_status === 'delivered' ? 'Cash to collect: ' : 'COD ') + rs(o.total)}</span></div>
      <div><b>{o.customer || 'Customer'}</b> {o.phone && <a href={`tel:${o.phone}`} className="muted">{o.phone}</a>}</div>
      {o.address && <a className="muted addr" href={mapUrl(o.address)} target="_blank" rel="noreferrer"><Icon name="pin" size={14} />{o.address}</a>}
      <ul>{o.items.map(i => <li key={i.id}>{i.qty}× {i.name}</li>)}</ul>
      {o.rider && <div className="muted">Rider: {o.rider.name}{o.delivery_status === 'out' && `, out ${mins(o.dispatched_at)} min`}</div>}
      {!o.delivery_status && ['new', 'preparing'].includes(o.kitchen_status) && <div className="muted">Kitchen: cooking</div>}
      {!o.delivery_status && ['ready', 'done'].includes(o.kitchen_status) && <div className="food-ready">Food ready</div>}
      <div className="t-actions">{actions}</div>
    </div>
  )
  return (
    <section className="delivery">
      <div className="row-head"><h2>Delivery</h2>
        <div className="riders">
          {!riders.length && <span className="muted">No riders yet — add staff with job "Rider" under Staff</span>}
          {riders.map(r => (
            <div key={r.id} className="rider-chip">
              <b>{r.name}</b><small className="muted">{r.on_road ? `${r.on_road} on the road` : 'At shop'}</small>
              {r.cash_due > 0 && <button className="primary sm" onClick={() => settle(r)}>Collect {rs(r.cash_due)}</button>}
            </div>
          ))}
        </div>
      </div>
      <div className="kitchen">
        <div className="k-col new"><h2>Ready to send <span className="count">{waiting.length}</span></h2><div className="k-list">
          {!waiting.length && <div className="empty">Nothing waiting to be sent</div>}
          {waiting.map(o => card(o, <>
            <select value={pick[o.id] || riders[0]?.id || ''} onChange={e => setPick({ ...pick, [o.id]: e.target.value })}>
              {riders.map(r => <option key={r.id} value={r.id}>{r.name}{r.on_road ? ` (${r.on_road} out)` : ''}</option>)}
            </select>
            <button className="ghost sm" aria-label="Print bill" title="Print bill" onClick={() => printBill(o)}><Icon name="print" size={16} /></button>
            <button className="primary" onClick={() => dispatch(o)}>Dispatch</button>
          </>))}
        </div></div>
        <div className="k-col preparing"><h2>On the way <span className="count">{out.length}</span></h2><div className="k-list">
          {!out.length && <div className="empty">No rider on the way</div>}
          {out.map(o => card(o, <>
            <button className="primary" onClick={() => delivered(o)}>Delivered</button>
          </>))}
        </div></div>
        <div className="k-col ready"><h2>Delivered <span className="count">{done.length}</span></h2><div className="k-list">
          {!done.length && <div className="empty">Nothing delivered today</div>}
          {done.map(o => card(o, o.status === 'open' ? <button className="primary" onClick={() => cashIn(o)}>Cash received</button> : null))}
        </div></div>
      </div>
    </section>
  )
}
