import { useEffect, useState } from 'react'
import { api, ago, fileBase64, shrinkImage, downloadCsv } from './lib'
import { run, toast, toastError, confirmBox, inputBox } from './notify'
import { Stage, WhatsApp, Check } from './ui'

const TABS = ['Overview', 'Details', 'Menu', 'Tables', 'Delivery areas', 'Staff', 'Health & errors']

// One branch: prepare its setup before the restaurant installs, give the activation code, then watch its health
export default function Branch({ id }) {
  const [d, setD] = useState(null)
  const [tab, setTab] = useState('Overview')
  const [code, setCode] = useState(null)
  const load = () => api(`/branches/${id}/setup`).then(setD)
  useEffect(() => { run(load)() }, [id])
  if (!d) return <p className="muted">Loading…</p>

  const save = async body => { await api(`/branches/${id}/setup`, body); toast('Saved'); await load() }
  const newCode = run(async () => {
    if (d.branch.code_used_at && !await confirmBox('Make a new activation code? When it is used, the PC that is activated now stops working. Use this for a new PC or a reinstall.', { confirmLabel: 'Make new code', danger: true })) return
    setCode(await api(`/branches/${id}/code`, {})); await load()
  })
  const b = { ...d.branch, setup: d.summary }

  return (
    <>
      <div className="crumb"><a href="#/clients">Clients</a> / <a href={'#/client/' + d.owner?.id}>{d.owner?.name}</a> /</div>
      <div className="page-head"><h1>{d.branch.name}</h1><Stage b={b} /><span className="sp" />
        <button className="primary" onClick={newCode}>New activation code</button></div>
      {code && <div className="card"><h3>Activation code</h3><div className="code">{code.code}</div>
        <p className="muted">Shown once. Send it to the restaurant with the installer. It works one time.</p>
        <button style={{ marginTop: 12 }} onClick={() => setCode(null)}>I've noted it</button></div>}
      <div className="tabs" role="tablist">{TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Overview' && <Overview d={d} go={setTab} />}
      {tab === 'Details' && <Details r={d.setup.restaurant || {}} save={save} />}
      {tab === 'Menu' && <><MenuPictures id={id} images={d.images} reload={load} /><Menu id={id} d={d} reload={load} /><Deals menu={d.setup.menu || []} save={save} /></>}
      {tab === 'Tables' && <Tables tables={d.setup.tables || []} floors={d.setup.floors || []} save={save} />}
      {tab === 'Delivery areas' && <Zones zones={d.setup.zones || []} save={save} />}
      {tab === 'Staff' && <><PinReset id={id} /><Staff staff={d.setup.staff || []} save={save} /></>}
      {tab === 'Health & errors' && <Health d={d} />}
    </>
  )
}

function Overview({ d, go }) {
  const s = d.summary, br = d.branch
  const steps = [
    [s.restaurant, 'Restaurant details', 'Details'], [s.logo, 'Logo', 'Details'], [s.images, `Menu pictures (${s.images})`, 'Menu'], [s.menu, `Menu items (${s.menu})`, 'Menu'],
    [s.tables, `Floors & tables (${s.floors || 0} / ${s.tables})`, 'Tables'], [s.zones, `Delivery areas (${s.zones})`, 'Delivery areas'], [s.staff, `Staff (${s.staff})`, 'Staff'],
  ]
  return (
    <>
      <div className="card"><h3>Onboarding</h3>
        <div className="checks"> {steps.map(([ok, label, t]) => <button key={label} className="link" style={{ padding: 0, minHeight: 32 }} onClick={() => go(t)}><Check ok={ok}>{label}</Check></button>)}
          <Check ok={br.code_used_at}>Activated on their PC</Check><Check ok={s.applied_at}>Setup on their PC</Check></div>
        {s.error && <p className="notice bad" style={{ marginTop: 12 }}>Their POS couldn't apply the setup: {s.error}</p>}
        <p className="muted" style={{ marginTop: 12 }}>{s.applied_at
          ? `Setup applied ${ago(s.applied_at)}${d.applied ? ` (${Object.entries(d.applied).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}. Changes saved now reach the POS only while it has no orders; after that, the restaurant changes things in the POS itself.`
          : 'Prepare everything in the tabs above, then make the activation code. When the restaurant activates, their POS downloads it all and replaces the demo restaurant.'}</p>
      </div>
      <div className="grid2">
        <div className="card"><h3>Activation</h3>
          <p>{br.code_used_at ? `Activated ${ago(br.code_used_at)}.` : br.code_created_at ? `Code made ${ago(br.code_created_at)}, not used yet.` : 'No activation code yet.'}</p>
          <p className="muted small" style={{ marginTop: 8 }}>A code works once. For a new PC or a reinstall, make a new code: when it's used, the old PC stops.</p></div>
        <div className="card"><h3>Right now</h3>
          {br.health ? <><p>Last report {ago(br.health_at)} · version {br.health.version}</p>
            <div className="row" style={{ marginTop: 8 }}>WhatsApp <WhatsApp h={br.health} /> · {br.health.orders_today} orders today</div>
            {d.errors.length > 0 && <button className="link" style={{ paddingLeft: 0 }} onClick={() => go('Health & errors')}>{d.errors.length} error(s) reported →</button>}</>
            : <p className="muted">No report yet. The POS reports every few hours once activated.</p>}</div>
      </div>
    </>
  )
}

function Details({ r, save }) {
  const [f, setF] = useState({ name: r.name || '', phone: r.phone || '', logo_image: r.logo_image || '', address: r.address || '', tax_rate: r.tax_rate || '', ntn: r.ntn || '', strn: r.strn || '', footer: r.footer || '' })
  const set = k => e => setF({ ...f, [k]: e.target.value })
  return (
    <form className="card" onSubmit={e => { e.preventDefault(); run(() => save({ restaurant: f }))() }}>
      <h3>Restaurant details</h3>
      <div className="grid3">
        <label>Name (on receipts and the WhatsApp bot)<input value={f.name} onChange={set('name')} required /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} inputMode="tel" /></label>
        <div className="logo-edit">
          <div className="logo-preview">{f.logo_image ? <img src={f.logo_image} alt="Logo" /> : <span className="muted small">No logo</span>}</div>
          <div className="row">
            <label className="file-btn">{f.logo_image ? 'Change logo' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden
              onChange={async e => { const file = e.target.files[0]; e.target.value = ''; if (file) try { const img = await shrinkImage(file, 256, 'image/png'); setF(x => ({ ...x, logo_image: img })) } catch (err) { toastError(err.message) } }} /></label>
            {f.logo_image && <button type="button" className="danger" onClick={() => setF({ ...f, logo_image: '' })}>Remove</button>}
          </div>
        </div>
        <label className="wide">Address<input value={f.address} onChange={set('address')} /></label>
        <label>Tax rate % (empty = no tax)<input value={f.tax_rate} onChange={set('tax_rate')} inputMode="decimal" /></label>
        <label>NTN<input value={f.ntn} onChange={set('ntn')} /></label>
        <label>STRN<input value={f.strn} onChange={set('strn')} /></label>
        <label className="wide">Receipt footer<input value={f.footer} onChange={set('footer')} placeholder="Thank you! Visit again" /></label>
      </div>
      <div className="row" style={{ marginTop: 16 }}><button className="primary">Save details</button></div>
    </form>
  )
}

function Menu({ id, d, reload }) {
  const [preview, setPreview] = useState(null) // { file, name, result }
  const [busy, setBusy] = useState(false)
  const menu = d.setup.menu || []
  const choose = async e => {
    const f = e.target.files[0]; e.target.value = ''
    if (!f) return
    setBusy(true); setPreview(null)
    try { const file = await fileBase64(f); setPreview({ file, name: f.name, result: await api(`/branches/${id}/setup/menu`, { file, name: f.name }) }) }
    catch (err) { toastError(err.message) }
    finally { setBusy(false) }
  }
  const apply = run(async () => { await api(`/branches/${id}/setup/menu`, { file: preview.file, name: preview.name, apply: true }); setPreview(null); toast('Menu saved'); await reload() })
  const template = run(async () => downloadCsv('hazelpos-menu-template.csv', await api('/menu-template')))
  const cats = [...new Set(menu.map(i => i.category))]
  return (
    <>
      <div className="card"><h3>Or upload an Excel file</h3>
        <p className="muted">If the client sends their menu as Excel, upload it here instead (or use our template). One row per item, or one per size. Uploading again replaces the menu here.</p>
        {d.menu_upload ? <div className="row" style={{ marginTop: 12 }}>
          <button onClick={template}>Download template</button>
          <label className={'file-btn' + (busy ? ' off' : '')}>{busy ? 'Reading…' : 'Choose Excel file'}<input type="file" accept=".xlsx,.csv" hidden disabled={busy} onChange={choose} /></label>
        </div> : <p className="notice bad" style={{ marginTop: 12 }}>Menu upload is off on the cloud: it must be deployed from the whole repo (cloud/README.md).</p>}
        {preview && <div style={{ marginTop: 16 }}>
          <p><b>{preview.result.items}</b> items in <b>{preview.result.categories.length}</b> categories: {preview.result.categories.join(', ')}</p>
          {preview.result.errors.length
            ? <div className="notice bad" style={{ marginTop: 8 }} role="alert"><b>Fix these rows in the file, then choose it again:</b>
                <ul>{preview.result.errors.map((x, i) => <li key={i}>Row {x.row}: {x.error}</li>)}</ul></div>
            : <div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={apply}>Save this menu</button><button onClick={() => setPreview(null)}>Cancel</button></div>}
        </div>}
      </div>
      <div className="card"><h3>Menu ({menu.length} items{cats.length ? `, ${cats.length} categories` : ''})</h3>
        {menu.length ? <div className="scroll"><table>
          <thead><tr><th>Category</th><th>Item</th><th className="num">Price</th><th>Sizes</th><th>Description</th></tr></thead>
          <tbody>{menu.map((i, n) => <tr key={n}><td>{i.category}</td><td>{i.emoji} {i.name} {!i.active && <span className="pill">hidden</span>}{i.deal?.length > 0 && <span className="pill info">{i.combo_for ? 'Combo' : 'Deal'}</span>}</td>
            <td className="num">{i.price}</td><td className="muted small">{i.sizes.map(z => `${z.name} ${z.price}`).join(' · ')}</td>
            <td className="muted small">{i.deal?.length ? dealText(i.deal) : i.description}</td></tr>)}</tbody>
        </table></div> : <div className="empty">No menu yet.</div>}
      </div>
    </>
  )
}

// The client's menu card pictures, one section for both jobs:
// 1. The WhatsApp bot sends these pictures when a customer asks for the menu.
// 2. AI reads them into menu items, sorted into categories (Starters, Desi, Deals…). New pictures are read straight
//    away; you check and fix the rows, then Save as the menu (or download as Excel). Nothing is saved without you.
function MenuPictures({ id, images, reload }) {
  const [rows, setRows] = useState(null) // [[category, item, size, price, description]]
  const [busy, setBusy] = useState('')
  const [check, setCheck] = useState(null)
  const readAll = async (ids, start = rows || []) => {
    const out = [...start]
    try {
      for (const [n, imgId] of ids.entries()) {
        setBusy(`AI is reading picture ${n + 1} of ${ids.length}…`)
        let r
        for (let tries = 0; ; tries++) { // Groq's free plan allows about one picture a minute: wait as long as it asks, then go on
          try { r = await api(`/branches/${id}/setup/menu-photo`, { image_id: imgId }); break }
          catch (err) {
            if (!err.data?.retry_after || tries >= 20) throw err
            for (let left = err.data.retry_after + 2; left > 0; left--) {
              setBusy(`Picture ${n + 1} of ${ids.length}: waiting ${left} s for the AI's per-minute limit, then it carries on…`)
              await new Promise(ok => setTimeout(ok, 1000))
            }
            setBusy(`AI is reading picture ${n + 1} of ${ids.length}…`)
          }
        }
        const key = x => `${x[1]}|${x[2]}`.toLowerCase().replace(/\s+/g, ' ').trim() // same item and size = already in the list (e.g. the same page uploaded twice)
        const have = new Set(out.map(key))
        out.push(...r.rows.filter(x => !have.has(key(x)))); setRows([...out])
      }
      toast(`Read ${out.length} items. Check them, then Save as the menu`)
    } catch (err) { toastError(err.message) }
    finally { setBusy(''); setCheck(null) }
  }
  const add = async e => {
    const files = [...e.target.files]; e.target.value = ''
    if (!files.length) return
    const ids = []
    try {
      for (const [n, f] of files.entries()) {
        setBusy(`Uploading picture ${n + 1} of ${files.length}…`)
        ids.push((await api(`/branches/${id}/setup/images`, { data: await shrinkImage(f) })).id)
      }
    } catch (err) { toastError(err.message) }
    setBusy(''); reload()
    if (ids.length) await readAll(ids)
  }
  const del = run(async imgId => { if (await confirmBox('Delete this menu picture?', { confirmLabel: 'Delete', danger: true })) { await api(`/setup-images/${imgId}/delete`, {}); reload() } })
  const readAgain = async () => {
    if (rows?.length && !await confirmBox('Read all pictures again? The rows below are replaced.', { confirmLabel: 'Read again' })) return
    setRows(null); await readAll(images.map(im => im.id), [])
  }
  const set = (i, c, v) => { setRows(rows.map((r, n) => n === i ? r.map((x, k) => k === c ? v : x) : r)); setCheck(null) }
  const send = run(async apply => {
    const r = await api(`/branches/${id}/setup/menu-rows`, { rows, apply })
    setCheck(r)
    if (r.applied) { toast(`Menu saved: ${r.items} items`); setRows(null); setCheck(null); reload() }
    else if (apply) toastError(`NOT saved: ${r.errors.length} row${r.errors.length === 1 ? ' has' : 's have'} a problem (shown in red below). Fix ${r.errors.length === 1 ? 'it' : 'them'} or remove the row, then save again.`)
  })
  const csv = () => downloadCsv('menu-from-pictures.csv', [['Category', 'Item', 'Size', 'Price', 'Description'], ...rows])
  return (
    <div className="card">
      <h3>Menu pictures ({images.length} / 6)</h3>
      <p className="muted">Clear photos of the client's menu card, one page per picture. The AI reads every item, size and price and sorts them into
        categories (Starters, Desi, Burgers, Deals…). Check the list before saving: a price it couldn't read is left empty (red).
        The WhatsApp bot also sends these pictures when a customer asks for the menu ("menu bhejo", "kya kya milta hai?").</p>
      <div className="row" style={{ marginTop: 12 }}>
        <label className={'file-btn' + (busy || images.length >= 6 ? ' off' : '')}>Add pictures<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={!!busy || images.length >= 6} onChange={add} /></label>
        {images.length > 0 && <button onClick={readAgain} disabled={!!busy}>Read all pictures into the menu</button>}
        {busy && <span className="muted">{busy}</span>}
      </div>
      <div className="pics">{images.map((im, i) => <figure key={im.id}><img src={`/api/setup-images/${im.id}`} alt={`Menu picture ${i + 1}`} loading="lazy" />
        <button className="danger" onClick={() => del(im.id)}>Delete</button></figure>)}</div>
      {rows && <>
        <div className="scroll" style={{ marginTop: 12, maxHeight: 460, overflowY: 'auto' }}><table className="edit-table">
          <thead><tr><th>Category</th><th>Item</th><th>Size</th><th className="num">Price</th><th>Description</th><th></th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>
            {r.map((v, c) => <td key={c}><input aria-label={['Category', 'Item', 'Size', 'Price', 'Description'][c]} value={v} onChange={e => set(i, c, e.target.value)}
              className={c === 3 && !String(v).trim() ? 'bad' : ''} inputMode={c === 3 ? 'numeric' : undefined} /></td>)}
            <td><button className="danger" aria-label="Remove row" onClick={() => { setRows(rows.filter((_, n) => n !== i)); setCheck(null) }}>✕</button></td></tr>)}</tbody>
        </table></div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => { setRows([...rows, ['', '', '', '', '']]); setCheck(null) }}>+ Add row</button>
          <button onClick={() => send(false)}>Check</button>
          <button className="primary" onClick={() => send(true)}>Save as the menu</button>
          <button onClick={csv}>Download as Excel (CSV)</button>
          <button className="danger" onClick={() => { setRows(null); setCheck(null) }}>Discard</button>
        </div>
        {check && (check.errors.length
          ? <div className="notice bad" style={{ marginTop: 12 }} role="alert"><b>Fix these first:</b><ul>{check.errors.map((x, n) => <li key={n}>Row {x.row - 1}: {x.error}</li>)}</ul></div>
          : <p className="ok-t" style={{ marginTop: 12 }}>Looks fine: {check.items} items in {check.categories.length} categories. Saving replaces this branch's setup menu.</p>)}
      </>}
    </div>
  )
}

