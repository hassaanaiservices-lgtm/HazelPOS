import { useEffect, useRef, useState } from 'react'
import { api, rs, run } from './lib'
import { Icon } from './ui'
import { toast } from './notify'

// The rider's own screen (4th login, role rider). Ready orders to accept, their deliveries (navigate, call, delivered),
// an On-duty switch that shares their location, and their money: today, this month, cash still with them.
// A phone's GPS only works on https or localhost. Opened over the restaurant Wi-Fi (http://192.168…), location goes
// through their phone link on the cloud instead (the same screen, on https).
const mins = iso => iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 0
const since = iso => { const m = mins(iso); return m < 90 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days` }
const navUrl = address => { const m = /q=(-?\d+\.?\d*),(-?\d+\.?\d*)/.exec(address || ''); return 'https://www.google.com/maps/dir/?api=1&destination=' + (m ? `${m[1]},${m[2]}` : encodeURIComponent(address || '')) }

export default function RiderHome() {
  const [d, setD] = useState(null)
  const [duty, setDuty] = useState(false)
  const [loc, setLoc] = useState('')
  const [armed, setArmed] = useState(null) // order id whose Delivered button was tapped once
  const watch = useRef(null), last = useRef(0), wake = useRef(null)
  const gps = typeof window !== 'undefined' && window.isSecureContext && 'geolocation' in navigator

  const load = () => api('/rider/board').then(x => { setD(x); return x }).catch(e => setLoc(e.message))
  useEffect(() => { load().then(x => x?.me?.on_duty && gps && start()); const t = setInterval(load, 5000); return () => { clearInterval(t); stop() } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = p => {
    if (Date.now() - last.current < 8000) return
    last.current = Date.now()
    api('/rider/location', { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy })
      .then(() => setLoc('Location on'), e => setLoc('Location not sent: ' + e.message))
  }
  const start = () => {
    setDuty(true)
    if (!gps) return
    setLoc('Getting your location…')
    watch.current = navigator.geolocation.watchPosition(send, e => setLoc(e.code === 1 ? 'Allow location for this page (phone settings → browser → location)' : 'Turn on Location (GPS) on the phone'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 })
    navigator.wakeLock?.request('screen').then(w => { wake.current = w }).catch(() => {})
  }
  const stop = () => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current)
    watch.current = null; wake.current?.release?.().catch(() => {}); wake.current = null
  }
  const toggleDuty = run(async () => {
    const on = !duty
    await api('/rider/duty', { on })
    if (on) start(); else { stop(); setDuty(false); setLoc('') }
  })
  const accept = run(async o => { await api('/rider/accept', { order: o.id }); toast(`#${o.id} is yours. Drive safe!`); load() })
  const delivered = run(async o => {
    if (armed !== o.id) { setArmed(o.id); setTimeout(() => setArmed(a => a === o.id ? null : a), 4000); return }
    setArmed(null); await api('/rider/delivered', { order: o.id }); toast(`#${o.id} delivered`); load()
  })

  if (!d) return <section className="rider-home"><p className="muted">{loc || 'Loading…'}</p></section>
  const ticket = (o, mine) => (
    <div key={o.id} className={'ticket rider-ticket' + (mine ? ' mine' : '')}>
      <div className="t-head"><b>#{o.id}</b>{o.zone && <span className="pill">{o.zone}</span>}
        <span className={o.cod ? 'cod-tag' : 'ok-tag'}>{o.cod ? `Collect ${rs(o.total)}` : `Paid ${rs(o.total)}`}</span></div>
      <div><b>{o.customer || 'Customer'}</b></div>
      {o.address && <a className="muted addr" href={navUrl(o.address)} target="_blank" rel="noreferrer"><Icon name="pin" size={14} />{o.address}</a>}
      <div className="muted">{o.items}</div>
      {mine ? <>
        <div className="muted">Out for {since(o.dispatched_at)}</div>
        <div className="rider-actions">
          <a className="btn ghost" href={navUrl(o.address)} target="_blank" rel="noreferrer"><Icon name="pin" size={16} />Navigate</a>
          {o.phone ? <a className="btn ghost" href={`tel:${o.phone}`}><Icon name="phone" size={16} />Call</a> : <span />}
          <button className={'wide ' + (armed === o.id ? 'primary' : 'ok-btn')} onClick={() => delivered(o)}>
            <Icon name="check" size={18} />{armed === o.id ? `Tap again: delivered${o.cod ? `, ${rs(o.total)} collected` : ''}` : 'Delivered'}</button>
        </div>
      </> : <div className="rider-actions">
        {o.status === 'ready'
          ? <button className="primary wide" onClick={() => accept(o)}>Accept · main le jata hoon</button>
          : <button className="wide" disabled>Still cooking · abhi tayyar nahi</button>}
      </div>}
    </div>
  )
  return (
    <section className="rider-home">
      <div className="rider-top">
        <div><h2>Hi {d.me.name}</h2><span className="muted">{d.me.fee ? `You earn ${rs(d.me.fee)} per delivery` : 'Your deliveries'}</span></div>
        <button className={'duty-switch' + (duty ? ' on' : '')} aria-pressed={duty} onClick={toggleDuty}>{duty ? 'On duty' : 'Off duty'}<span>🛵</span></button>
      </div>
      {duty && (gps
        ? <p className={'rider-note' + (/not|Allow|Turn/.test(loc) ? ' bad' : '')}>{loc || 'Location on'} · Keep this screen open while delivering, so the restaurant and the customer can see where you are.</p>
        : <p className="rider-note bad">Location can't be shared from this address (it is not https).{' '}
          {d.phone_link ? <a href={d.phone_link} target="_blank" rel="noreferrer">Open your phone link to share it</a> : 'Ask the owner for your phone link (Riders → Phone link).'}</p>)}

      <div className="rider-money">
        <div className="card"><span className="muted">Today</span><b>{d.today.delivered}</b><small className="muted">delivered · {rs(d.today.earned)}</small></div>
        <div className="card"><span className="muted">Cash with you</span><b className={d.cash_with_me > 0 ? 'warn-t' : ''}>{rs(d.cash_with_me)}</b><small className="muted">hand it in at the counter</small></div>
        <div className="card"><span className="muted">This month</span><b>{d.month.deliveries}</b><small className="muted">deliveries · earned {rs(d.month.earned)}</small></div>
        <div className="card"><span className="muted">To get from the restaurant</span><b className={d.month.owed > 0 ? 'ok-t' : ''}>{rs(d.month.owed)}</b><small className="muted">paid so far {rs(d.month.paid)}</small></div>
      </div>

      <h3>My deliveries <span className="count">{d.mine.length}</span></h3>
      <div className="rider-list">{d.mine.length ? d.mine.map(o => ticket(o, true)) : <div className="empty">Nothing with you right now</div>}</div>
      <h3>Ready to pick up <span className="count">{d.ready.length}</span></h3>
      <div className="rider-list">{d.ready.length ? d.ready.map(o => ticket(o, false)) : <div className="empty">No order waiting. New delivery orders appear here; Accept them when the kitchen marks them ready.</div>}</div>
      {d.others_out > 0 && <p className="muted">{d.others_out} other {d.others_out > 1 ? 'deliveries are' : 'delivery is'} out with other riders.</p>}
    </section>
  )
}
