import { useEffect, useState } from 'react'
import { api, run } from './lib'
import { Icon } from './ui'
import { toastError } from './notify'

// Payment QR and PRA / FBR fiscal invoicing
export default function Integrations({ onChanged, notify }) {
  const [s, setS] = useState(null)
  const [secrets, setSecrets] = useState({})
  const [tokens, setTokens] = useState({ fiscal_token: '' })
  const [pending, setPending] = useState([])
  const load = () => {
    api('/settings').then(setS); api('/secrets').then(setSecrets)
    api('/fiscal/pending').then(setPending)
  }
  useEffect(() => { load() }, [])
  if (!s) return null
  const f = (k, l, props = {}) => <label>{l}<input value={s[k] ?? ''} onChange={e => setS({ ...s, [k]: e.target.value })} {...props} /></label>
  const save = run(async () => {
    await api('/settings', s)
    for (const name of ['fiscal_token']) if (tokens[name]) await api('/secrets', { name, secret: tokens[name] })
    setTokens({ fiscal_token: '' }); onChanged(); load(); notify('Saved')
  })
  const uploadQr = e => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 700 * 1024) return toastError('Image is too large — use a picture under 700 KB')
    const r = new FileReader(); r.onload = () => setS({ ...s, payment_qr: r.result }); r.readAsDataURL(file)
  }
  const token = (name, label) => (
    <label>{label} {secrets[name] && <span className="pill sm">saved</span>}
      <input type="password" placeholder={secrets[name] ? '•••••••• (leave blank to keep)' : 'Paste token'} value={tokens[name]}
        onChange={e => setTokens({ ...tokens, [name]: e.target.value })} /></label>
  )
  return (
    <div className="integrations">
      <div className="card settings-card">
        <h3>Payment QR (Raast, bank, JazzCash)</h3>
        <p className="muted" style={{ fontSize: 13 }}>Save the QR from your bank app as a picture and upload it. It is shown with the amount when the cashier picks
          "QR / Raast / JazzCash" at payment; the cashier confirms after seeing the payment. (A dynamic Raast QR that marks bills paid automatically needs a bank / 1LINK merchant agreement.)</p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {s.payment_qr ? <img src={s.payment_qr} alt="Payment QR" style={{ width: 140, height: 140, objectFit: 'contain', background: '#fff', borderRadius: 12, padding: 6 }} />
            : <div className="muted" style={{ width: 140, height: 140, border: '1px dashed var(--line)', borderRadius: 12, display: 'grid', placeItems: 'center' }}>No QR</div>}
          <div style={{ flex: 1, minWidth: 220 }}>
            <input type="file" accept="image/*" onChange={uploadQr} />
            {f('payment_qr_label', 'Shown under the QR', { placeholder: 'e.g. Meezan Bank · Pizza Venu Foods' })}
            {s.payment_qr && <button className="ghost sm danger" onClick={() => setS({ ...s, payment_qr: '' })}>Remove QR</button>}
          </div>
        </div>
      </div>

      <div className="card settings-card">
        <h3>Tax authority (PRA e-IMS, FBR)</h3>
        <p className="muted" style={{ fontSize: 13 }}>Each paid bill is reported and the fiscal invoice number + QR is printed on the receipt. If the internet is down the bill is kept
          and sent automatically later. Use the POS ID, address and token the authority gives you, and test on their sandbox first.</p>
        <label>Integration
          <select value={s.fiscal_mode || 'off'} onChange={e => setS({ ...s, fiscal_mode: e.target.value })}>
            <option value="off">Off</option><option value="pra">PRA e-IMS (Punjab)</option><option value="fbr">FBR POS integration</option>
          </select></label>
        {s.fiscal_mode !== 'off' && <>
          {f('fiscal_url', 'Invoice API address', { placeholder: 'from PRA / FBR (sandbox first)' })}
          <div className="two">{f('fiscal_pos_id', 'POS ID')}{token('fiscal_token', 'Access token')}</div>
          {f('fiscal_pct_code', 'PCT code for your items (if required)')}
          {pending.length > 0 && <p className="err">{pending.length} bill(s) waiting to be reported — last error: {pending.at(-1).fiscal_error}{' '}
            <button className="ghost sm" onClick={run(async () => { const r = await api('/fiscal/retry', {}); notify(`${r.sent} sent`); load() })}>Retry now</button></p>}
        </>}
      </div>
      <button className="primary" onClick={save}>Save integrations</button>
    </div>
  )
}