// Deals and combos inside the client's setup menu. A deal names items on this menu; "Offer with" makes it a combo
// that shows when that item is tapped. Sent with the rest of the setup; the POS turns names into its own items.
const dealText = list => (list || []).map(d => `${d.qty > 1 ? d.qty + '× ' : ''}${d.name}${d.size ? ` (${d.size})` : ''}`).join(', ')
function Deals({ menu, save }) {
  const [edit, setEdit] = useState(null) // { index (-1 = new), name, price, emoji, category, deal: [], combo_for }
  const deals = menu.map((it, index) => ({ ...it, index })).filter(it => it.deal?.length)
  const items = menu.filter(it => !it.deal?.length)
  const sizesOf = name => items.find(i => i.name === name)?.sizes || []
  const open = it => setEdit(it ? { ...it, deal: it.deal.map(d => ({ ...d })) } : { index: -1, name: '', price: '', emoji: '🎁', category: 'Deals', deal: [{ name: '', size: '', qty: 1 }], combo_for: '', active: true, sizes: [], description: '' })
  const row = (i, patch) => setEdit({ ...edit, deal: edit.deal.map((d, n) => n === i ? { ...d, ...patch } : d) })
  const submit = run(async e => {
    e.preventDefault()
    const deal = edit.deal.filter(d => d.name)
    if (!deal.length) throw new Error('Add at least one item to the deal')
    const { index, ...it } = { ...edit, deal, price: +edit.price || 0 }
    await save({ menu: index < 0 ? [...menu, it] : menu.map((m, n) => n === index ? it : m) })
    setEdit(null)
  })
  const remove = run(async it => {
    if (!await confirmBox(`Delete the deal "${it.name}"?`, { confirmLabel: 'Delete', danger: true })) return
    await save({ menu: menu.filter((_, n) => n !== it.index) })
  })
  return (
    <div className="card">
      <div className="card-head"><h3>Deals & combos ({deals.length})</h3><span className="sp" />
        <button className="primary" onClick={() => open(null)} disabled={!items.length} title={items.length ? '' : 'Upload the menu first'}>+ Add deal</button></div>
      <p className="muted">A deal is several menu items for one price (shown in the Deals tab of their POS). Choose an item under "Also offer as a combo on" and it shows as "Make it a combo" when that item is tapped. The kitchen sees each item inside. You can also put deals in the Excel file ("Deal items" and "Combo for" columns, see the template).</p>
      {!items.length && <p className="notice" style={{ marginTop: 12 }}>Upload the menu first (above). A deal is made from the items on the menu.</p>}
      {deals.length > 0 && <div className="scroll" style={{ marginTop: 12 }}><table>
        <thead><tr><th>Deal</th><th className="num">Price</th><th>Inside</th><th>Combo on</th><th></th></tr></thead>
        <tbody>{deals.map(it => <tr key={it.index}><td>{it.emoji} <b>{it.name}</b></td><td className="num">{it.price}</td><td className="muted small">{dealText(it.deal)}</td>
          <td>{it.combo_for || <span className="muted">Deals tab only</span>}</td>
          <td><div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={() => open(it)}>Edit</button><button className="danger" onClick={() => remove(it)}>Delete</button></div></td></tr>)}</tbody>
      </table></div>}
      {edit && <div className="modal-bg" onClick={() => setEdit(null)}>
        <form className="modal" style={{ width: 'min(680px, 100%)' }} onClick={e => e.stopPropagation()} onSubmit={submit}>
          <h2>{edit.index < 0 ? 'New deal' : 'Edit deal'}</h2>
          <div className="grid3">
            <label className="wide">Name<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Zinger Combo, Family Deal" required autoFocus /></label>
            <label>Price (Rs)<input type="number" min="0" value={edit.price} onChange={e => setEdit({ ...edit, price: e.target.value })} required /></label>
            <label>Emoji<input value={edit.emoji} onChange={e => setEdit({ ...edit, emoji: e.target.value })} /></label>
            <label>Category<input value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })} /></label>
          </div>
          <div><b>Items inside</b>
            {edit.deal.map((dl, i) => {
              const sizes = sizesOf(dl.name)
              return (
                <div key={i} className="deal-row">
                  <select aria-label="Item" value={dl.name} onChange={e => row(i, { name: e.target.value, size: sizesOf(e.target.value)[0]?.name || '' })} required>
                    <option value="">Choose an item…</option>{items.map(m => <option key={m.name} value={m.name}>{m.emoji} {m.name}</option>)}</select>
                  {sizes.length > 1 ? <select aria-label="Size" value={dl.size} onChange={e => row(i, { size: e.target.value })}>{sizes.map(z => <option key={z.name}>{z.name}</option>)}</select> : <span />}
                  <input aria-label="Quantity" type="number" min="1" value={dl.qty} onChange={e => row(i, { qty: e.target.value })} />
                  <button type="button" className="danger" aria-label="Remove item" onClick={() => setEdit({ ...edit, deal: edit.deal.filter((_, n) => n !== i) })}>✕</button>
                </div>
              )
            })}
            <button type="button" onClick={() => setEdit({ ...edit, deal: [...edit.deal, { name: '', size: '', qty: 1 }] })}>+ Add item</button>
          </div>
          <label>Also offer as a combo on<select value={edit.combo_for} onChange={e => setEdit({ ...edit, combo_for: e.target.value })}>
            <option value="">No, only in the Deals tab</option>{items.map(m => <option key={m.name} value={m.name}>{m.emoji} {m.name}</option>)}</select></label>
          <div className="actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="primary">Save deal</button></div>
        </form>
      </div>}
    </div>
  )
}

