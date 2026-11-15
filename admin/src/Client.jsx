import { useEffect, useState } from 'react'
import { api, num, ago } from './lib'
import { run, toast, confirmBox, inputBox } from './notify'
import { Membership, Stage, WhatsApp, LastSeen } from './ui'
import { go } from './App'

// One client: membership (payments, suspend), their details, and their branches
export default function Client({ id }) {
  const [o, setO] = useState(null)
  const [missing, setMissing] = useState(false)
  const [code, setCode] = useState(null)
  const [edit, setEdit] = useState(null)
  const load = async () => { const all = await api('/owners'); const x = all.find(c => c.id === id); setO(x || null); setMissing(!x) }
  useEffect(() => { run(load)() }, [id])
  if (missing) return <div className="empty">Client not found. <a href="#/clients">Back to clients</a></div>
  if (!o) return <p className="muted">Loading…</p>

  const extend = months => run(async () => { const r = await api(`/owners/${id}/extend`, { months }); toast(`Paid until ${r.paid_until}`); load() })
  const setDate = run(async () => {
    const v = await inputBox('Paid until', { type: 'date', value: o.paid_until || '' })
    if (v) { await api(`/owners/${id}`, { paid_until: v }); toast(`Paid until ${v}`); load() }
  })
  const suspend = run(async () => {
    if (!o.suspended && !await confirmBox(`Suspend ${o.name || o.email}? New orders stop on their POS at its next check (within 3 hours), and their WhatsApp assistant stops right away.`, { confirmLabel: 'Suspend', danger: true })) return
    await api(`/owners/${id}`, { suspended: !o.suspended }); toast(o.suspended ? 'Resumed' : 'Suspended'); load()
  })
  const addBranch = run(async () => {
    const name = await inputBox('Branch name', { value: o.branches.length ? '' : 'Main branch', confirmLabel: 'Add branch' })
    if (name) { setCode(await api(`/owners/${id}/branches`, { name })); load() }
  })
  const saveDetails = run(async e => {
    e.preventDefault()
    await api(`/owners/${id}`, edit); setEdit(null); toast('Saved'); load()
  })

  return (
    <>
      <div className="crumb"><a href="#/clients">Clients</a> /</div>
      <div className="page-head"><h1>{o.name || o.email}</h1><Membership o={o} /><span className="sp" />
        <button onClick={() => setEdit({ name: o.name || '', phone: o.phone || '', plan: o.plan || '', notes: o.notes || '' })}>Edit details</button></div>

      {code && <div className="card"><h3>Activation code for {code.name}</h3>
        <div className="code">{code.code}</div>
        <p className="muted">Shown once. Prepare the branch's setup first, then send this code with the installer. It works one time.</p>
        <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={() => go('branch/' + code.id)}>Prepare this branch</button><button onClick={() => setCode(null)}>I've noted it</button></div></div>}

      <div className="grid2">
        <div className="card"><h3>Membership</h3>
          <p>Paid until <b>{o.paid_until || '—'}</b>{o.plan ? <span className="muted"> · {o.plan}</span> : null}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={extend(1)}>Paid: +1 month</button>
            <button onClick={extend(3)}>+3 months</button>
            <button onClick={setDate}>Set date</button>
            <button className={o.suspended ? '' : 'danger'} onClick={suspend}>{o.suspended ? 'Resume' : 'Suspend'}</button>
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>"+1 month" counts from the later of today and the current paid-until date. After it ends: 3 days of warnings on their POS, then new orders lock.</p>
        </div>
        <div className="card"><h3>Details</h3>
          <p>{o.email}</p>
          {o.phone && <p>{o.phone}</p>}
          {o.notes && <p className="muted" style={{ marginTop: 8 }}>{o.notes}</p>}
          <p className="muted small" style={{ marginTop: 8 }}>Client since {o.created_at?.slice(0, 10)}. The email and password log in to their own sales dashboard on the cloud.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Branches</h3><span className="sp" /><button className="primary" onClick={addBranch}>+ Add branch</button></div>
        {o.branches.length ? <div className="scroll"><table>
          <thead><tr><th>Branch</th><th>Stage</th><th>Setup</th><th>Last seen</th><th>Version</th><th>WhatsApp</th><th className="num">Errors 24 h</th><th className="num">AI replies</th><th></th></tr></thead>
          <tbody>{o.branches.map(b => (
            <tr key={b.id} className="click" onClick={() => go('branch/' + b.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && go('branch/' + b.id)}>
              <td><b>{b.name}</b><div className="muted small">{b.code_used_at ? `activated ${ago(b.code_used_at)}` : b.code_created_at ? 'code not used yet' : 'no code'}</div></td>
              <td><Stage b={b} /></td>
              <td className="muted small">{b.setup.menu} items · {b.setup.tables} tables · {b.setup.staff} staff</td>
              <td><LastSeen b={b} /></td><td>{b.health?.version || '—'}</td><td><WhatsApp h={b.health} /></td>
              <td className="num">{b.errors_24h ? <span className="pill bad">{b.errors_24h}</span> : '0'}</td><td className="num">{num(b.ai.calls)}</td>
              <td><button className="primary" onClick={e => { e.stopPropagation(); go('branch/' + b.id) }}>Set up menu, staff… →</button></td>
            </tr>))}</tbody></table></div>
          : <div className="empty">No branch yet. Add one to prepare its setup and get the activation code.</div>}
      </div>

      {edit && <div className="modal-bg" onClick={() => setEdit(null)}>
        <form className="modal" onClick={e => e.stopPropagation()} onSubmit={saveDetails}>
          <h2>Edit details</h2>
          <label>Restaurant name<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} autoFocus /></label>
          <label>Owner phone<input value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} inputMode="tel" /></label>
          <label>Plan<input value={edit.plan} onChange={e => setEdit({ ...edit, plan: e.target.value })} /></label>
          <label>Notes<textarea rows={3} value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></label>
          <div className="actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="primary">Save</button></div>
        </form>
      </div>}
    </>
  )
}
