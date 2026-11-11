// In-app notifications: toasts (success / error / info) and the confirm and prompt dialogs that replace the
// browser's own alert(), confirm() and prompt() boxes. Call these from anywhere; <Notifier /> (mounted once in
// main.jsx) draws them.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './ui'

let host = null // set while <Notifier /> is mounted
let nextId = 1

// toast('Saved') · toast('Printer offline', 'error') · toast('Order moved', 'info')
export function toast(message, kind = 'success') {
  if (!message) return
  if (!host) return kind === 'error' ? window.alert(message) : undefined
  host.addToast({ id: nextId++, message: String(message), kind })
}
export const toastError = message => toast(message, 'error')

// await confirmBox('Delete Fries?') -> true / false. Starts with Delete / Cancel / Remove / Unlink / Stop -> a red button.
export function confirmBox(message, { title, confirmLabel, cancelLabel = 'Keep it', danger } = {}) {
  const verb = /^(Delete|Cancel|Remove|Unlink|Stop|Refund)\b/.exec(message)?.[1]
  const isDanger = danger ?? !!verb
  if (!host) return Promise.resolve(window.confirm(message))
  return new Promise(resolve => host.openDialog({
    type: 'confirm', message, title, resolve, danger: isDanger,
    confirmLabel: confirmLabel || (verb === 'Cancel' ? 'Cancel order' : verb) || 'Confirm', cancelLabel: isDanger ? cancelLabel : 'Cancel',
  }))
}

// await promptBox('Reason?', { defaultValue }) -> the text, or null when cancelled
export function promptBox(message, { title, defaultValue = '', placeholder = '', confirmLabel = 'OK', multiline = false, required = false } = {}) {
  if (!host) return Promise.resolve(window.prompt(message, defaultValue))
  return new Promise(resolve => host.openDialog({ type: 'prompt', message, title, defaultValue, placeholder, confirmLabel, multiline, required, resolve }))
}

const ICON = { success: 'check', error: 'x', info: 'bell' }
const LIFE = { success: 2600, info: 3500, error: 6500 }
const EXIT_MS = 180

export function Notifier() {
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)
  const [closing, setClosing] = useState(false)
  const timers = useRef({})

  const dismiss = id => {
    clearTimeout(timers.current[id])
    setToasts(list => list.map(t => t.id === id ? { ...t, leaving: true } : t))
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), EXIT_MS)
  }

  useEffect(() => {
    host = {
      addToast: t => {
        setToasts(list => {
          const same = list.find(x => x.message === t.message && !x.leaving) // the same message twice: refresh, don't stack
          if (same) { clearTimeout(timers.current[same.id]); timers.current[same.id] = setTimeout(() => dismiss(same.id), LIFE[same.kind]); return list }
          timers.current[t.id] = setTimeout(() => dismiss(t.id), LIFE[t.kind] || 3000)
          return [...list, t].slice(-4)
        })
      },
      openDialog: d => { setClosing(false); setDialog(d) },
    }
    return () => { host = null }
  }, [])

  const close = value => {
    if (!dialog) return
    const d = dialog
    setClosing(true)
    setTimeout(() => { setDialog(null); setClosing(false); d.resolve(value) }, EXIT_MS)
  }

  return (
    <>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <button key={t.id} className={`toast-item ${t.kind}${t.leaving ? ' leaving' : ''}`} onClick={() => dismiss(t.id)} title="Dismiss">
            <span className="toast-icon"><Icon name={ICON[t.kind] || 'bell'} size={16} /></span>
            <span className="toast-text">{t.message}</span>
          </button>
        ))}
      </div>
      {dialog && <Dialog d={dialog} closing={closing} onClose={close} />}
    </>
  )
}

function Dialog({ d, closing, onClose }) {
  const [text, setText] = useState(d.defaultValue || '')
  const field = useRef(null), ok = useRef(null)
  const cancelValue = d.type === 'prompt' ? null : false
  const confirm = () => { if (d.type === 'prompt') { if (d.required && !text.trim()) return field.current?.focus(); onClose(text) } else onClose(true) }
  useEffect(() => { (d.type === 'prompt' ? field : ok).current?.focus() }, [d])
  useEffect(() => {
    const key = e => { if (e.key === 'Escape') onClose(cancelValue) }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  })
  return (
    <div className={'modal-bg dialog-bg' + (closing ? ' closing' : '')} onMouseDown={e => e.target === e.currentTarget && onClose(cancelValue)}>
      <div className="modal dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-msg">
        {d.title && <h2>{d.title}</h2>}
        <p id="dialog-msg" className="dialog-msg">{d.message}</p>
        {d.type === 'prompt' && (d.multiline
          ? <textarea ref={field} rows={3} value={text} placeholder={d.placeholder} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirm() }} />
          : <input ref={field} value={text} placeholder={d.placeholder} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && confirm()} />)}
        <div className="actions">
          <button className="ghost" onClick={() => onClose(cancelValue)}>{d.cancelLabel || 'Cancel'}</button>
          <button ref={ok} className={d.danger ? 'primary danger-btn' : 'primary'} onClick={confirm}>{d.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
