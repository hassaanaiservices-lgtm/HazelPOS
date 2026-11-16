import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api, rs, run, localDate } from './lib'
import { FormModal, Icon } from './ui'
import { toast, confirmBox } from './notify'
import Delivery from './Delivery'
import RiderMap from './RiderMap'

// Owner's Riders section: the delivery board, the riders themselves (with the link for their phone screen), where
// they are on the map, and their monthly accounts: deliveries, fees earned, what was paid, COD cash collected and
// handed in. A rider's phone screen runs on the cloud (cloud/public/rider.html) so it works on the road.
const TABS = [['board', 'Delivery board'], ['riders', 'Riders'], ['accounts', 'Accounts'], ['map', 'Map']]
export default function Riders({ notify }) {
  const [tab, setTab] = useState('board')
  return (
    <section className="riders-section">
      <div className="row-head"><h2>Riders</h2>
        <div className="tabs" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      </div>
      {tab === 'board' && <Delivery notify={notify} embedded />}
      {tab === 'riders' && <RiderList notify={notify} />}
      {tab === 'accounts' && <Accounts notify={notify} />}
      {tab === 'map' && <div className="pad"><RiderMap height={Math.max(360, window.innerHeight - 220)} /></div>}
    </section>
  )
}

const ago = iso => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago` }
const EMPTY = { name: '', phone: '', delivery_fee: '', active: 1 }

function RiderList({ notify }) {
  const [riders, setRiders] = useState([])
  const [edit, setEdit] = useState(null)
  const [link, setLink] = useState(null) // { rider, qr }
  const load = () => api('/riders?all=1').then(setRiders)
  useEffect(() => { run(load)(); const t = setInterval(() => run(load)(), 15000); return () => clearInterval(t) }, [])
  const save = run(async () => {
    const r = await api('/riders', { ...edit, delivery_fee: +edit.delivery_fee || 0, active: edit.active ? 1 : 0 })
    setEdit(null); notify(edit.id ? 'Rider saved' : `${r.name} added. Give them their phone link.`); load()
  })
  const showLink = run(async r => setLink({ rider: r, qr: r.link ? await QRCode.toDataURL(r.link, { width: 260, margin: 1 }) : null }))
  const newLink = run(async r => {
    if (!await confirmBox(`Make a new link for ${r.name}? The old one stops working.`, { confirmLabel: 'New link' })) return
    const nr = await api(`/riders/${r.id}/link`, {}); await load(); showLink(nr)
  })
  const sendLink = run(async r => { await api(`/riders/${r.id}/send-link`, {}); notify(`Link sent to ${r.name} on WhatsApp`) })
  const copy = run(async text => { await navigator.clipboard.writeText(text); toast('Copied') })
  const status = r => !r.active ? <span className="muted">Not working here</span>
    : r.on_road ? <span className="ok-t">Delivering ({r.on_road})</span>
    : r.on_duty ? <span className="ok-t">On duty{r.at ? `, seen ${ago(r.at)}` : ''}</span>
    : r.at ? <span className="muted">Off duty, last seen {ago(r.at)}</span> : <span className="muted">Off duty</span>
  return (
    <div className="pad">
      <div className="row-head sub"><span className="muted">Each rider gets a link for their phone: they accept orders, mark them delivered and share their location while on duty.</span>
        <button className="primary add" onClick={() => setEdit({ ...EMPTY })}>+ Add rider</button></div>
      <table className="tbl riders-tbl">
        <thead><tr><th>Rider</th><th>Phone</th><th>Fee per delivery</th><th>Now</th><th>Today</th><th>Cash with rider</th><th /></tr></thead>
        <tbody>
          {!riders.length && <tr><td colSpan={7} className="muted">No riders yet. Add your first rider.</td></tr>}
          {riders.map(r => (
            <tr key={r.id} className={r.active ? '' : 'inactive'}>
              <td><b>{r.name}</b></td><td className="muted">{r.phone || '—'}</td><td>{rs(r.delivery_fee)}</td>
              <td>{status(r)}</td><td>{r.delivered_today} delivered</td>
              <td>{r.cash_due > 0 ? <b className="warn-t">{rs(r.cash_due)}</b> : <span className="muted">—</span>}</td>
              <td className="actions">
                <button className="ghost sm" onClick={() => showLink(r)}><Icon name="qr" size={16} />Phone link</button>{' '}
                <button className="ghost sm" onClick={() => setEdit({ ...r, delivery_fee: r.delivery_fee || '' })}>Edit</button>
              </td>
            </tr>))}
        </tbody>
      </table>
      {edit && <FormModal title={edit.id ? 'Edit rider' : 'New rider'} value={edit} onChange={setEdit} onSave={save} onClose={() => setEdit(null)}
        fields={[['name', 'Name'], ['phone', 'WhatsApp number'], ['delivery_fee', 'Fee the rider earns per delivery (Rs)', 'number'], ['active', 'Still working here', 'checkbox']]} />}
      {link && <div className="modal-bg" onClick={() => setLink(null)}><div className="modal link-modal" onClick={e => e.stopPropagation()}>
        <h2>{link.rider.name}'s phone screen</h2>
        {link.rider.link ? <>
          <p className="muted">Open this link on the rider's phone once, then "Add to Home screen" in the browser menu. It's a secret: anyone with it can act as this rider.</p>
          <img src={link.qr} alt="QR code of the rider link" className="link-qr" />
          <code className="link-text">{link.rider.link}</code>
          <div className="row wrap">
            <button className="primary" onClick={() => sendLink(link.rider)}><Icon name="chat" size={16} />Send on WhatsApp</button>
            <button className="ghost" onClick={() => copy(link.rider.link)}>Copy link</button>
            <button className="ghost" onClick={() => newLink(link.rider)}>New link</button>
            <span style={{ flex: 1 }} /><button className="ghost" onClick={() => setLink(null)}>Close</button>
          </div>
        </> : <>
          <p>The rider screen runs on the cloud, so riders can use it on the road. Connect the cloud first: <b>Settings → Cloud</b>.</p>
          <div className="row"><span style={{ flex: 1 }} /><button className="ghost" onClick={() => setLink(null)}>Close</button></div>
        </>}
      </div></div>}
    </div>
  )
}

const thisMonth = () => localDate().slice(0, 7)
const shiftMonth = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthName = m => new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })

function Accounts({ notify }) {
  const [month, setMonth] = useState(thisMonth())
  const [d, setD] = useState(null)
  const [pay, setPay] = useState(null)
  const load = () => api(`/riders/accounts?month=${month}`).then(setD)
  useEffect(() => { run(load)() }, [month]) // eslint-disable-line react-hooks/exhaustive-deps
  const savePay = run(async () => {
    await api(`/riders/${pay.id}/pay`, { amount: +pay.amount, method: pay.method, date: pay.date, note: pay.note, month })
    setPay(null); notify(`Paid ${rs(pay.amount)} to ${pay.name}`); load()
  })
  const undo = run(async p => {
    if (!await confirmBox(`Remove this payment of ${rs(p.amount)} to ${p.name}?`, { confirmLabel: 'Remove', danger: true })) return
    await api(`/payroll/${p.id}/delete`, {}); load()
  })
  if (!d) return <p className="muted pad">Loading…</p>
  const sum = k => d.riders.reduce((s, r) => s + (r[k] || 0), 0)
  return (
    <div className="pad">
      <div className="row-head sub">
        <div className="row"><button className="ghost sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back" size={16} /></button>
          <b>{monthName(month)}</b>
          <button className="ghost sm" aria-label="Next month" disabled={month >= thisMonth()} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="next" size={16} /></button></div>
        <span className="muted">Fees paid here go to Expenses under Salaries.</span>
      </div>
      <div className="acct-cards">
        <div className="card"><span className="muted">Deliveries</span><b>{sum('deliveries')}</b></div>
        <div className="card"><span className="muted">Fees earned</span><b>{rs(sum('earned'))}</b></div>
        <div className="card"><span className="muted">Paid to riders</span><b>{rs(sum('paid'))}</b></div>
        <div className="card"><span className="muted">Still owed</span><b className={sum('owed') > 0 ? 'warn-t' : ''}>{rs(sum('owed'))}</b></div>
        <div className="card"><span className="muted">COD cash collected</span><b>{rs(sum('cash_collected'))}</b></div>
        <div className="card"><span className="muted">Cash with riders now</span><b className={sum('with_rider') > 0 ? 'warn-t' : ''}>{rs(sum('with_rider'))}</b></div>
      </div>
      <table className="tbl acct-tbl">
        <thead><tr><th>Rider</th><th>Deliveries</th><th>Avg time</th><th>Late (45+ min)</th><th>Fee</th><th>Earned</th><th>Paid</th><th>Owed</th><th>Cash collected</th><th>Handed in</th><th>With rider now</th><th /></tr></thead>
        <tbody>
          {!d.riders.length && <tr><td colSpan={12} className="muted">No riders this month</td></tr>}
          {d.riders.map(r => (
            <tr key={r.id} className={r.active ? '' : 'inactive'}>
              <td><b>{r.name}</b>{!r.active && <span className="muted"> (left)</span>}</td>
              <td>{r.deliveries}</td><td className="muted">{r.deliveries ? `${r.avg_minutes} min` : '—'}</td><td className={r.late ? 'warn-t' : 'muted'}>{r.late || '—'}</td>
              <td className="muted">{rs(r.delivery_fee)}</td><td>{rs(r.earned)}</td><td>{rs(r.paid)}</td>
              <td className={r.owed > 0 ? 'warn-t' : r.owed < 0 ? 'err-t' : ''}><b>{rs(r.owed)}</b></td>
              <td>{rs(r.cash_collected)}</td><td>{rs(r.handed_in)}</td>
              <td className={r.with_rider > 0 ? 'warn-t' : 'muted'}>{r.with_rider > 0 ? rs(r.with_rider) : '—'}</td>
              <td><button className="primary sm" disabled={r.owed <= 0} onClick={() => setPay({ id: r.id, name: r.name, amount: r.owed, method: 'cash', date: localDate(), note: '' })}>Pay</button></td>
            </tr>))}
        </tbody>
      </table>
      <h3>Fees paid this month</h3>
      <table className="tbl">
        <thead><tr><th>Date</th><th>Rider</th><th>Amount</th><th>Note</th><th>By</th><th /></tr></thead>
        <tbody>
          {!d.payments.length && <tr><td colSpan={6} className="muted">Nothing paid yet</td></tr>}
          {d.payments.map(p => <tr key={p.id}><td className="muted">{p.date}</td><td>{p.name}</td><td>{rs(p.amount)}</td><td className="muted">{p.note}</td><td className="muted">{p.user_name}</td>
            <td><button className="ghost sm danger" aria-label="Remove" onClick={() => undo(p)}><Icon name="x" size={16} /></button></td></tr>)}
        </tbody>
      </table>
      {pay && <FormModal title={`Pay delivery fees to ${pay.name} · ${monthName(month)}`} value={pay} onChange={setPay} onSave={savePay} onClose={() => setPay(null)} saveLabel={`Pay ${rs(pay.amount)}`}
        fields={[['amount', 'Amount (Rs)', 'number'], ['method', 'Paid by', 'select', [['cash', 'Cash'], ['bank', 'Bank transfer'], ['online', 'JazzCash / Easypaisa']]], ['date', 'Date', 'date'], ['note', 'Note']]} />}
    </div>
  )
}
