import { useEffect, useState } from 'react'
import { lsGet, lsSet, lsDel } from './lib'

// Owner sign-in: phone + password, a code on a new device, then "Choose a restaurant" when the owner has more than one.
// Talks to /api/auth/* directly: these routes need no restaurant. onDone({ token, user, restaurant }) opens the app.
export const post = async (url, body) => {
  const r = await fetch('/api/auth' + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || 'Something went wrong. Try again')
  return data
}
// A random id this browser keeps, so the code is asked only once per device
export const deviceId = () => {
  let id = lsGet('hz_owner_device')
  if (!id) { id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()); lsSet('hz_owner_device', id) }
  return id
}

export default function SignIn({ onDone, onBack, start }) {
  const [step, setStep] = useState('login') // login | code | pick | forgot
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [owner, setOwner] = useState(null) // { owner_token, restaurants }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false) // forgot password: the link was asked for

  const go = fn => async e => {
    e?.preventDefault(); setErr(''); setBusy(true)
    try { await fn() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const enter = async (o, slug) => onDone(await post('/owner/enter', { owner_token: o.owner_token, slug }))
  const signedIn = async o => {
    setOwner(o)
    // Remembered: this browser skips the password next time (App's Sign out forgets it). Never on a till: staff use it too.
    if (lsGet('hz_device')) lsDel('hz_owner_token'); else lsSet('hz_owner_token', o.owner_token)
    if (o.restaurants.length === 1) await enter(o, o.restaurants[0].slug)
    else if (o.restaurants.length === 0) throw new Error('No restaurant is linked to this account yet. Please contact HazelPOS.')
    else setStep('pick')
  }
  const login = go(async () => {
    const r = await post('/owner/login', { phone, password, device_id: deviceId() })
    if (r.otp_required) { setStep('code'); return }
    await signedIn(r)
  })
  // Once: a password was just set from a link, or this browser still has the owner's token (no password needed)
  const [resuming, setResuming] = useState(() => !start && !lsGet('hz_device') && !!lsGet('hz_owner_token'))
  useEffect(() => {
    if (start) return void go(() => signedIn(start))()
    if (!resuming) return
    post('/owner/me', { owner_token: lsGet('hz_owner_token') }).then(signedIn)
      .catch(() => lsDel('hz_owner_token')).finally(() => setResuming(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const forgot = go(async () => { await post('/owner/forgot', { phone }); setSent(true) })
  const verify = go(async () => signedIn(await post('/owner/otp', { phone, code: code.trim(), device_id: deviceId() })))

  return (
    <div className="login">
      <div className="login-card">
        <h1>HazelPOS</h1>
        {resuming && <p className="muted" role="status">Signing you in…</p>}
        {step === 'login' && !resuming && <form className="login-form" onSubmit={login}>
          <p className="muted">Sign in to your restaurant</p>
          <label>Phone number<input id="owner-phone" type="tel" inputMode="tel" autoComplete="username" autoFocus value={phone} onChange={e => setPhone(e.target.value)} placeholder="03001234567" /></label>
          <label>Password<input id="owner-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="primary" id="owner-go" disabled={busy || !phone.trim() || !password}>Sign in</button>
          <button type="button" className="link" onClick={() => { setErr(''); setStep('forgot') }}>Forgot password?</button>
          {onBack && <button type="button" className="ghost" onClick={onBack}>Back to the till</button>}
        </form>}
        {step === 'forgot' && <form className="login-form" onSubmit={forgot}>
          <h2 style={{ margin: 0 }}>Forgot password?</h2>
          {sent
            ? <p id="forgot-done" role="status">If this number has a HazelPOS account, we've sent a link on WhatsApp.</p>
            : <>
              <p className="muted">Enter your phone number and we'll send a link on WhatsApp to set a new password.</p>
              <label>Phone number<input id="forgot-phone" type="tel" inputMode="tel" autoComplete="username" autoFocus value={phone} onChange={e => setPhone(e.target.value)} placeholder="03001234567" /></label>
              {err && <div className="err" role="alert">{err}</div>}
              <button className="primary" id="forgot-go" disabled={busy || !phone.trim()}>Send link</button>
            </>}
          <button type="button" className="ghost" onClick={() => { setErr(''); setSent(false); setStep('login') }}>Back to sign in</button>
        </form>}
        {step === 'code' && <form className="login-form" onSubmit={verify}>
          <p className="muted">Enter the 6-digit code we sent to {phone}</p>
          <div className="pin-field"><input id="owner-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} aria-label="Code" placeholder="Code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="primary" id="owner-code-go" disabled={busy || code.length !== 6}>Continue</button>
          <button type="button" className="ghost" onClick={() => { setErr(''); setCode(''); setStep('login') }}>Back</button>
        </form>}
        {step === 'pick' && <div className="login-form">
          <h2 style={{ margin: 0 }}>Choose a restaurant</h2>
          <div className="staff-list">
            {owner.restaurants.map(r => <button key={r.slug} className="ghost staff-btn" disabled={busy} onClick={go(() => enter(owner, r.slug))}>{r.name}</button>)}
          </div>
          {err && <div className="err" role="alert">{err}</div>}
        </div>}
      </div>
    </div>
  )
}