// Lines of "a, b, c" <-> rows; simple to type, simple to paste from Excel
const toLines = (rows, keys) => rows.map(r => keys.map(k => r[k]).join(', ')).join('\n')
const fromLines = text => text.split('\n').map(l => l.split(',').map(x => x.trim())).filter(p => p[0])

function Tables({ tables, floors: savedFloors, save }) {
  const [floors, setFloors] = useState(() => [...new Set([...savedFloors.map(f => f.name), ...tables.map(t => t.floor)].filter(Boolean))])
  const [newFloor, setNewFloor] = useState('')
  const [text, setText] = useState(toLines(tables, ['name', 'seats', 'floor']))
  const [gen, setGen] = useState({ prefix: 'T', count: '', seats: 4, floor: floors[0] || '' })
  const addFloor = e => {
    e.preventDefault()
    const name = newFloor.trim()
    if (!name || floors.some(f => f.toLowerCase() === name.toLowerCase())) return
    setFloors([...floors, name]); setNewFloor(''); if (!gen.floor) setGen({ ...gen, floor: name })
  }
  const removeFloor = run(async name => {
    const used = fromLines(text).filter(([, , f]) => f === name).length
    if (used && !await confirmBox(`${used} table(s) are on "${name}". Remove the floor and those tables?`, { confirmLabel: 'Remove', danger: true })) return
    setFloors(floors.filter(f => f !== name))
    setText(fromLines(text).filter(([, , f]) => f !== name).map(p => p.join(', ')).join('\n'))
    if (gen.floor === name) setGen({ ...gen, floor: floors.find(f => f !== name) || '' })
  })
  const add = () => {
    const n = Math.min(100, +gen.count || 0)
    if (!n || !gen.floor) return
    const taken = new Set(fromLines(text).map(([name]) => name))
    const lines = []
    for (let i = 1; lines.length < n && i < 1000; i++) if (!taken.has(gen.prefix + i)) lines.push(`${gen.prefix}${i}, ${gen.seats}, ${gen.floor}`)
    setText(t => (t.trim() ? t.trim() + '\n' : '') + lines.join('\n'))
  }
  const rows = fromLines(text)
  const saveAll = run(() => {
    const tbls = rows.map(([name, seats, floor]) => ({ name, seats: +seats || 4, floor: floor || floors[0] || 'Main Dining' }))
    const allFloors = [...new Set([...floors, ...tbls.map(t => t.floor)])]
    return save({ floors: allFloors.map(name => ({ name })), tables: tbls })
  })
  return (
    <>
      <div className="card"><h3>Floors / areas ({floors.length})</h3>
        <p className="muted">E.g. Ground floor, Family hall, Rooftop. Add the floors first, then their tables below.</p>
        <div className="row" style={{ margin: '12px 0' }}>{floors.map(f => <span key={f} className="pill floor-pill">{f}
          <button className="link" aria-label={`Remove ${f}`} onClick={() => removeFloor(f)}>✕</button></span>)}
          {!floors.length && <span className="muted">No floors yet.</span>}</div>
        <form className="row" onSubmit={addFloor}><input style={{ maxWidth: 320 }} placeholder="Floor name, e.g. Rooftop" value={newFloor} onChange={e => setNewFloor(e.target.value)} />
          <button disabled={!newFloor.trim()}>+ Add floor</button></form>
      </div>
      <div className="card"><h3>Tables ({rows.length})</h3>
        <div className="row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
          <label style={{ flex: 1, minWidth: 160 }}>Floor<select value={gen.floor} onChange={e => setGen({ ...gen, floor: e.target.value })} disabled={!floors.length}>
            {!floors.length && <option value="">Add a floor first</option>}{floors.map(f => <option key={f}>{f}</option>)}</select></label>
          <label style={{ width: 90 }}>Prefix<input value={gen.prefix} onChange={e => setGen({ ...gen, prefix: e.target.value })} /></label>
          <label style={{ width: 110 }}>How many<input type="number" min="1" max="100" value={gen.count} onChange={e => setGen({ ...gen, count: e.target.value })} /></label>
          <label style={{ width: 90 }}>Seats<input type="number" min="1" value={gen.seats} onChange={e => setGen({ ...gen, seats: e.target.value })} /></label>
          <button onClick={add} disabled={!gen.floor || !+gen.count}>Add tables</button>
        </div>
        {floors.length > 0 && rows.length > 0 && <p className="muted small" style={{ marginBottom: 8 }}>{floors.map(f => `${f}: ${rows.filter(r => r[2] === f).length}`).join(' · ')}</p>}
        <label>One table per line: <code>name, seats, floor</code><textarea rows={12} value={text} onChange={e => setText(e.target.value)} /></label>
        <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={saveAll}>Save floors & tables</button></div>
      </div>
    </>
  )
}

