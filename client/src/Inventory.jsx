import { useEffect, useState } from 'react'
import { api, rs, run, localDate } from './lib'
import { FormModal, Icon } from './ui'
import { confirmBox } from './notify'

const TABS = ['Stock', 'Recipes', 'Suppliers & Khata', 'Stock history']
const UNITS = ['kg', 'g', 'L', 'ml', 'pcs', 'dozen', 'pack']
const qty = n => Math.round((n || 0) * 1000) / 1000

export default function Inventory({ notify }) {
  const [tab, setTab] = useState('Stock')
  const [ingredients, setIngredients] = useState([])
  const load = () => api('/ingredients').then(setIngredients)
  useEffect(() => { load() }, [])
  return (
    <section className="admin">
      <div className="row-head"><h2>Inventory</h2>
        <div className="tabs">{TABS.map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => { setTab(t); load() }}>{t}</button>)}</div>
      </div>
      {tab === 'Stock' && <Stock ingredients={ingredients} reload={load} notify={notify} />}
      {tab === 'Recipes' && <Recipes ingredients={ingredients} notify={notify} />}
      {tab === 'Suppliers & Khata' && <Suppliers ingredients={ingredients} reload={load} notify={notify} />}
      {tab === 'Stock history' && <History />}
    </section>
  )
}

