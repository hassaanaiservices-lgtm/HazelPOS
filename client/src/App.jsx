import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import './App.css'
import { api, rs, TYPES } from './lib'
import Login from './Login'
import Kitchen from './Kitchen'
import Reports from './Reports'
import Admin from './Admin'
import Invoicing from './Invoicing'
import RegisterSession from './RegisterSession'
import TablesFloor from './TablesFloor'
import { QrOrderAlerts, QrCodesModal } from './QrOrders'

const Ctx = createContext({})
const NAV = {
  admin: [
    ['home', 'New Order'],
    ['orders', 'Orders'],
    ['kitchen', 'Kitchen'],
    ['qr_menu', '📱 QR Codes'],
    ['register_session', 'Cash Drawer'],
    ['invoicing', 'Invoicing & Expenses'],
    ['reports', 'Reports'],
    ['admin', 'Settings']
  ],
  cashier: [
    ['home', 'New Order'],
    ['orders', 'Orders'],
    ['kitchen', 'Kitchen'],
    ['qr_menu', '📱 QR Codes'],
    ['register_session', 'Cash Drawer']
  ],
  kitchen: [
    ['kitchen', 'Kitchen']
  ],
}

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('pos_user') || 'null'))
  const [settings, setSettings] = useState({ name: 'EasyPOS', logo: '🍕' })
  const [view, setView] = useState(user?.role === 'kitchen' ? 'kitchen' : 'home')
  const [menu, setMenu] = useState({ categories: [], products: [], taxRate: 0 })
  const [tables, setTables] = useState([])
  const [order, setOrder] = useState(null)
  const [summary, setSummary] = useState({ orders: 0, revenue: 0 })
  const [toast, setToast] = useState('')

  const refresh = () => { api('/tables').then(setTables); api('/summary').then(setSummary) }
  const reloadAll = () => { api('/menu').then(setMenu); api('/settings').then(setSettings); refresh() }
  useEffect(reloadAll, [])

  const login = u => { setUser(u); localStorage.setItem('pos_user', JSON.stringify(u)); setView(u.role === 'kitchen' ? 'kitchen' : 'home') }
  const logout = () => { setUser(null); localStorage.removeItem('pos_user'); setOrder(null) }

  const notify = m => { setToast(m); setTimeout(() => setToast(''), 2200) }
  if (!user) return <Login settings={settings} onLogin={login} />
  const nav = NAV[user.role] || NAV.cashier
  const newOrder = (type, table) => { setOrder({ type, table_id: table?.id, tableName: table?.name, items: [], discount: 0, user_name: user.name }); setView('register') }
  const openExisting = async id => {
    const o = await api('/orders/' + id)
    setOrder({ ...o, tableName: tables.find(t => t.id === o.table_id)?.name, items: o.items.map(i => ({ ...i })) })
    setView('register')
  }
  const goHome = () => { setOrder(null); refresh(); setView('home') }
  const go = v => v === 'home' ? goHome() : (setOrder(null), refresh(), setView(v))
  const isActive = v => v === view || (v === 'home' && ['tables', 'register'].includes(view))

  return (
    <Ctx.Provider value={{ settings }}>
    <div className="app">
      <header className="topbar no-print">
        <div className="brand" onClick={() => go(nav[0][0])}>{settings.logo} <span>{settings.name}</span></div>
        <nav>
          {nav.map(([v, l]) => <button key={v} id={'nav-' + v} className={isActive(v) ? 'active' : ''} onClick={() => go(v)}>{l}</button>)}
        </nav>
        {user.role !== 'kitchen' && <div className="today">Today: <b>{summary.orders}</b> orders · <b>{rs(summary.revenue)}</b></div>}
        <div className="user"><span className="avatar">{user.name[0]}</span>{user.name}
          <button className="ghost sm" id="logout" onClick={logout}>Lock 🔒</button></div>
      </header>

      <main>
        {view === 'home' && <Home onPick={t => t === 'dine-in' ? (refresh(), setView('tables')) : newOrder(t)} />}
        {view === 'tables' && <TablesFloor tables={tables} onBack={goHome} onRefresh={refresh}
          onPick={t => t.order_id ? openExisting(t.order_id) : newOrder('dine-in', t)} />}
        {view === 'register' && order && <Register menu={menu} order={order} setOrder={setOrder} notify={notify} onDone={goHome} />}
        {view === 'orders' && <Orders onOpen={openExisting} />}
        {view === 'kitchen' && <Kitchen />}
        {view === 'register_session' && <RegisterSession user={user} notify={notify} />}
        {view === 'invoicing' && user.role === 'admin' && <Invoicing user={user} notify={notify} />}
        {view === 'reports' && user.role === 'admin' && <Reports />}
        {view === 'admin' && user.role === 'admin' && <Admin onChanged={reloadAll} notify={notify} />}
        {view === 'qr_menu' && <QrCodesModal onClose={goHome} />}
      </main>
      {toast && <div className="toast">{toast}</div>}
      {user.role !== 'kitchen' && <QrOrderAlerts user={user} notify={notify} onAccepted={refresh} />}
    </div>
    </Ctx.Provider>
  )
}

