import { useEffect, useState } from 'react'
import { api } from './lib'

export default function Login({ settings, onLogin }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)

  const press = d => { setErr(false); setPin(p => (p + d).slice(0, 6)) }
  const submit = async (p = pin) => {
    try { onLogin(await api('/login', { pin: p })) }
    catch { setErr(true); setPin('') }
  }
  useEffect(() => { if (pin.length === 4) submit(pin) }, [pin]) // auto-submit 4-digit PINs

  useEffect(() => {
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
        <div className="login-logo">{settings.logo}</div>
        <h1>{settings.name}</h1>
        <p className="muted">Enter your PIN</p>
        <div className={'pin-dots' + (err ? ' shake' : '')}>
          {[0, 1, 2, 3].map(i => <i key={i} className={pin.length > i ? 'on' : ''} />)}
        </div>
        {err && <div className="err">Wrong PIN, try again</div>}
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k => (
            <button key={k} id={'key-' + k} onClick={() => k === 'C' ? setPin('') : k === '⌫' ? setPin(p => p.slice(0, -1)) : press(k)}>{k}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