function Zones({ zones, save }) {
  const [text, setText] = useState(toLines(zones, ['name', 'fee', 'min_order', 'free_above', 'eta_min']))
  return (
    <div className="card"><h3>Delivery areas ({fromLines(text).length})</h3>
      <label>One area per line: <code>area, delivery fee, minimum order, free delivery above (0 = never), minutes</code>
        <textarea rows={12} value={text} onChange={e => setText(e.target.value)} placeholder={'Gulberg, 150, 800, 3000, 35\nDHA Phase 5, 200, 1000, 0, 45'} /></label>
      <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={run(() => save({ zones: fromLines(text).map(([name, fee, min_order, free_above, eta_min]) => ({ name, fee: +fee || 0, min_order: +min_order || 0, free_above: +free_above || 0, eta_min: +eta_min || 45 })) }))}>Save delivery areas</button></div>
    </div>
  )
}

// The logins on their POS and their PINs. A PIN set or changed on the POS appears here (stored encrypted on the cloud); a PIN you
// set here reaches their POS within a minute. Both need internet at the restaurant. "Show" is for owners only and is logged.
const tempPin = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), n => 'abcdefghjkmnpqrstuvwxyz23456789'[n % 31]).join('')
const ROLE_NAMES = { admin: 'Owner (admin)', cashier: 'Cashier', kitchen: 'Kitchen', rider: 'Rider' }
function PinReset({ id }) {
  const [users, setUsers] = useState(null)
  const [resets, setResets] = useState([])
  const [shown, setShown] = useState({}) // user id -> PIN, for 20 seconds
  const load = () => Promise.all([api(`/branches/${id}/pins`).then(setUsers), api(`/branches/${id}/pin-resets`).then(setResets)])
  useEffect(() => { run(load)(); const t = setInterval(() => run(load)(), 10000); return () => clearInterval(t) }, [id])
  const show = run(async u => {
    const r = await api(`/branches/${id}/pins/${u.id}/reveal`, {})
    setShown(s => ({ ...s, [u.id]: r.pin })); setTimeout(() => setShown(s => { const n = { ...s }; delete n[u.id]; return n }), 20000)
  })
  const setPin = run(async u => {
    const pin = await inputBox(`New PIN for ${u.name}. It reaches their POS within a minute (their POS must be online).`, { value: tempPin(), confirmLabel: 'Set PIN' })
    if (!pin) return
    await api(`/branches/${id}/pin-reset`, { user_id: u.id, pin: pin.trim() })
    toast(`${u.name}'s PIN will be ${pin.trim()} as soon as their POS is online`); load()
  })
  const failed = u => resets.find(r => r.user_id === u.id && r.applied_at && r.result !== 'ok' && r.result !== 'replaced by a newer reset')
  const state = u => failed(u) ? <span className="err">{failed(u).result}</span> : u.pending ? 'sending to their POS…' : u.fresh ? 'in sync' : u.has_pin ? 'changed on the POS, waiting to sync' : 'not known yet'
  return (
    <div className="card"><h3>Logins and PINs</h3>
      <p className="muted">Everyone's PIN, kept in sync with their POS. A PIN changed on the POS shows here; a PIN you set here goes to their POS. Both need internet at the restaurant.</p>
      {!users?.length ? <p className="muted" style={{ marginTop: 12 }}>The list appears after their POS reports in (within 10 minutes of starting version 1.0.2 or newer).</p>
        : <table style={{ marginTop: 12 }}><thead><tr><th>Login</th><th>Role</th><th>PIN</th><th>Status</th><th /></tr></thead>
          <tbody>{users.map(u => (
            <tr key={u.id}><td><b>{u.name}</b></td><td className="muted">{ROLE_NAMES[u.role] || u.role}</td>
              <td>{shown[u.id] ? <b style={{ letterSpacing: '0.1em' }}>{shown[u.id]}</b> : u.has_pin ? <><span className="muted">••••••</span> <button className="link" style={{ padding: 0, minHeight: 0 }} onClick={() => show(u)}>Show</button></> : <span className="muted">—</span>}</td>
              <td className="muted small">{state(u)}</td>
              <td><button onClick={() => setPin(u)}>Set PIN</button></td></tr>))}</tbody></table>}
    </div>
  )
}

