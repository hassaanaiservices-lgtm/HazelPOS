import { useEffect, useState } from 'react'
import { api, rs, parseModifiers } from './lib'
import { Icon } from './ui'
import Integrations from './Integrations'
import { toastError, confirmBox } from './notify'

const TABS = ['Menu', 'Categories', 'Floors', 'Tables', 'Delivery Zones', 'Restaurant', 'WhatsApp bot', 'Integrations', 'Cloud', 'Activity Log']

export default function Admin({ onChanged, notify }) {
  const [tab, setTab] = useState('Menu')
  const [floors, setFloors] = useState([])
  useEffect(() => { if (tab === 'Tables') api('/floors').then(f => setFloors(f.map(x => x.name))).catch(() => {}) }, [tab])
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
          ['floor', 'Floor / Dining Area', 'select', floors.length ? floors : ['Main Dining']],
          ['shape', 'Table Shape', 'select', ['square', 'rect', 'round']]
        ]}
        blank={{ name: '', seats: 4, floor: floors[0] || 'Main Dining', shape: 'square' }}
        show={t => (
          <>
            <span className="pill" style={{ textTransform: 'capitalize' }}>{t.floor || 'Main Dining'}</span>
            <b>{t.name}</b>
            <span className="muted">{t.seats} seats</span>
            <span className="pill sm" style={{ textTransform: 'capitalize' }}>{t.shape || 'square'}</span>
          </>
        )} />}
      {tab === 'Delivery Zones' && <SimpleAdmin route="delivery-zones" listUrl="/delivery-zones" notify={notify}
        fields={[['name', 'Area name (e.g. DHA Phase 5)'], ['fee', 'Delivery fee (Rs)', 'number'], ['min_order', 'Minimum order (Rs)', 'number'],
          ['free_above', 'Free delivery above (Rs, 0 = never)', 'number'], ['eta_min', 'Usual delivery time (minutes)', 'number'], ['active', 'Delivering here (1 = yes, 0 = paused)', 'select', [1, 0]]]}
        blank={{ name: '', fee: 100, min_order: 0, free_above: 0, eta_min: 40, active: 1 }}
        show={z => <><b>{z.name}</b><span className="pill">{rs(z.fee)}</span>{z.min_order > 0 && <span className="muted">min {rs(z.min_order)}</span>}
          {z.free_above > 0 && <span className="muted">free above {rs(z.free_above)}</span>}<span className="muted">~{z.eta_min} min</span>{!+z.active && <span className="pill sm low-pill">Off</span>}</>} />}
      {tab === 'Restaurant' && <RestaurantSettings onChanged={onChanged} notify={notify} />}
      {tab === 'WhatsApp bot' && <BotBehaviour notify={notify} />}
      {tab === 'Integrations' && <Integrations onChanged={onChanged} notify={notify} />}
      {tab === 'Cloud' && <CloudSettings notify={notify} />}
      {tab === 'Activity Log' && <ActivityLog />}
    </section>
  )
}

