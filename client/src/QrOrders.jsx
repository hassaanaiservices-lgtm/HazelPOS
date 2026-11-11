import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api, modsText } from './lib'
import { Icon } from './ui'
import { toastError } from './notify'

// Printable sheet with one QR code per table
export function QrCodesModal({ onClose }) {
  const [info, setInfo] = useState(null)
  const [base, setBase] = useState('')
  const [codes, setCodes] = useState({})

  useEffect(() => {
    api('/qr-info').then(d => {
      setInfo(d)
      const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname)
      const port = window.location.port ? ':' + window.location.port : ''
      // Phones can't open "localhost", so use the PC's WiFi address
      setBase(isLocal && d.ips[0] ? `${window.location.protocol}//${d.ips[0]}${port}` : window.location.origin)
    })
  }, [])

  useEffect(() => {
    if (!info || !base) return
    Promise.all(info.tables.map(async t => [t.id, await QRCode.toDataURL(`${base}/t/${t.qr_token}`, { width: 320, margin: 1 })]))
      .then(list => setCodes(Object.fromEntries(list)))
  }, [info, base])

  const port = window.location.port ? ':' + window.location.port : ''

  return (
    <div className="modal-bg qr-modal-bg" onClick={onClose}>
      <div className="modal qr-modal" onClick={e => e.stopPropagation()}>
        <div className="qr-modal-head no-print">
          <div>
            <h2>Table QR codes</h2>
            <p className="muted">Print and stick one on each table. Customers scan it, order from their phone, and the order pops up here for you to accept.</p>
          </div>
          <div className="qr-modal-actions">
            {info && info.ips.length > 1 && (
              <select value={base} onChange={e => setBase(e.target.value)}>
                {info.ips.map(ip => <option key={ip} value={`${window.location.protocol}//${ip}${port}`}>{ip}</option>)}
              </select>
            )}
            <button className="primary" onClick={() => window.print()}><Icon name="print" size={16} />Print</button>
            <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
          </div>
        </div>
        {!info ? <p className="muted">Loading…</p> : (
          <div className="qr-grid" id="qr-print-area">
            {info.tables.map(t => (
              <div key={t.id} className="qr-card">
                <div className="qr-card-title">{t.name}</div>
                <div className="qr-card-floor">{t.floor}</div>
                {codes[t.id] ? <img src={codes[t.id]} alt={`QR code for ${t.name}`} /> : <div className="qr-ph" />}
                <div className="qr-card-cta">Scan to order</div>
                <a className="qr-link no-print" href={`${base}/t/${t.qr_token}`} target="_blank" rel="noreferrer">Open link</a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Polls for new customer QR orders and pops them up for staff
export function QrOrderAlerts({ notify, onAccepted }) {
  const [list, setList] = useState([])

  useEffect(() => {
    let prev = 0
    const load = () => api('/qr-requests').then(l => {
      if (l.length > prev) beep()
      prev = l.length
      setList(l)
    }).catch(() => {})
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [])

  if (!list.length) return null
  const r = list[0]
  const total = r.items.reduce((s, i) => s + i.price * i.qty, 0)

  const act = async kind => {
    const res = await api(`/qr-requests/${r.id}/${kind}`, {})
    if (res.kitchen_print && res.kitchen_print !== 'ok') toastError('Kitchen printer: ' + res.kitchen_print)
    setList(l => l.filter(x => x.id !== r.id))
    notify(kind === 'accept' ? `${r.table_name} order sent to kitchen` : `${r.table_name} order rejected`)
    if (kind === 'accept') onAccepted?.()
  }

  return (
    <div className="modal-bg qr-alert-bg">
      <div className="modal qr-alert">
        <div className="qr-alert-head">
          <span className="qr-alert-ping"><Icon name="bell" size={20} /></span>
          <div>
            <h2>New QR order, {r.table_name}</h2>
            <p className="muted">{r.floor}{r.customer ? ' · ' + r.customer : ''} · {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          {list.length > 1 && <span className="qr-alert-more">+{list.length - 1} more</span>}
        </div>
        <div className="qr-alert-items">
          {r.items.map((i, k) => (
            <div key={k} className="qr-alert-line">
              <b>{i.qty} ×</b><span>{i.name}{i.mods?.length > 0 && <small>+ {modsText(i.mods)}</small>}{i.note && <small>{i.note}</small>}</span>
              <span>Rs. {Math.round(i.price * i.qty).toLocaleString('en-PK')}</span>
            </div>
          ))}
          {r.note && <div className="qr-alert-note">Note: {r.note}</div>}
        </div>
        <div className="qr-alert-total"><span>Subtotal</span><b>Rs. {Math.round(total).toLocaleString('en-PK')}</b></div>
        <div className="actions">
          <button className="ghost danger" onClick={() => act('reject')}>Reject</button>
          <button className="primary" id="qr-accept" onClick={() => act('accept')}>Accept & send to kitchen</button>
        </div>
      </div>
    </div>
  )
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[0, 0.18].forEach(d => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination)
      g.gain.setValueAtTime(0.2, ctx.currentTime + d)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d + 0.15)
      o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.16)
    })
  } catch { /* audio blocked */ }
}
