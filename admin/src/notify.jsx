import { useEffect, useState } from 'react'

// Toasts and small dialogs instead of alert/confirm/prompt. <Notifier /> is mounted once in App.
let host = null

export function toast(message, kind = 'success') { host?.toast({ id: Math.random(), message, kind }) }
export const toastError = message => toast(message, 'error')

// await confirmBox('Suspend?', { confirmLabel: 'Suspend', danger: true }) -> true / false
export function confirmBox(message, { title, confirmLabel = 'Yes', danger } = {}) {
  return new Promise(resolve => host ? host.dialog({ kind: 'confirm', message, title, confirmLabel, danger, resolve }) : resolve(false))
}
// await inputBox('Paid until', { type: 'date', value }) -> the value, or null when cancelled
export function inputBox(message, { title, type = 'text', value = '', confirmLabel = 'Save' } = {}) {
  return new Promise(resolve => host ? host.dialog({ kind: 'input', message, title, type, value, confirmLabel, resolve }) : resolve(null))
}

export function Notifier() {
  const [toasts, setToasts] = useState([])
  const [dlg, setDlg] = useState(null)
  const [value, setValue] = useState('')
  useEffect(() => {
    host = {
      toast: t => { setToasts(ts => [...ts, t]); setTimeout(() => setToasts(ts => ts.filter(x => x !== t)), t.kind === 'error' ? 6000 : 3000) },
      dialog: d => { setValue(d.value || ''); setDlg(d) },
    }
    return () => { host = null }
  }, [])
  const close = v => { dlg.resolve(v); setDlg(null) }
  useEffect(() => {
    if (!dlg) return
    const k = e => { if (e.key === 'Escape') close(dlg.kind === 'confirm' ? false : null) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  return (
    <>
      <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={'toast ' + t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>{t.message}</div>)}</div>
      {dlg && <div className="modal-bg" onClick={() => close(dlg.kind === 'confirm' ? false : null)}>
        <form className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
          onSubmit={e => { e.preventDefault(); close(dlg.kind === 'confirm' ? true : value) }}>
          {dlg.title && <h3>{dlg.title}</h3>}
          {dlg.kind === 'input'
            ? <label>{dlg.message}<input type={dlg.type} value={value} onChange={e => setValue(e.target.value)} autoFocus required /></label>
            : <p>{dlg.message}</p>}
          <div className="actions">
            <button type="button" onClick={() => close(dlg.kind === 'confirm' ? false : null)}>Cancel</button>
            <button className={dlg.danger ? 'danger' : 'primary'} autoFocus={dlg.kind === 'confirm'}>{dlg.confirmLabel}</button>
          </div>
        </form>
      </div>}
    </>
  )
}

// Wraps an event handler so errors show as a toast
export const run = fn => async (...a) => { try { await fn(...a) } catch (e) { toastError(e.message) } }