function Home({ onPick }) {
  return (
    <section className="home">
      <h1>Start a new order</h1>
      <p className="muted">One tap. That's it.</p>
      <div className="type-grid">
        {TYPES.map(t => (
          <button key={t.id} id={'type-' + t.id} className={'type-card ' + t.id} onClick={() => onPick(t.id)}>
            <span className="big-icon">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function Register({ menu, order, setOrder, notify, onDone }) {
  const [cat, setCat] = useState(0)
  const [q, setQ] = useState('')
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState(null)

  const products = menu.products.filter(p => (!cat || p.category_id === cat) && p.name.toLowerCase().includes(q.toLowerCase()))
  const color = id => menu.categories.find(c => c.id === id)?.color

  const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0)
  const tax = Math.round((subtotal - order.discount) * menu.taxRate)
  const total = Math.max(0, subtotal - order.discount + tax)

  const add = p => setOrder(o => {
    const ex = o.items.find(i => i.product_id === p.id)
    return { ...o, items: ex ? o.items.map(i => i === ex ? { ...i, qty: i.qty + 1 } : i) : [...o.items, { product_id: p.id, name: p.name, price: p.price, qty: 1 }] }
  })
  const setQty = (idx, d) => setOrder(o => ({ ...o, items: o.items.map((i, k) => k === idx ? { ...i, qty: i.qty + d } : i).filter(i => i.qty > 0) }))
  const save = async () => { const s = await api('/orders', order); setOrder(o => ({ ...o, id: s.id })); return s }

  const hold = async () => { if (!order.items.length) return; await save(); notify('Sent to kitchen 👨‍🍳'); onDone() }
  const pay = async (method, paid) => {
    const s = await save()
    const done = await api(`/orders/${s.id}/pay`, { method, paid })
    setPaying(false); setReceipt(done)
  }
  const cancel = async () => { if (order.id && confirm('Cancel this order?')) await api(`/orders/${order.id}/cancel`, {}); onDone() }

  const typeInfo = TYPES.find(t => t.id === order.type)

  return (
    <section className="register">
      <div className="menu-side">
        <div className="menu-head">
          <input id="search" placeholder="🔍 Search menu..." value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="cats">
          <button className={!cat ? 'cat active' : 'cat'} onClick={() => setCat(0)}>All</button>
          {menu.categories.map(c => (
            <button key={c.id} className={cat === c.id ? 'cat active' : 'cat'} style={{ '--c': c.color }} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
        </div>
        <div className="prod-grid">
          {products.map(p => (
            <button key={p.id} id={'prod-' + p.id} className="prod" style={{ '--c': color(p.category_id) }} onClick={() => add(p)}>
              <span className="emoji">{p.emoji}</span><b>{p.name}</b><span className="price">{rs(p.price)}</span>
            </button>
          ))}
        </div>
      </div>

      <aside className="cart">
        <div className="cart-head">
          <span className="pill">{typeInfo.icon} {typeInfo.label}{order.tableName ? ' · ' + order.tableName : ''}</span>
          {order.id && <span className="muted">#{order.id}</span>}
        </div>
        {order.type !== 'dine-in' && (
          <div className="cust">
            <input placeholder="Customer name" value={order.customer || ''} onChange={e => setOrder({ ...order, customer: e.target.value })} />
            <input placeholder="Phone" value={order.phone || ''} onChange={e => setOrder({ ...order, phone: e.target.value })} />
            {order.type === 'delivery' && <input className="full" placeholder="Delivery address" value={order.address || ''} onChange={e => setOrder({ ...order, address: e.target.value })} />}
          </div>
        )}
        <div className="items">
          {!order.items.length && <div className="empty">Tap items on the left to add them</div>}
          {order.items.map((i, k) => (
            <div className="item" key={k}>
              <div className="iname"><b>{i.name}</b><small>{rs(i.price)}</small>
                <input className="note" placeholder="+ note (e.g. no onion)" value={i.note || ''}
                  onChange={e => setOrder(o => ({ ...o, items: o.items.map((x, j) => j === k ? { ...x, note: e.target.value } : x) }))} /></div>
              <div className="qty"><button onClick={() => setQty(k, -1)}>−</button><span>{i.qty}</span><button onClick={() => setQty(k, 1)}>+</button></div>
              <div className="ltotal">{rs(i.price * i.qty)}</div>
            </div>
          ))}
        </div>
        <div className="totals">
          <div><span>Subtotal</span><span>{rs(subtotal)}</span></div>
          <div><span>Discount</span>
            <input type="number" min="0" className="disc" value={order.discount || ''} placeholder="0"
              onChange={e => setOrder({ ...order, discount: Math.max(0, +e.target.value) })} /></div>
          <div><span>Tax ({Math.round(menu.taxRate * 100)}%)</span><span>{rs(tax)}</span></div>
          <div className="grand"><span>Total</span><span>{rs(total)}</span></div>
        </div>
        <div className="actions">
          <button className="ghost danger" onClick={cancel}>Cancel</button>
          <button className="ghost" disabled={!order.items.length} onClick={hold}>Send to kitchen</button>
          <button id="pay-btn" className="primary" disabled={!order.items.length} onClick={() => setPaying(true)}>Pay {rs(total)}</button>
        </div>
      </aside>

      {paying && <PayModal total={total} onClose={() => setPaying(false)} onPay={pay} />}
      {receipt && <Receipt order={receipt} onClose={onDone} />}
    </section>
  )
}

function PayModal({ total, onClose, onPay }) {
  const [method, setMethod] = useState('cash')
  const [given, setGiven] = useState('')
  const quick = useMemo(() => [...new Set([total, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, Math.ceil(total / 5000) * 5000])], [total])
  const change = Math.max(0, (+given || 0) - total)
  const ok = method !== 'cash' || (+given || 0) >= total
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Payment</h2>
        <div className="due">{rs(total)}</div>
        <div className="methods">
          {[['cash', '💵 Cash'], ['card', '💳 Card'], ['online', '📱 JazzCash / Easypaisa']].map(([id, l]) => (
            <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}>{l}</button>
          ))}
        </div>
        {method === 'cash' && <>
          <input id="cash-given" autoFocus type="number" placeholder="Cash received" value={given} onChange={e => setGiven(e.target.value)} />
          <div className="quick">{quick.map(v => <button key={v} onClick={() => setGiven(String(v))}>{rs(v)}</button>)}</div>
          <div className="change">Change: <b>{rs(change)}</b></div>
        </>}
        <div className="actions">
          <button className="ghost" onClick={onClose}>Back</button>
          <button id="confirm-pay" className="primary" disabled={!ok} onClick={() => onPay(method, method === 'cash' ? +given : total)}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

function Receipt({ order, onClose }) {
  const { settings: s } = useContext(Ctx)
  return (
    <div className="modal-bg">
      <div className="modal receipt-wrap">
        <div className="receipt" id="receipt">
          <h3>{s.logo} {s.name}</h3>
          {s.address && <p>{s.address}</p>}
          {s.phone && <p>Tel: {s.phone}</p>}
          <p>Order #{order.id} · {order.type}{order.customer ? ' · ' + order.customer : ''}</p>
          {order.address && <p>{order.address}</p>}
          <p>{new Date(order.paid_at).toLocaleString()}{order.user_name ? ' · ' + order.user_name : ''}</p>
          <hr />
          {order.items.map(i => <div className="r-line" key={i.id}><span>{i.qty} × {i.name}</span><span>{rs(i.qty * i.price)}</span></div>)}
          <hr />
          <div className="r-line"><span>Subtotal</span><span>{rs(order.subtotal)}</span></div>
          {order.discount > 0 && <div className="r-line"><span>Discount</span><span>-{rs(order.discount)}</span></div>}
          <div className="r-line"><span>Tax</span><span>{rs(order.tax)}</span></div>
          <div className="r-line big"><span>TOTAL</span><span>{rs(order.total)}</span></div>
          <div className="r-line"><span>Paid ({order.payment_method})</span><span>{rs(order.paid)}</span></div>
          {order.change_ > 0 && <div className="r-line"><span>Change</span><span>{rs(order.change_)}</span></div>}
          <p className="thanks">{s.footer}</p>
        </div>
        <div className="actions no-print">
          <button className="ghost" onClick={() => window.print()}>🖨️ Print</button>
          <button id="new-order" className="primary" onClick={onClose}>New Order</button>
        </div>
      </div>
    </div>
  )
}

function Orders({ onOpen }) {
  const [list, setList] = useState([])
  const [tab, setTab] = useState('open')
  useEffect(() => { api('/orders?status=' + tab).then(setList) }, [tab])
  return (
    <section className="orders">
      <div className="row-head"><h2>Orders</h2>
        <div className="tabs">{['open', 'paid', 'cancelled'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>
      <div className="order-list">
        {!list.length && <div className="empty">No {tab} orders</div>}
        {list.map(o => (
          <div key={o.id} className="order-row" onClick={() => tab === 'open' && onOpen(o.id)}>
            <b>#{o.id}</b>
            <span className="pill">{TYPES.find(t => t.id === o.type)?.icon} {o.type}</span>
            <span className="muted">{o.items.reduce((s, i) => s + i.qty, 0)} items {o.customer && '· ' + o.customer}</span>
            <span className="muted">{new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <b className="amt">{rs(o.total)}</b>
            {tab === 'open' && <span className="link">Open →</span>}
          </div>
        ))}
      </div>
    </section>
  )
}
