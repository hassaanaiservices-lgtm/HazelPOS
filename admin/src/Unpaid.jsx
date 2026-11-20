import { useEffect, useState } from 'react'
import { api } from './lib'
import { run, toast, confirmBox, inputBox } from './notify'
import { PayDialog, StatusChip, rs } from './ui'
import { go } from './App'

// Open invoices that are past their due date, with Mark paid. "Create this month's invoices" makes one per paying restaurant.
export default function Unpaid() {
  const [list, setList] = useState(null)
  const [paying, setPaying] = useState(null)
  const load = () => api('/invoices?status=open').then(setList)
  useEffect(() => { run(load)() }, [])
  if (!list) return <p className="muted">Loading…</p>
  const today = new Date().toISOString().slice(0, 10)
  const late = list.filter(i => i.due_date < today)
  const generate = run(async () => {
    const month = await inputBox('Month to invoice', { type: 'month', value: today.slice(0, 7), confirmLabel: 'Create invoices' })
    if (!month) return
    const r = await api('/invoices/generate', { month })
    toast(r.created ? `${r.created} invoice${r.created === 1 ? '' : 's'} created and sent on WhatsApp` : 'Every restaurant already has an invoice for that month'); load()
  })
  const voidIt = run(async i => {
    if (!await confirmBox(`Void the ${i.month} invoice for ${i.tenant_name}?`, { confirmLabel: 'Void invoice', danger: true })) return
    await api(`/invoices/${i.id}/void`, {}); toast('Invoice voided'); load()
  })
  const runLifecycle = run(async () => {
    const r = await api('/lifecycle/run', {}); toast(r.changes.length ? `${r.changes.length} restaurant status change(s)` : 'No status changes'); load()
  })
  return (
    <>
      <div className="page-head"><h1>Unpaid</h1><span className="sp" />
        <button onClick={runLifecycle}>Check statuses now</button>
        <button className="primary" id="gen-invoices" onClick={generate}>Create invoices</button></div>
      <p className="muted" style={{ marginBottom: 12 }}>An invoice more than 7 days past its due date suspends the restaurant's new orders. Marking it paid switches them back on.</p>
      <div className="card scroll" style={{ padding: 0 }}>
        {late.length ? <table>
          <thead><tr><th>Restaurant</th><th>Month</th><th className="num">Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
          <tbody>{late.map(i => (
            <tr key={i.id}>
              <td><button className="link" style={{ padding: 0 }} onClick={() => go('restaurant/' + i.tenant_id)}><b>{i.tenant_name}</b></button></td>
              <td>{i.month}</td><td className="num">{rs(i.amount)}</td><td>{i.due_date}</td>
              <td><StatusChip status={i.tenant_status || 'past_due'} /></td>
              <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="primary" onClick={() => setPaying(i)}>Mark paid</button>
                <button className="danger" onClick={() => voidIt(i)}>Void</button></div></td>
            </tr>))}</tbody>
        </table> : <div className="empty">Nothing is overdue.</div>}
      </div>
      {list.length > late.length && <p className="muted small">{list.length - late.length} more open invoice(s) are not due yet.</p>}
      {paying && <PayDialog invoice={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load() }} />}
    </>
  )
}