function MenuAdmin({ onChanged, notify }) {
  const [data, setData] = useState({ categories: [], products: [] })
  const [edit, setEdit] = useState(null)
  const load = () => api('/menu?all=1').then(setData)
  useEffect(() => { load() }, [])

  const openEdit = (p) => {
    let sizesArr = [];
    if (p.sizes) {
      try {
        sizesArr = typeof p.sizes === 'string' ? JSON.parse(p.sizes) : p.sizes;
      } catch {}
    }
    let ings = '';
    if (p.ingredients) {
      try {
        ings = typeof p.ingredients === 'string'
          ? (p.ingredients.startsWith('[') ? JSON.parse(p.ingredients).join(', ') : p.ingredients)
          : (Array.isArray(p.ingredients) ? p.ingredients.join(', ') : '');
      } catch {
        ings = String(p.ingredients);
      }
    }
    setEdit({
      ...p,
      subtitle: p.subtitle || '',
      description: p.description || '',
      ingredients_str: ings,
      sizes_list: Array.isArray(sizesArr) ? sizesArr : [],
      modifiers_list: parseModifiers(p)
    });
  };

  const save = async () => {
    const ingsArray = (edit.ingredients_str || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const validSizes = (edit.sizes_list || [])
      .filter(s => s.name && s.name.trim())
      .map(s => ({ name: s.name.trim(), detail: (s.detail || '').trim(), price: +s.price || 0 }));

    await api('/products', {
      ...edit,
      price: +edit.price,
      category_id: +edit.category_id,
      active: edit.active ? 1 : 0,
      subtitle: edit.subtitle || '',
      description: edit.description || '',
      ingredients: JSON.stringify(ingsArray),
      sizes: validSizes.length > 0 ? JSON.stringify(validSizes) : '',
      modifiers: JSON.stringify((edit.modifiers_list || [])
        .map(g => ({ name: g.name.trim(), min: Math.max(0, +g.min || 0), max: Math.max(0, +g.max || 0),
          options: g.options.filter(o => o.name.trim()).map(o => ({ name: o.name.trim(), price: +o.price || 0 })) }))
        .filter(g => g.name && g.options.length))
    });
    setEdit(null);
    load();
    onChanged();
    notify('Item saved');
  };

  const del = async p => { if (await confirmBox(`Delete ${p.name}?`)) { await api(`/products/${p.id}/delete`, {}); load(); onChanged() } }
  const cat = id => data.categories.find(c => c.id === id)

  return (
    <>
      <button className="primary add" id="add-item" onClick={() => openEdit({ name: '', price: '', emoji: '🍽️', category_id: data.categories[0]?.id, active: 1, subtitle: '', description: '', ingredients_str: '', sizes_list: [] })}>+ Add item</button>
      <div className="admin-list">
        {data.products.map(p => (
          <div key={p.id} className={'admin-row' + (p.active ? '' : ' off')}>
            <span className="emoji-sm">{p.emoji}</span><b>{p.name}</b>
            <span className="pill" style={{ borderColor: cat(p.category_id)?.color }}>{cat(p.category_id)?.name}</span>
            <span className="amt">{rs(p.price)}</span>
            <span className="muted">{p.active ? 'On menu' : 'Hidden'}</span>
            <button className="ghost" onClick={() => openEdit(p)}>Edit</button>
            <button className="ghost danger" onClick={() => del(p)}>Delete</button>
          </div>
        ))}
      </div>
      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className="modal menu-edit-modal" style={{ width: 560, maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2>{edit.id ? 'Edit item' : 'New item'}</h2>
            <label>Name<input autoFocus value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
            <div className="two">
              <label>Base Price (Rs.)<input type="number" value={edit.price} onChange={e => setEdit({ ...edit, price: e.target.value })} /></label>
              <label>Icon (emoji)<input value={edit.emoji} onChange={e => setEdit({ ...edit, emoji: e.target.value })} /></label>
            </div>
            <label>Category
              <select value={edit.category_id} onChange={e => setEdit({ ...edit, category_id: e.target.value })}>
                {data.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>

            <label>Subtitle / Serving Info
              <input value={edit.subtitle || ''} placeholder="e.g. Pizza · Serves 1–3 depending on size" onChange={e => setEdit({ ...edit, subtitle: e.target.value })} />
            </label>
            <label>Description
              <textarea rows={2} style={{ width: '100%', borderRadius: 12, padding: '10px 14px', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text)', font: 'inherit' }}
                value={edit.description || ''} placeholder="Describe ingredients, cooking style, taste..." onChange={e => setEdit({ ...edit, description: e.target.value })} />
            </label>
            <label>Ingredients (comma-separated)
              <input value={edit.ingredients_str || ''} placeholder="e.g. Mozzarella, Tomato sauce, Fresh basil, Olive oil" onChange={e => setEdit({ ...edit, ingredients_str: e.target.value })} />
            </label>

            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <b style={{ fontSize: 14 }}>Size Variations & Prices</b>
                <button type="button" className="ghost" style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setEdit({
                  ...edit,
                  sizes_list: [...(edit.sizes_list || []), { name: '', detail: '', price: edit.price || 0 }]
                })}>+ Add size</button>
              </div>
              {(!edit.sizes_list || !edit.sizes_list.length) ? (
                <div className="muted" style={{ fontSize: 13, padding: '4px 0' }}>No sizes added yet (item will use base price)</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                  {edit.sizes_list.map((sz, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: 6, alignItems: 'center' }}>
                      <input placeholder="Name (e.g. Small)" value={sz.name} onChange={e => {
                        const next = [...edit.sizes_list];
                        next[idx] = { ...next[idx], name: e.target.value };
                        setEdit({ ...edit, sizes_list: next });
                      }} />
                      <input placeholder="Detail (e.g. 8 inch)" value={sz.detail} onChange={e => {
                        const next = [...edit.sizes_list];
                        next[idx] = { ...next[idx], detail: e.target.value };
                        setEdit({ ...edit, sizes_list: next });
                      }} />
                      <input type="number" placeholder="Price" value={sz.price} onChange={e => {
                        const next = [...edit.sizes_list];
                        next[idx] = { ...next[idx], price: e.target.value };
                        setEdit({ ...edit, sizes_list: next });
                      }} />
                      <button type="button" className="ghost danger" style={{ padding: '6px 10px' }} onClick={() => {
                        setEdit({ ...edit, sizes_list: edit.sizes_list.filter((_, i) => i !== idx) });
                      }} aria-label="Remove"><Icon name="x" size={16} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <ModifierEditor groups={edit.modifiers_list || []} onChange={modifiers_list => setEdit({ ...edit, modifiers_list })} />

            <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={!!edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Show on menu</label>
            <div className="actions"><button className="ghost" onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" disabled={!edit.name || !edit.price} onClick={save}>Save</button></div>
          </div>
        </div>
      )}
    </>
  )
}

// Option groups such as "Crust (pick 1)" or "Extra toppings (up to 3)", each option with its own add-on price
function ModifierEditor({ groups, onChange }) {
  const setGroup = (gi, patch) => onChange(groups.map((g, i) => i === gi ? { ...g, ...patch } : g))
  const setOpt = (gi, oi, patch) => setGroup(gi, { options: groups[gi].options.map((o, i) => i === oi ? { ...o, ...patch } : o) })
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>Options & add-ons</b>
        <button type="button" className="ghost" style={{ padding: '4px 12px', fontSize: 13 }}
          onClick={() => onChange([...groups, { name: '', min: 0, max: 1, options: [{ name: '', price: 0 }] }])}>+ Add option group</button>
      </div>
      {!groups.length && <div className="muted" style={{ fontSize: 13 }}>e.g. Crust (pick 1), Extra toppings (up to 3), Drink choice</div>}
      {groups.map((g, gi) => (
        <div key={gi} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, alignItems: 'end' }}>
            <label>Group name<input placeholder="e.g. Extra toppings" value={g.name} onChange={e => setGroup(gi, { name: e.target.value })} /></label>
            <label>Min (0 = optional)<input type="number" min="0" value={g.min} onChange={e => setGroup(gi, { min: e.target.value })} /></label>
            <label>Max (0 = no limit)<input type="number" min="0" value={g.max} onChange={e => setGroup(gi, { max: e.target.value })} /></label>
            <button type="button" className="ghost danger" style={{ padding: '6px 10px' }} onClick={() => onChange(groups.filter((_, i) => i !== gi))} aria-label="Remove"><Icon name="x" size={16} /></button>
          </div>
          {g.options.map((o, oi) => (
            <div key={oi} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 6, marginTop: 6 }}>
              <input placeholder="Option (e.g. Extra cheese)" value={o.name} onChange={e => setOpt(gi, oi, { name: e.target.value })} />
              <input type="number" placeholder="+ Price" value={o.price} onChange={e => setOpt(gi, oi, { price: e.target.value })} />
              <button type="button" className="ghost danger" style={{ padding: '6px 10px' }} onClick={() => setGroup(gi, { options: g.options.filter((_, i) => i !== oi) })} aria-label="Remove"><Icon name="x" size={16} /></button>
            </div>
          ))}
          <button type="button" className="ghost" style={{ padding: '4px 12px', fontSize: 13, marginTop: 6 }}
            onClick={() => setGroup(gi, { options: [...g.options, { name: '', price: 0 }] })}>+ Add option</button>
        </div>
      ))}
    </div>
  )
}

function SimpleAdmin({ route, listUrl, pick = d => d, fields, blank, show, onChanged = () => {}, notify }) {
  const [list, setList] = useState([])
  const [edit, setEdit] = useState(null)
  const load = () => api(listUrl).then(d => setList(pick(d)))
  useEffect(() => { load() }, [route])
  const save = async () => {
    try { await api('/' + route, edit); setEdit(null); load(); onChanged(); notify('Saved') }
    catch (e) { toastError(e.message) }
  }
  const del = async x => { if (await confirmBox('Delete?')) { await api(`/${route}/${x.id}/delete`, {}); load(); onChanged() } }
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
  const test = async target => {
    try { await api('/print/test', { target }); notify('Test page sent') } catch (e) { toastError(e.message) }
  }
  return (
    <div className="card settings-card">
      <div className="two">{f('name', 'Restaurant name')}{f('logo', 'Logo (emoji)')}</div>
      {f('address', 'Address')}
      <div className="two">{f('phone', 'Phone')}{f('tax_rate', 'Tax rate (%)', 'number')}</div>
      <div className="two">{f('ntn', 'NTN')}{f('strn', 'STRN (Sales tax reg. no.)')}</div>
      <div className="two">{f('pos_id', 'POS ID (from FBR / PRA)')}{f('cashier_discount_limit', 'Cashier discount limit (%) — above this needs admin PIN', 'number')}</div>
      <div className="two">{f('bank_name', 'Bank Name')}{f('bank_title', 'Bank Account Title')}</div>
      {f('bank_account', 'IBAN / Account Number')}
      {f('footer', 'Receipt footer message')}
      <div className="two">{f('loyalty_earn', 'Loyalty: points per Rs 100 spent (0 = off)', 'number')}{f('loyalty_value', 'Loyalty: Rs off per point', 'number')}</div>

      <h3 style={{ marginTop: 18 }}>Thermal printers</h3>
      <p className="muted" style={{ fontSize: 13 }}>Network printer: <code>192.168.1.50:9100</code> · USB on Linux: <code>/dev/usb/lp0</code> · Leave empty to use the browser print dialog.</p>
      <div className="two">
        <label>Receipt printer<div style={{ display: 'flex', gap: 6 }}>
          <input value={s.receipt_printer ?? ''} placeholder="192.168.1.50:9100" onChange={e => setS({ ...s, receipt_printer: e.target.value })} />
          <button className="ghost" disabled={!s.receipt_printer} onClick={() => test(s.receipt_printer)}>Test</button></div></label>
        <label>Kitchen printer<div style={{ display: 'flex', gap: 6 }}>
          <input value={s.kitchen_printer ?? ''} placeholder="192.168.1.51:9100" onChange={e => setS({ ...s, kitchen_printer: e.target.value })} />
          <button className="ghost" disabled={!s.kitchen_printer} onClick={() => test(s.kitchen_printer)}>Test</button></div></label>
      </div>
      <div className="two">
        <label>Paper width
          <select value={s.paper_width || '80'} onChange={e => setS({ ...s, paper_width: e.target.value })}>
            <option value="80">80 mm</option><option value="58">58 mm</option>
          </select></label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={s.open_drawer === '1'}
          onChange={e => setS({ ...s, open_drawer: e.target.checked ? '1' : '0' })} /> Open cash drawer on cash payments</label>
      </div>
      <label>Cash payment while no shift is open (Cash Drawer closed)
        <select value={s.closed_drawer_cash || 'auto_open'} onChange={e => setS({ ...s, closed_drawer_cash: e.target.value })}>
          <option value="auto_open">Open a shift automatically (Rs 0 float)</option>
          <option value="refuse">Refuse — the cashier must open the Cash Drawer first</option>
        </select></label>
      <button className="primary" onClick={async () => { await api('/settings', s); onChanged(); notify('Settings saved') }}>Save settings</button>
      <LoginPins notify={notify} />
    </div>
  )
}

// The three logins (Admin, Cashier, Kitchen) are fixed; only their PINs change
function LoginPins({ notify }) {
  const [users, setUsers] = useState([])
  const [pins, setPins] = useState({})
  useEffect(() => { api('/users').then(setUsers) }, [])
  const change = async u => {
    try { await api('/users', { id: u.id, name: u.name, role: u.role, pin: pins[u.id] }); setPins({ ...pins, [u.id]: '' }); notify(`${u.name} PIN changed`) }
    catch (e) { toastError(e.message) }
  }
  return (
    <>
      <h3 style={{ marginTop: 22 }}>Login PINs</h3>
      <p className="muted" style={{ fontSize: 13 }}>Change the default PINs (1234, 1111, 2222) before you start using the POS.</p>
      {users.map(u => (
        <div key={u.id} className="two" style={{ alignItems: 'end' }}>
          <label>{u.name} <span className="pill sm">{u.role}</span>
            <input type="password" inputMode="numeric" maxLength={4} placeholder="New 4-digit PIN" value={pins[u.id] || ''}
              onChange={e => setPins({ ...pins, [u.id]: e.target.value.replace(/\D/g, '') })} /></label>
          <button className="ghost" disabled={(pins[u.id] || '').length !== 4} onClick={() => change(u)}>Change PIN</button>
        </div>
      ))}
    </>
  )
}

// How the WhatsApp assistant writes. Facts (menu, prices, address) and the safety rules are fixed in the code.
function BotBehaviour({ notify }) {
  const [s, setS] = useState(null)
  const [text, setText] = useState('')
  useEffect(() => { api('/settings').then(x => { setS(x); setText(x.bot_behaviour || '') }) }, [])
  if (!s) return null
  const MAX = 2000
  const changed = text !== (s.bot_behaviour || '')
  const save = async () => {
    try { const x = await api('/settings', { bot_behaviour: text.slice(0, MAX) }); setS(x); notify('Bot behaviour saved. New replies use it right away.') }
    catch (e) { toastError(e.message) }
  }
  return (
    <div className="card settings-card">
      <h3>How the bot writes</h3>
      <p className="muted" style={{ fontSize: 13 }}>Tell the WhatsApp assistant how to talk: length, tone, language, what to ask. One instruction per line works best.
        The menu, prices, sizes and your address always come from the POS, and the safety rules (no made-up prices, no discounts, no other customers' details) can't be changed here.</p>
      <label>Behaviour
        <textarea rows={10} value={text} maxLength={MAX} onChange={e => setText(e.target.value)}
          placeholder={'- Keep replies to 1 or 2 lines\n- Ask only for the one missing detail'} />
      </label>
      <p className="muted" style={{ fontSize: 13 }}>{text.length} / {MAX} characters</p>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="primary" disabled={!changed} onClick={save}>Save behaviour</button>
        <button className="ghost" disabled={text === s.bot_behaviour_default} onClick={() => setText(s.bot_behaviour_default || '')}>Reset to default</button>
      </div>
    </div>
  )
}

function ActivityLog() {
  const [rows, setRows] = useState([])
  useEffect(() => { api('/audit').then(setRows) }, [])
  return (
    <div className="card">
      <table className="tbl">
        <thead><tr><th>Time</th><th>Staff</th><th>Action</th><th>Result</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td className="muted">{new Date(r.at).toLocaleString()}</td>
              <td>{r.user_name || '—'} {r.role && <span className="pill sm">{r.role}</span>}</td>
              <td><b>{r.action}</b></td>
              <td className={r.status >= 400 ? 'err' : 'muted'}>{r.status}</td>
              <td className="muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.detail}>{r.detail === '{}' ? '' : r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Connect this branch to HazelPOS Cloud (owner dashboard + daily backups); the POS keeps working offline either way
function CloudSettings({ notify }) {
  const [st, setSt] = useState(null)
  const [form, setForm] = useState({ url: '', key: '' })
  const [busy, setBusy] = useState('')
  const load = () => api('/cloud/status').then(s => { setSt(s); setForm(f => ({ ...f, url: f.url || s.url })) })
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [])
  const act = (name, fn) => async () => { setBusy(name); try { await fn() } catch (e) { toastError(e.message) } setBusy(''); load() }
  const when = iso => iso ? new Date(iso).toLocaleString() : 'never'
  if (!st) return null
  return (
    <div className="card settings-card">
      {st.connected ? <>
        <h3>Connected as <b>{st.branch}</b></h3>
        <p className="muted" style={{ fontSize: 13 }}>{st.url}</p>
        <table className="tbl"><tbody>
          <tr><td>Last sync</td><td>{when(st.last_sync)}</td></tr>
          <tr><td>Orders waiting to upload</td><td>{st.pending_orders}</td></tr>
          <tr><td>Last backup</td><td>{when(st.last_backup)}</td></tr>
          {st.last_error && <tr><td>Problem</td><td className="err">{st.last_error} — will retry every minute</td></tr>}
        </tbody></table>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="primary" disabled={!!busy} onClick={act('sync', async () => { await api('/cloud/sync', {}); notify('Synced') })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
          <button className="ghost" disabled={!!busy} onClick={act('backup', async () => { await api('/cloud/backup', {}); notify('Backup uploaded') })}>{busy === 'backup' ? 'Uploading…' : 'Backup now'}</button>
          <button className="ghost danger" onClick={act('off', async () => { if (await confirmBox('Stop syncing this branch?')) await api('/cloud/disconnect', {}) })}>Disconnect</button>
        </div>
      </> : <>
        <h3>Connect to HazelPOS Cloud</h3>
        <p className="muted" style={{ fontSize: 13 }}>The owner sees every branch's sales, cash shortages and low stock from their phone, and this branch's data is backed up daily.
          Create the branch in the cloud dashboard, then paste its address and key here. Billing keeps working without internet; data uploads when the connection is back.</p>
        <label>Cloud address<input placeholder="https://cloud.example.com" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} /></label>
        <label>Branch key<input type="password" placeholder="hz_…" value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} /></label>
        <button className="primary" disabled={!!busy || !form.url || !form.key}
          onClick={act('connect', async () => { const r = await api('/cloud/connect', form); setForm({ url: form.url, key: '' }); notify(`Connected as ${r.branch}`) })}>
          {busy === 'connect' ? 'Connecting…' : 'Connect'}</button>
      </>}
    </div>
  )
}
