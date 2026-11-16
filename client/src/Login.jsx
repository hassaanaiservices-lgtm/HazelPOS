import { useState } from 'react'
import { api } from './lib'
import { Logo } from './ui'

export default function Login({ settings, onLogin }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)

  const [show, setShow] = useState(false)
  // 4 to 12 letters or numbers, typed on the device's own keyboard (phone or PC)
  const type = v => { setErr(false); setPin(v.replace(/[^a-z0-9]/gi, '').slice(0, 12)) }
  const submit = async e => {
    e?.preventDefault()
    if (pin.length < 4) return
    try { onLogin(await api('/login', { pin })) }
    catch (x) { setErr(x.message); setPin('') }
  }
  const demoLogin = async p => { try { onLogin(await api('/login', { pin: p })) } catch (x) { setErr(x.message) } }

  return (
    <div className="login">
      <div className="login-card">
        <div className={"brand-mark login-logo" + (settings.logo_image ? " has-img" : "")} aria-hidden="true"><Logo s={settings} /></div>
        <h1>{settings.name}</h1>
        {settings.demo ? <>
          <p className="muted">Free demo. Pick who you want to be:</p>
          <div className="demo-roles">
            {[['1234', 'Owner', 'Menu, stock, staff, reports and settings'], ['1111', 'Cashier', 'Take orders, tables, delivery, WhatsApp'], ['2222', 'Kitchen', 'The kitchen ticket board'], ['3333', 'Rider', 'Accept deliveries, live location, your earnings']].map(([p, role, what]) => (
              <button key={role} className={`ghost demo-role role-${role.toLowerCase()}`} onClick={() => demoLogin(p)}><b>{role}</b><small className="muted">{what}</small></button>
            ))}
          </div>
          {err && <div className="err">{err}</div>}
        </> : <>
        <p className="muted">Enter your PIN</p>
        <form className="login-form" onSubmit={submit}>
          <div className={'pin-field' + (err ? ' shake' : '')}>
            <input id="pin" autoFocus type={show ? 'text' : 'password'} value={pin} onChange={e => type(e.target.value)} aria-label="PIN" placeholder="PIN"
              autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={12} enterKeyHint="go" />
            <button type="button" className="ghost sm" onClick={() => setShow(v => !v)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
          </div>
          {err && <div className="err" role="alert">{err === 'Wrong PIN' ? 'Wrong PIN, try again' : err}</div>}
          <button className="primary" id="login-go" disabled={pin.length < 4}>Log in</button>
        </form>
        </>}
      </div>
    </div>
  )
}
