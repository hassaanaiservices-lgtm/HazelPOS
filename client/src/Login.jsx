import { useEffect, useState } from 'react'
import { api } from './lib'
import { Icon } from './ui'

export default function Login({ settings, onLogin }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)

  const press = d => { setErr(false); setPin(p => (p + d).slice(0, 6)) }
  const submit = async (p = pin) => {
    try { onLogin(await api('/login', { pin: p })) }
    catch (e) { setErr(e.message); setPin('') }
  }
  useEffect(() => { if (pin.length === 4) submit(pin) }, [pin]) // auto-submit 4-digit PINs

  useEffect(() => {
    if (settings.demo) return
    const k = e => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin(p => p.slice(0, -1))
      else if (e.key === 'Enter') submit()
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand-mark login-logo" aria-hidden="true">{settings.logo}</div>
        <h1>{settings.name}</h1>
        {settings.demo ? <>
          <p className="muted">Free demo. Pick who you want to be:</p>
          <div className="demo-roles">
            {[['1234', 'Owner', 'Menu, stock, staff, reports and settings'], ['1111', 'Cashier', 'Take orders, tables, delivery, WhatsApp'], ['2222', 'Kitchen', 'The kitchen ticket board']].map(([p, role, what]) => (
              <button key={role} className={`ghost demo-role role-${role.toLowerCase()}`} onClick={() => submit(p)}><b>{role}</b><small className="muted">{what}</small></button>
            ))}
          </div>
          {err && <div className="err">{err}</div>}
        </> : <>
        <p className="muted">Enter your PIN</p>
        <div className={'pin-dots' + (err ? ' shake' : '')}>
          {[0, 1, 2, 3].map(i => <i key={i} className={pin.length > i ? 'on' : ''} />)}
        </div>
        {err && <div className="err">{err === 'Wrong PIN' ? 'Wrong PIN, try again' : err}</div>}
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k => (
            <button key={k} id={'key-' + k} aria-label={k === 'C' ? 'Clear' : k === '⌫' ? 'Delete' : k}
              onClick={() => k === 'C' ? setPin('') : k === '⌫' ? setPin(p => p.slice(0, -1)) : press(k)}>{k === '⌫' ? <Icon name="back" size={22} /> : k}</button>
          ))}
        </div>
        </>}
      </div>
    </div>
  )
}
