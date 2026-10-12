import { useEffect, useState } from 'react'
import { api, rs } from './lib'
import './CustomerOrder.css'

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

  const qtyOf = id => cart.find(i => i.product_id === id)?.qty || 0
  const change = (p, d) => setCart(c => {
    const ex = c.find(i => i.product_id === p.id)
    if (!ex) return d > 0 ? [...c, { product_id: p.id, name: p.name, price: p.price, emoji: p.emoji, qty: 1, note: '' }] : c
    return c.map(i => i === ex ? { ...i, qty: i.qty + d } : i).filter(i => i.qty > 0)
  })
  const count = cart.reduce((s, i) => s + i.qty, 0)
  const subtotal = cart.reduce((s, i) => s + i.qty * i.price, 0)
  const tax = Math.round(subtotal * data.taxRate)

  const submit = async () => {
    setSending(true)
    try {
      const r = await api(`/qr/${token}/order`, { items: cart, note, customer: name })
      setPlaced(r); setCart([]); setNote(''); setShowCart(false)
    } catch (e) { alert(e.message) }
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
          const q = qtyOf(p.id)
          return (
            <div key={p.id} className={'co-item ' + (q ? 'in' : '')}>
              <span className="co-emoji">{p.emoji}</span>
              <div className="co-info"><b>{p.name}</b><span>{rs(p.price)}</span></div>
              {q ? (
                <div className="co-qty">
                  <button onClick={() => change(p, -1)}>−</button><span>{q}</span><button onClick={() => change(p, 1)}>+</button>
                </div>
              ) : <button className="co-add" onClick={() => change(p, 1)}>Add</button>}
            </div>
          )
        })}
      </div>

      {count > 0 && (
        <button className="co-cartbar" onClick={() => setShowCart(true)}>
          <span className="co-badge">{count}</span> View order <b>{rs(subtotal)}</b>
        </button>
      )}

      {showCart && (
        <div className="co-sheet-bg" onClick={() => setShowCart(false)}>
          <div className="co-sheet" onClick={e => e.stopPropagation()}>
            <div className="co-sheet-head"><h3>Your order · {data.table.name}</h3><button onClick={() => setShowCart(false)}>✕</button></div>
            {cart.map(i => (
              <div key={i.product_id} className="co-line">
                <span>{i.emoji}</span>
                <div className="co-info"><b>{i.name}</b>
                  <input placeholder="+ note (e.g. extra spicy)" value={i.note}
                    onChange={e => setCart(c => c.map(x => x === i ? { ...x, note: e.target.value } : x))} />
                </div>
                <div className="co-qty">
                  <button onClick={() => change({ id: i.product_id }, -1)}>−</button><span>{i.qty}</span><button onClick={() => change({ id: i.product_id }, 1)}>+</button>
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
