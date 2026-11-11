import { useEffect, useState } from 'react'
import { api, rs, run, downloadCsv, localDate } from './lib'
import { FormModal, Icon } from './ui'
import { confirmBox } from './notify'

export default function Customers({ notify }) {
  const [tab, setTab] = useState('Customers')
  return (
    <section className="admin">
      <div className="row-head"><h2>Customers</h2>
        <div className="tabs">{['Customers', 'Promo codes'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>
      {tab === 'Customers' ? <CustomerList notify={notify} /> : <Promos notify={notify} />}
    </section>
  )
}

function CustomerList({ notify }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState([])
  const [edit, setEdit] = useState(null)
  const load = () => api('/customers?q=' + encodeURIComponent(q)).then(setList)
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q])
  const save = run(async () => { await api('/customers', edit); setEdit(null); load(); notify('Saved') })
  const del = run(async c => { if (await confirmBox(`Delete ${c.name || c.phone}? Their past orders stay.`)) { await api(`/customers/${c.id}/delete`, {}); load() } })
  return (
    <>
      <div className="row-head">
        <input type="search" placeholder="Search name or phone" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <span className="muted">Customers are added automatically when a phone number is entered on an order.</span>
        <button className="ghost sm" onClick={() => downloadCsv('customers.csv', list.map(c => ({ Name: c.name, Phone: c.phone, Address: c.address, Points: c.points, Visits: c.visits, Spent: c.spent, 'Last visit': c.last_visit })))}><Icon name="download" size={15} />Excel</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Phone</th><th>Visits</th><th>Spent</th><th>Points</th><th>Last visit</th><th /></tr></thead>
          <tbody>
            {!list.length && <tr><td colSpan={7} className="muted">No customers yet</td></tr>}
            {list.map(c => (
              <tr key={c.id}>
                <td><b>{c.name || '—'}</b>{c.address && <div className="muted" style={{ fontSize: 12 }}>{c.address}</div>}</td>
                <td>{c.phone}</td><td>{c.visits}</td><td>{rs(c.spent)}</td><td>⭐ {c.points}</td>
                <td className="muted">{c.last_visit ? new Date(c.last_visit).toLocaleDateString() : '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="ghost sm" onClick={() => setEdit(c)}>Edit</button>{' '}
                  <button className="ghost sm danger" onClick={() => del(c)} aria-label="Remove"><Icon name="x" size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <FormModal title="Edit customer" value={edit} onChange={setEdit} onSave={save} onClose={() => setEdit(null)}
        fields={[['name', 'Name'], ['phone', 'Phone'], ['address', 'Address'], ['points', 'Loyalty points', 'number']]} />}
    </>
  )
}

function Promos({ notify }) {
  const [list, setList] = useState([])
  const [edit, setEdit] = useState(null)
  const load = () => api('/promos').then(setList)
  useEffect(() => { load() }, [])
  const save = run(async () => {
    await api('/promos', { ...edit, value: +edit.value, min_order: +edit.min_order || 0, max_discount: +edit.max_discount || 0, uses_limit: +edit.uses_limit || 0, expires: edit.expires || null })
    setEdit(null); load(); notify('Promo saved')
  })
  const del = run(async p => { if (await confirmBox(`Delete ${p.code}?`)) { await api(`/promos/${p.id}/delete`, {}); load() } })
  const today = localDate()
  return (
    <>
      <button className="primary add" onClick={() => setEdit({ code: '', type: 'percent', value: '', min_order: '', max_discount: '', uses_limit: '', expires: '', active: 1 })}>+ New promo code</button>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Discount</th><th>Min. order</th><th>Used</th><th>Expires</th><th>Status</th><th /></tr></thead>
          <tbody>
            {!list.length && <tr><td colSpan={7} className="muted">No promo codes yet — e.g. EID20 for 20% off up to Rs 500</td></tr>}
            {list.map(p => {
              const status = !p.active ? 'Off' : p.expires && p.expires < today ? 'Expired' : p.uses_limit && p.used >= p.uses_limit ? 'Used up' : 'Active'
              return (
                <tr key={p.id}>
                  <td><b>{p.code}</b></td>
                  <td>{p.type === 'percent' ? `${p.value}%` : rs(p.value)}{p.max_discount > 0 && <span className="muted"> (max {rs(p.max_discount)})</span>}</td>
                  <td>{p.min_order ? rs(p.min_order) : '—'}</td>
                  <td>{p.used}{p.uses_limit ? ` / ${p.uses_limit}` : ''}</td>
                  <td className="muted">{p.expires || 'Never'}</td>
                  <td><span className={'pill sm' + (status === 'Active' ? '' : ' low-pill')}>{status}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="ghost sm" onClick={() => setEdit(p)}>Edit</button>{' '}
                    <button className="ghost sm danger" onClick={() => del(p)} aria-label="Remove"><Icon name="x" size={16} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {edit && <FormModal title={edit.id ? 'Edit promo' : 'New promo code'} value={edit} onChange={setEdit} onSave={save} onClose={() => setEdit(null)}
        fields={[['code', 'Code (customers say this at the counter)'], ['type', 'Type', 'select', [['percent', '% off'], ['flat', 'Rs off']]],
          ['value', edit.type === 'percent' ? 'Percent off' : 'Rs off', 'number'], ['max_discount', 'Max discount Rs (0 = no cap)', 'number'],
          ['min_order', 'Minimum order Rs', 'number'], ['uses_limit', 'Total uses allowed (0 = unlimited)', 'number'],
          ['expires', 'Expires on', 'date'], ['active', 'Active', 'checkbox']]} />}
    </>
  )
}
