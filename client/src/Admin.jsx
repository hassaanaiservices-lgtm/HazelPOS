import { useEffect, useState } from 'react'
import { api, rs, parseModifiers, downloadCsv, dealItems } from './lib'
import { Icon } from './ui'
import Integrations from './Integrations'
import { QrCodesModal } from './QrOrders'
import BotFaq from './BotFaq'
import { toastError, confirmBox, promptBox } from './notify'

const TABS = ['Restaurant', 'Staff & PINs', 'Alerts', 'Updates', 'WhatsApp bot', 'Integrations', 'Cloud', 'Activity Log']

export default function Admin({ onChanged, notify, updateNew, onUpdateSeen }) {
  const [tab, setTab] = useState('Restaurant')
  useEffect(() => { if (tab === 'Updates' && updateNew) onUpdateSeen() }, [tab, updateNew]) // opened = seen: stop blinking
  return (
    <section className="admin">
      <div className="row-head"><h2>Settings</h2>
        <div className="tabs">{TABS.map(t => <button key={t} id={'tab-' + t} className={(tab === t ? 'active' : '') + (t === 'Updates' && updateNew ? ' attention' : '')} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>
      {tab === 'Restaurant' && <RestaurantSettings onChanged={onChanged} notify={notify} />}
      {tab === 'Staff & PINs' && <LoginPins notify={notify} />}
      {tab === 'Alerts' && <StockAlerts notify={notify} />}
      {tab === 'Updates' && <Updates notify={notify} />}
      {tab === 'WhatsApp bot' && <><BotBehaviour notify={notify} /><BotFaq notify={notify} /></>}
      {tab === 'Integrations' && <Integrations onChanged={onChanged} notify={notify} />}
      {tab === 'Cloud' && <CloudSettings notify={notify} />}
      {tab === 'Activity Log' && <ActivityLog />}
    </section>
  )
}

// Its own section in the sidebar (not under Settings): floors, tables and delivery zones
const PLACE_TABS = [['floors', 'Floors'], ['tables', 'Tables'], ['zones', 'Delivery zones']]
export function PlacesSection({ onChanged, notify }) {
  const [tab, setTab] = useState('tables')
  const [floors, setFloors] = useState([])
  const [qr, setQr] = useState(null) // 'all' or a table id: the printable QR sheet
  useEffect(() => { if (tab === 'tables') api('/floors').then(f => setFloors(f.map(x => x.name))).catch(() => {}) }, [tab])
  return (
    <section className="admin">
      {qr && <QrCodesModal only={qr === 'all' ? null : qr} onClose={() => setQr(null)} />}
      <div className="row-head"><h2>Tables & delivery</h2>
        <div className="tabs" role="tablist">{PLACE_TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      </div>
      {tab === 'floors' && <SimpleAdmin route="floors" listUrl="/floors" onChanged={onChanged} notify={notify}
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
      {tab === 'tables' && <SimpleAdmin route="tables" listUrl="/tables" onChanged={onChanged} notify={notify}
        headExtra={<button className="ghost" onClick={() => setQr('all')}><Icon name="qr" size={16} />Print all QR codes</button>}
        rowExtra={t => <button className="ghost" onClick={() => setQr(t.id)}><Icon name="qr" size={16} />QR code</button>}
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
      {tab === 'zones' && <SimpleAdmin route="delivery-zones" listUrl="/delivery-zones" notify={notify}
        fields={[['name', 'Area name (e.g. DHA Phase 5)'], ['fee', 'Delivery fee (Rs)', 'number'], ['min_order', 'Minimum order (Rs)', 'number'],
          ['free_above', 'Free delivery above (Rs, 0 = never)', 'number'], ['eta_min', 'Usual delivery time (minutes)', 'number'], ['active', 'Delivering here (1 = yes, 0 = paused)', 'select', [1, 0]]]}
        blank={{ name: '', fee: 100, min_order: 0, free_above: 0, eta_min: 40, active: 1 }}
        show={z => <><b>{z.name}</b><span className="pill">{rs(z.fee)}</span>{z.min_order > 0 && <span className="muted">min {rs(z.min_order)}</span>}
          {z.free_above > 0 && <span className="muted">free above {rs(z.free_above)}</span>}<span className="muted">~{z.eta_min} min</span>{!+z.active && <span className="pill sm low-pill">Off</span>}</>} />}
    </section>
  )
}

// Its own section in the sidebar (not under Settings): items, categories and the menu card pictures
const MENU_TABS = [['items', 'Items'], ['categories', 'Categories'], ['pictures', 'Menu pictures']]
export function MenuSection({ onChanged, notify }) {
  const [tab, setTab] = useState('items')
  return (
    <section className="admin">
      <div className="row-head"><h2>Menu</h2>
        <div className="tabs" role="tablist">{MENU_TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      </div>
      {tab === 'items' && <MenuAdmin onChanged={onChanged} notify={notify} />}
      {tab === 'pictures' && <MenuPictures notify={notify} />}
      {tab === 'categories' && <SimpleAdmin route="categories" listUrl="/menu?all=1" pick={d => d.categories} onChanged={onChanged} notify={notify}
        fields={[['name', 'Name'], ['color', 'Colour', 'color']]} blank={{ name: '', color: '#ff6b35' }}
        show={c => <><i className="swatch" style={{ background: c.color }} />{c.name}</>} />}
    </section>
  )
}

function MenuAdmin({ onChanged, notify }) {
  const [data, setData] = useState({ categories: [], products: [] })
  const [edit, setEdit] = useState(null)
  const [importing, setImporting] = useState(false)
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
      modifiers_list: parseModifiers(p),
      deal_list: dealItems(p).map(d => ({ product_id: +d.product_id, size: d.size || '', qty: +d.qty || 1 })),
      is_deal: dealItems(p).length > 0,
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
        .filter(g => g.name && g.options.length)),
      // A deal: the items inside (for the kitchen, stock and the WhatsApp bot). combo_for: offered on that item too
      deal_items: edit.is_deal ? JSON.stringify((edit.deal_list || []).filter(d => d.product_id).map(d => ({ product_id: +d.product_id, size: d.size || '', qty: Math.max(1, +d.qty || 1) }))) : '',
      combo_for: edit.is_deal && +edit.combo_for ? +edit.combo_for : null,
    });
    setEdit(null);
    load();
    onChanged();
    notify('Item saved');
  };

  const del = async p => { if (await confirmBox(`Delete ${p.name}?`)) { await api(`/products/${p.id}/delete`, {}); load(); onChanged() } }
  // A deal starts in the "Deals" category (made the first time) with one empty item row
  const addDeal = async () => {
    let c = data.categories.find(x => /deal|combo/i.test(x.name))
    if (!c) { try { c = await api('/categories', { name: 'Deals', color: '#ff6b35' }); load() } catch (e) { return toastError(e.message) } }
    openEdit({ name: '', price: '', emoji: '🎁', category_id: c.id, active: 1, subtitle: '', description: '', ingredients_str: '', sizes_list: [] })
    setEdit(e => ({ ...e, is_deal: true, deal_list: [{ product_id: '', size: '', qty: 1 }] }))
  }
  const nameOf = id => data.products.find(x => x.id === +id)?.name || '?'
  const cat = id => data.categories.find(c => c.id === id)

  return (
    <>
      <div className="row add">
        <button className="primary" id="add-item" onClick={() => openEdit({ name: '', price: '', emoji: '🍽️', category_id: data.categories[0]?.id, active: 1, subtitle: '', description: '', ingredients_str: '', sizes_list: [] })}>+ Add item</button>
        <button className="primary" id="add-deal" onClick={addDeal}>+ Add deal</button>
        <button className="ghost" id="import-menu" onClick={() => setImporting(true)}><Icon name="plus" size={16} />Import from Excel</button>
      </div>
      {importing && <MenuImport onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(); onChanged() }} notify={notify} />}
      <div className="admin-list">
        {data.products.map(p => (
          <div key={p.id} className={'admin-row' + (p.active ? '' : ' off')}>
            <span className="emoji-sm">{p.emoji}</span><b>{p.name}</b>
            {dealItems(p).length > 0 && <span className="deal-pill" title={dealItems(p).map(d => `${d.qty}× ${nameOf(d.product_id)}${d.size ? ` (${d.size})` : ''}`).join(', ')}>
              {+p.combo_for ? `Combo on ${nameOf(p.combo_for)}` : 'Deal'}: {dealItems(p).map(d => `${+d.qty > 1 ? d.qty + '× ' : ''}${nameOf(d.product_id)}`).join(', ')}</span>}
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
            <h2>{edit.is_deal ? (edit.id ? 'Edit deal' : 'New deal') : (edit.id ? 'Edit item' : 'New item')}</h2>
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
            {/* A deal is a normal item in a "Deals" category: what's inside goes in the description (POS, QR menu and WhatsApp bot all show it) */}
            {(() => { const isDeal = /deal|combo/i.test(cat(+edit.category_id)?.name || ''); return (
            <label>{isDeal ? "What's in the deal" : 'Description'}
              <textarea rows={2} style={{ width: '100%', borderRadius: 12, padding: '10px 14px', background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--text)', font: 'inherit' }}
                value={edit.description || ''} placeholder={isDeal ? 'e.g. 1 Zinger burger, 1 regular fries, 1 soft drink (345 ml)' : 'Describe ingredients, cooking style, taste...'}
                onChange={e => setEdit({ ...edit, description: e.target.value })} />
            </label>) })()}
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

            <DealEditor edit={edit} setEdit={setEdit} products={data.products} categories={data.categories} onCategories={load} />

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

// A deal or combo = several menu items for one price. Shown in the Deals tab of Billing; with "Offer with" set, it's also
// offered as "Make it a combo" when that item is tapped. The kitchen sees every item inside; stock goes down for each.
function DealEditor({ edit, setEdit, products, categories, onCategories }) {
  const items = products.filter(p => p.id !== edit.id && !dealItems(p).length) // a deal holds normal items only
  const sizesOf = id => { try { const s = JSON.parse(products.find(p => p.id === +id)?.sizes || '[]'); return Array.isArray(s) ? s : [] } catch { return [] } }
  const list = edit.deal_list || []
  const setRow = (i, patch) => setEdit({ ...edit, deal_list: list.map((d, n) => n === i ? { ...d, ...patch } : d) })
  const turnOn = async on => {
    let category_id = edit.category_id
    if (on) {
      let c = categories.find(x => /deal|combo/i.test(x.name))
      if (!c) { c = await api('/categories', { name: 'Deals', color: '#ff6b35' }); onCategories() }
      category_id = c.id
    }
    setEdit({ ...edit, is_deal: on, category_id, deal_list: on && !list.length ? [{ product_id: '', size: '', qty: 1 }] : list })
  }
  return (
    <div className="deal-editor">
      <label className="check"><input type="checkbox" checked={!!edit.is_deal} onChange={e => turnOn(e.target.checked)} /> This is a deal or combo (several items for one price)</label>
      {edit.is_deal && <>
        <div className="muted" style={{ fontSize: 13 }}>Items inside. The kitchen sees each one, and stock goes down for each.</div>
        {list.map((d, i) => {
          const sizes = sizesOf(d.product_id)
          return (
            <div key={i} className="deal-row">
              <select aria-label="Item" value={d.product_id} onChange={e => setRow(i, { product_id: +e.target.value, size: sizesOf(e.target.value)[0]?.name || '' })}>
                <option value="">Choose an item…</option>
                {items.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
              </select>
              {sizes.length > 1 ? <select aria-label="Size" value={d.size} onChange={e => setRow(i, { size: e.target.value })}>
                {sizes.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select> : <span />}
              <input aria-label="Quantity" type="number" min="1" value={d.qty} onChange={e => setRow(i, { qty: e.target.value })} />
              <button type="button" className="ghost danger" aria-label="Remove item" onClick={() => setEdit({ ...edit, deal_list: list.filter((_, n) => n !== i) })}><Icon name="x" size={16} /></button>
            </div>
          )
        })}
        <button type="button" className="ghost" onClick={() => setEdit({ ...edit, deal_list: [...list, { product_id: '', size: '', qty: 1 }] })}>+ Add item to the deal</button>
        <label>Also offer it as a combo on
          <select value={edit.combo_for || ''} onChange={e => setEdit({ ...edit, combo_for: e.target.value })}>
            <option value="">No, only in the Deals tab</option>
            {items.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name} (shows "Make it a combo")</option>)}
          </select></label>
      </>}
    </div>
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

function SimpleAdmin({ route, listUrl, pick = d => d, fields, blank, show, onChanged = () => {}, notify, rowExtra = null, headExtra = null }) {
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
      <div className="row add"><button className="primary" onClick={() => setEdit({ ...blank })}>+ Add</button>{headExtra}</div>
      <div className="admin-list">
        {list.map(x => (
          <div key={x.id} className="admin-row">{show(x)}
            <span style={{ flex: 1 }} />
            {rowExtra?.(x)}
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
      {f('name', 'Restaurant name')}
      <div className="logo-edit">
        <div className="logo-preview">{s.logo_image ? <img className="logo-img" src={s.logo_image} alt="Logo" /> : s.logo}</div>
        <label className="primary file-btn">{s.logo_image ? 'Change logo' : 'Upload logo'}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async e => {
            const file = e.target.files[0]; e.target.value = ''
            if (file) try { setS({ ...s, logo_image: await shrink(file, 256, 'image/png') }) } catch (err) { toastError(err.message) }
          }} /></label>
        {s.logo_image && <button className="ghost danger" onClick={() => setS({ ...s, logo_image: '' })}>Remove logo</button>}
        <span className="muted" style={{ fontSize: 13 }}>Shown on the POS, receipts, invoices and the table QR menu. Press Save settings after.</span>
      </div>
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
    </div>
  )
}

// App updates (desktop app): status, check now, update now. Installs at night by itself when no orders are open.
const UPDATE_TEXT = {
  idle: 'Waiting for the first check.', checking: 'Checking for an update…', none: 'You have the newest version.',
  downloading: 'Downloading the update in the background. You can keep working.', ready: 'An update is downloaded and ready to install.',
  installing: 'Installing: HazelPOS restarts in about a minute.', error: 'The last check failed (no internet?). It tries again by itself.',
  unavailable: 'Updates come with the installed HazelPOS app.',
}
function Updates({ notify }) {
  const [u, setU] = useState(null)
  const load = () => api('/update').then(setU).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
  if (!u) return null
  const install = async () => {
    const warn = u.open_orders ? ` ${u.open_orders} order(s) are still open; they stay open and come back after the update.` : ''
    if (!await confirmBox(`Install the update now? HazelPOS closes for about a minute and opens again by itself. A backup is made first.${warn}`, { title: 'Update HazelPOS', confirmLabel: 'Update now' })) return
    try { await api('/update/install', {}); notify('Updating: HazelPOS restarts in about a minute') } catch (e) { toastError(e.message) }
  }
  return (
    <div className="admin-form">
      <h3>App updates</h3>
      <p>Version <b>{u.current}</b>{u.version && u.version !== u.current ? <> · new version <b>{u.version}</b></> : null}</p>
      <p className={u.state === 'error' ? 'err' : 'muted'}>{UPDATE_TEXT[u.state] || u.state}{u.state === 'downloading' && u.percent ? ` ${u.percent}%` : ''}{u.state === 'error' && u.error ? ` (${u.error})` : ''}</p>
      {u.vendor_requested_at && <p className="notice-inline">HazelPOS asked all restaurants to update ({new Date(u.vendor_requested_at).toLocaleDateString()}).</p>}
      {u.desktop && <div className="row">
        {u.state === 'ready' && u.allowed && <button className="primary" onClick={install}>Update now</button>}
        {u.state === 'ready' && !u.allowed && <span className="muted">HazelPOS is testing this version with a few restaurants first. It installs as soon as it's released to everyone.</span>}
        <button className="ghost" disabled={['checking', 'downloading', 'installing'].includes(u.state)} onClick={async () => { await api('/update/check', {}).catch(e => toastError(e.message)); notify('Checking for updates…'); setTimeout(load, 2000) }}>Check for updates</button>
      </div>}
      <p className="muted" style={{ fontSize: 13 }}>How updates work: they download by themselves in the background. If you don't press "Update now", HazelPOS installs the update at night (3–5 AM) when no orders are open. Before every update, your data is backed up to HazelPOS Cloud and copied on this PC, and the update never changes your menu, orders or settings.</p>
    </div>
  )
}

// End-of-day WhatsApp to the owner when ingredients are really low (server/stock-alert.js)
function StockAlerts({ notify }) {
  const [s, setS] = useState(null)
  const [preview, setPreview] = useState(null)
  const loadPreview = () => api('/low-stock-alert/preview').then(setPreview).catch(() => {})
  useEffect(() => { api('/settings').then(setS); loadPreview() }, [])
  if (!s) return null
  const set = k => e => setS({ ...s, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value })
  const save = async () => {
    try { await api('/settings', { low_stock_alert: s.low_stock_alert, low_stock_alert_to: s.low_stock_alert_to, low_stock_alert_time: s.low_stock_alert_time, low_stock_alert_percent: s.low_stock_alert_percent, low_stock_alert_min_items: s.low_stock_alert_min_items }); notify('Alert saved'); loadPreview() }
    catch (e) { toastError(e.message) }
  }
  const test = async () => {
    try { await save(); const r = await api('/low-stock-alert/test', {}); notify(r.sent ? `Sent to ${r.sent} number(s)` : r.message || 'Nothing to send') }
    catch (e) { toastError(e.message) }
  }
  return (
    <div className="admin-form">
      <h3>Low-stock WhatsApp alert</h3>
      <p className="muted" style={{ fontSize: 13 }}>Once a day, at the time you choose, the restaurant's WhatsApp sends you the ingredients that are really low, so you can order before tomorrow. A little low doesn't count, and if nothing is low enough, no message is sent.</p>
      <label className="check"><input type="checkbox" checked={s.low_stock_alert === '1'} onChange={set('low_stock_alert')} /> Send the alert</label>
      <label>Send to (WhatsApp numbers, separated by commas)<input value={s.low_stock_alert_to} onChange={set('low_stock_alert_to')} placeholder="0300 1234567, 0321 7654321" inputMode="tel" /></label>
      <div className="two">
        <label>Time (end of the day)<input type="time" value={s.low_stock_alert_time} onChange={set('low_stock_alert_time')} /></label>
        <label>Only when at least this many are low<input type="number" min="1" value={s.low_stock_alert_min_items} onChange={set('low_stock_alert_min_items')} /></label>
      </div>
      <label>How low counts as "really low"
        <select value={s.low_stock_alert_percent} onChange={set('low_stock_alert_percent')}>
          <option value="100">At its "Alert below" level</option>
          <option value="75">Down to 75% of its alert level</option>
          <option value="50">Down to half of its alert level (recommended)</option>
          <option value="25">Down to a quarter of its alert level</option>
        </select></label>
      <p className="muted" style={{ fontSize: 13 }}>Each ingredient's "Alert below" level is set in Inventory → Stock. Example: buns alert at 30 pcs, "half" = the message counts buns once they're at 15 or fewer.</p>
      <div className="row"><button className="primary" onClick={save}>Save</button><button className="ghost" onClick={test}>Send a test now</button></div>
      {preview && <div className="alert-preview">
        <b>{preview.low.length ? `If it were sent now (${preview.low.length} ingredient${preview.low.length === 1 ? '' : 's'}):` : 'Nothing is low enough right now, so no message would be sent.'}</b>
        {preview.low.length > 0 && <pre>{preview.text}</pre>}
        {preview.low.length > 0 && !preview.enough && <p className="muted">Not sent: fewer than {s.low_stock_alert_min_items} ingredients are that low.</p>}
      </div>}
      <p className="muted" style={{ fontSize: 13 }}>It's sent from the restaurant's linked WhatsApp (WhatsApp screen). If it's not connected at that time, it tries again every minute until midnight.</p>
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
      <h3>Staff & PINs</h3>
      <p className="muted" style={{ fontSize: 13 }}>Only the owner (admin) sees this. Type a new PIN (4 to 12 letters or numbers; capital or small letters don't matter) to change or reset anyone's PIN, e.g. when a cashier forgets theirs or leaves. They are signed out on every screen and must use the new PIN. If you still use the default PINs (1234, 1111, 2222), change them now. Riders get their PIN in the Riders section.</p>
      {users.map(u => (
        <div key={u.id} className="two" style={{ alignItems: 'end' }}>
          <label>{u.name} <span className="pill sm">{u.role}</span>
            <input type="password" autoCapitalize="none" autoComplete="new-password" maxLength={12} placeholder="New PIN (4+ letters or numbers)" value={pins[u.id] || ''}
              onChange={e => setPins({ ...pins, [u.id]: e.target.value.replace(/[^a-z0-9]/gi, '') })} /></label>
          <button className="ghost" disabled={(pins[u.id] || '').length < 4} onClick={() => change(u)}>Change PIN</button>
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
        <h3 style={{ marginTop: 22 }}>Restore from cloud backup</h3>
        <p className="muted" style={{ fontSize: 13 }}>For a new or repaired PC: brings back this branch's newest backup from the cloud (orders, menu, staff and PINs, customers, stock, settings). Everything on this PC now is replaced. A new PC activated with a code does this by itself.</p>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="ghost danger" disabled={!!busy} onClick={act('restore', async () => {
            const typed = await promptBox('Everything on this PC (orders, menu, staff, settings) will be replaced by the cloud backup. Type RESTORE to continue.', { title: 'Restore from cloud backup?', placeholder: 'RESTORE', confirmLabel: 'Restore', required: true })
            if (typed === null) return
            const r = await api('/cloud/restore', { confirm: typed.trim().toUpperCase() })
            notify(`Restored the backup from ${new Date(r.at).toLocaleString()}: ${r.orders} orders, ${r.products} menu items`)
            setTimeout(() => window.dispatchEvent(new Event('pos-logout')), 1500) // logins were cleared: PIN screen
          })}>{busy === 'restore' ? 'Restoring…' : 'Restore from cloud backup'}</button>
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

// Photos of the menu card. The WhatsApp assistant sends them when a customer asks "menu bhejo".
// Pictures are shrunk in the browser first (max 1600 px, JPEG), so a phone photo of 5 MB becomes ~300 KB.
const shrink = (file, max = 1600, type = 'image/jpeg') => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => {
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) })
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(img.src)
    resolve(c.toDataURL(type, 0.85))
  }
  img.onerror = () => reject(new Error('That file is not a picture'))
  img.src = URL.createObjectURL(file)
})

function MenuPictures({ notify }) {
  const [pics, setPics] = useState([])
  const [busy, setBusy] = useState(false)
  const load = () => api('/menu-images').then(setPics)
  useEffect(() => { load() }, [])

  const upload = async e => {
    const files = [...e.target.files]; e.target.value = ''
    setBusy(true)
    try {
      for (const f of files) await api('/menu-images', { data: await shrink(f), caption: '' })
      notify(files.length > 1 ? 'Pictures added' : 'Picture added')
    } catch (err) { toastError(err.message) }
    finally { setBusy(false); load() }
  }
  const caption = async (p, text) => { if (text !== (p.caption || '')) { await api(`/menu-images/${p.id}`, { caption: text }).catch(e => toastError(e.message)); load() } }
  const del = async p => { if (await confirmBox('Delete this menu picture?', { confirmLabel: 'Delete', danger: true })) { await api(`/menu-images/${p.id}/delete`, {}); load() } }

  return (
    <>
      <p className="muted">Photos of your menu card. When a customer on WhatsApp asks to see the menu, the assistant sends these pictures instead of typing out the whole list. Up to 6 pictures.</p>
      <label className={'primary add file-btn' + (busy || pics.length >= 6 ? ' disabled' : '')}>
        <Icon name="plus" size={16} />{busy ? 'Adding…' : 'Add pictures'}
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy || pics.length >= 6} onChange={upload} />
      </label>
      {!pics.length && <div className="muted menu-pics-empty">No menu pictures yet. The assistant will describe the menu in text.</div>}
      <div className="menu-pics">
        {pics.map((p, i) => (
          <figure key={p.id} className="menu-pic card">
            <img src={`/api/menu-images/${p.id}/image`} alt={p.caption || `Menu picture ${i + 1}`} />
            <figcaption>
              <input defaultValue={p.caption || ''} placeholder={`Caption (optional), e.g. Page ${i + 1}`} onBlur={e => caption(p, e.target.value.trim())} />
              <button className="ghost danger" onClick={() => del(p)} aria-label="Delete picture"><Icon name="x" size={16} /></button>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  )
}

// Menu from an Excel (.xlsx) or CSV file: download the template, fill it in, choose it, check what will change, import.
// The server reads the file (server/menu-import.js); the first call is a dry run.
function MenuImport({ onClose, onDone, notify }) {
  const [file, setFile] = useState(null) // { name, base64 }
  const [hide, setHide] = useState(false)
  const [plan, setPlan] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const template = async () => {
    const [head, ...rows] = await api('/menu/import-template')
    downloadCsv('hazelpos-menu-template.csv', rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))))
  }
  const check = async (f = file, hideMissing = hide) => {
    if (!f) return
    setBusy(true); setErr(''); setPlan(null)
    try { setPlan(await api('/menu/import', { file: f.base64, name: f.name, hide_missing: hideMissing })) }
    catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }
  const choose = e => {
    const f = e.target.files[0]; e.target.value = ''
    if (!f) return
    const r = new FileReader()
    r.onload = () => { const next = { name: f.name, base64: String(r.result).split(',')[1] || '' }; setFile(next); check(next) }
    r.readAsDataURL(f)
  }
  const apply = async () => {
    setBusy(true)
    try {
      const r = await api('/menu/import', { file: file.base64, name: file.name, hide_missing: hide, apply: true })
      notify(`Menu imported: ${r.added.length} new, ${r.updated.length} updated`)
      onDone()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  const list = (label, names) => names.length > 0 && <details className="import-list"><summary>{label}: <b>{names.length}</b></summary><p className="muted">{names.join(', ')}</p></details>

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal import-modal" onClick={e => e.stopPropagation()}>
        <h2>Import menu from Excel</h2>
        <p className="muted">One row per item, or one row per size. Columns: Category, Item, Size, Price, Description, Emoji, Available, and for deals: Deal items (e.g. "2x Zinger Burger; Fries; Soft Drink") and Combo for (the item it's offered with). Items already on the menu are matched by name and updated.</p>
        <div className="row">
          <button className="ghost" onClick={template}>Download template</button>
          <label className="primary file-btn">{file ? 'Choose another file' : 'Choose Excel file'}
            <input type="file" accept=".xlsx,.csv" hidden onChange={choose} /></label>
        </div>
        {file && <p className="muted">File: <b>{file.name}</b></p>}
        <label className="check"><input type="checkbox" checked={hide} onChange={e => { setHide(e.target.checked); check(file, e.target.checked) }} /> Hide items on the menu that aren't in this file</label>
        {busy && !plan && <p className="muted">Reading the file…</p>}
        {err && <div className="err">{err}</div>}
        {plan && <div className="import-plan">
          <p><b>{plan.items}</b> items in the file. <b>{plan.unchanged}</b> already up to date.</p>
          {list('New items', plan.added)}
          {list('Updated items', plan.updated)}
          {list('New categories', plan.new_categories)}
          {list('Will be hidden', plan.hidden)}
          {plan.errors.length > 0 && <div className="import-errors" role="alert">
            <b>Fix these rows in the file, then choose it again:</b>
            <ul>{plan.errors.map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}</ul>
          </div>}
        </div>}
        <div className="actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !plan || plan.errors.length > 0 || !(plan.added.length + plan.updated.length + plan.hidden.length)} onClick={apply}>Import</button>
        </div>
      </div>
    </div>
  )
}
