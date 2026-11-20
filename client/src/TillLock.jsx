import { useEffect, useState } from 'react'
import { api, lsDel } from './lib'
import Login from './Login'

// A set-up till: the restaurant and till name, the staff names, then that person's PIN. The owner's "Owner sign-in" link
// below shows the sign-in screen without removing the device key.
export default function TillLock({ onLogin, onOwner }) {
  const [till, setTill] = useState(null)
  const [who, setWho] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    lsDel('pos_token'); lsDel('pos_user') // a locked till is signed out
    api('/till').then(setTill).catch(e => setErr(e.message))
  }, [])
  if (err) return <div className="login"><div className="login-card"><p className="err" role="alert">{err}</p><button className="ghost" onClick={() => window.location.reload()}>Try again</button></div></div>
  if (!till) return <div className="login" />
  if (who) return <Login settings={{ name: till.restaurant.name }} who={who.name} userId={who.id} onLogin={onLogin} onBack={() => setWho(null)} />
  return (
    <div className="login">
      <div className="login-card">
        <h1>{till.restaurant.name}</h1>
        <p className="muted">{till.device.name}</p>
        <p>Who is working?</p>
        <div className="staff-list">
          {till.staff.map(s => <button key={s.id} className="ghost staff-btn" onClick={() => setWho(s)}><b>{s.name}</b> <small className="muted">{s.role === 'admin' ? 'Owner' : s.role[0].toUpperCase() + s.role.slice(1)}</small></button>)}
        </div>
        <button className="link" onClick={onOwner}>Owner sign-in</button>
      </div>
    </div>
  )
}
