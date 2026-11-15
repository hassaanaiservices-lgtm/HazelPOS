import { useEffect, useState } from 'react'
import { api } from './lib'
import { run, toast, confirmBox } from './notify'
import { Membership, Service } from './ui'
import { go } from './App'

// Clients who haven't paid, are stopped or cancelled. Per client: mark paid, give more days before the bot / POS
// stop, stop them now, or cancel the membership.
export default function Unpaid() {
  const [owners, setOwners] = useState(null)
  const load = () => api('/owners').then(setOwners)
  useEffect(() => { run(load)() }, [])
  if (!owners) return <p className="muted">Loading…</p>

  const lockedUse = o => o.branches.reduce((s, b) => s + (b.locked_orders || 0), 0) // orders made while the POS should have been locked
  const list = owners.filter(o => o.days_overdue > 0 || o.suspended || o.cancelled || !o.paid_until || lockedUse(o))
    .sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0))
  const act = fn => run(async o => { await fn(o); load() })
  const paid = act(async o => { const r = await api(`/owners/${o.id}/extend`, { months: 1 }); toast(`${o.name || o.email}: paid until ${r.paid_until}`) })
  const moreDays = act(async o => {
    await api(`/owners/${o.id}`, { wa_grace_days: o.wa_grace_days + 7, pos_grace_days: o.pos_grace_days + 7 })
    toast(`${o.name || o.email}: 7 more days for the bot and the POS`)
  })
  const stop = act(async o => {
    if (!o.suspended && !await confirmBox(`Stop ${o.name || o.email} now? Their WhatsApp bot stops right away and new orders stop at the POS's next check (within 3 hours).`, { confirmLabel: 'Stop now', danger: true })) return
    await api(`/owners/${o.id}`, { suspended: !o.suspended }); toast(o.suspended ? 'Resumed' : 'Stopped')
  })
  const cancel = act(async o => {
    if (!o.cancelled && !await confirmBox(`Cancel ${o.name || o.email}'s membership?`, { confirmLabel: 'Cancel membership', danger: true })) return
    await api(`/owners/${o.id}`, { cancelled: !o.cancelled }); toast(o.cancelled ? 'Reactivated' : 'Membership cancelled')
  })

  return (
    <>
      <div className="page-head"><h1>Unpaid</h1></div>
      <p className="muted" style={{ marginBottom: 16 }}>
        By default an unpaid client's WhatsApp bot stops 3 days after their paid-until date, and their POS (new orders) after 7 days.
        Give a client more days, stop them sooner, or cancel. No internet at the restaurant never stops anything.
      </p>
      <div className="card scroll" style={{ padding: 0 }}>
        {list.length ? <table>
          <thead><tr><th>Client</th><th>Status</th><th>Paid until</th><th>WhatsApp bot</th><th>POS</th><th></th></tr></thead>
          <tbody>{list.map(o => (
            <tr key={o.id}>
              <td><button className="link" style={{ padding: 0, minHeight: 0 }} onClick={() => go('client/' + o.id)}><b>{o.name || o.email}</b></button>
                <div className="muted small">{o.phone || o.email}{o.plan ? ` · ${o.plan}` : ''}</div></td>
              <td><Membership o={o} />{lockedUse(o) > 0 && <div className="err small" title="These orders reached the cloud although this POS should have been locked: check that PC">⚠ {lockedUse(o)} order(s) made while locked</div>}</td>
              <td>{o.paid_until || '—'}</td>
              <td><Service on={o.ai_active} until={o.ai_until} stopped={o.suspended || o.cancelled} /></td>
              <td><Service on={o.pos_active} until={o.pos_until} stopped={o.suspended || o.cancelled} /></td>
              <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="primary" onClick={() => paid(o)}>Paid: +1 month</button>
                {!o.suspended && !o.cancelled && o.paid_until && <button onClick={() => moreDays(o)} title="Bot and POS keep working 7 more days">+7 days</button>}
                <button className={o.suspended ? '' : 'danger'} onClick={() => stop(o)}>{o.suspended ? 'Resume' : 'Stop now'}</button>
                <button className={o.cancelled ? '' : 'danger'} onClick={() => cancel(o)}>{o.cancelled ? 'Reactivate' : 'Cancel'}</button>
              </div></td>
            </tr>))}</tbody>
        </table> : <div className="empty">Everyone has paid. 👍</div>}
      </div>
    </>
  )
}
