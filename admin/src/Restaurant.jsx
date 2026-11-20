import { useEffect, useState } from 'react'
import { api, ago } from './lib'
import { run, toast, confirmBox, inputBox } from './notify'
import { StatusChip, STATUSES, PayDialog, rs, dateOf } from './ui'

// One restaurant: status and plan, Suspend / Activate / Cancel (each asks first), links for the owner, and its invoices.
export default function Restaurant({ id }) {
  const [t, setT] = useState(null)
  const [f, setF] = useState(null)
  const [paying, setPaying] = useState(null)
  const [backups, setBackups] = useState([])
  const [link, setLink] = useState(null) // { kind, link, sent }: the last link made, to paste by hand when WhatsApp isn't linked
  const load = () => api('/tenants/' + id).then(x => { setT(x); setF({ name: x.name, plan: x.plan || 'standard', monthly_fee: x.monthly_fee, status: x.status }) })
  useEffect(() => { run(load)() }, [id])
  useEffect(() => { api(`/tenants/${id}/backups`).then(setBackups).catch(() => setBackups([])) }, [id])
  if (!t || !f) return <p className="muted">Loading…</p>

  const restore = b => run(async () => {
    if (!await confirmBox(`Restore ${t.name} to the backup from ${b.name.replace(/-(\d\d)$/, ' at $1:00')} (UTC)? Everything saved since then in this restaurant is replaced. Other restaurants are not affected. The current data is kept on the server as a safety copy.`, { confirmLabel: 'Restore', danger: true })) return
    await api(`/tenants/${id}/restore`, { backup: b.name }); toast('Restored'); load()
  })
  const save = run(async e => { e?.preventDefault(); await api('/tenants/' + id, { ...f, monthly_fee: +f.monthly_fee }); toast('Saved'); load() })
  const setStatus = (status, verb, warn) => run(async () => {
    if (!await confirmBox(`${verb} ${t.name}? ${warn}`, { confirmLabel: verb, danger: status !== 'active' })) return
    await api('/tenants/' + id, { status }); toast(`${t.name}: ${verb.toLowerCase()} done`); load()
  })
  const sendLink = (path, kind) => run(async () => {
    const r = await api(`/tenants/${id}/${path}`, {})
    setLink({ kind, ...r }); toast(r.sent ? 'Sent on WhatsApp' : "WhatsApp isn't linked: copy the link below")
  })
  const setPassword = run(async () => {
    const pw = await inputBox(`New password for ${t.owner?.name || 'the owner'} (8+ characters). They sign in with their phone number and this password.`, { title: 'Set owner password', confirmLabel: 'Set password' })
    if (pw == null) return
    await api(`/tenants/${id}/owner-password`, { password: pw }); toast('Password set. Give it to the owner')
  })
  const newPin = run(async () => {
    if (!await confirmBox(`Make a new till PIN for ${t.owner?.name || 'the owner'}? The old PIN stops working.`, { title: 'New till PIN', confirmLabel: 'Make new PIN' })) return
    const r = await api(`/tenants/${id}/owner-pin`, {}); setLink({ kind: 'Owner till PIN', pin: r.pin })
  })
  const copyLink = run(async () => { await navigator.clipboard.writeText(link.link); toast('Link copied') })

  return (
    <>
      <div className="crumb"><a href="#/restaurants">Restaurants</a> / {t.name}</div>
      <div className="page-head"><h1>{t.name}</h1><StatusChip status={t.status} />{t.status === 'suspended' && <span className="muted small">{t.status_reason === 'manual' ? 'Suspended by HazelPOS' : 'Suspended: payment overdue'}</span>}<span className="sp" />
        {t.status !== 'suspended' && t.status !== 'cancelled' && <button className="danger" id="btn-suspend" onClick={setStatus('suspended', 'Suspend', 'New orders stop. Open bills can still be paid.')}>Suspend</button>}
        {t.status !== 'active' && t.status !== 'cancelled' && <button className="primary" id="btn-activate" onClick={setStatus('active', 'Activate', 'New orders work again.')}>Activate</button>}
        {t.status === 'cancelled' && <button className="primary" id="btn-activate" onClick={setStatus('active', 'Activate', 'The restaurant can sign in again.')}>Activate</button>}
        {t.status !== 'cancelled' && <button className="danger" id="btn-cancel" onClick={setStatus('cancelled', 'Cancel', 'The restaurant cannot sign in. Its data is kept.')}>Cancel</button>}
      </div>
      <div className="kpis">
        <div className="kpi"><span>Code</span><b style={{ fontSize: 'var(--fs-md)' }}>{t.slug}</b></div>
        <div className="kpi"><span>Orders today</span><b>{t.orders_today}</b></div>
        <div className="kpi"><span>Last active</span><b style={{ fontSize: 'var(--fs-md)' }}>{ago(t.last_active)}</b></div>
        <div className="kpi"><span>Printer helper</span><b style={{ fontSize: 'var(--fs-md)' }}>{t.bridge_online ? 'Online' : 'Offline'}</b></div>
        <div className="kpi"><span>Trial ends</span><b style={{ fontSize: 'var(--fs-md)' }}>{dateOf(t.trial_ends)}</b></div>
      </div>

      <form className="card" onSubmit={save}>
        <h3>Details</h3>
        <div className="grid2">
          <label>Restaurant name<input id="rd-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></label>
          <label>Plan<input id="rd-plan" value={f.plan} onChange={e => setF({ ...f, plan: e.target.value })} /></label>
          <label>Monthly fee (Rs)<input id="rd-fee" type="number" min="0" value={f.monthly_fee} onChange={e => setF({ ...f, monthly_fee: e.target.value })} /></label>
          <label>Status<select id="rd-status" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></label>
        </div>
        <p className="muted small" style={{ marginTop: 8 }}>Owner: {t.owner ? `${t.owner.name}, ${t.owner.phone}` : 'none'}</p>
        <div className="row" style={{ marginTop: 12 }}><button className="primary" id="rd-save">Save</button></div>
      </form>

      <div className="card">
        <h3>Owner sign-in</h3>
        <p className="muted" style={{ marginBottom: 12 }}>Sends a link from HazelPOS's WhatsApp number. A welcome link lasts 7 days, a reset link 1 hour, and each works once.</p>
        <div className="row">
          <button id="btn-resend" onClick={sendLink('resend-welcome', 'Welcome link')}>Resend welcome</button>
          <button className="primary" id="btn-setpw" onClick={setPassword}>Set password</button>
          <button id="btn-pin" onClick={newPin}>New till PIN</button>
          <button id="btn-reset" onClick={sendLink('owner-reset', 'Reset link')}>Send reset link</button>
        </div>
        {link?.pin && <div className="notice" style={{ marginTop: 12 }}><b>{link.kind}</b>: <b id="new-pin">{link.pin}</b> <span className="muted small">(shown once: give it to the owner)</span></div>}
        {link && !link.pin && <div className="notice" style={{ marginTop: 12 }}>
          <b>{link.kind}</b>: <a href={link.link} target="_blank" rel="noreferrer" id="made-link">{link.link}</a>
          <div className="row" style={{ marginTop: 8 }}><button onClick={copyLink}>Copy link</button></div></div>}
      </div>

      <div className="card">
        <h3>Backups</h3>
        <p className="muted" style={{ marginBottom: 12 }}>Saved every hour. Restoring brings back only this restaurant; the server keeps running.</p>
        {backups.length ? backups.slice(0, 12).map(b => (
          <div key={b.name} className="row" style={{ marginBottom: 8 }}>
            <span>{b.name.replace(/-(\d\d)$/, ' at $1:00')} UTC</span><span className="muted small">{Math.round(b.size / 1024)} KB</span><span className="sp" />
            <button className="danger" onClick={restore(b)}>Restore</button>
          </div>)) : <p className="muted">No backups yet. The first one is made an hour after the server starts.</p>}
      </div>

      <div className="card scroll" style={{ padding: 0 }}>
        <div className="card-head" style={{ padding: '16px 16px 0' }}><h3>Invoices</h3></div>
        {t.invoices.length ? <table>
          <thead><tr><th>Month</th><th className="num">Amount</th><th>Due</th><th>Status</th><th>Paid</th><th></th></tr></thead>
          <tbody>{t.invoices.map(i => (
            <tr key={i.id}>
              <td>{i.month}</td><td className="num">{rs(i.amount)}</td><td>{i.due_date}</td>
              <td><span className={'pill ' + (i.status === 'paid' ? 'ok' : i.status === 'void' ? '' : 'warn')}>{i.status}</span></td>
              <td>{i.status === 'paid' ? `${dateOf(i.paid_at)} · ${i.method}${i.ref ? ' · ' + i.ref : ''} · by ${i.marked_by}` : '—'}</td>
              <td>{i.status === 'open' && <button className="primary" onClick={() => setPaying({ ...i, tenant_name: t.name })}>Mark paid</button>}</td>
            </tr>))}</tbody>
        </table> : <div className="empty">No invoices yet. Create them from the Unpaid page.</div>}
      </div>
      {paying && <PayDialog invoice={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load() }} />}
    </>
  )
}
