import { useState } from 'react'
import { api } from './lib'
import { run, toast } from './notify'

// Shared pieces: status chips (spans, never buttons), the Mark paid dialog, money and date formats.
const STATUS = { trial: ['info', 'Trial'], active: ['ok', 'Active'], past_due: ['warn', 'Past due'], suspended: ['bad', 'Suspended'], cancelled: ['', 'Cancelled'] }
export const StatusChip = ({ status }) => { const [k, l] = STATUS[status] || ['', status]; return <span className={'pill ' + k} data-status={status}>{l}</span> }
export const rs = n => 'Rs ' + Math.round(+n || 0).toLocaleString('en-US')
export const dateOf = iso => iso ? String(iso).slice(0, 10) : '—'
export const STATUSES = Object.keys(STATUS)

export const invoiceChip = inv => inv
  ? <span className={'pill ' + (inv.due_date < new Date().toISOString().slice(0, 10) ? 'bad' : 'warn')} title={`${inv.month}, due ${inv.due_date}`}>{rs(inv.amount)} due {inv.due_date}</span>
  : <span className="muted">None open</span>

// "Mark paid": how it was paid and the reference (receipt number). onDone runs after the server accepted it.
export function PayDialog({ invoice, onClose, onDone }) {
  const [method, setMethod] = useState('JazzCash')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = run(async e => {
    e.preventDefault(); setBusy(true)
    try { await api(`/invoices/${invoice.id}/paid`, { method, ref }); toast(`${invoice.tenant_name || 'Invoice'} marked paid`); onDone() }
    finally { setBusy(false) }
  })
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="modal" role="dialog" aria-modal="true" aria-label="Mark paid" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h3>Mark paid</h3>
        <p className="muted">{invoice.tenant_name ? `${invoice.tenant_name}: ` : ''}{invoice.month}, {rs(invoice.amount)}</p>
        <label>Paid by<select id="pay-method" value={method} onChange={e => setMethod(e.target.value)}>
          {['JazzCash', 'Easypaisa', 'Bank transfer', 'Cash', 'Other'].map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Reference (receipt or transaction number)<input id="pay-ref" value={ref} onChange={e => setRef(e.target.value)} autoFocus /></label>
        <div className="actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" id="pay-save" disabled={busy}>Mark paid</button></div>
      </form>
    </div>
  )
}
