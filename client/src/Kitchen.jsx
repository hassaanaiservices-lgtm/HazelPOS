import { useEffect, useRef, useState } from 'react'
import { api, TYPES, modsText } from './lib'
import { Icon } from './ui'

// The kitchen's one job: cook. Two columns, two buttons: Start cooking, Ready.
// On Ready the ticket leaves the kitchen; the order type (picked at billing) decides where it goes:
//   dine-in / takeaway -> the counter's Food-ready strip (ReadyAlerts.jsx); paying the bill clears it too
//   delivery           -> the riders' phones; it is gone when a rider takes it
// The side list shows what is ready and still waiting, read-only (with a short Undo for a wrong tap).
const COLS = [
  { id: 'new', label: 'New', next: 'preparing', btn: 'Start cooking' },
  { id: 'preparing', label: 'Cooking', next: 'ready', btn: 'Ready' },
]
const UNDO_MS = 2 * 60 * 1000 // a wrong "Ready" can be taken back for 2 minutes
const mins = t => Math.floor((Date.now() - new Date(t)) / 60000)
const since = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
const goesTo = t => t.type === 'delivery' ? (t.rider ? `Rider ${t.rider.name}` : 'Waiting for a rider') : t.type === 'dine-in' ? `Counter → ${t.tableName || 'table'}` : 'Counter → pickup'

export default function Kitchen({ readOnly = false }) {
  const [tickets, setTickets] = useState([])
  const [, tick] = useState(0)
  const known = useRef(null)

  const load = async () => {
    const list = await api('/kitchen')
    const ids = new Set(list.filter(t => t.kitchen_status === 'new').map(t => t.id + t.kitchen_at))
    if (!readOnly && known.current && [...ids].some(id => !known.current.has(id))) beep()
    known.current = ids
    setTickets(list)
  }
  useEffect(() => {
    load()
    const a = setInterval(load, 3000), b = setInterval(() => tick(x => x + 1), 15000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [])

  const move = async (t, status) => { await api('/kitchen/' + t.id, { status }); load() }
  const waiting = tickets.filter(t => t.kitchen_status === 'ready').sort((a, b) => Date.parse(a.ready_at || 0) - Date.parse(b.ready_at || 0))

  return (
    <section className="kitchen kitchen-2">
      {COLS.map(c => {
        const list = tickets.filter(t => t.kitchen_status === c.id)
        return (
          <div key={c.id} className={'k-col ' + c.id}>
            <h2>{c.label} <span className="count">{list.length}</span></h2>
            <div className="k-list">
              {!list.length && <div className="empty">{c.id === 'new' ? 'No new orders' : 'Nothing cooking'}</div>}
              {list.map(t => {
                const m = mins(t.kitchen_at), type = TYPES.find(x => x.id === t.type)
                return (
                  <div key={t.id} className={'ticket type-' + t.type + (m >= 15 ? ' late' : m >= 8 ? ' warn' : '')}>
                    <div className="t-head">
                      <b>#{t.id}</b>
                      <span className="pill"><Icon name={type?.icon} size={15} />{t.tableName || type?.label}</span>
                      <span className="timer">{since(m)}</span>
                    </div>
                    {t.customer && <div className="muted">{t.customer}</div>}
                    <ul>{t.items.map(i => <li key={i.id}><b>{i.qty}×</b> {i.name}{i.mods?.length > 0 && <small className="mods"> + {modsText(i.mods)}</small>}{i.note && <em>, {i.note}</em>}
                      {i.includes?.length > 0 && <ul className="deal-incl">{i.includes.map((d, n) => <li key={n}>{d.qty * i.qty}× {d.name}{d.size ? ` (${d.size})` : ''}</li>)}</ul>}</li>)}</ul>
                    {!readOnly && <div className="t-actions">
                      {c.id === 'preparing' && <button className="ghost" aria-label="Back to New" title="Back to New" onClick={() => move(t, 'new')}><Icon name="back" size={16} /></button>}
                      <button className={'primary' + (c.id === 'preparing' ? ' k-ready-btn' : '')} onClick={() => move(t, c.next)}>
                        {c.id === 'preparing' && <Icon name="check" size={18} />}{c.btn}</button>
                    </div>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      <aside className="k-col k-waiting" aria-label="Ready, waiting to go">
        <h2>Ready, waiting <span className="count">{waiting.length}</span></h2>
        <div className="k-list">
          {!waiting.length && <div className="empty">Nothing waiting</div>}
          {waiting.map(t => {
            const type = TYPES.find(x => x.id === t.type), age = Date.now() - Date.parse(t.ready_at || 0)
            return (
              <div key={t.id} className={'k-wait type-' + t.type + (age > 10 * 60e3 ? ' late' : '')}>
                <div className="k-wait-top"><b>#{t.id}</b><Icon name={type?.icon} size={14} /><span className="muted">{t.tableName || type?.label}</span>
                  <span className="timer">{since(mins(t.ready_at || t.kitchen_at))}</span></div>
                <div className="k-wait-to">{goesTo(t)}</div>
                {!readOnly && age < UNDO_MS && <button className="link sm" onClick={() => move(t, 'preparing')}>Undo, not ready</button>}
              </div>
            )
          })}
        </div>
      </aside>
    </section>
  )
}

function beep() {
  try {
    const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.2
    o.start(); o.stop(ctx.currentTime + 0.25)
  } catch { /* audio blocked */ }
}
