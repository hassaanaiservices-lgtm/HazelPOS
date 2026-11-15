import { useEffect, useState } from 'react'
import { api } from './lib'
import { Notifier } from './notify'
import Clients from './Clients'
import Client from './Client'
import Branch from './Branch'
import Usage from './Usage'
import Unpaid from './Unpaid'
import Updates from './Updates'

// Pages live in the address (#/clients, #/client/3, #/branch/5, #/usage), so Back and refresh work.
const parse = () => {
  const [, page = 'clients', id] = location.hash.replace(/^#\/?/, '#/').split('/')
  return { page, id: +id || null }
}
export const go = path => { location.hash = '#/' + path }

export default function App() {
  const [auth, setAuth] = useState(null) // null = checking, false = logged out, { cloud } = in
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    api('/me').then(setAuth, () => setAuth(false))
    const onHash = () => { setRoute(parse()); scrollTo(0, 0) }
    const onLogout = () => setAuth(false)
    window.addEventListener('hashchange', onHash); window.addEventListener('admin-logout', onLogout)
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('admin-logout', onLogout) }
  }, [])

  if (auth === null) return <Notifier />
  if (!auth) return <><Login onIn={() => api('/me').then(setAuth)} /><Notifier /></>

  const nav = [['clients', 'Clients', '🏪'], ['unpaid', 'Unpaid', '⏰'], ['updates', 'Updates', '⬆️'], ['usage', 'AI usage', '📊']]
  const section = ['usage', 'unpaid', 'updates'].includes(route.page) ? route.page : 'clients'
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span aria-hidden="true">🛠️</span>HazelPOS Admin</div>
        <nav aria-label="Main">
          {nav.map(([p, label, icon]) => <a key={p} href={'#/' + p} className={section === p ? 'on' : ''} aria-current={section === p ? 'page' : undefined} aria-label={label}>
            <span aria-hidden="true">{icon}</span><span className="label">{label}</span></a>)}
        </nav>
        <button className="link" onClick={() => api('/logout', {}).finally(() => setAuth(false))}>Log out</button>
      </aside>
      <main className="content">
        {route.page === 'client' && route.id ? <Client id={route.id} />
          : route.page === 'branch' && route.id ? <Branch id={route.id} />
          : route.page === 'usage' ? <Usage />
          : route.page === 'unpaid' ? <Unpaid />
          : route.page === 'updates' ? <Updates />
          : <Clients />}
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
        <p className="muted">Clients, onboarding, memberships, health and AI usage.</p>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" autoFocus required /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </div>
  )
}
