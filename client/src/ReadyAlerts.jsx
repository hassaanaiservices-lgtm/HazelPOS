import { useEffect, useRef, useState } from 'react'
import { api, run } from './lib'
import { Icon } from './ui'
import { beep } from './QrOrders'

// The counter's "Food ready" strip (cashier). The kitchen pressed Mark ready on a dine-in or takeaway order:
// it beeps, and stays here until someone presses Served / Picked up (or the takeaway is paid).
// Delivery orders are not shown: riders are told on their own screens.
const mins = iso => iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)) : 0

export default function ReadyAlerts({ notify }) {
  const [list, setList] = useState([])
  const seen = useRef(null)
  const load = () => api('/kitchen').then(all => {
    const ready = all.filter(t => t.kitchen_status === 'ready' && t.type !== 'delivery')
    const keys = new Set(ready.map(t => `${t.id}:${t.ready_at}`))
    if (seen.current && [...keys].some(k => !seen.current.has(k))) beep()
    seen.current = keys
    setList(ready)
  }).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [])
  const done = run(async t => {
    await api('/kitchen/' + t.id, { status: 'done' })
    notify(t.type === 'dine-in' ? `${t.tableName || '#' + t.id} served` : `#${t.id} picked up`)
    load()
  })
  if (!list.length) return null
  return (
    <div className="ready-strip no-print" role="status" aria-label="Food ready">
      <span className="ready-strip-title"><Icon name="bell" size={18} />Food ready</span>
      {list.map(t => (
        <div key={t.id} className={'ready-chip ' + t.type}>
          <div className="ready-chip-text">
            <b>{t.type === 'dine-in' ? (t.tableName || `#${t.id}`) : `Takeaway #${t.id}`}</b>
            <small className="muted">{t.type === 'dine-in' ? 'Serve it' : `Call ${t.customer || 'the customer'}`}{` · ${mins(t.ready_at)} min`}</small>
          </div>
          <button className="primary sm" onClick={() => done(t)}>{t.type === 'dine-in' ? 'Served' : 'Picked up'}</button>
        </div>
      ))}
    </div>
  )
}
