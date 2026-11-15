import { useState } from 'react'
import { api } from './lib'

// First run of the installed app: the restaurant types the HazelPOS Cloud address and the branch key you gave them.
// Until then nobody can log in. (server/licence.js; only when the server runs with HAZEL_LICENCE=1)
export default function Activate({ settings, onDone }) {
  const [url, setUrl] = useState('https://')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await api('/licence/activate', { url: url.trim(), key: key.trim() }); onDone() }
    catch (e2) { setErr(e2.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form className="login-card activate-card" onSubmit={submit}>
        <div className="brand-mark login-logo" aria-hidden="true">{settings.logo}</div>
        <h1>Activate HazelPOS</h1>
        <p className="muted">Enter the cloud address and branch key from HazelPOS. This PC needs internet for this step only.</p>
        <label>Cloud address<input value={url} onChange={e => setUrl(e.target.value)} inputMode="url" autoComplete="off" required /></label>
        <label>Branch key<input value={key} onChange={e => setKey(e.target.value)} placeholder="hz_…" autoComplete="off" spellCheck="false" required /></label>
        {err && <div className="err">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? 'Checking…' : 'Activate'}</button>
      </form>
    </div>
  )
}
