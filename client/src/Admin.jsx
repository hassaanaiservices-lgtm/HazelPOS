import { useEffect, useState } from 'react'
import { api, rs, parseModifiers, downloadCsv, dealItems, lsSet, lsDel } from './lib'
import { Icon } from './ui'
import Integrations from './Integrations'
import { QrCodesModal } from './QrOrders'
import BotFaq from './BotFaq'
import { toastError, confirmBox, promptBox } from './notify'

const TABS = ['Restaurant', 'Staff & PINs', 'WhatsApp', 'Payments & tax', 'Printers', 'Devices', 'Activity log']

export default function Admin({ onChanged, notify }) {
  const [tab, setTab] = useState('Restaurant')
  return (
    <section className="admin">
      <div className="row-head"><h2>Settings</h2>
        <div className="tabs">{TABS.map(t => <button key={t} id={'tab-' + t} className={(tab === t ? 'active' : '')} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>
      {tab === 'Restaurant' && <RestaurantSettings onChanged={onChanged} notify={notify} />}
      {tab === 'Staff & PINs' && <LoginPins notify={notify} />}
      {tab === 'WhatsApp' && <><BotBehaviour notify={notify} /><BotFaq notify={notify} /><StockAlerts notify={notify} /></>}
      {tab === 'Payments & tax' && <Integrations onChanged={onChanged} notify={notify} />}
      {tab === 'Printers' && <Printers notify={notify} />}
      {tab === 'Devices' && <Devices notify={notify} />}
      {tab === 'Activity log' && <ActivityLog />}
    </section>
  )
}

// Settings -> Printers: the printer helper (HazelPOS Bridge) on the shop PC prints the tickets the server queues.
function Printers({ notify }) {
  const [st, setSt] = useState(null)
  const [key, setKey] = useState('') // shown once, only when "Show key instead" is used
  const [pair, setPair] = useState(null) // { code, expires_at }: the 6-digit pairing code
  const [, tick] = useState(0)
  const load = () => api('/print/status').then(setSt).catch(e => toastError(e.message))
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!pair) return; const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t) }, [pair])
  const setup = async () => {
    try { setKey(''); setPair(await api('/print/pairing', {})) } catch (e) { toastError(e.message) }
  }
  const showKey = async () => {
    try { const d = await api('/devices', { name: 'Printer helper', kind: 'bridge' }); setPair(null); setKey(d.device_key); load() } catch (e) { toastError(e.message) }
  }
  const left = pair ? Math.max(0, Math.round((Date.parse(pair.expires_at) - Date.now()) / 1000)) : 0
  const copy = async text => { try { await navigator.clipboard.writeText(text); notify('Copied') } catch { toastError('Could not copy. Select the text and copy it') } }
  const reprint = async j => { try { await api(`/print/jobs/${j.id}/retry`, {}); notify('Sent to printer'); load() } catch (e) { toastError(e.message) } }
  const test = async () => { try { await api('/print/test', {}); notify('Test page sent') } catch (e) { toastError(e.message) } }
  if (!st) return null
  const cmd = 'node bridge/index.js --config bridge/config.json'
  return (
    <div className="card settings-card">
      <h3>Printer helper</h3>
      <p className={st.bridge_online ? 'ok-t' : 'warn-t'} role="status">{st.bridge_online ? 'Online: tickets print as they are sent.' : st.bridge_set_up ? 'Offline: tickets wait here until it is running again.' : 'Not set up yet.'}
        {st.waiting > 0 && <> {st.waiting} {st.waiting === 1 ? 'ticket' : 'tickets'} waiting.</>}</p>
      <p className="muted" style={{ fontSize: 13 }}>A small app (HazelPOS Printer) on one PC in the shop prints your receipts and kitchen tickets. Printer addresses are set in that app.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="primary" style={{ minHeight: 44 }} onClick={setup}>Set up printer helper</button>
        <button className="ghost" style={{ minHeight: 44 }} disabled={!st.bridge_set_up} onClick={test}>Send test page</button>
      </div>
      {pair && <div className="card" style={{ marginTop: 12 }}>
        <p>On the shop PC, open <b>HazelPOS Printer</b> and type this code:</p>
        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 6 }} aria-label={'Pairing code ' + pair.code.split('').join(' ')}>{pair.code}</div>
        <p className="muted" style={{ fontSize: 13 }}>{left > 0 ? `Works once, for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more minutes.` : 'This code has expired. Press "Set up printer helper" for a new one.'}</p>
        <button className="ghost" style={{ minHeight: 44 }} onClick={showKey}>Show key instead</button>
      </div>}
      {key && <div className="card" style={{ marginTop: 12 }}>
        <p><b>Copy this key now.</b> It is shown only once.</p>
        <code style={{ wordBreak: 'break-all' }}>{key}</code>
        <div style={{ margin: '8px 0' }}><button className="ghost" style={{ minHeight: 44 }} onClick={() => copy(key)}>Copy key</button></div>
        <p className="muted" style={{ fontSize: 13 }}>On the shop PC, put it in <code>bridge/config.json</code> as <code>"key"</code>, then start the helper:</p>
        <code style={{ wordBreak: 'break-all' }}>{cmd}</code>
        <div style={{ marginTop: 8 }}><button className="ghost" style={{ minHeight: 44 }} onClick={() => copy(cmd)}>Copy command</button></div>
      </div>}
      <h3 style={{ marginTop: 18 }}>Tickets that did not print</h3>
      {st.failed_today.map(j => (
        <div key={j.id} className="device-row">
          <div><b>{j.label}</b><br /><small className="err">{j.error}</small></div>
          <button className="ghost" style={{ minHeight: 44 }} onClick={() => reprint(j)}>Reprint</button>
        </div>
      ))}
      {!st.failed_today.length && <p className="muted">Nothing failed in the last 24 hours.</p>}
    </div>
  )
}

