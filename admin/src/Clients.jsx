import { useEffect, useState } from 'react'
import { api, num } from './lib'
import { run, toast } from './notify'
import { Membership, Stage, needsAttention, LastSeen } from './ui'
import { go } from './App'

// All clients: who's paid, where each branch is in onboarding, and who needs attention today
export default function Clients() {
  const [owners, setOwners] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(false)
  const load = () => api('/owners').then(setOwners)
  useEffect(() => { run(load)() }, [])
  if (!owners) return <p className="muted">Loading…</p>

  const branches = owners.flatMap(o => o.branches)
  const running = branches.filter(b => b.health_at && Date.now() - Date.parse(b.health_at) < 864e5).length
  const attention = owners.filter(needsAttention)
  const shown = (filter === 'attention' ? attention : owners)
    .filter(o => !q || `${o.name} ${o.email} ${o.phone} ${o.branches.map(b => b.name).join(' ')}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="page-head"><h1>Clients</h1><span className="sp" /><button className="primary" onClick={() => setAdding(true)}>+ New client</button></div>
      <div className="kpis">
        <div className="kpi"><span>Clients</span><b>{owners.length}</b></div>
        <div className="kpi"><span>Paid memberships</span><b>{owners.filter(o => o.active).length}</b></div>
        <div className="kpi"><span>Branches running</span><b>{running} / {branches.length}</b></div>
        <div className="kpi"><span>Need attention</span><b>{attention.length}</b></div>
        <div className="kpi"><span>Errors (24 h)</span><b>{branches.reduce((s, b) => s + b.errors_24h, 0)}</b></div>
        <div className="kpi"><span>AI replies this month</span><b>{num(branches.reduce((s, b) => s + b.ai.calls, 0))}</b></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="search" type="search" placeholder="Search name, phone, email…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search clients" />
        <div className="tabs" style={{ margin: 0, border: 0 }} role="tablist">
          <button role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All ({owners.length})</button>
          <button role="tab" aria-selected={filter === 'attention'} className={filter === 'attention' ? 'on' : ''} onClick={() => setFilter('attention')}>Needs attention ({attention.length})</button>
        </div>
      </div>
      <div className="card scroll" style={{ padding: 0 }}>
        {shown.length ? <table>
          <thead><tr><th>Client</th><th>Membership</th><th>Paid until</th><th>Branches</th><th>Last seen</th><th className="num">Errors 24 h</th><th className="num">AI replies</th><th></th></tr></thead>
          <tbody>{shown.map(o => (
            <tr key={o.id} className="click" onClick={() => go('client/' + o.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && go('client/' + o.id)}>
              <td><b>{o.name || o.email}</b><div className="muted small">{o.phone || o.email}</div></td>
              <td><Membership o={o} /></td>
              <td>{o.paid_until || '—'}</td>
              <td><div className="row">{o.branches.length ? o.branches.map(b => <button key={b.id} className="link branch-link" title={`Set up ${b.name}: menu, staff, tables…`}
                onClick={e => { e.stopPropagation(); go('branch/' + b.id) }}>{b.name} <Stage b={b} /></button>) : <span className="muted">No branch yet</span>}</div></td>
              <td>{o.branches.length ? <LastSeen b={o.branches.reduce((a, b) => (Date.parse(b.health_at || b.last_sync || 0) > Date.parse(a.health_at || a.last_sync || 0) ? b : a))} /> : '—'}</td>
              <td className="num">{o.branches.reduce((s, b) => s + b.errors_24h, 0) || '0'}</td>
              <td className="num">{num(o.branches.reduce((s, b) => s + b.ai.calls, 0))}</td>
              <td><button onClick={e => { e.stopPropagation(); go('client/' + o.id) }}>Open →</button></td>
            </tr>))}
          </tbody></table>
          : <div className="empty">{owners.length ? 'No client matches.' : 'No clients yet. Add your first one.'}</div>}
      </div>
      {adding && <NewClient onClose={() => setAdding(false)} onDone={id => { setAdding(false); toast('Client added'); go('client/' + id) }} />}
    </>
  )
}

function NewClient({ onClose, onDone }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '', plan: '', paid_until: '', notes: '', monthly_fee: '', install_fee: '', install_paid: false })
  const [err, setErr] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const submit = async e => {
    e.preventDefault(); setErr('')
    try { onDone((await api('/owners', f)).id) } catch (e2) { setErr(e2.message) }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submit} style={{ width: 'min(640px, 100%)' }}>
        <h2>New client</h2>
        <div className="grid2">
          <label>Restaurant name<input value={f.name} onChange={set('name')} required autoFocus /></label>
          <label>Owner phone<input value={f.phone} onChange={set('phone')} inputMode="tel" /></label>
          <label>Owner email (their cloud dashboard login)<input type="email" value={f.email} onChange={set('email')} required /></label>
          <label>Dashboard password (8+ characters)<input value={f.password} onChange={set('password')} minLength={8} required /></label>
          <label>Monthly fee (Rs)<input type="number" min="0" value={f.monthly_fee} onChange={set('monthly_fee')} placeholder="e.g. 5000" /></label>
          <label>Installation fee (Rs, one time)<input type="number" min="0" value={f.install_fee} onChange={set('install_fee')} placeholder="e.g. 15000" /></label>
          <label className="check"><input type="checkbox" checked={f.install_paid} onChange={e => setF({ ...f, install_paid: e.target.checked })} /> Installation fee paid</label>
          <label>Plan / note on the price<input value={f.plan} onChange={set('plan')} placeholder="e.g. Standard, 1 branch" /></label>
          <label>Paid until (empty = one month from today)<input type="date" value={f.paid_until} onChange={set('paid_until')} /></label>
          <label className="wide">Notes<textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary">Add client</button></div>
      </form>
    </div>
  )
}
