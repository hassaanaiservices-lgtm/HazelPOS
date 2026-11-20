import { useEffect, useState } from 'react'
import { api, ago } from './lib'
import { run, toast, confirmBox } from './notify'
import { StatusChip, rs, dateOf, invoiceChip } from './ui'
import { go } from './App'

// All restaurants: status, owner, fee, last activity, printer helper and open invoice. "+ New restaurant" creates one and
// sends the owner a welcome link on WhatsApp.
export default function Restaurants() {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState(null)
  const load = () => api('/tenants').then(setList)
  useEffect(() => { run(load)() }, [])
  if (!list) return <p className="muted">Loading…</p>
  const shown = list.filter(t => !q || `${t.name} ${t.slug} ${t.owner?.name} ${t.owner?.phone}`.toLowerCase().includes(q.toLowerCase()))
  const count = s => list.filter(t => t.status === s).length
  return (
    <>
      <div className="page-head"><h1>Restaurants</h1><span className="sp" />
        <button className="primary" id="new-restaurant" onClick={() => { setAdding(true); setCreated(null) }}>+ New restaurant</button></div>
      {created && <Created c={created} onClose={() => setCreated(null)} />}
      {adding && !created && <NewRestaurant onCancel={() => setAdding(false)} onCreated={c => { setCreated(c); setAdding(false); load() }} />}
      <div className="kpis">
        <div className="kpi"><span>Restaurants</span><b>{list.length}</b></div>
        <div className="kpi"><span>On trial</span><b>{count('trial')}</b></div>
        <div className="kpi"><span>Active</span><b>{count('active')}</b></div>
        <div className="kpi"><span>Past due or suspended</span><b>{count('past_due') + count('suspended')}</b></div>
        <div className="kpi"><span>Orders today</span><b>{list.reduce((s, t) => s + t.orders_today, 0)}</b></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="search" type="search" placeholder="Search name, owner, phone…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search restaurants" />
      </div>
      <div className="card scroll" style={{ padding: 0 }}>
        {shown.length ? <table>
          <thead><tr><th>Restaurant</th><th>Owner</th><th>Status</th><th className="num">Fee</th><th>Trial ends</th><th>Last active</th><th className="num">Orders today</th><th>Printer helper</th><th>Open invoice</th><th></th></tr></thead>
          <tbody>{shown.map(t => (
            <tr key={t.id} className="click" onClick={() => go('restaurant/' + t.id)}>
              <td><b>{t.name}</b><div className="muted small">{t.slug}</div></td>
              <td>{t.owner?.name || '—'}<div className="muted small">{t.owner?.phone}</div></td>
              <td><StatusChip status={t.status} /></td>
              <td className="num">{rs(t.monthly_fee)}</td>
              <td>{t.status === 'trial' ? dateOf(t.trial_ends) : '—'}</td>
              <td>{ago(t.last_active)}</td>
              <td className="num">{t.orders_today}</td>
              <td>{t.bridge_online ? <span className="pill ok">Online</span> : <span className="pill">Offline</span>}</td>
              <td>{invoiceChip(t.open_invoice)}</td>
              <td><button onClick={e => { e.stopPropagation(); go('restaurant/' + t.id) }}>Open</button></td>
            </tr>))}</tbody>
        </table> : <div className="empty">{list.length ? 'No restaurant matches.' : 'No restaurants yet. Add the first one.'}</div>}
      </div>
    </>
  )
}

function NewRestaurant({ onCancel, onCreated }) {
  const [f, setF] = useState({ name: '', owner_name: '', owner_phone: '', monthly_fee: '', owner_password: '' })
  const [showPw, setShowPw] = useState(true)
  const genPw = () => setF(x => ({ ...x, owner_password: Array.from(crypto.getRandomValues(new Uint32Array(10)), n => 'abcdefghjkmnpqrstuvwxyz23456789'[n % 31]).join('') }))
  const [busy, setBusy] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const submit = run(async e => {
    e.preventDefault(); setBusy(true)
    const body = { ...f, monthly_fee: f.monthly_fee === '' ? 0 : +f.monthly_fee }
    try {
      const o = await api('/owners/lookup?phone=' + encodeURIComponent(f.owner_phone))
      if (o.exists) {
        if (await confirmBox(`This phone already belongs to ${o.name}. Add the restaurant to their account?`, { confirmLabel: 'Add restaurant' }))
          onCreated({ ...(await api('/tenants', { ...body, confirm_existing_owner: true })), owner_password: '' })
      } else onCreated({ ...(await api('/tenants', body)), owner_password: f.owner_password })
    } finally { setBusy(false) }
  })
  return (
    <form className="card" id="new-restaurant-form" onSubmit={submit}>
      <h3>New restaurant</h3>
      <div className="grid2">
        <label>Restaurant name<input id="nr-name" value={f.name} onChange={set('name')} autoFocus required /></label>
        <label>Owner name<input id="nr-owner" value={f.owner_name} onChange={set('owner_name')} required /></label>
        <label>Owner phone<input id="nr-phone" type="tel" inputMode="tel" placeholder="03001234567" value={f.owner_phone} onChange={set('owner_phone')} required /></label>
        <label>Monthly fee (Rs)<input id="nr-fee" type="number" min="0" step="1" value={f.monthly_fee} onChange={set('monthly_fee')} /></label>
        <label>Owner password (8+ characters)<input id="nr-password" type={showPw ? 'text' : 'password'} autoComplete="new-password" minLength={8} placeholder="Leave empty to send a welcome link instead" value={f.owner_password} onChange={set('owner_password')} /></label>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <button type="button" id="nr-genpw" onClick={genPw}>Make a password</button>
          <button type="button" onClick={() => setShowPw(v => !v)}>{showPw ? 'Hide' : 'Show'}</button>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" id="nr-create" disabled={busy}>{busy ? 'Creating…' : 'Create restaurant'}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function Created({ c, onClose }) {
  const link = c.welcome_link, message = c.message
  const copy = run(async () => {
    try { await navigator.clipboard.writeText(message); toast('Message copied. Paste it into WhatsApp') }
    catch { document.getElementById('welcome-message')?.select(); toast('Select the message and copy it', 'error') }
  })
  return (
    <div className="card" id="created-card">
      <h3>{c.tenant.name} is ready</h3>
      <p className="muted">{c.welcome_sent ? "The welcome message was sent from HazelPOS's WhatsApp." : "HazelPOS's WhatsApp isn't linked, so nothing was sent. Copy the message and send it to the owner yourself."}</p>
      {link && <p>Welcome link: <a href={link} id="welcome-link" target="_blank" rel="noreferrer">{link}</a></p>}
      {c.owner_password && <p>Owner signs in with phone <b>{c.tenant.owner?.phone}</b> and password <b id="owner-password">{c.owner_password}</b></p>}
      <p>Till PIN for the owner: <b id="till-pin">{c.till_pin}</b></p>
      <textarea id="welcome-message" readOnly rows={3} value={message} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" id="copy-message" onClick={copy}>Copy message</button>
        <button onClick={onClose}>Done</button>
      </div>
    </div>
  )
}
