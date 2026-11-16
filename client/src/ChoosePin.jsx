import { useState } from 'react'
import { api } from './lib'
import { Logo } from './ui'

// First login with a starting PIN (1234…): nothing else works until the owner chooses their own PIN.
// The server enforces it (code change_pin); this is the screen for it.
export default function ChoosePin({ user, settings, onDone, onLogout }) {
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const clean = v => v.replace(/[^a-z0-9]/gi, '').slice(0, 12)
  const submit = async e => {
    e.preventDefault()
    if (pin.length < 4) return setErr('At least 4 letters or numbers')
    if (pin !== again) return setErr('The two PINs are not the same')
    setBusy(true); setErr('')
    try { await api('/me/pin', { pin }); onDone() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className={'brand-mark login-logo' + (settings.logo_image ? ' has-img' : '')} aria-hidden="true"><Logo s={settings} /></div>
        <h1>Choose your own PIN</h1>
        <p className="muted" style={{ textAlign: 'center' }}>Hi {user.name}. You logged in with the PIN that comes with a new HazelPOS, which anyone could guess.
          Choose your own: 4 to 12 letters or numbers, for example your name and a number.</p>
        <div className="login-form">
          <div className="pin-field">
            <input autoFocus type={show ? 'text' : 'password'} value={pin} onChange={e => { setPin(clean(e.target.value)); setErr('') }} placeholder="New PIN" aria-label="New PIN"
              autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={12} />
            <button type="button" className="ghost sm" onClick={() => setShow(v => !v)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
          </div>
          <div className="pin-field">
            <input type={show ? 'text' : 'password'} value={again} onChange={e => { setAgain(clean(e.target.value)); setErr('') }} placeholder="Same PIN again" aria-label="Same PIN again"
              autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={12} enterKeyHint="go" />
          </div>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="primary" disabled={busy || pin.length < 4 || again.length < 4}>{busy ? 'Saving…' : 'Save my PIN'}</button>
          <button type="button" className="ghost" onClick={onLogout}>Sign out</button>
        </div>
      </form>
    </div>
  )
}
