import { useState } from 'react'
import { api } from './lib'
import { toast } from './notify'
import { Logo } from './ui'

// First run of the installed app: the restaurant types the activation code you gave them (HZ-XXXX-XXXX). The POS then
// downloads its setup (menu, tables, staff…) from HazelPOS Cloud. Until then nobody can log in.
// (server/licence.js; only when the server runs with HAZEL_LICENCE=1)
export default function Activate({ settings, onDone }) {
  const builtIn = settings.licence?.default_url || ''
  const [otherUrl, setOtherUrl] = useState(!builtIn)
  const [url, setUrl] = useState(builtIn || 'https://')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await api('/licence/activate', { url: otherUrl ? url.trim() : '', code: code.trim() })
      if (r.setup_error) toast(`Activated, but the setup didn't load: ${r.setup_error}`, 'error')
      else if (r.setup_applied_at) toast('Activated. Your menu and setup are ready')
      else toast('Activated')
      onDone()
    } catch (e2) { setErr(e2.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form className="login-card activate-card" onSubmit={submit}>
        <div className={"brand-mark login-logo" + (settings.logo_image ? " has-img" : "")} aria-hidden="true"><Logo s={settings} /></div>
        <h1>Activate HazelPOS</h1>
        <p className="muted">Type the activation code HazelPOS gave you. This PC needs internet for this step only.</p>
        <label>Activation code
          <input className="activate-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="HZ-XXXX-XXXX"
            autoComplete="off" spellCheck="false" autoFocus required /></label>
        {otherUrl
          ? <label>Cloud address<input value={url} onChange={e => setUrl(e.target.value)} inputMode="url" autoComplete="off" required /></label>
          : <button type="button" className="ghost sm" onClick={() => setOtherUrl(true)}>Use a different cloud address</button>}
        {err && <div className="err" role="alert">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Activating…' : 'Activate'}</button>
      </form>
    </div>
  )
}
