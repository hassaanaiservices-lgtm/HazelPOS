import { useEffect, useState } from 'react'
import { api, rs } from './lib'

const TABS = ['Menu', 'Categories', 'Floors', 'Tables', 'Staff', 'Restaurant']

export default function Admin({ onChanged, notify }) {
  const [tab, setTab] = useState('Menu')
  return (
    <section className="admin">
      <div className="row-head"><h2>Settings</h2>
        <div className="tabs">{TABS.map(t => <button key={t} id={'tab-' + t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>
      {tab === 'Menu' && <MenuAdmin onChanged={onChanged} notify={notify} />}
      {tab === 'Categories' && <SimpleAdmin route="categories" listUrl="/menu?all=1" pick={d => d.categories} onChanged={onChanged} notify={notify}
        fields={[['name', 'Name'], ['color', 'Colour', 'color']]} blank={{ name: '', color: '#ff6b35' }}
        show={c => <><i className="swatch" style={{ background: c.color }} />{c.name}</>} />}
      {tab === 'Floors' && <SimpleAdmin route="floors" listUrl="/floors" onChanged={onChanged} notify={notify}
        fields={[
          ['name', 'Floor Name (e.g. Main Dining, Terrace)'],
          ['icon', 'Icon (Emoji)'],
          ['color', 'Theme Color', 'color']
        ]}
        blank={{ name: '', icon: '🍽️', color: '#ff9f43' }}
        show={f => (
          <>
            <i className="swatch" style={{ background: f.color }} />
            <span style={{ fontSize: 20 }}>{f.icon || '🍽️'}</span>
            <b>{f.name}</b>
            <span className="muted">{f.total || 0} tables</span>
          </>
        )} />}
      {tab === 'Tables' && <SimpleAdmin route="tables" listUrl="/tables" onChanged={onChanged} notify={notify}
        fields={[
          ['name', 'Table Name (e.g. T1, F1)'],
          ['seats', 'Seats / Capacity', 'number'],
          ['floor', 'Floor / Dining Area', 'select', ['Main Dining', 'Family Section', 'Patio & Outdoor', 'Rooftop Terrace']],
          ['shape', 'Table Shape', 'select', ['square', 'rect', 'round']]
        ]}
        blank={{ name: '', seats: 4, floor: 'Main Dining', shape: 'square' }}
        show={t => (
          <>
            <span className="pill" style={{ textTransform: 'capitalize' }}>{t.floor || 'Main Dining'}</span>
            <b>{t.name}</b>
            <span className="muted">{t.seats} seats</span>
            <span className="pill sm" style={{ textTransform: 'capitalize' }}>{t.shape || 'square'}</span>
          </>
        )} />}
      {tab === 'Staff' && <SimpleAdmin route="users" listUrl="/users" notify={notify}
        fields={[['name', 'Name'], ['pin', 'PIN (4 digits)'], ['role', 'Role', 'role']]} blank={{ name: '', pin: '', role: 'cashier' }}
        show={u => <><b>{u.name}</b><span className="pill">{u.role}</span><span className="muted">PIN ••••</span></>} />}
      {tab === 'Restaurant' && <RestaurantSettings onChanged={onChanged} notify={notify} />}
    </section>
  )
}

function MenuAdmin({ onChanged, notify }) {
  const [data, setData] = useState({ categories: [], products: [] })
  const [edit, setEdit] = useState(null)
  const load = () => api('/menu?all=1').then(setData)
  useEffect(() => { load() }, [])
  const save = async () => {
    await api('/products', { ...edit, price: +edit.price, category_id: +edit.category_id, active: edit.active ? 1 : 0 })
    setEdit(null); load(); onChanged(); notify('Item saved ✔')
  }
  const del = async p => { if (confirm(`Delete ${p.name}?`)) { await api(`/products/${p.id}/delete`, {}); load(); onChanged() } }
  const cat = id => data.categories.find(c => c.id === id)

  return (
    <>
      <button className="primary add" id="add-item" onClick={() => setEdit({ name: '', price: '', emoji: '🍽️', category_id: data.categories[0]?.id, active: 1 })}>+ Add item</button>
      <div className="admin-list">
        {data.products.map(p => (
          <div key={p.id} className={'admin-row' + (p.active ? '' : ' off')}>
            <span className="emoji-sm">{p.emoji}</span><b>{p.name}</b>
            <span className="pill" style={{ borderColor: cat(p.category_id)?.color }}>{cat(p.category_id)?.name}</span>
            <span className="amt">{rs(p.price)}</span>
            <span className="muted">{p.active ? 'On menu' : 'Hidden'}</span>
            <button className="ghost" onClick={() => setEdit(p)}>Edit</button>
            <button className="ghost danger" onClick={() => del(p)}>Delete</button>
          </div>
        ))}
      </div>
      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{edit.id ? 'Edit item' : 'New item'}</h2>
            <label>Name<input autoFocus value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
            <div className="two">
              <label>Price (Rs.)<input type="number" value={edit.price} onChange={e => setEdit({ ...edit, price: e.target.value })} /></label>
              <label>Icon (emoji)<input value={edit.emoji} onChange={e => setEdit({ ...edit, emoji: e.target.value })} /></label>
            </div>
            <label>Category
              <select value={edit.category_id} onChange={e => setEdit({ ...edit, category_id: e.target.value })}>
                {data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label className="check"><input type="checkbox" checked={!!edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Show on menu</label>
            <div className="actions"><button className="ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" disabled={!edit.name || !edit.price} onClick={save}>Save</button></div>
          </div>
        </div>
      )}
    </>
  )
}

function SimpleAdmin({ route, listUrl, pick = d => d, fields, blank, show, onChanged = () => {}, notify }) {
  const [list, setList] = useState([])
  const [edit, setEdit] = useState(null)
  const load = () => api(listUrl).then(d => setList(pick(d)))
  useEffect(() => { load() }, [route])
  const save = async () => {
    try { await api('/' + route, edit); setEdit(null); load(); onChanged(); notify('Saved ✔') }
    catch (e) { alert(e.message.includes('UNIQUE') ? 'That PIN is already used' : e.message) }
  }
  const del = async x => { if (confirm('Delete?')) { await api(`/${route}/${x.id}/delete`, {}); load(); onChanged() } }
  return (
    <>
      <button className="primary add" onClick={() => setEdit({ ...blank })}>+ Add</button>
      <div className="admin-list">
        {list.map(x => (
          <div key={x.id} className="admin-row">{show(x)}
            <span style={{ flex: 1 }} />
            <button className="ghost" onClick={() => setEdit(x)}>Edit</button>
            <button className="ghost danger" onClick={() => del(x)}>Delete</button>
          </div>
        ))}
      </div>
      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{edit.id ? 'Edit' : 'Add'}</h2>
            {fields.map(([k, l, type, opts]) => (
              <label key={k}>{l}
                {type === 'role' ? (
                  <select value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })}>
                    <option value="admin">Admin (everything)</option>
                    <option value="cashier">Cashier (orders only)</option>
                    <option value="kitchen">Kitchen (display only)</option>
                  </select>
                ) : type === 'select' ? (
                  <select value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })}>
                    {opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={type || 'text'} value={edit[k] ?? ''} onChange={e => setEdit({ ...edit, [k]: type === 'number' ? +e.target.value : e.target.value })} />
                )}
              </label>
            ))}
            <div className="actions"><button className="ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" onClick={save}>Save</button></div>
          </div>
        </div>
      )}
    </>
  )
}

function RestaurantSettings({ onChanged, notify }) {
  const [s, setS] = useState(null)
  useEffect(() => { api('/settings').then(setS) }, [])
  if (!s) return null
  const f = (k, l, type) => <label>{l}<input type={type || 'text'} value={s[k] ?? ''} onChange={e => setS({ ...s, [k]: e.target.value })} /></label>
  return (
    <div className="card settings-card">
      <div className="two">{f('name', 'Restaurant name')}{f('logo', 'Logo (emoji)')}</div>
      {f('address', 'Address')}
      <div className="two">{f('phone', 'Phone')}{f('tax_rate', 'Tax rate (%)', 'number')}</div>
      <div className="two">{f('ntn', 'NTN / STRN (Tax ID)')}{f('bank_name', 'Bank Name')}</div>
      <div className="two">{f('bank_title', 'Bank Account Title')}{f('bank_account', 'IBAN / Account Number')}</div>
      {f('footer', 'Receipt footer message')}
      <button className="primary" onClick={async () => { await api('/settings', s); onChanged(); notify('Settings saved ✔') }}>Save settings</button>
    </div>
  )
}