function Staff({ staff, save }) {
  const applied = staff.some(u => u.pin_applied)
  const [rows, setRows] = useState(staff.length ? staff.map(u => ({ ...u, pin: u.pin || '' })) : [{ name: 'Owner', role: 'admin', pin: '' }, { name: 'Cashier', role: 'cashier', pin: '' }, { name: 'Kitchen', role: 'kitchen', pin: '' }])
  const set = (i, k) => e => setRows(rows.map((r, n) => n === i ? { ...r, [k]: e.target.value } : r))
  return (
    <div className="card"><h3>Staff and PINs</h3>
      <p className="muted">At least one admin (the owner). PINs are 4 to 12 letters or numbers, all different (capital or small letters don't matter). Once their POS has the PINs, they're deleted from the cloud. After that the owner changes or resets anyone's PIN in the POS: <b>Settings → Staff & PINs</b>.</p>
      {applied && <p className="notice" style={{ marginTop: 12 }}>These PINs are already on their POS and were removed from the cloud. To send new ones (for a new PC), type all PINs again.</p>}
      <div style={{ marginTop: 12 }}>{rows.map((u, i) => (
        <div className="staff-row" key={i}>
          <input aria-label="Name" placeholder="Name" value={u.name} onChange={set(i, 'name')} />
          <select aria-label="Role" value={u.role} onChange={set(i, 'role')}><option value="admin">Admin (owner)</option><option value="cashier">Cashier</option><option value="kitchen">Kitchen</option><option value="rider">Rider</option></select>
          <input aria-label="PIN" placeholder={u.pin_applied ? 'on their POS' : 'PIN (4+ letters or numbers)'} value={u.pin} onChange={e => set(i, 'pin')({ target: { value: e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 12) } })} autoCapitalize="none" maxLength={12} />
          <button className="danger" aria-label={`Remove ${u.name || 'person'}`} onClick={() => setRows(rows.filter((_, n) => n !== i))}>✕</button>
        </div>))}</div>
      <div className="row"><button onClick={() => setRows([...rows, { name: '', role: 'cashier', pin: '' }])}>+ Add person</button>
        <button className="primary" onClick={run(() => save({ staff: rows.map(({ name, role, pin }) => ({ name, role, pin })) }))}>Save staff</button></div>
    </div>
  )
}

