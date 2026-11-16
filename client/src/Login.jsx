import { useEffect, useState } from 'react'
import { api } from './lib'
import { Icon, Logo } from './ui'

export default function Login({ settings, onLogin }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)

  const [abc, setAbc] = useState(() => { try { return localStorage.getItem('pos_login_kb') === 'abc' } catch { return false } }) // number pad or English keyboard
  const press = d => { setErr(false); setPin(p => (p + d).slice(0, 12)) }
  const submit = async (p = pin) => {
    if (p.length < 4) return
    try { onLogin(await api('/login', { pin: p })) }
    catch (e) { setErr(e.message); setPin('') }
  }
  const switchKb = () => setAbc(v => { try { localStorage.setItem('pos_login_kb', v ? '123' : 'abc') } catch { /* private window */ } return !v })

  // A real keyboard works too: letters, numbers, Backspace, Enter
  useEffect(() => {
    if (settings.demo) return
    const k = e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[a-z0-9]$/i.test(e.key)) press(e.key.toLowerCase())
      else if (e.key === 'Backspace') setPin(p => p.slice(0, -1))
      else if (e.key === 'Enter') submit()
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  const del = () => setPin(p => p.slice(0, -1))

  return (
    <div className="login">
      <div className="login-card">
        <div className={"brand-mark login-logo" + (settings.logo_image ? " has-img" : "")} aria-hidden="true"><Logo s={settings} /></div>
        <h1>{settings.name}</h1>
        {settings.demo ? <>
          <p className="muted">Free demo. Pick who you want to be:</p>
          <div className="demo-roles">
            {[['1234', 'Owner', 'Menu, stock, staff, reports and settings'], ['1111', 'Cashier', 'Take orders, tables, delivery, WhatsApp'], ['2222', 'Kitchen', 'The kitchen ticket board'], ['3333', 'Rider', 'Accept deliveries, live location, your earnings']].map(([p, role, what]) => (
              <button key={role} className={`ghost demo-role role-${role.toLowerCase()}`} onClick={() => submit(p)}><b>{role}</b><small className="muted">{what}</small></button>
            ))}
          </div>
          {err && <div className="err">{err}</div>}
        </> : <>
        <p className="muted">Enter your PIN</p>
        <div className={'pin-dots' + (err ? ' shake' : '')} aria-label={`${pin.length} characters typed`}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={pin.length > i ? 'on' : ''} />)}
        </div>
        {err && <div className="err">{err === 'Wrong PIN' ? 'Wrong PIN, try again' : err}</div>}
        {abc ? <div className="kb" aria-label="English keyboard">
          {['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row, r) => (
            <div key={row} className="kb-row">
              {[...row].map(k => <button key={k} id={'key-' + k} onClick={() => press(k)}>{k.toUpperCase()}</button>)}
              {r === 3 && <button className="kb-wide" aria-label="Delete" onClick={del}><Icon name="back" size={20} /></button>}
            </div>))}
        </div> : <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(k => (
            <button key={k} id={'key-' + k} aria-label={k === 'C' ? 'Clear' : k === '⌫' ? 'Delete' : k}
              onClick={() => k === 'C' ? setPin('') : k === '⌫' ? del() : press(k)}>{k === '⌫' ? <Icon name="back" size={22} /> : k}</button>
          ))}
        </div>}
        <div className="login-actions">
          <button className="ghost" id="kb-switch" onClick={switchKb}>{abc ? '123 Number pad' : 'ABC Keyboard'}</button>
          <button className="primary" id="login-go" disabled={pin.length < 4} onClick={() => submit()}>Log in</button>
        </div>
        </>}
      </div>
    </div>
  )
}
