import { StrictMode, Component, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import CustomerOrder from './CustomerOrder.jsx'
import SignIn from './SignIn.jsx'
import TillLock from './TillLock.jsx'
import OwnerLink from './OwnerLink.jsx'
import { api, lsGet, lsSet, lsDel, setForceTenant } from './lib.js'
import { Notifier } from './notify.jsx'
import { watchTables } from './ui.jsx'
import { PrintHost } from './Bill.jsx'

// Customers scanning a table QR land on /t/<restaurant>/<token>
const linkMatch = window.location.pathname.match(/^\/(?:welcome|reset)\/([a-f0-9]+)\/?$/i)
const joinMatch = window.location.pathname.match(/^\/join\/([a-z0-9-]+)\/([a-f0-9]{32})\/?$/i) // a staff login link from the owner
const qrMatch = window.location.pathname.match(/^\/t\/([a-z0-9-]+)\/([a-z0-9]+)/i)

// sessionStorage: kept through a refresh, gone when the tab closes. ss(k) reads, ss(k, v) writes, ss(k, null) removes.
const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v) } catch { return null } }

// Which screen first: a till that was set up shows the lock screen; a browser the owner signed in on opens the app; otherwise
// the sign-in screen. (The public demo has no sign-in: the server answers /settings for its demo restaurant.)
function Root() {
  const [, bump] = useState(0)
  // A till stays unlocked through a refresh (sessionStorage); closing the browser tab locks it again
  const [unlocked, setUnlocked] = useState(() => ss('hz_till_unlocked') === '1' && !!lsGet('pos_token'))
  const [ownerMode, setOwnerMode] = useState(false) // "Owner sign-in" pressed on a till: the sign-in screen, device key kept
  const [ownerOnTill, setOwnerOnTill] = useState(() => { const on = ss('hz_till_owner') === '1' && !!lsGet('pos_token'); if (on) setForceTenant(true); return on }) // the owner signed in that way
  const [demo, setDemo] = useState(null)
  const [linkToken, setLinkToken] = useState(linkMatch?.[1] || null) // /welcome/<token> or /reset/<token>, until the password is set
  const [linkSession, setLinkSession] = useState(null) // a password was just set from a welcome or reset link
  useEffect(() => {
    const restart = () => { ss('hz_till_unlocked', null); ss('hz_till_owner', null); setUnlocked(false); setOwnerMode(false); setOwnerOnTill(false); setForceTenant(false); bump(n => n + 1) }
    window.addEventListener('pos-restart', restart)
    return () => window.removeEventListener('pos-restart', restart)
  }, [])
  // Only ask the server about the demo once a restaurant is known (the demo itself never has one stored)
  useEffect(() => {
    if (lsGet('hz_device') || lsGet('hz_tenant')) { setDemo(false); return }
    fetch('/api/health').then(r => r.json()).then(h => setDemo(!!h.demo)).catch(() => setDemo(false))
  }, [])
  if (joinMatch) return <JoinLink slug={joinMatch[1]} token={joinMatch[2]} />
  if (demo === null) return <div className="login" />
  if (demo) return <App />
  const device = lsGet('hz_device')
  const open = ({ token, user, restaurant }) => { // the owner entered a restaurant
    setLinkSession(null)
    lsSet('pos_token', token); lsSet('pos_user', JSON.stringify(user)); lsSet('hz_tenant', restaurant.slug)
    if (device) { setForceTenant(true); setOwnerOnTill(true); ss('hz_till_owner', '1') }
    bump(n => n + 1)
  }
  if (linkToken) return <OwnerLink token={linkToken} onDone={o => { history.replaceState(null, '', '/'); lsDel('hz_tenant'); lsDel('pos_token'); setLinkToken(null); setLinkSession(o) }} />
  if (linkSession) return <SignIn start={linkSession} onDone={open} />
  if (device && !ownerOnTill) {
    if (unlocked) return <App />
    if (ownerMode) return <SignIn onDone={open} onBack={() => setOwnerMode(false)} />
    return <TillLock onLogin={({ token, user }) => { lsSet('pos_token', token); lsSet('pos_user', JSON.stringify(user)); ss('hz_till_unlocked', '1'); setUnlocked(true) }} onOwner={() => setOwnerMode(true)} />
  }
  if (lsGet('hz_tenant') && lsGet('pos_token')) return <App />
  return <SignIn onDone={open} />
}

// A staff member opened the login link the owner sent: this phone becomes a till of that restaurant, then name + PIN
function JoinLink({ slug, token }) {
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/join/' + token, { method: 'POST', headers: { 'X-Tenant': slug } })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'This login link does not work. Ask the owner for a new one.'); return d })
      .then(d => {
        lsSet('hz_device', d.device_key); lsDel('pos_token'); lsDel('pos_user'); lsDel('hz_tenant'); lsDel('hz_owner_token')
        window.location.replace('/') // the lock screen: tap your name, type your PIN
      })
      .catch(e => setErr(e.message))
  }, [slug, token])
  return (
    <div className="login"><div className="login-card"><h1>HazelPOS</h1>
      {err ? <p className="err" role="alert">{err}</p> : <p className="muted" role="status">Setting up this phone…</p>}
    </div></div>
  )
}

// Any screen that crashes shows a message and a reload button, never a blank page
class Crash extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('Screen error:', error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg)', color: 'var(--text)', textAlign: 'center' }}>
        <div>
          <h2>Something went wrong on this screen</h2>
          <p style={{ color: 'var(--text-2)' }}>Your data is safe. Reload to continue.</p>
          <button className="btn primary" style={{ minHeight: 44, marginTop: 12 }} onClick={() => window.location.reload()}>Reload</button>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 16 }}>{String(this.state.error?.message || this.state.error).slice(0, 200)}</p>
        </div>
      </div>
    )
  }
}

// No saved theme: follow the device's light/dark setting (App.css [data-theme=auto])
document.documentElement.dataset.theme = ['light', 'dark'].includes(lsGet('pos_theme')) ? lsGet('pos_theme') : 'auto'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Crash>{qrMatch ? <CustomerOrder slug={qrMatch[1].toLowerCase()} token={qrMatch[2]} /> : <Root />}</Crash>
    <Notifier />
    <PrintHost />
  </StrictMode>,
)

watchTables() // tables turn into stacked cards on phones