function Health({ d }) {
  const h = d.branch.health
  return (
    <>
      <div className="card"><h3>Latest report</h3>
        {h ? <div className="grid3">
          <div><span className="muted small">Reported</span><p><b>{ago(d.branch.health_at)}</b></p></div>
          <div><span className="muted small">App version</span><p><b>{h.version}</b> <span className="muted small">{h.platform}</span></p></div>
          <div><span className="muted small">Running for</span><p><b>{Math.round((h.uptime_min || 0) / 60)} h</b></p></div>
          <div><span className="muted small">WhatsApp</span><p><WhatsApp h={h} /> {h.whatsapp?.assistant === false && <span className="pill">assistant off</span>}</p>{h.whatsapp?.error && <p className="err">{h.whatsapp.error}</p>}</div>
          <div><span className="muted small">Orders today</span><p><b>{h.orders_today ?? '—'}</b></p></div>
          <div><span className="muted small">Membership on their POS</span><p><b>{h.licence || '—'}</b></p></div>
          <div className="wide"><span className="muted small">Cloud sync</span>
            <p>Last sync {ago(h.cloud_sync?.last_sync)} · last backup {ago(h.cloud_sync?.last_backup)}{h.cloud_sync?.pending_orders ? ` · ${h.cloud_sync.pending_orders} orders waiting` : ''}</p>
            {h.cloud_sync?.last_error && <p className="err">{h.cloud_sync.last_error}</p>}</div>
          {h.setup_error && <div className="wide notice bad">Setup error: {h.setup_error}</div>}
        </div> : <div className="empty">No report yet. The POS reports every few hours once it is activated.</div>}
      </div>
      <div className="card"><h3>Errors ({d.errors.length})</h3>
        {d.errors.length ? <div className="errlist">{d.errors.map((e, i) => <div key={i}><span className="muted">{e.at.replace('T', ' ').slice(0, 19)}</span>{'\n'}{e.text}</div>)}</div>
          : <div className="empty">No errors reported. 👍</div>}
      </div>
    </>
  )
}
