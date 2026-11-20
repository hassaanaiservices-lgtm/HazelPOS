import { useEffect, useState } from 'react'
import { post, deviceId } from './SignIn'

// /welcome/<token> and /reset/<token>: the owner sets a password from the WhatsApp link, then continues into the normal
// sign-in flow (restaurant picker or the app). The link works once; GET asks the server whether it is still good.
export default function OwnerLink({ token, onDone }) {
  const [info, setInfo] = useState(null) // { purpose, name, phone_masked }
  const [gone, setGone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    fetch('/api/auth/owner/link/' + token).then(async r => {
      const d = await r.json().catch(() => ({}))
      r.ok && d.valid !== false ? setInfo(d) : setGone(d.reason || d.error || 'This link has expired or was already used.')
    }).catch(() => setGone('Could not reach HazelPOS. Check your internet and reload.'))
  }, [token])
  const submit = async e => {
    e.preventDefault(); setErr('')
    if (password.length < 8) return setErr('The password needs at least 8 characters')
    if (password !== confirm) return setErr("The two passwords don't match")
    setBusy(true)
    try { onDone(await post('/owner/link/' + token, { password, device_id: deviceId() })) }
    catch (x) { setErr(x.message); setBusy(false) }
  }
  return (
    <div className="login">
      <div className="login-card">
        <h1>HazelPOS</h1>
        {gone && <div className="login-form">
          <p id="link-gone" role="alert">{gone}</p>
          <a className="ghost" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} href="/" onClick={() => history.replaceState(null, '', '/')}>Go to sign in</a>
        </div>}
        {info && <form className="login-form" onSubmit={submit}>
          <h2 style={{ margin: 0 }}>Set your password</h2>
          <p className="muted">{info.purpose === 'reset' ? 'Choose a new password' : `Welcome, ${info.name}. Choose a password`} for {info.phone_masked}.</p>
          <label>Password<input id="link-password" type={show ? 'text' : 'password'} autoComplete="new-password" autoFocus value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Confirm password<input id="link-confirm" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
          <button type="button" className="link" aria-pressed={show} onClick={() => setShow(v => !v)}>{show ? 'Hide password' : 'Show password'}</button>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="primary" id="link-go" disabled={busy || !password || !confirm}>Save password and continue</button>
        </form>}
        {!info && !gone && <p className="muted">One moment…</p>}
      </div>
    </div>
  )
}
