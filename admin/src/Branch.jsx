import { useEffect, useState } from 'react'
import { api, ago, fileBase64, shrinkImage, downloadCsv } from './lib'
import { run, toast, toastError, confirmBox } from './notify'
import { Stage, WhatsApp, Check } from './ui'

const TABS = ['Overview', 'Details', 'Menu', 'Menu pictures', 'Tables', 'Delivery areas', 'Staff', 'Health & errors']

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
      {tab === 'Menu' && <Menu id={id} d={d} reload={load} />}
      {tab === 'Menu pictures' && <Pictures id={id} images={d.images} reload={load} />}
      {tab === 'Tables' && <Tables tables={d.setup.tables || []} save={save} />}
      {tab === 'Delivery areas' && <Zones zones={d.setup.zones || []} save={save} />}
      {tab === 'Staff' && <Staff staff={d.setup.staff || []} save={save} />}
      {tab === 'Health & errors' && <Health d={d} />}
    </>
  )
}

function Overview({ d, go }) {
  const s = d.summary, br = d.branch
  const steps = [
    [s.restaurant, 'Restaurant details', 'Details'], [s.menu, `Menu (${s.menu} items)`, 'Menu'], [s.images, `Menu pictures (${s.images})`, 'Menu pictures'],
    [s.tables, `Tables (${s.tables})`, 'Tables'], [s.zones, `Delivery areas (${s.zones})`, 'Delivery areas'], [s.staff, `Staff (${s.staff})`, 'Staff'],
  ]
  return (
    <>
      <div className="card"><h3>Onboarding</h3>
        <div className="checks">{steps.map(([ok, label, t]) => <button key={t} className="link" style={{ padding: 0, minHeight: 32 }} onClick={() => go(t)}><Check ok={ok}>{label}</Check></button>)}
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
  const [f, setF] = useState({ name: r.name || '', phone: r.phone || '', logo: r.logo || '🍽️', address: r.address || '', tax_rate: r.tax_rate || '', ntn: r.ntn || '', strn: r.strn || '', footer: r.footer || '' })
  const set = k => e => setF({ ...f, [k]: e.target.value })
  return (
    <form className="card" onSubmit={e => { e.preventDefault(); run(() => save({ restaurant: f }))() }}>
      <h3>Restaurant details</h3>
      <div className="grid3">
        <label>Name (on receipts and the WhatsApp bot)<input value={f.name} onChange={set('name')} required /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} inputMode="tel" /></label>
        <label>Logo (one emoji)<input value={f.logo} onChange={set('logo')} /></label>
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
      <div className="card"><h3>Upload the menu</h3>
        <p className="muted">Their Excel, or one you typed from their menu photos into the template. One row per item, or one per size. Uploading again replaces the menu here.</p>
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
          <tbody>{menu.map((i, n) => <tr key={n}><td>{i.category}</td><td>{i.emoji} {i.name} {!i.active && <span className="pill">hidden</span>}</td>
            <td className="num">{i.price}</td><td className="muted small">{i.sizes.map(z => `${z.name} ${z.price}`).join(' · ')}</td><td className="muted small">{i.description}</td></tr>)}</tbody>
        </table></div> : <div className="empty">No menu yet.</div>}
      </div>
    </>
  )
}

function Pictures({ id, images, reload }) {
  const [busy, setBusy] = useState(false)
  const add = async e => {
    const files = [...e.target.files]; e.target.value = ''
    setBusy(true)
    try { for (const f of files) await api(`/branches/${id}/setup/images`, { data: await shrinkImage(f) }); toast('Pictures added') }
    catch (err) { toastError(err.message) }
    finally { setBusy(false); reload() }
  }
  const del = run(async imgId => { if (await confirmBox('Delete this menu picture?', { confirmLabel: 'Delete', danger: true })) { await api(`/setup-images/${imgId}/delete`, {}); reload() } })
  return (
    <div className="card"><h3>Menu pictures ({images.length} / 6)</h3>
      <p className="muted">Photos of their menu card. The WhatsApp assistant sends them when a customer asks for the menu.</p>
      <label className={'file-btn' + (busy || images.length >= 6 ? ' off' : '')} style={{ marginTop: 12 }}>{busy ? 'Adding…' : 'Add pictures'}
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={busy || images.length >= 6} onChange={add} /></label>
      <div className="pics">{images.map((im, i) => <figure key={im.id}><img src={`/api/setup-images/${im.id}`} alt={`Menu picture ${i + 1}`} loading="lazy" />
        <button className="danger" onClick={() => del(im.id)}>Delete</button></figure>)}</div>
    </div>
  )
}

