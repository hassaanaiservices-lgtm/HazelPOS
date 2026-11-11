import { useEffect, useState } from 'react'
import { api, rs, parseModifiers, modsText } from './lib'
import './CustomerOrder.css'
import { toastError } from './notify'

// Mobile ordering page opened by scanning a table's QR code
export default function CustomerOrder({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState(0)
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [note, setNote] = useState('')
  const [name, setName] = useState('')
  const [sending, setSending] = useState(false)
  const [placed, setPlaced] = useState(null) // { id, status }
  const [choosing, setChoosing] = useState(null) // product whose size/options sheet is open

  useEffect(() => {
    api('/qr/' + token).then(d => { setData(d); document.title = `${d.restaurant.name} · ${d.table.name}` })
      .catch(e => setError(e.message))
  }, [token])

  // Poll order status after placing
  useEffect(() => {
    if (!placed || placed.status !== 'pending') return
    const t = setInterval(() => api(`/qr/${token}/status/${placed.id}`).then(setPlaced).catch(() => {}), 4000)
    return () => clearInterval(t)
  }, [placed, token])

  if (error) return <div className="co-center"><div className="co-big">⚠️</div><h2>{error}</h2><p>Please ask the staff for help.</p></div>
  if (!data) return <div className="co-center"><div className="co-spinner" /></div>

  const qtyOf = id => cart.filter(i => i.product_id === id).reduce((s, i) => s + i.qty, 0)
  // One cart line per product + size + options; prices here are a preview, the server prices the order
  const addLine = (p, size, mods = []) => setCart(c => {
    const key = JSON.stringify([p.id, size?.name, mods.map(m => m.name)])
    const ex = c.find(i => i.key === key)
    if (ex) return c.map(i => i === ex ? { ...i, qty: i.qty + 1 } : i)
    const name = p.name + (size && (sizesOf(p).length > 1 || size.name !== 'Regular') ? ` (${size.name})` : '')
    const price = (size ? +size.price : p.price) + mods.reduce((s, m) => s + m.price, 0)
    return [...c, { key, product_id: p.id, size: size?.name, mods, name, price, emoji: p.emoji, qty: 1, note: '' }]
  })
  const change = (line, d) => setCart(c => c.map(i => i.key === line.key ? { ...i, qty: i.qty + d } : i).filter(i => i.qty > 0))
  const simple = p => sizesOf(p).length <= 1 && !parseModifiers(p).length
  const count = cart.reduce((s, i) => s + i.qty, 0)
  const subtotal = cart.reduce((s, i) => s + i.qty * i.price, 0)
  const tax = Math.round(subtotal * data.taxRate)

  const submit = async () => {
    setSending(true)
    try {
      const items = cart.map(i => ({ product_id: i.product_id, size: i.size, mods: i.mods, qty: i.qty, note: i.note }))
      const r = await api(`/qr/${token}/order`, { items, note, customer: name })
      setPlaced(r); setCart([]); setNote(''); setShowCart(false)
    } catch (e) { toastError(e.message) }
    setSending(false)
  }

  if (placed) {
    const st = {
      pending: ['⏳', 'Order sent!', 'Waiting for staff to confirm your order…'],
      accepted: ['✅', 'Order confirmed!', 'The kitchen is preparing your food.'],
      rejected: ['❌', 'Order not accepted', 'Please call a staff member for help.'],
    }[placed.status] || ['⏳', 'Order sent!', '']
    return (
      <div className="co-center">
        <div className={'co-big ' + (placed.status === 'pending' ? 'pulse' : '')}>{st[0]}</div>
        <h2>{st[1]}</h2>
        <p>{st[2]}</p>
        <p className="co-muted">{data.table.name} · Order #{placed.id}</p>
        <button className="co-primary" onClick={() => setPlaced(null)}>+ Order more</button>
      </div>
    )
  }

  const products = data.products.filter(p => !cat || p.category_id === cat)

  return (
    <div className="co-page">
      <header className="co-head">
        <div className="co-brand">{data.restaurant.logo} {data.restaurant.name}</div>
        <div className="co-table">🍽️ {data.table.name}<small>{data.table.floor}</small></div>
      </header>

      <div className="co-cats">
        <button className={!cat ? 'active' : ''} onClick={() => setCat(0)}>All</button>
        {data.categories.map(c => (
          <button key={c.id} className={cat === c.id ? 'active' : ''} style={{ '--c': c.color }} onClick={() => setCat(c.id)}>{c.name}</button>
        ))}
      </div>

      <div className="co-list">
        {products.map(p => {
          const q = qtyOf(p.id), line = simple(p) && cart.find(i => i.product_id === p.id)
          const from = Math.min(...sizesOf(p).map(z => +z.price), p.price)
          return (
            <div key={p.id} className={'co-item ' + (q ? 'in' : '')}>
              <span className="co-emoji">{p.emoji}</span>
              <div className="co-info"><b>{p.name}</b><span>{simple(p) ? rs(sizesOf(p)[0]?.price ?? p.price) : 'from ' + rs(from)}</span></div>
              {line ? (
                <div className="co-qty">
                  <button onClick={() => change(line, -1)}>−</button><span>{q}</span><button onClick={() => change(line, 1)}>+</button>
                </div>
              ) : <button className="co-add" onClick={() => simple(p) ? addLine(p, sizesOf(p)[0]) : setChoosing(p)}>{q ? `Add more (${q})` : simple(p) ? 'Add' : 'Choose'}</button>}
            </div>
          )
        })}
      </div>

      {count > 0 && (
        <button className="co-cartbar" onClick={() => setShowCart(true)}>
          <span className="co-badge">{count}</span> View order <b>{rs(subtotal)}</b>
        </button>
      )}

      {choosing && <OptionSheet product={choosing} onClose={() => setChoosing(null)}
        onAdd={(size, mods) => { addLine(choosing, size, mods); setChoosing(null) }} />}

      {showCart && (
        <div className="co-sheet-bg" onClick={() => setShowCart(false)}>
          <div className="co-sheet" onClick={e => e.stopPropagation()}>
            <div className="co-sheet-head"><h3>Your order · {data.table.name}</h3><button onClick={() => setShowCart(false)}>✕</button></div>
            {cart.map(i => (
              <div key={i.key} className="co-line">
                <span>{i.emoji}</span>
                <div className="co-info"><b>{i.name}</b>{i.mods.length > 0 && <small>+ {modsText(i.mods)}</small>}
                  <input placeholder="+ note (e.g. extra spicy)" value={i.note}
                    onChange={e => setCart(c => c.map(x => x === i ? { ...x, note: e.target.value } : x))} />
                </div>
                <div className="co-qty">
                  <button onClick={() => change(i, -1)}>−</button><span>{i.qty}</span><button onClick={() => change(i, 1)}>+</button>
                </div>
              </div>
            ))}
            <input className="co-field" placeholder="Your name (optional)" value={name} onChange={e => setName(e.target.value)} />
            <textarea className="co-field" placeholder="Anything else for the kitchen?" value={note} onChange={e => setNote(e.target.value)} />
            <div className="co-totals">
              <div><span>Subtotal</span><span>{rs(subtotal)}</span></div>
              <div><span>Tax ({Math.round(data.taxRate * 100)}%)</span><span>{rs(tax)}</span></div>
              <div className="grand"><span>Total</span><span>{rs(subtotal + tax)}</span></div>
            </div>
            <button className="co-primary full" disabled={sending} onClick={submit}>{sending ? 'Sending…' : 'Place order'}</button>
            <p className="co-muted center">Pay at the counter or to your waiter.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function sizesOf(p) {
  try { const z = typeof p.sizes === 'string' ? JSON.parse(p.sizes) : p.sizes; return Array.isArray(z) ? z : [] } catch { return [] }
}

// Bottom sheet: pick a size and any option groups, then add to the cart
function OptionSheet({ product: p, onAdd, onClose }) {
  const sizes = sizesOf(p), groups = parseModifiers(p)
  const [size, setSize] = useState(sizes.length > 1 ? null : sizes[0])
  const [mods, setMods] = useState([])
  const toggle = (g, o) => setMods(list => {
    const entry = { group: g.name, name: o.name, price: +o.price || 0 }
    if (list.some(m => m.group === g.name && m.name === o.name)) return list.filter(m => !(m.group === g.name && m.name === o.name))
    if (+g.max === 1) return [...list.filter(m => m.group !== g.name), entry]
    if (+g.max && list.filter(m => m.group === g.name).length >= +g.max) return list
    return [...list, entry]
  })
  const missing = sizes.length > 1 && !size ? 'a size' : groups.find(g => mods.filter(m => m.group === g.name).length < (+g.min || 0))?.name
  const price = (size ? +size.price : p.price) + mods.reduce((s, m) => s + m.price, 0)
  return (
    <div className="co-sheet-bg" onClick={onClose}>
      <div className="co-sheet" onClick={e => e.stopPropagation()}>
        <div className="co-sheet-head"><h3>{p.emoji} {p.name}</h3><button onClick={onClose}>✕</button></div>
        {p.description && <p className="co-muted">{p.description}</p>}
        {sizes.length > 1 && <>
          <h4>Size</h4>
          <div className="co-cats">{sizes.map(z => (
            <button key={z.name} className={size?.name === z.name ? 'active' : ''} onClick={() => setSize(z)}>{z.name} · {rs(z.price)}</button>
          ))}</div>
        </>}
        {groups.map(g => <div key={g.name}>
          <h4>{g.name} <small className="co-muted">{+g.min ? 'required' : 'optional'}{+g.max > 1 ? ` · up to ${g.max}` : ''}</small></h4>
          <div className="co-cats">{g.options.map(o => (
            <button key={o.name} className={mods.some(m => m.group === g.name && m.name === o.name) ? 'active' : ''} onClick={() => toggle(g, o)}>
              {o.name}{+o.price ? ` +${rs(o.price)}` : ''}
            </button>
          ))}</div>
        </div>)}
        <button className="co-primary full" disabled={!!missing} onClick={() => onAdd(size, mods)}>
          {missing ? `Choose ${missing}` : `Add · ${rs(price)}`}
        </button>
      </div>
    </div>
  )
}
