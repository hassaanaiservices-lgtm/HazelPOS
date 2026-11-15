import { useEffect, useState } from 'react'
import { api, ago } from './lib'
import { run, toast, confirmBox, inputBox } from './notify'

// Team members: each has their own login, and everything they change shows in Activity under their name.
// Owner = everything, including this page. Staff = everything except managing the team.
export default function Team({ me }) {
  const [list, setList] = useState(null)
  const [add, setAdd] = useState(null)
  const load = () => api('/team').then(setList)
  useEffect(() => { run(load)() }, [])
  if (!list) return <p className="muted">Loading…</p>

  const save = run(async e => {
    e.preventDefault()
    await api('/team', add); toast(`${add.name || add.email} added. Send them the address of this app, their email and password.`); setAdd(null); load()
  })
  const update = run(async (u, patch, msg) => { await api(`/team/${u.id}`, patch); toast(msg); load() })
  const reset = run(async u => {
    const p = await inputBox(`New password for ${u.name} (10+ characters). They are signed out everywhere.`, { title: 'Reset password', confirmLabel: 'Set password' })
    if (p) update(u, { password: p }, 'Password changed')
  })
  const toggle = run(async u => {
    if (u.active && !await confirmBox(`Switch off ${u.name}'s login? They are signed out straight away.`, { confirmLabel: 'Switch off', danger: true })) return
    update(u, { active: !u.active }, u.active ? 'Login switched off' : 'Login switched on')
  })

  return (
    <>
      <div className="page-head"><h1>Team</h1><span className="sp" /><button className="primary" onClick={() => setAdd({ name: '', email: '', password: '', role: 'staff' })}>+ Add team member</button></div>
      <p className="muted" style={{ marginBottom: 16 }}>Each person logs in with their own email and password; Activity shows who did what. Owner: everything, including this page. Staff: everything except the team. The main owner password (ADMIN_PASSWORD) always works too.</p>
      <div className="card scroll" style={{ padding: 0 }}>
        {list.length ? <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last login</th><th></th></tr></thead>
          <tbody>{list.map(u => <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
            <td><b>{u.name}</b>{!u.active && <span className="pill bad" style={{ marginLeft: 8 }}>Off</span>}{me?.id === u.id && <span className="pill info" style={{ marginLeft: 8 }}>You</span>}</td>
            <td>{u.email}</td>
            <td><select value={u.role} onChange={e => update(u, { role: e.target.value }, 'Role changed')} aria-label={`Role of ${u.name}`} style={{ width: 'auto' }}>
              <option value="staff">Staff</option><option value="owner">Owner</option></select></td>
            <td>{ago(u.last_login)}</td>
            <td><div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={() => reset(u)}>Reset password</button>
              <button className={u.active ? 'danger' : ''} onClick={() => toggle(u)}>{u.active ? 'Switch off' : 'Switch on'}</button></div></td>
          </tr>)}</tbody>
        </table> : <div className="empty">No team members yet. You log in with the main owner password.</div>}
      </div>
      {add && <div className="modal-bg" onClick={() => setAdd(null)}>
        <form className="modal" onClick={e => e.stopPropagation()} onSubmit={save}>
          <h2>Add team member</h2>
          <label>Name<input value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} required autoFocus /></label>
          <label>Email (their login)<input type="email" value={add.email} onChange={e => setAdd({ ...add, email: e.target.value })} required /></label>
          <label>Password (10+ characters)<input value={add.password} onChange={e => setAdd({ ...add, password: e.target.value })} minLength={10} required /></label>
          <label>Role<select value={add.role} onChange={e => setAdd({ ...add, role: e.target.value })}><option value="staff">Staff: everything except the team</option><option value="owner">Owner: everything</option></select></label>
          <div className="actions"><button type="button" onClick={() => setAdd(null)}>Cancel</button><button className="primary">Add</button></div>
        </form>
      </div>}
    </>
  )
}
