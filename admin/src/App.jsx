import { useEffect, useState } from 'react'
import { api } from './lib'
import { Notifier } from './notify'
import Restaurants from './Restaurants'
import Restaurant from './Restaurant'
import Unpaid from './Unpaid'
import Settings from './Settings'
import Activity from './Activity'

// Pages live in the address (#/restaurants, #/restaurant/3, #/unpaid), so Back and refresh work.
const parse = () => {
  const [, page = 'restaurants', id] = location.hash.replace(/^#\/?/, '#/').split('/')
  return { page, id: +id || null }
}
export const go = path => { location.hash = '#/' + path }

export default function App() {
  const [auth, setAuth] = useState(null) // null = checking, false = logged out, { cloud } = in
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    api('/me').then(d => setAuth(d.ok ? d : false), () => setAuth(false))
    const onHash = () => { setRoute(parse()); scrollTo(0, 0) }
    const onLogout = () => setAuth(false)
    window.addEventListener('hashchange', onHash); window.addEventListener('admin-logout', onLogout)
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('admin-logout', onLogout) }
  }, [])

  if (auth === null) return <Notifier />
  if (!auth) return <><Login onIn={() => api('/me').then(d => setAuth(d.ok ? d : false))} /><Notifier /></>

  // shortcut: the Team page (Team.jsx, a person each with their own login) is hidden until there is a team; ADMIN_PASSWORD is the one login.
  const nav = [['restaurants', 'Restaurants', '🏪'], ['unpaid', 'Unpaid', '💳'], ['activity', 'Activity', '🕑'], ['settings', 'Settings', '⚙️']]
  const section = route.page === 'restaurant' ? 'restaurants' : nav.some(n => n[0] === route.page) ? route.page : 'restaurants'
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span aria-hidden="true">🛠️</span>HazelPOS Admin</div>
        <nav aria-label="Main">
          {nav.map(([p, label, icon]) => <a key={p} href={'#/' + p} className={section === p ? 'on' : ''} aria-current={section === p ? 'page' : undefined} aria-label={label}>
            <span aria-hidden="true">{icon}</span><span className="label">{label}</span></a>)}
        </nav>
        <div className="side-user muted small">{auth.user?.name}{auth.user?.role ? ` · ${auth.user.role}` : ''}</div>
        <button className="link" onClick={() => api('/logout', {}).finally(() => setAuth(false))}>Log out</button>
      </aside>
      <main className="content">
        {route.page === 'restaurant' && route.id ? <Restaurant id={route.id} />
          : route.page === 'unpaid' ? <Unpaid />
          : route.page === 'activity' ? <Activity />
          : route.page === 'settings' ? <Settings />
          : <Restaurants />}
      </main>
      <Notifier />
    </div>
  )
}

function Login({ onIn }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    try { await api('/login', { password }); onIn() } catch (e2) { setErr(e2.message); setBusy(false) }
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>HazelPOS Admin</h1>
        <p className="muted">Restaurants, invoices and the HazelPOS WhatsApp number.</p>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </div>
  )
}
