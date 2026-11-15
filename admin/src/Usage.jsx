import { useEffect, useState } from 'react'
import { api, num, usd } from './lib'
import { run } from './notify'
import { go } from './App'

// AI usage and its estimated cost per branch, for a month: does each client's fee cover their WhatsApp assistant?
export default function Usage() {
  const [month, setMonth] = useState('')
  const [d, setD] = useState(null)
  useEffect(() => { run(async () => setD(await api('/usage' + (month ? `?month=${month}` : ''))))() }, [month])
  if (!d) return <p className="muted">Loading…</p>

  const total = k => d.branches.reduce((s, b) => s + (b[k] || 0), 0)
  const rows = [...d.branches].sort((a, b) => b.cost_usd - a.cost_usd)
  const maxDay = Math.max(1, ...d.days.map(x => x.calls))
  return (
    <>
      <div className="page-head"><h1>AI usage</h1><span className="sp" />
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>Month
          <select value={d.month} onChange={e => setMonth(e.target.value)} style={{ width: 'auto' }}>{d.months.map(m => <option key={m}>{m}</option>)}</select></label></div>
      <div className="kpis">
        <div className="kpi"><span>Estimated cost</span><b>{usd(total('cost_usd'))}</b></div>
        <div className="kpi"><span>AI replies</span><b>{num(total('calls') - total('voice_notes'))}</b></div>
        <div className="kpi"><span>Voice notes</span><b>{num(total('voice_notes'))}</b> <span className="muted small">{Math.round(total('audio_seconds') / 60)} min</span></div>
        <div className="kpi"><span>Tokens in / out</span><b>{(total('tokens_in') / 1e6).toFixed(2)}M / {(total('tokens_out') / 1e6).toFixed(2)}M</b></div>
        <div className="kpi"><span>Failed calls</span><b>{num(total('failed'))}</b></div>
      </div>
      <div className="card"><h3>Replies per day</h3>
        {d.days.length ? <><div className="bars" role="img" aria-label="AI replies per day">{d.days.map(x => <div key={x.day} style={{ height: `${(x.calls / maxDay) * 100}%` }} title={`${x.day}: ${x.calls} calls, ${usd(x.cost_usd)}`} />)}</div>
          <div className="row muted small" style={{ justifyContent: 'space-between' }}><span>{d.days[0].day}</span><span>{d.days.at(-1).day}</span></div></>
          : <div className="empty">No AI use this month.</div>}
      </div>
      <div className="card scroll" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Client</th><th>Branch</th><th>Plan</th><th className="num">Replies</th><th className="num">Voice notes</th><th className="num">Tokens in</th><th className="num">Tokens out</th><th className="num">Failed</th><th className="num">Est. cost</th></tr></thead>
          <tbody>{rows.map(b => (
            <tr key={b.id} className="click" onClick={() => go('branch/' + b.id)}>
              <td><b>{b.owner}</b></td><td>{b.name}</td><td className="muted small">{b.plan || '—'}</td>
              <td className="num">{num(b.calls - b.voice_notes)}</td><td className="num">{num(b.voice_notes)}</td>
              <td className="num">{num(b.tokens_in)}</td><td className="num">{num(b.tokens_out)}</td><td className="num">{num(b.failed)}</td>
              <td className="num"><b>{usd(b.cost_usd)}</b></td>
            </tr>))}</tbody>
        </table>
        {!rows.length && <div className="empty">No branches yet.</div>}
      </div>
      <p className="muted small">Estimate at DeepSeek peak prices (${d.prices.input_miss} / ${d.prices.input_hit} cached / ${d.prices.output} output per million tokens) and Groq Whisper at ${d.prices.whisper_hour} per audio hour. Change them with AI_PRICES on the cloud.</p>
    </>
  )
}
