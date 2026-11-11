import { useEffect, useState } from 'react'
import { api, rs, run, localDate } from './lib'
import { FormModal, Icon } from './ui'
import { confirmBox } from './notify'

// Restaurant jobs for the staff form. "Rider" matters: riders appear on the Delivery board.
const JOBS = ['Manager', 'Cashier', 'Waiter', 'Head chef', 'Cook', 'Pizza maker', 'Tandoor cook', 'Kitchen helper', 'Rider', 'Dishwasher', 'Cleaner', 'Security guard', 'Other']
// The saved job as one of the list (old entries like "rider" match "Rider"); anything else stays as it was
const jobOptions = current => {
  const hit = JOBS.find(j => j.toLowerCase() === String(current || '').trim().toLowerCase())
  return current && !hit ? [current, ...JOBS] : JOBS
}
const normJob = job => JOBS.find(j => j.toLowerCase() === String(job || '').trim().toLowerCase()) || job

// Monthly salary sheet: salary − advances − salary paid = still to pay. Every payment is also logged as an expense.
export default function Payroll({ notify }) {
  const [month, setMonth] = useState(localDate().slice(0, 7))
  const [staff, setStaff] = useState([])
  const [history, setHistory] = useState([])
  const [edit, setEdit] = useState(null)
  const [pay, setPay] = useState(null)
  const load = () => { api('/employees?month=' + month).then(setStaff); api('/payroll').then(setHistory) }
  useEffect(() => { load() }, [month])
  const save = run(async () => { await api('/employees', { ...edit, salary: +edit.salary || 0 }); setEdit(null); load(); notify('Saved') })
  const savePay = run(async () => { await api('/payroll', { ...pay, amount: +pay.amount, month }); setPay(null); load(); notify('Recorded (added to expenses)') })
  const undo = run(async p => { if (await confirmBox(`Delete this ${p.type} of ${rs(p.amount)}? The expense entry is removed too.`)) { await api(`/payroll/${p.id}/delete`, {}); load() } })
  const del = run(async e => { if (await confirmBox(`Delete ${e.name}?`)) { await api(`/employees/${e.id}/delete`, {}); load() } })
  const active = staff.filter(e => e.active)
  return (
    <>
      <div className="row-head">
        <button className="primary sm" onClick={() => setEdit({ name: '', phone: '', job: 'Waiter', salary: '', joined: localDate(), active: 1 })}>+ Add staff</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Month <input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>
        <span className="muted">Total salaries {rs(active.reduce((s, e) => s + e.salary, 0))}, still to pay <b style={{ color: 'var(--accent2)' }}>{rs(active.reduce((s, e) => s + Math.max(0, e.due), 0))}</b></span>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Job</th><th>Salary</th><th>Advances</th><th>Paid</th><th>Still to pay</th><th /></tr></thead>
          <tbody>
            {!staff.length && <tr><td colSpan={7} className="muted">Add your waiters, cooks and riders with their monthly salary</td></tr>}
            {staff.map(e => (
              <tr key={e.id} style={{ opacity: e.active ? 1 : 0.5 }}>
                <td><b>{e.name}</b>{e.phone && <div className="muted" style={{ fontSize: 12 }}>{e.phone}</div>}</td>
                <td>{e.job}</td><td>{rs(e.salary)}</td><td>{rs(e.advances)}</td><td>{rs(e.paid)}</td>
                <td><b style={{ color: e.due > 0 ? 'var(--accent2)' : 'var(--green)' }}>{rs(e.due)}</b></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {e.active ? <>
                    <button className="ghost sm" onClick={() => setPay({ employee_id: e.id, name: e.name, type: 'advance', amount: '', method: 'cash', date: localDate(), note: '' })}>Advance</button>{' '}
                    <button className="primary sm" onClick={() => setPay({ employee_id: e.id, name: e.name, type: 'salary', amount: Math.max(0, e.due), method: 'cash', date: localDate(), note: '' })}>Pay salary</button>{' '}
                  </> : null}
                  <button className="ghost sm" onClick={() => setEdit({ ...e, job: normJob(e.job) })}>Edit</button>{' '}
                  <button className="ghost sm danger" onClick={() => del(e)} aria-label="Remove"><Icon name="x" size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <h3>Payment history</h3>
        <table className="tbl">
          <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>For month</th><th>Amount</th><th>Note</th><th /></tr></thead>
          <tbody>
            {!history.length && <tr><td colSpan={7} className="muted">No payments yet</td></tr>}
            {history.map(p => (
              <tr key={p.id}>
                <td className="muted">{p.date}</td><td>{p.name}</td><td>{p.type === 'advance' ? 'Advance' : 'Salary'}</td>
                <td>{p.month}</td><td>{rs(p.amount)}</td><td className="muted">{p.note}</td>
                <td><button className="ghost sm danger" onClick={() => undo(p)} aria-label="Remove"><Icon name="x" size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <FormModal title={edit.id ? 'Edit staff' : 'New staff member'} value={edit} onChange={setEdit} onSave={save} onClose={() => setEdit(null)}
        fields={[['name', 'Name'], ['phone', 'Phone'], ['job', 'Job', 'select', jobOptions(edit.job)], ['salary', 'Monthly salary (Rs)', 'number'], ['joined', 'Joined', 'date'], ['active', 'Still working here', 'checkbox']]} />}
      {pay && <FormModal title={`${pay.type === 'advance' ? 'Advance to' : 'Pay salary to'} ${pay.name} · ${month}`} value={pay} onChange={setPay} onSave={savePay} onClose={() => setPay(null)}
        saveLabel={`Pay ${rs(pay.amount)}`}
        fields={[['amount', 'Amount (Rs)', 'number'], ['method', 'Paid by', 'select', [['cash', 'Cash'], ['bank', 'Bank transfer'], ['online', 'JazzCash / Easypaisa']]], ['date', 'Date', 'date'], ['note', 'Note']]} />}
    </>
  )
}