// Lines of "a, b, c" <-> rows; simple to type, simple to paste from Excel
const toLines = (rows, keys) => rows.map(r => keys.map(k => r[k]).join(', ')).join('\n')
const fromLines = text => text.split('\n').map(l => l.split(',').map(x => x.trim())).filter(p => p[0])

function Tables({ tables, save }) {
  const [text, setText] = useState(toLines(tables, ['name', 'seats', 'floor']))
  const [gen, setGen] = useState({ prefix: 'T', count: '', seats: 4, floor: 'Main Dining' })
  const add = () => {
    const n = Math.min(100, +gen.count || 0)
    if (!n) return
    const lines = Array.from({ length: n }, (_, i) => `${gen.prefix}${i + 1}, ${gen.seats}, ${gen.floor}`).join('\n')
    setText(t => (t.trim() ? t.trim() + '\n' : '') + lines)
  }
  return (
    <div className="card"><h3>Tables ({fromLines(text).length})</h3>
      <div className="row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
        <label style={{ width: 90 }}>Prefix<input value={gen.prefix} onChange={e => setGen({ ...gen, prefix: e.target.value })} /></label>
        <label style={{ width: 110 }}>How many<input type="number" min="1" max="100" value={gen.count} onChange={e => setGen({ ...gen, count: e.target.value })} /></label>
        <label style={{ width: 90 }}>Seats<input type="number" min="1" value={gen.seats} onChange={e => setGen({ ...gen, seats: e.target.value })} /></label>
        <label style={{ flex: 1, minWidth: 160 }}>Floor / area<input value={gen.floor} onChange={e => setGen({ ...gen, floor: e.target.value })} /></label>
        <button onClick={add}>Add tables</button>
      </div>
      <label>One table per line: <code>name, seats, floor</code><textarea rows={12} value={text} onChange={e => setText(e.target.value)} /></label>
      <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={run(() => save({ tables: fromLines(text).map(([name, seats, floor]) => ({ name, seats: +seats || 4, floor: floor || 'Main Dining' })) }))}>Save tables</button></div>
    </div>
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

function Staff({ staff, save }) {
  const applied = staff.some(u => u.pin_applied)
  const [rows, setRows] = useState(staff.length ? staff.map(u => ({ ...u, pin: u.pin || '' })) : [{ name: 'Owner', role: 'admin', pin: '' }, { name: 'Cashier', role: 'cashier', pin: '' }, { name: 'Kitchen', role: 'kitchen', pin: '' }])
  const set = (i, k) => e => setRows(rows.map((r, n) => n === i ? { ...r, [k]: e.target.value } : r))
  return (
    <div className="card"><h3>Staff and PINs</h3>
      <p className="muted">At least one admin (the owner). PINs are 4 to 6 digits, all different. Once their POS has the PINs, they're deleted from the cloud.</p>
      {applied && <p className="notice" style={{ marginTop: 12 }}>These PINs are already on their POS and were removed from the cloud. To send new ones (for a new PC), type all PINs again.</p>}
      <div style={{ marginTop: 12 }}>{rows.map((u, i) => (
        <div className="staff-row" key={i}>
          <input aria-label="Name" placeholder="Name" value={u.name} onChange={set(i, 'name')} />
          <select aria-label="Role" value={u.role} onChange={set(i, 'role')}><option value="admin">Admin (owner)</option><option value="cashier">Cashier</option><option value="kitchen">Kitchen</option></select>
          <input aria-label="PIN" placeholder={u.pin_applied ? 'on their POS' : 'PIN'} value={u.pin} onChange={set(i, 'pin')} inputMode="numeric" maxLength={6} />
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
