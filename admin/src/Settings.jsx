import { useEffect, useState } from 'react'
import { api } from './lib'
import { run, toast, confirmBox } from './notify'

// Settings -> HazelPOS WhatsApp: the number that sends sign-in codes, welcome links and invoices. Linked once by scanning a QR
// (WhatsApp -> Linked devices on the phone). While the QR shows, the page asks again every 3 seconds.
const LABEL = { not_linked: 'Not linked', connecting: 'Connecting…', qr: 'Waiting for the scan', connected: 'Connected', reconnecting: 'Reconnecting…' }
export default function Settings() {
  const [st, setSt] = useState(null)
  const load = () => api('/wa').then(setSt)
  useEffect(() => { run(load)() }, [])
  useEffect(() => {
    if (!st || !['connecting', 'qr', 'reconnecting'].includes(st.state)) return
    const t = setInterval(() => { load().catch(() => {}) }, 3000)
    return () => clearInterval(t)
  }, [st?.state])
  const link = run(async () => setSt(await api('/wa/link', {})))
  const unlink = run(async () => {
    if (!await confirmBox('Unlink the HazelPOS WhatsApp number? Codes and links will only show in the server log until it is linked again.', { confirmLabel: 'Unlink', danger: true })) return
    setSt(await api('/wa/logout', {})); toast('Unlinked')
  })
  if (!st) return <p className="muted">Loading…</p>
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <div className="card" id="wa-card">
        <h3>HazelPOS WhatsApp</h3>
        <p className="muted" style={{ marginBottom: 12 }}>This is HazelPOS's own number. It sends owners their sign-in codes, welcome and reset links, and invoices. It is not a restaurant's number.</p>
        <p style={{ marginBottom: 12 }}>Status: <span id="wa-state" className={'pill ' + (st.state === 'connected' ? 'ok' : st.state === 'not_linked' ? '' : 'warn')}>{LABEL[st.state] || st.state}</span>
          {st.phone && <> <b>{st.phone}</b></>}</p>
        {st.error && st.state !== 'connected' && <p className="err" style={{ marginBottom: 12 }}>{st.error}</p>}
        {st.qr && <div style={{ marginBottom: 12 }}>
          <img id="wa-qr" src={st.qr} alt="WhatsApp link code" width={280} height={280} style={{ background: '#fff', padding: 8, borderRadius: 'var(--r-sm)' }} />
          <p className="muted small">On the phone: WhatsApp, Linked devices, Link a device, then scan this code. It refreshes by itself.</p></div>}
        <div className="row">
          {st.state !== 'connected' && <button className="primary" id="wa-link" onClick={link}>Link number</button>}
          {st.state !== 'not_linked' && <button className="danger" id="wa-unlink" onClick={unlink}>Unlink</button>}
        </div>
      </div>
    </>
  )
}
