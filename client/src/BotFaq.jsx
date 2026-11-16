import { useEffect, useState } from 'react'
import { api, run } from './lib'
import { FormModal } from './ui'
import { confirmBox } from './notify'

// Settings → WhatsApp bot → Questions and answers. What the assistant may tell customers about this restaurant
// (opening hours, delivery, halal, parking…). Prices, the menu and delivery areas come from the POS by themselves.
// Questions with an empty answer are not sent to the assistant.
export default function BotFaq({ notify }) {
  const [d, setD] = useState(null)
  const [edit, setEdit] = useState(null)
  const load = () => api('/faq').then(setD)
  useEffect(() => { run(load)() }, [])
  if (!d) return null
  const save = run(async () => { await api('/faq', { id: edit.id, question: edit.question, answer: edit.answer }); setEdit(null); notify('Saved. The assistant uses it from the next message.'); load() })
  const del = run(async f => { if (await confirmBox(`Delete "${f.question}"?`, { confirmLabel: 'Delete', danger: true })) { await api(`/faq/${f.id}/delete`, {}); load() } })
  const starter = run(async () => { const r = await api('/faq/starter', {}); notify(r.added ? `${r.added} usual questions added. Write the answers.` : 'You already have them'); load() })
  const todo = d.items.filter(f => !f.answer.trim()).length
  return (
    <div className="card settings-card" style={{ marginTop: 16 }}>
      <h3>Questions and answers</h3>
      <p className="muted" style={{ fontSize: 13 }}>What customers ask on WhatsApp that only you know: opening hours, delivery time, halal, parking, party orders.
        The assistant answers from these. Prices, the menu and delivery areas come from the POS by themselves, so don't write them here.
        Write in any language (English, Roman Urdu or Urdu).</p>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="primary" onClick={() => setEdit({ question: '', answer: '' })}>+ Add a question</button>
        <button className="ghost" onClick={starter}>Add the usual questions</button>
        <span className="muted" style={{ fontSize: 13 }}>{d.used_chars.toLocaleString()} of {d.max_chars.toLocaleString()} characters used</span>
      </div>
      {todo > 0 && <p className="warn-t" style={{ fontSize: 13 }}>{todo} question{todo > 1 ? 's have' : ' has'} no answer yet. The assistant ignores them until you write one.</p>}
      <table className="tbl">
        <thead><tr><th>Question</th><th>Answer</th><th /></tr></thead>
        <tbody>
          {!d.items.length && <tr><td colSpan={3} className="muted">Nothing yet. Press "Add the usual questions" to start.</td></tr>}
          {d.items.map(f => (
            <tr key={f.id}>
              <td><b>{f.question}</b></td>
              <td className={f.answer.trim() ? '' : 'warn-t'}>{f.answer.trim() || 'No answer yet'}</td>
              <td className="actions"><button className="ghost sm" onClick={() => setEdit({ ...f })}>Edit</button>{' '}
                <button className="ghost sm danger" onClick={() => del(f)}>Delete</button></td>
            </tr>))}
        </tbody>
      </table>
      {edit && <FormModal title={edit.id ? 'Edit question' : 'New question'} value={edit} onChange={setEdit} onSave={save} onClose={() => setEdit(null)}
        fields={[['question', 'Question the customer asks'], ['answer', 'Your answer (what the assistant may say)', 'textarea']]} />}
    </div>
  )
}