function Stock({ ingredients, reload, notify }) {
  const [edit, setEdit] = useState(null)
  const [adjust, setAdjust] = useState(null)
  const save = run(async () => { await api('/ingredients', { ...edit, low_level: +edit.low_level || 0, cost: +edit.cost || 0 }); setEdit(null); reload(); notify('Saved') })
  const saveAdjust = run(async () => { await api('/stock/adjust', { ...adjust, qty: +adjust.qty }); setAdjust(null); reload(); notify('Stock updated') })
  const del = run(async i => { if (await confirmBox(`Delete ${i.name}? It is also removed from recipes.`)) { await api(`/ingredients/${i.id}/delete`, {}); reload() } })
  const value = ingredients.reduce((s, i) => s + Math.max(0, i.stock) * i.cost, 0)
  const low = ingredients.filter(i => i.low)
  return (
    <>
      <div className="row-head">
        <button className="primary add" onClick={() => setEdit({ name: '', unit: 'kg', low_level: '', cost: '' })}>+ Add ingredient</button>
        <span className="muted">Stock value <b>{rs(value)}</b></span>{low.length > 0 && <span className="pill low-pill">{low.length} running low</span>}
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Ingredient</th><th>In stock</th><th>Alert below</th><th>Cost / unit</th><th>Value</th><th /></tr></thead>
          <tbody>
            {!ingredients.length && <tr><td colSpan={6} className="muted">Add the ingredients you buy (cheese, dough, chicken…), then link them to menu items under Recipes.</td></tr>}
            {ingredients.map(i => (
              <tr key={i.id}>
                <td><b>{i.name}</b> {i.low ? <span className="pill sm low-pill">Low</span> : null}</td>
                <td style={{ color: i.stock < 0 ? 'var(--red)' : undefined }}>{qty(i.stock)} {i.unit}</td>
                <td className="muted">{qty(i.low_level)} {i.unit}</td>
                <td>{rs(i.cost)}</td>
                <td>{rs(Math.max(0, i.stock) * i.cost)}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="ghost sm" onClick={() => setAdjust({ ingredient_id: i.id, name: i.name, unit: i.unit, reason: 'count', qty: qty(i.stock), note: '' })}>Adjust</button>{' '}
                  <button className="ghost sm" onClick={() => setEdit(i)}>Edit</button>{' '}
                  <button className="ghost sm danger" onClick={() => del(i)} aria-label="Remove"><Icon name="x" size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <FormModal title={edit.id ? 'Edit ingredient' : 'New ingredient'} value={edit} onChange={setEdit} onSave={save} onClose={() => setEdit(null)}
        fields={[['name', 'Name'], ['unit', 'Unit', 'select', UNITS], ['low_level', 'Alert when stock falls below', 'number'], ['cost', 'Cost per unit (Rs) — updated by purchases', 'number']]}>
        {!edit.id && <p className="muted" style={{ fontSize: 13 }}>Opening stock: add it as a purchase under Suppliers, or use Adjust → Physical count.</p>}
      </FormModal>}
      {adjust && <FormModal title={`Adjust ${adjust.name}`} value={adjust} onChange={setAdjust} onSave={saveAdjust} onClose={() => setAdjust(null)}
        fields={[
          ['reason', 'What happened?', 'select', [['count', 'Physical count (set actual stock)'], ['waste', 'Waste / spoiled (subtract)'], ['adjust', 'Correction (+ or −)']]],
          ['qty', adjust.reason === 'count' ? `Counted stock (${adjust.unit})` : `Quantity (${adjust.unit})`, 'number'], ['note', 'Note']]} />}
    </>
  )
}

// Ingredients used per menu item; a size-specific recipe replaces the "all sizes" one for that size
function Recipes({ ingredients, notify }) {
  const [menu, setMenu] = useState({ products: [] })
  const [product, setProduct] = useState(null)
  const [size, setSize] = useState('')
  const [all, setAll] = useState([])
  const [lines, setLines] = useState([])
  useEffect(() => { api('/menu?all=1').then(setMenu) }, [])
  const sizes = (() => { try { return JSON.parse(product?.sizes || '[]') } catch { return [] } })()
  const open = async (p, sz = '') => {
    const rows = await api(`/recipes/${p.id}`)
    setProduct(p); setSize(sz); setAll(rows)
    setLines(rows.filter(r => r.size === sz).map(r => ({ ingredient_id: r.ingredient_id, qty: r.qty })))
  }
  const pickSize = sz => { setSize(sz); setLines(all.filter(r => r.size === sz).map(r => ({ ingredient_id: r.ingredient_id, qty: r.qty }))) }
  const save = run(async () => { await api(`/recipes/${product.id}`, { size, lines }); await open(product, size); notify('Recipe saved') })
  const ing = id => ingredients.find(i => i.id === +id)
  const cost = lines.reduce((s, l) => s + (+l.qty || 0) * (ing(l.ingredient_id)?.cost || 0), 0)
  const price = size ? +(sizes.find(z => z.name === size)?.price) || product?.price : sizes[0]?.price ?? product?.price
  return (
    <div className="recipe-grid">
      <div className="card recipe-list">
        {menu.products.map(p => (
          <button key={p.id} className={product?.id === p.id ? 'active' : ''} onClick={() => open(p)}>
            {p.emoji} {p.name}
          </button>
        ))}
      </div>
      <div className="card">
        {!product ? <p className="muted">Pick a menu item to set what goes into it. Stock is deducted automatically when an order is paid.</p> : <>
          <h3>{product.emoji} {product.name}</h3>
          {sizes.length > 1 && <div className="tabs" style={{ margin: '8px 0' }}>
            <button className={size === '' ? 'active' : ''} onClick={() => pickSize('')}>All sizes</button>
            {sizes.map(z => <button key={z.name} className={size === z.name ? 'active' : ''} onClick={() => pickSize(z.name)}>
              {z.name}{all.some(r => r.size === z.name) ? ' ✓' : ''}</button>)}
          </div>}
          {size === '' && sizes.length > 1 && <p className="muted" style={{ fontSize: 13 }}>Used for any size without its own recipe.</p>}
          {lines.map((l, k) => (
            <div key={k} className="recipe-line">
              <select value={l.ingredient_id} onChange={e => setLines(lines.map((x, j) => j === k ? { ...x, ingredient_id: +e.target.value } : x))}>
                {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <input type="number" step="any" value={l.qty} onChange={e => setLines(lines.map((x, j) => j === k ? { ...x, qty: e.target.value } : x))} />
              <span className="muted">{ing(l.ingredient_id)?.unit}</span>
              <span>{rs((+l.qty || 0) * (ing(l.ingredient_id)?.cost || 0))}</span>
              <button className="ghost sm danger" onClick={() => setLines(lines.filter((_, j) => j !== k))} aria-label="Remove"><Icon name="x" size={16} /></button>
            </div>
          ))}
          {!ingredients.length ? <p className="muted">Add ingredients in the Stock tab first.</p>
            : <button className="ghost sm" onClick={() => setLines([...lines, { ingredient_id: ingredients[0].id, qty: '' }])}>+ Add ingredient</button>}
          <div className="recipe-cost">
            Food cost <b>{rs(cost)}</b>{price > 0 && <> · Price {rs(price)} · Margin <b style={{ color: cost / price > 0.4 ? 'var(--red)' : 'var(--green)' }}>{Math.round((1 - cost / price) * 100)}%</b></>}
          </div>
          <button className="primary" onClick={save}>Save recipe</button>
        </>}
      </div>
    </div>
  )
}

function Suppliers({ ingredients, reload, notify }) {
  const [list, setList] = useState([])
  const [sel, setSel] = useState(null)
  const [ledger, setLedger] = useState([])
  const [edit, setEdit] = useState(null)
  const [purchase, setPurchase] = useState(null)
  const [payment, setPayment] = useState(null)
  const load = async (keep = sel) => {
    const l = await api('/suppliers'); setList(l)
    if (keep) { setSel(l.find(s => s.id === keep.id)); setLedger(await api(`/suppliers/${keep.id}/ledger`)) }
  }
  useEffect(() => { load() }, [])
  const open = async s => { setSel(s); setLedger(await api(`/suppliers/${s.id}/ledger`)) }
  const saveSupplier = run(async () => { const s = await api('/suppliers', edit); setEdit(null); await load(s) })
  const savePurchase = run(async () => {
    await api(`/suppliers/${sel.id}/purchase`, { ...purchase, items: purchase.items.filter(l => +l.qty > 0).map(l => ({ ...l, qty: +l.qty, cost: +l.cost || 0 })), paid: +purchase.paid || 0, amount: +purchase.amount || 0 })
    setPurchase(null); await load(); reload(); notify('Purchase added to khata')
  })
  const savePayment = run(async () => { await api(`/suppliers/${sel.id}/payment`, { ...payment, amount: +payment.amount }); setPayment(null); await load(); notify('Payment recorded') })
  const undo = run(async l => {
    if (!await confirmBox(l.type === 'purchase' ? 'Delete this purchase? Its stock is taken back out.' : 'Delete this payment? Its expense entry is removed too.')) return
    await api(`/supplier-ledger/${l.id}/delete`, {}); await load(); reload()
  })
  const del = run(async s => { if (await confirmBox(`Delete ${s.name}?`)) { await api(`/suppliers/${s.id}/delete`, {}); setSel(null); load() } })
  const rows = ledger.reduce((acc, l) => [...acc, { ...l, balance: (acc.at(-1)?.balance || 0) + (l.type === 'purchase' ? l.amount : -l.amount) }], [])
  const purchaseTotal = purchase ? (purchase.items.some(l => +l.qty > 0) ? purchase.items.reduce((s, l) => s + (+l.cost || 0), 0) : +purchase.amount || 0) : 0
  return (
    <div className="recipe-grid">
      <div className="card recipe-list">
        <button className="primary sm" onClick={() => setEdit({ name: '', phone: '', note: '' })}>+ Add supplier</button>
        {list.map(s => (
          <button key={s.id} className={sel?.id === s.id ? 'active' : ''} onClick={() => open(s)}>
            <span>{s.name}</span><small style={{ color: s.balance > 0 ? 'var(--red)' : 'var(--muted)' }}>{s.balance > 0 ? `Owe ${rs(s.balance)}` : s.balance < 0 ? `Advance ${rs(-s.balance)}` : 'Settled'}</small>
          </button>
        ))}
      </div>
      <div className="card">
        {!sel ? <p className="muted">Pick a supplier to see their khata (what you bought, what you paid, what you still owe).</p> : <>
          <div className="row-head">
            <h3>{sel.name} {sel.phone && <span className="muted">· {sel.phone}</span>}</h3>
            <span>{sel.balance >= 0 ? 'You owe' : 'Advance paid'}: <b style={{ color: sel.balance > 0 ? 'var(--red)' : 'var(--green)' }}>{rs(Math.abs(sel.balance))}</b></span>
          </div>
          <div className="export-row" style={{ marginBottom: 10 }}>
            <button className="primary sm" onClick={() => setPurchase({ date: localDate(), items: ingredients.length ? [{ ingredient_id: ingredients[0].id, qty: '', cost: '' }] : [], amount: '', paid: '', method: 'cash', note: '' })}>+ Purchase</button>
            <button className="ghost sm" onClick={() => setPayment({ date: localDate(), amount: sel.balance > 0 ? sel.balance : '', method: 'cash', note: '' })}>+ Payment</button>
            <button className="ghost sm" onClick={() => setEdit(sel)}>Edit</button>
            <button className="ghost sm danger" onClick={() => del(sel)}>Delete</button>
          </div>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Details</th><th>Bought</th><th>Paid</th><th>Balance</th><th /></tr></thead>
            <tbody>
              {!ledger.length && <tr><td colSpan={6} className="muted">No entries yet</td></tr>}
              {rows.map(l => {
                return (
                  <tr key={l.id}>
                    <td className="muted">{l.date}</td><td>{l.note || (l.type === 'purchase' ? 'Purchase' : 'Payment')}</td>
                    <td>{l.type === 'purchase' ? rs(l.amount) : ''}</td><td style={{ color: 'var(--green)' }}>{l.type === 'payment' ? rs(l.amount) : ''}</td>
                    <td><b>{rs(l.balance)}</b></td>
                    <td><button className="ghost sm danger" onClick={() => undo(l)} aria-label="Remove"><Icon name="x" size={16} /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>}
      </div>
      {edit && <FormModal title={edit.id ? 'Edit supplier' : 'New supplier'} value={edit} onChange={setEdit} onSave={saveSupplier} onClose={() => setEdit(null)}
        fields={[['name', 'Name'], ['phone', 'Phone'], ['note', 'Note (what they supply)']]} />}
      {payment && <FormModal title={`Pay ${sel.name}`} value={payment} onChange={setPayment} onSave={savePayment} onClose={() => setPayment(null)} saveLabel="Record payment"
        fields={[['amount', 'Amount (Rs)', 'number'], ['method', 'Paid by', 'select', [['cash', 'Cash'], ['bank', 'Bank transfer'], ['online', 'JazzCash / Easypaisa']]], ['date', 'Date', 'date'], ['note', 'Note']]} />}
      {purchase && <FormModal title={`Purchase from ${sel.name}`} value={purchase} onChange={setPurchase} onSave={savePurchase} onClose={() => setPurchase(null)} saveLabel={`Add ${rs(purchaseTotal)} to khata`}
        fields={[['date', 'Date', 'date'], ['note', 'Bill no. / note']]}>
        <b style={{ fontSize: 14 }}>Items received (adds to stock)</b>
        {purchase.items.map((l, k) => {
          const set = patch => setPurchase({ ...purchase, items: purchase.items.map((x, j) => j === k ? { ...x, ...patch } : x) })
          return (
            <div key={k} className="recipe-line purchase-line">
              <select value={l.ingredient_id} onChange={e => set({ ingredient_id: +e.target.value })}>
                {ingredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </select>
              <input type="number" step="any" placeholder="Qty" value={l.qty} onChange={e => set({ qty: e.target.value })} />
              <input type="number" placeholder="Total Rs" value={l.cost} onChange={e => set({ cost: e.target.value })} />
              <button className="ghost sm danger" onClick={() => setPurchase({ ...purchase, items: purchase.items.filter((_, j) => j !== k) })} aria-label="Remove"><Icon name="x" size={16} /></button>
            </div>
          )
        })}
        {ingredients.length > 0 ? <button className="ghost sm" onClick={() => setPurchase({ ...purchase, items: [...purchase.items, { ingredient_id: ingredients[0].id, qty: '', cost: '' }] })}>+ Item</button>
          : <p className="muted" style={{ fontSize: 13 }}>No ingredients yet, so this bill can't add to stock. Add ingredients under the Stock tab to track stock — or just enter the bill amount below to record it in the khata.</p>}
        {!purchase.items.some(l => +l.qty > 0) && <label>Or just the bill amount (Rs)<input type="number" value={purchase.amount} onChange={e => setPurchase({ ...purchase, amount: e.target.value })} /></label>}
        <div className="two">
          <label>Paid now (Rs)<input type="number" value={purchase.paid} placeholder="0 = all on credit" onChange={e => setPurchase({ ...purchase, paid: e.target.value })} /></label>
          <label>Paid by<select value={purchase.method} onChange={e => setPurchase({ ...purchase, method: e.target.value })}>
            <option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="online">JazzCash / Easypaisa</option></select></label>
        </div>
      </FormModal>}
    </div>
  )
}

const REASONS = { sale: 'Sold', purchase: 'Purchase', waste: 'Waste', adjust: 'Correction', count: 'Physical count' }
function History() {
  const [moves, setMoves] = useState([])
  useEffect(() => { api('/stock/moves').then(setMoves) }, [])
  return (
    <div className="card">
      <table className="tbl">
        <thead><tr><th>Time</th><th>Ingredient</th><th>Change</th><th>Reason</th><th>Details</th><th>By</th></tr></thead>
        <tbody>
          {!moves.length && <tr><td colSpan={6} className="muted">No stock movements yet</td></tr>}
          {moves.map(m => (
            <tr key={m.id}>
              <td className="muted">{new Date(m.at).toLocaleString()}</td><td>{m.ingredient}</td>
              <td style={{ color: m.qty < 0 ? 'var(--red)' : 'var(--green)' }}>{m.qty > 0 ? '+' : ''}{qty(m.qty)} {m.unit}</td>
              <td>{REASONS[m.reason] || m.reason}</td>
              <td className="muted">{[m.ref?.startsWith('order:') ? `Order #${m.ref.slice(6)}` : '', m.note].filter(Boolean).join(' · ')}</td>
              <td className="muted">{m.user_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