// Tills and tablets (Settings -> Devices). "Use this device as a till" gives this browser a long-lived key for this restaurant,
// signs the owner out here and shows the lock screen (client/src/TillLock.jsx). Revoke removes a lost tablet.
function Devices({ notify }) {
  const [list, setList] = useState([])
  const load = () => api('/devices').then(l => setList(l.filter(d => d.kind !== 'bridge'))).catch(e => toastError(e.message))
  useEffect(() => { load() }, [])
  const setup = async () => {
    const name = await promptBox('What should this till be called?', { title: 'Use this device as a till', placeholder: 'Till 1', confirmLabel: 'Set up', required: true })
    if (!name?.trim()) return
    try {
      const d = await api('/devices', { name: name.trim() })
      await api('/logout', {}).catch(() => {})
      ;['pos_token', 'pos_user', 'hz_tenant'].forEach(lsDel)
      lsSet('hz_device', d.device_key)
      window.dispatchEvent(new Event('pos-restart')) // shows the lock screen
    } catch (e) { toastError(e.message) }
  }
  const revoke = async d => {
    if (!await confirmBox(`Remove ${d.name}? It will stop working until you set it up again.`, { title: 'Remove this till', confirmLabel: 'Remove', danger: true })) return
    try { await api(`/devices/${d.id}/revoke`, {}); notify(`${d.name} removed`); load() } catch (e) { toastError(e.message) }
  }
  const when = t => t ? new Date(t).toLocaleString() : 'never'
  return (
    <div className="card settings-card">
      <h3>Devices</h3>
      <p className="muted" style={{ fontSize: 13 }}>A till remembers this restaurant. Staff open it by tapping their name and entering their PIN, so PINs only work on your tills.</p>
      <button className="primary" style={{ minHeight: 44 }} onClick={setup}>Use this device as a till</button>
      {list.map(d => (
        <div key={d.id} className="device-row">
          <div><b>{d.name}</b> {d.revoked_at && <span className="pill sm">Removed</span>}<br /><small className="muted">Last used {when(d.last_seen)}</small></div>
          {!d.revoked_at && <button className="ghost" style={{ minHeight: 44 }} onClick={() => revoke(d)}>Revoke</button>}
        </div>
      ))}
      {!list.length && <p className="muted">No tills set up yet.</p>}
    </div>
  )
}

