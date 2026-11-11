import { useEffect, useRef, useState } from 'react'
import { api, TYPES, modsText } from './lib'
import { Icon } from './ui'

const COLS = [
  { id: 'new', label: 'New', next: 'preparing', btn: 'Start cooking' },
  { id: 'preparing', label: 'Preparing', next: 'ready', btn: 'Mark ready' },
  { id: 'ready', label: 'Ready', next: 'done', btn: 'Served / Picked up' },
]
const mins = t => Math.floor((Date.now() - new Date(t)) / 60000)
const since = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`

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
    const a = setInterval(load, 3000), b = setInterval(() => tick(x => x + 1), 30000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [])

  const move = async (t, status) => { await api('/kitchen/' + t.id, { status }); load() }

  return (
    <section className="kitchen">
      {COLS.map(c => {
        const list = tickets.filter(t => t.kitchen_status === c.id)
        return (
          <div key={c.id} className={'k-col ' + c.id}>
            <h2>{c.label} <span className="count">{list.length}</span></h2>
            <div className="k-list">
              {!list.length && <div className="empty">Nothing here</div>}
              {list.map(t => {
                const m = mins(t.kitchen_at), type = TYPES.find(x => x.id === t.type)
                return (
                  <div key={t.id} className={'ticket' + (m >= 15 ? ' late' : m >= 8 ? ' warn' : '')}>
                    <div className="t-head">
                      <b>#{t.id}</b>
                      <span className="pill"><Icon name={type?.icon} size={15} />{t.tableName || type?.label}</span>
                      <span className="timer">{since(m)}</span>
                    </div>
                    {t.customer && <div className="muted">{t.customer}</div>}
                    <ul>{t.items.map(i => <li key={i.id}><b>{i.qty}×</b> {i.name}{i.mods?.length > 0 && <small className="mods"> + {modsText(i.mods)}</small>}{i.note && <em>, {i.note}</em>}</li>)}</ul>
                    {!readOnly && <div className="t-actions">
                      {c.id !== 'new' && <button className="ghost" aria-label="Move back" title="Move back" onClick={() => move(t, COLS[COLS.indexOf(c) - 1].id)}><Icon name="back" size={16} /></button>}
                      <button className="primary" onClick={() => move(t, c.next)}>{c.btn}</button>
                    </div>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
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
