import { useEffect, useState } from 'react'
import { api } from './lib'
import { run } from './notify'

// Everything changed through this panel or by the daily job, with who did it (server: vendor_audit). Newest first.
const WHAT = {
  'tenant.create': d => `Created ${d.name}`,
  'tenant.update': d => `Changed ${d.slug}${d.status ? ` (status ${d.status})` : ''}`,
  'tenant.status': d => `${d.slug}: ${d.from} to ${d.to}${d.why ? ` (${d.why})` : ''}`,
  'tenant.resend-welcome': d => `Resent the welcome link to ${d.slug}`,
  'tenant.owner-reset': d => `Made a password reset link for ${d.slug}`,
  'invoices.generate': d => `Created ${d.created} invoice(s) for ${d.month}`,
  'invoice.paid': d => `Marked paid: ${d.tenant} ${d.month} (${d.method}${d.ref ? ', ' + d.ref : ''})`,
  'invoice.void': d => `Voided invoice ${d.id}`,
  'lifecycle.run': d => `Checked statuses (${d.changes} change(s))`,
  'wa.link': () => 'Started linking the HazelPOS WhatsApp number',
  'wa.logout': () => 'Unlinked the HazelPOS WhatsApp number',
}
export default function Activity() {
  const [list, setList] = useState(null)
  useEffect(() => { run(async () => setList(await api('/audit?limit=500')))() }, [])
  if (!list) return <p className="muted">Loading…</p>
  const describe = a => { let d = {}; try { d = JSON.parse(a.detail) } catch { /* not JSON */ } return WHAT[a.action]?.(d) || a.action }
  return (
    <>
      <div className="page-head"><h1>Activity</h1></div>
      <div className="card scroll" style={{ padding: 0 }}>
        {list.length ? <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{list.map(a => <tr key={a.id}><td style={{ whiteSpace: 'nowrap' }}>{a.at.replace('T', ' ').slice(0, 16)}</td><td>{a.who}</td><td>{describe(a)}</td>
            <td className="muted small" style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{a.action}{a.detail && a.detail !== '{}' ? ` ${a.detail}` : ''}</td></tr>)}</tbody>
        </table> : <div className="empty">Nothing yet.</div>}
      </div>
    </>
  )
}