// Its own section in the sidebar (not under Settings): floors, tables and delivery zones
const PLACE_TABS = [['tables', 'Tables & floors'], ['zones', 'Delivery zones']]
export function PlacesSection({ onChanged, notify }) {
  const [tab, setTab] = useState('tables')
  const [floors, setFloors] = useState([])
  const [qr, setQr] = useState(null) // 'all' or a table id: the printable QR sheet
  const loadFloors = () => api('/floors').then(f => setFloors(f.map(x => x.name))).catch(() => {})
  useEffect(() => { if (tab === 'tables') loadFloors() }, [tab])
  return (
    <section className="admin">
      {qr && <QrCodesModal only={qr === 'all' ? null : qr} onClose={() => setQr(null)} />}
      <div className="row-head"><h2>Tables & delivery</h2>
        <div className="tabs" role="tablist">{PLACE_TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      </div>
      {tab === 'tables' && <SimpleAdmin route="floors" title="Floors" listUrl="/floors" onChanged={() => { loadFloors(); onChanged?.() }} notify={notify}
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
      {tab === 'tables' && <SimpleAdmin route="tables" title="Tables" listUrl="/tables" onChanged={onChanged} notify={notify}
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

function SimpleAdmin({ route, listUrl, pick = d => d, fields, blank, show, onChanged = () => {}, notify, rowExtra = null, headExtra = null, title = '' }) {
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
      {title && <h3 style={{ margin: '14px 0 6px' }}>{title}</h3>}
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

      <h3 style={{ marginTop: 18 }}>Receipt paper</h3>
      <p className="muted" style={{ fontSize: 13 }}>Printer addresses are set on the shop PC (Settings → Printers).</p>
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

// Staff logins: add, edit (name, role, PIN) and remove. PINs are only stored scrambled, so nobody can read one back;
// they are unique inside the restaurant and only work on this restaurant's tills.
const ROLE_LABEL = { admin: 'Owner', cashier: 'Cashier', kitchen: 'Kitchen' }
const blankStaff = { id: null, name: '', role: 'cashier', pin: '' }
function LoginPins({ notify }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState(null) // null = closed; blankStaff = adding; a user = editing
  const [busy, setBusy] = useState(false)
  const me = (() => { try { return JSON.parse(localStorage.getItem('pos_user') || '{}') } catch { return {} } })()
  const load = () => api('/users').then(list => setUsers(list.filter(u => u.role !== 'rider')))
  useEffect(() => { load() }, [])
  const save = async e => {
    e.preventDefault(); setBusy(true)
    try {
      await api('/users', { id: form.id || undefined, name: form.name.trim(), role: form.role, pin: form.pin || undefined })
      notify(form.id ? `${form.name} saved` : `${form.name} added. Now tap Login link and send it to them on WhatsApp`)
      setForm(null); load()
    } catch (x) { toastError(x.message) } finally { setBusy(false) }
  }
  const remove = async u => {
    if (!await confirmBox(`Remove ${u.name}? They are signed out now and can't use a till any more.`, { confirmLabel: 'Remove', danger: true })) return
    try { await api(`/users/${u.id}/delete`, {}); notify(`${u.name} removed`); load() } catch (x) { toastError(x.message) }
  }
  const when = iso => iso ? new Date(iso).toLocaleString() : 'Never'
  const [link, setLink] = useState(null) // { id, name, link }: a login link to send
  const makeLink = async u => {
    try { const r = await api(`/users/${u.id}/login-link`, {}); setLink({ id: u.id, ...r }) } catch (x) { toastError(x.message) }
  }
  const waText = l => `Assalam o alaikum ${l.name}! Open this link on your phone to use our POS (it works once, for ${l.days} days):\n${l.link}\nThen tap your name and type your PIN.`
  const copy = l => navigator.clipboard?.writeText(l.link).then(() => notify('Link copied'), () => toastError('Could not copy. Press and hold the link to copy it.'))
  return (
    <div className="card settings-card">
      <div className="row-head"><h3>Staff & PINs</h3>
        <button className="primary" id="staff-add" onClick={() => setForm({ ...blankStaff })}><Icon name="plus" size={16} />Add staff</button></div>
      <p className="muted" style={{ fontSize: 13 }}>Each person uses their own phone: tap <b>Login link</b> and send it to them on WhatsApp. They open it once, then sign in by tapping their name and typing their PIN (4 to 12 letters or numbers). Each PIN must be different inside this restaurant. Riders get their link in the Riders section.</p>
      {form && <form className="staff-form" onSubmit={save}>
        <div className="two">
          <label>Name<input id="staff-name" autoFocus required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label>Role<select id="staff-role" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            <option value="cashier">Cashier</option><option value="kitchen">Kitchen</option><option value="admin">Owner</option></select></label>
        </div>
        <label>{form.id ? 'New PIN (leave empty to keep the current one)' : 'PIN'}
          <input id="staff-pin" type="password" autoCapitalize="none" autoComplete="new-password" maxLength={12} required={!form.id} value={form.pin}
            onChange={e => setForm({ ...form, pin: e.target.value.replace(/[^a-z0-9]/gi, '') })} /></label>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="primary" id="staff-save" disabled={busy || !form.name.trim() || (!form.id && form.pin.length < 4) || (form.pin && form.pin.length < 4)}>{form.id ? 'Save' : 'Add staff'}</button>
          <button type="button" className="ghost" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </form>}
      {users.map(u => (
        <div key={u.id} className="admin-row staff-row" data-staff={u.name}>
          <div className="staff-who"><b>{u.name}</b> <span className="pill sm">{ROLE_LABEL[u.role] || u.role}</span><br />
            <small className="muted">Last sign-in: {when(u.last_login)}</small></div>
          <button className="ghost" aria-label={`Login link for ${u.name}`} onClick={() => makeLink(u)}><Icon name="link" size={16} />Login link</button>
          <button className="ghost" aria-label={`Edit ${u.name}`} onClick={() => setForm({ id: u.id, name: u.name, role: u.role, pin: '' })}>Edit</button>
          <button className="ghost danger" aria-label={`Remove ${u.name}`} disabled={u.id === me.id} title={u.id === me.id ? "You can't remove your own login" : undefined} onClick={() => remove(u)}>Remove</button>
          {link?.id === u.id && <div className="staff-link">
            <p>Send this to <b>{u.name}</b>. They open it on their phone once (it works for {link.days} days), then tap their name and type their PIN.</p>
            <code>{link.link}</code>
            <div className="actions" style={{ justifyContent: 'flex-start' }}>
              <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(waText(link))}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
              <button className="ghost" onClick={() => copy(link)}>Copy link</button>
              <button className="ghost" onClick={() => setLink(null)}>Close</button>
            </div>
          </div>}
        </div>
      ))}
    </div>
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
      <p className="muted" style={{ fontSize: 13 }}>Tell the WhatsApp bot how to talk: length, tone, language, what to ask. One instruction per line works best.
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
      <p className="muted">Photos of your menu card. When a customer on WhatsApp asks to see the menu, the bot sends these pictures instead of typing out the whole list. Up to 6 pictures.</p>
      <label className={'primary add file-btn' + (busy || pics.length >= 6 ? ' disabled' : '')}>
        <Icon name="plus" size={16} />{busy ? 'Adding…' : 'Add pictures'}
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy || pics.length >= 6} onChange={upload} />
      </label>
      {!pics.length && <div className="muted menu-pics-empty">No menu pictures yet. The bot will describe the menu in text.</div>}
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
