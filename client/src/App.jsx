import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import './App.css'
import { api, rs, TYPES, parseModifiers, modsText, promoPreview, run } from './lib'
import Login from './Login'
import Kitchen from './Kitchen'
import Reports from './Reports'
import Admin from './Admin'
import Invoicing from './Invoicing'
import RegisterSession from './RegisterSession'
import TablesFloor from './TablesFloor'
import Inventory from './Inventory'
import Customers from './Customers'
import Delivery from './Delivery'
import Payroll from './Payroll'
import WhatsApp from './WhatsApp'
import { QrOrderAlerts, QrCodesModal, beep } from './QrOrders'
import QRCode from 'qrcode'
import { Icon } from './ui'
import { toast, toastError, confirmBox, promptBox } from './notify'

const Ctx = createContext({})
const THEMES = [['dark', 'Dark', 'moon'], ['light', 'Light', 'sun'], ['auto', 'Auto', 'monitor']]
// [view, label, icon]
const NAV = {
  admin: [
    ['orders', 'Orders', 'list'],
    ['kitchen', 'Kitchen', 'flame'],
    ['delivery', 'Delivery', 'bike'],
    ['qr_menu', 'QR codes', 'qr'],
    ['register_session', 'Cash drawer', 'wallet'],
    ['inventory', 'Inventory', 'box'],
    ['customers', 'Customers', 'users'],
    ['staff', 'Staff', 'badge'],
    ['invoicing', 'Accounts', 'receipt'],
    ['reports', 'Reports', 'chart'],
    ['admin', 'Settings', 'settings'],
  ],
  cashier: [
    ['home', 'New order', 'plus'],
    ['orders', 'Orders', 'list'],
    ['kitchen', 'Kitchen', 'flame'],
    ['delivery', 'Delivery', 'bike'],
    ['qr_menu', 'QR codes', 'qr'],
    ['whatsapp', 'WhatsApp', 'chat'],
    ['register_session', 'Cash drawer', 'wallet'],
  ],
  kitchen: [
    ['kitchen', 'Kitchen', 'flame'],
  ],
}

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('pos_user') || 'null'))
  const [settings, setSettings] = useState({ name: 'HazelPOS', logo: '🍕' })
  const [view, setView] = useState(user?.role === 'kitchen' ? 'kitchen' : user?.role === 'admin' ? 'orders' : 'home')
  const [menu, setMenu] = useState({ categories: [], products: [], taxRate: 0 })
  const [tables, setTables] = useState([])
  const [order, setOrder] = useState(null)
  const [summary, setSummary] = useState({ orders: 0, revenue: 0 })
  const [lowStock, setLowStock] = useState(0)
  const [wa, setWa] = useState(null) // WhatsApp unread / missed-while-offline counts for the nav badge
  const [navOpen, setNavOpen] = useState(false) // drawer on narrow screens
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('pos_theme') || 'dark' } catch { return 'dark' } }) // per screen: dark | light | auto
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('pos_theme', theme) } catch { /* private window: theme just isn't remembered */ }
  }, [theme])

  const refresh = () => {
    api('/tables').then(setTables); api('/summary').then(setSummary)
    if (user?.role === 'admin') api('/inventory/low').then(l => setLowStock(l.length)).catch(() => {})
  }
  const reloadAll = () => { api('/settings').then(setSettings); if (user) { api('/menu').then(setMenu); refresh() } }
  useEffect(reloadAll, [user?.id])
  const notify = (m, kind) => toast(m, kind)
  useEffect(() => {
    if (user?.role !== 'cashier') return
    let prevOrders = null
    const poll = () => api('/whatsapp/status').then(st => {
      if (prevOrders !== null && st.orders_pending > prevOrders) { beep(); notify('New WhatsApp order: open WhatsApp to accept it', 'info') }
      prevOrders = st.orders_pending; setWa(st)
    }).catch(() => {})
    poll(); const t = setInterval(poll, 5000); return () => clearInterval(t)
  }, [user?.id])

  const login = ({ token, user: u }) => { localStorage.setItem('pos_token', token); setUser(u); localStorage.setItem('pos_user', JSON.stringify(u)); setView(u.role === 'kitchen' ? 'kitchen' : u.role === 'admin' ? 'orders' : 'home') }
  const clearSession = () => { setUser(null); localStorage.removeItem('pos_user'); localStorage.removeItem('pos_token'); setOrder(null) }
  const logout = () => { api('/logout', {}).catch(() => {}).finally(clearSession) }
  useEffect(() => {
    window.addEventListener('pos-logout', clearSession)
    return () => window.removeEventListener('pos-logout', clearSession)
  }, [])

  if (!user) return <Login settings={settings} onLogin={login} />
  const nav = NAV[user.role] || NAV.cashier
  const newOrder = (type, table) => { setOrder({ type, table_id: table?.id, tableName: table?.name, items: [], discount: 0, user_name: user.name }); setView('register') }
  const openExisting = async id => {
    const o = await api('/orders/' + id)
    setOrder({ ...o, tableName: tables.find(t => t.id === o.table_id)?.name, items: o.items.map(i => ({ ...i })) })
    setView('register')
  }
  const goHome = () => { setOrder(null); refresh(); setView('home') }
  const go = v => { setNavOpen(false); v === 'home' ? goHome() : (setOrder(null), refresh(), setView(v)) }
  const isActive = v => v === view || (v === 'home' && ['tables', 'register'].includes(view))
  const solo = nav.length === 1 // kitchen: one screen, no sidebar
  const brand = <div className="brand" onClick={() => go(nav[0][0])}><span className="brand-mark" aria-hidden="true">{settings.logo}</span><span>{settings.name}</span></div>
  // Demo: back to the role picker. Real POS: sign out to the PIN screen.
  const lock = settings.demo
    ? <button className="ghost sm" id="logout" onClick={logout} title="Back to choose another role"><Icon name="back" size={16} />Back</button>
    : <button className="ghost sm" id="logout" onClick={logout}><Icon name="logout" size={16} />Sign out</button>
  const badge = v => {
    if (v === 'inventory' && lowStock > 0) return <span className="nav-badge" title="Ingredients running low">{lowStock}</span>
    if (v !== 'whatsapp' || !wa) return null
    if (wa.orders_pending > 0) return <span className="nav-badge" title="WhatsApp orders waiting for you to accept">{wa.orders_pending}</span>
    if (wa.unread > 0 || wa.offline_chats > 0) return <span className={'nav-badge ' + (wa.offline_chats ? 'wa-offline' : 'wa')}
      title={wa.offline_chats ? `${wa.offline_chats} customer(s) messaged while the POS was offline` : 'Unread WhatsApp messages'}>{wa.unread || '!'}</span>
    return null
  }

  return (
    <Ctx.Provider value={{ settings }}>
    <div className={'app' + (solo ? ' solo' : '') + (navOpen ? ' nav-open' : '')}>
      <header className="topbar no-print">
        {!solo && <button className="icon-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}><Icon name="menu" size={22} /></button>}
        {brand}
        <button className="icon-btn" aria-label="Change theme" title={`Theme: ${theme}`}
          onClick={() => setTheme(THEMES[(THEMES.findIndex(t => t[0] === theme) + 1) % THEMES.length][0])}><Icon name={THEMES.find(t => t[0] === theme)?.[2] || 'moon'} size={20} /></button>
        {solo && <div className="user"><span className="avatar">{user.name[0]}</span><span>{user.name}</span>{lock}</div>}
      </header>
      {!solo && <aside className="sidebar no-print" aria-label="Main menu">
        {brand}
        <nav className="side-nav">
          {nav.map(([v, l, ic]) => <button key={v} id={'nav-' + v} className={isActive(v) ? 'active' : ''} aria-current={isActive(v) ? 'page' : undefined} onClick={() => go(v)}>
            <Icon name={ic} size={20} />{l}{badge(v)}</button>)}
        </nav>
        <div className="side-foot">
          <div className="theme-switch" role="radiogroup" aria-label="Theme">
            {THEMES.map(([id, label, ic]) => <button key={id} role="radio" aria-checked={theme === id} className={theme === id ? 'on' : ''} onClick={() => setTheme(id)}>
              <Icon name={ic} size={14} />{label}</button>)}
          </div>
          {user.role !== 'kitchen' && <div className="today"><span>Today</span><span><b>{summary.orders}</b> orders, <b>{rs(summary.revenue)}</b></span></div>}
          <div className="user"><span className="avatar">{user.name[0]}</span><span>{user.name}</span>{lock}</div>
        </div>
      </aside>}
      <div className="drawer-bg" onClick={() => setNavOpen(false)} />

      <main>
        {view === 'home' && <Home onPick={t => t === 'dine-in' ? (refresh(), setView('tables')) : newOrder(t)} />}
        {view === 'tables' && <TablesFloor tables={tables} onBack={goHome} onRefresh={refresh} canEditFloors={user.role === 'admin'}
          onPick={t => t.order_id ? openExisting(t.order_id) : newOrder('dine-in', t)} />}
        {view === 'register' && order && <Register menu={menu} order={order} setOrder={setOrder} notify={notify} onDone={goHome} />}
        {view === 'orders' && <Orders onOpen={user.role === 'admin' ? null : openExisting} notify={notify} />}
        {view === 'kitchen' && <Kitchen readOnly={user.role === 'admin'} />}
        {view === 'register_session' && <RegisterSession user={user} notify={notify} />}
        {view === 'invoicing' && user.role === 'admin' && <Invoicing user={user} notify={notify} />}
        {view === 'reports' && user.role === 'admin' && <Reports />}
        {view === 'inventory' && user.role === 'admin' && <Inventory notify={notify} />}
        {view === 'customers' && user.role === 'admin' && <Customers notify={notify} />}
        {view === 'staff' && user.role === 'admin' && <section className="admin"><div className="row-head"><h2>Staff</h2>
          <span className="muted">Salaries and advances are added to Expenses automatically.</span></div><Payroll notify={notify} /></section>}
        {view === 'delivery' && <Delivery notify={notify} />}
        {view === 'whatsapp' && user.role !== 'kitchen' && <WhatsApp notify={notify} />}
        {view === 'admin' && user.role === 'admin' && <Admin onChanged={reloadAll} notify={notify} />}
        {view === 'qr_menu' && <QrCodesModal onClose={() => go(nav[0][0])} />}
      </main>
      {user.role === 'cashier' && <QrOrderAlerts user={user} notify={notify} onAccepted={refresh} />}
    </div>
    </Ctx.Provider>
  )
}

function Home({ onPick }) {
  return (
    <section className="home">
      <h1>Start a new order</h1>
      <p className="muted">Pick how the customer is eating.</p>
      <div className="type-grid">
        {TYPES.map(t => (
          <button key={t.id} id={'type-' + t.id} className={'type-card ' + t.id} onClick={() => onPick(t.id)}>
            <Icon name={t.icon} size={36} />{t.label}
          </button>
        ))}
      </div>
    </section>
  )
}

function parseProductSizes(product) {
  if (!product) return [];
  if (product.sizes) {
    try {
      const parsed = typeof product.sizes === 'string' ? JSON.parse(product.sizes) : product.sizes;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return [{ name: 'Regular', detail: 'Standard', price: product.price }];
}

function parseProductImages(product) {
  if (!product || !product.ingredients) return [];
  try {
    if (Array.isArray(product.ingredients)) return product.ingredients;
    const parsed = JSON.parse(product.ingredients);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return String(product.ingredients).split(',').map(s => s.trim()).filter(Boolean);
}

function getProductMinPrice(product) {
  const sizes = parseProductSizes(product);
  if (sizes.length > 0) {
    return Math.min(...sizes.map(s => Number(s.price) || product.price));
  }
  return product.price;
}

function hasMultipleSizes(product) {
  const sizes = parseProductSizes(product);
  return sizes.length > 1;
}
const needsOptions = p => hasMultipleSizes(p) || parseModifiers(p).length > 0

function ItemDetailModal({ product, category, onAdd, onClose }) {
  const sizes = useMemo(() => parseProductSizes(product), [product]);
  const ingredients = useMemo(() => parseProductImages(product), [product]);

  const [selectedSize, setSelectedSize] = useState(() => {
    const med = sizes.find(s => s.name.toLowerCase() === 'medium');
    return med || sizes[0] || null;
  });
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const groups = useMemo(() => parseModifiers(product), [product]);
  const [picked, setPicked] = useState([]); // [{ group, name, price }]
  const toggle = (g, o) => setPicked(list => {
    const entry = { group: g.name, name: o.name, price: +o.price || 0 };
    if (list.some(m => m.group === g.name && m.name === o.name)) return list.filter(m => !(m.group === g.name && m.name === o.name));
    const max = +g.max || Infinity;
    if (max === 1) return [...list.filter(m => m.group !== g.name), entry]; // single choice: swap
    if (list.filter(m => m.group === g.name).length >= max) return list;
    return [...list, entry];
  });
  const missing = groups.find(g => picked.filter(m => m.group === g.name).length < (+g.min || 0));

  const unitPrice = (selectedSize ? +selectedSize.price : product.price) + picked.reduce((s, m) => s + m.price, 0);
  const totalPrice = unitPrice * qty;

  const handleAdd = () => {
    onAdd({ product, size: selectedSize, qty, note: note.trim(), mods: picked });
    onClose();
  };

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-bg item-detail-modal-bg" onClick={onClose}>
      <div className="item-detail-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="item-modal-head">
          <div className="item-modal-icon-badge" style={{ background: category?.color || '#f7b32b' }}>
            <span className="item-modal-emoji">{product.emoji || '🍕'}</span>
          </div>
          <div className="item-modal-title-col">
            <h2 className="item-modal-title">{product.name}</h2>
            <div className="item-modal-subtitle">
              {product.subtitle || `${category?.name || 'Menu'} · Serves 1–3 depending on size`}
            </div>
          </div>
          <button type="button" className="item-modal-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        {/* Description */}
        {product.description && (
          <p className="item-modal-desc">{product.description}</p>
        )}

        {/* CHOOSE SIZE (Non-editable, selectable variation) */}
        {sizes.length > 0 && (
          <div className="item-modal-section">
            <div className="item-modal-sec-title">Size</div>
            <div className="item-modal-sizes-grid">
              {sizes.map((s, idx) => {
                const isSelected = selectedSize?.name === s.name;
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`size-card-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedSize(s)}
                  >
                    <div className="size-name">{s.name}</div>
                    {s.detail && <div className="size-detail">{s.detail}</div>}
                    <div className="size-price">{rs(s.price)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* INGREDIENTS (Non-editable pills) */}
        {ingredients.length > 0 && (
          <div className="item-modal-section">
            <div className="item-modal-sec-title">Ingredients</div>
            <div className="item-modal-ingredients">
              {ingredients.map((ing, idx) => (
                <span key={idx} className="ingredient-tag">{ing}</span>
              ))}
            </div>
          </div>
        )}

        {groups.map(g => (
          <div className="item-modal-section" key={g.name}>
            <div className="item-modal-sec-title">
              {g.name}{' '}
              <span className="muted">{+g.min ? 'required' : 'optional'}{+g.max > 1 ? ` · up to ${g.max}` : ''}</span>
            </div>
            <div className="item-modal-sizes-grid">
              {g.options.map(o => {
                const on = picked.some(m => m.group === g.name && m.name === o.name);
                return (
                  <button key={o.name} type="button" className={`size-card-btn ${on ? 'selected' : ''}`} onClick={() => toggle(g, o)}>
                    <div className="size-name">{o.name}</div>
                    <div className="size-price">{+o.price ? '+' + rs(o.price) : 'Free'}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Note input */}
        <div className="item-modal-section">
          <input
            className="item-modal-note-input"
            placeholder="+ note (e.g. no onion)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
        </div>

        {/* Footer Actions */}
        <div className="item-modal-footer">
          <div className="item-modal-qty-ctrl">
            <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
            <span className="item-modal-qty-num">{qty}</span>
            <button type="button" onClick={() => setQty(q => q + 1)}>+</button>
          </div>
          <button type="button" className="item-modal-add-btn" disabled={!!missing} onClick={handleAdd}>
            {missing ? `Choose ${missing.name}` : `Add to order, ${rs(totalPrice)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Register({ menu, order, setOrder, notify, onDone }) {
  const { settings } = useContext(Ctx)
  const [cat, setCat] = useState(0)
  const [q, setQ] = useState('')
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [activeProduct, setActiveProduct] = useState(null)
  const [pinAsk, setPinAsk] = useState(null) // { msg, resolve }
  const [tableAction, setTableAction] = useState(null) // 'move' | 'split'
  const [zones, setZones] = useState([])
  const [cartOpen, setCartOpen] = useState(false) // cart sheet on narrow screens
  useEffect(() => { if (order.type === 'delivery') api('/delivery-zones').then(z => setZones(z.filter(x => x.active))) }, [order.type])

  const products = menu.products.filter(p => (!cat || p.category_id === cat) && p.name.toLowerCase().includes(q.toLowerCase()))
  const color = id => menu.categories.find(c => c.id === id)?.color

  // Same order as the server: manual discount, then promo, then loyalty points, then tax
  const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0)
  const afterDiscount = Math.max(0, subtotal - (order.discount || 0))
  const promoAmt = promoPreview(order.promo, afterDiscount)
  const pointValue = +settings.loyalty_value || 0
  const pointsUsed = pointValue ? Math.min(order.points_used || 0, Math.floor((afterDiscount - promoAmt) / pointValue)) : 0
  const net = afterDiscount - promoAmt - pointsUsed * pointValue
  const tax = Math.round(net * menu.taxRate)
  const zone = zones.find(z => z.id === +order.zone_id)
  const deliveryFee = order.type === 'delivery' && zone && !(zone.free_above && subtotal >= zone.free_above) ? zone.fee : 0
  const total = net + tax + deliveryFee

  // Prices shown here are a preview; the server recalculates every line from the menu when the order is saved
  const addWithVariation = ({ product, size, qty = 1, note = '', mods = [] }) => setOrder(o => {
    const hasMultiple = hasMultipleSizes(product);
    const sizeSuffix = (hasMultiple || (size && size.name !== 'Regular')) ? ` (${size.name})` : '';
    const itemName = `${product.name}${sizeSuffix}`;
    const itemPrice = (size ? +size.price : product.price) + mods.reduce((s, m) => s + m.price, 0);
    const cleanNote = note || '';

    const exIndex = o.items.findIndex(i => i.product_id === product.id && i.name === itemName && (i.note || '') === cleanNote && modsText(i.mods) === modsText(mods));
    if (exIndex >= 0) {
      return {
        ...o,
        items: o.items.map((i, k) => k === exIndex ? { ...i, qty: i.qty + qty } : i)
      };
    }
    return {
      ...o,
      items: [...o.items, { product_id: product.id, name: itemName, size: size?.name, mods, price: itemPrice, qty, note: cleanNote }]
    };
  })

  const setQty = (idx, d) => setOrder(o => ({ ...o, items: o.items.map((i, k) => k === idx ? { ...i, qty: i.qty + d } : i).filter(i => i.qty > 0) }))
  const askPin = msg => new Promise(resolve => setPinAsk({ msg, resolve }))
  const save = async () => {
    let body = order, s
    for (;;) {
      try { s = await api('/orders', body); break }
      catch (e) {
        if (e.code !== 'approval_needed') throw e
        const pin = await askPin(e.message) // big discount: an admin types their PIN on this screen
        if (!pin) throw new Error('Discount not approved')
        body = { ...order, approve_pin: pin }
      }
    }
    setOrder(o => ({ ...o, id: s.id, items: s.items, discount: s.discount, customer_id: s.customer_id, promo_code: s.promo_code, promo: s.promo, points_used: s.points_used, zone_id: s.zone_id }))
    if (s.kitchen_print && s.kitchen_print !== 'ok') toastError('Kitchen printer: ' + s.kitchen_print)
    return s
  }
  const tryIt = run
  const lookup = tryIt(async phone => {
    if (phone.replace(/\D/g, '').length < 10) return setOrder(o => ({ ...o, regular: null }))
    const c = await api('/customers/lookup?phone=' + encodeURIComponent(phone))
    setOrder(o => ({ ...o, regular: c, customer: o.customer || c?.name || '', address: o.address || c?.address || '' }))
  })
  const applyPromo = tryIt(async () => {
    if (!order.promo_code) return setOrder(o => ({ ...o, promo: null }))
    try {
      const p = await api('/promos/check', { code: order.promo_code, base: afterDiscount })
      setOrder(o => ({ ...o, promo: p, promo_code: p.code })); notify(`Promo ${p.code}: -${rs(p.amount)}`)
    } catch (e) { setOrder(o => ({ ...o, promo: null })); throw e }
  })
  useEffect(() => { if (order.phone && order.regular === undefined) lookup(order.phone) }, [order.id]) // reopened order: show the regular's points

  const hold = tryIt(async () => { if (!order.items.length) return; await save(); notify('Sent to kitchen'); onDone() })
  const pay = tryIt(async (method, paid) => {
    const s = await save()
    const done = await api(`/orders/${s.id}/pay`, { method, paid })
    setPaying(false); setReceipt(done)
    if (done.receipt_print && done.receipt_print !== 'ok') toastError('Receipt printer: ' + done.receipt_print)
  })
  const openTableAction = tryIt(async kind => { await save(); setTableAction(kind) })
  const moveTo = tryIt(async t => {
    if (t.order_id) {
      if (!await confirmBox(`Merge this bill into ${t.name}'s bill?`)) return
      const merged = await api(`/orders/${order.id}/merge`, { into_id: t.order_id })
      setOrder({ ...merged }); notify(`Merged into ${t.name}`)
    } else {
      const moved = await api(`/orders/${order.id}/transfer`, { table_id: t.id })
      setOrder(o => ({ ...o, table_id: moved.table_id, tableName: moved.tableName })); notify(`Moved to ${t.name}`)
    }
    setTableAction(null)
  })
  const split = tryIt(async lines => {
    const bill = await api(`/orders/${order.id}/split`, { items: lines })
    setTableAction(null); setOrder({ ...bill }); notify(`New bill #${bill.id} — ready to pay`)
  })
  const cancel = async () => { if (order.id && await confirmBox('Cancel this order?')) await api(`/orders/${order.id}/cancel`, {}); onDone() }

  const typeInfo = TYPES.find(t => t.id === order.type)

  return (
    <section className={'register' + (cartOpen ? ' cart-open' : '')}>
      <div className="menu-side">
        <div className="menu-head">
          <input id="search" type="search" placeholder="Search menu" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="cats">
          <button className={!cat ? 'cat active' : 'cat'} onClick={() => setCat(0)}>All</button>
          {menu.categories.map(c => (
            <button key={c.id} className={cat === c.id ? 'cat active' : 'cat'} style={{ '--c': c.color }} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
        </div>
        <div className="prod-grid">
          {products.map(p => {
            const minP = getProductMinPrice(p);
            const hasMultiple = hasMultipleSizes(p);
            return (
              <button
                key={p.id}
                id={'prod-' + p.id}
                className="prod"
                style={{ '--c': color(p.category_id) }}
                onClick={() => needsOptions(p) ? setActiveProduct(p) : addWithVariation({ product: p, size: parseProductSizes(p)[0], qty: 1, note: '' })}
              >
                <span className="emoji">{p.emoji}</span>
                <b>{p.name}</b>
                    <span className="price">{hasMultiple ? `from ${rs(minP)}` : rs(p.price)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button className="order-bar" onClick={() => setCartOpen(true)}>
        <Icon name="receipt" size={20} />{order.items.reduce((s, i) => s + i.qty, 0)} items<b>{rs(total)}</b>
      </button>
      <aside className="cart" aria-label="Current order">
        <div className="cart-head">
          <span className="pill"><Icon name={typeInfo.icon} size={15} />{typeInfo.label}{order.tableName ? `, ${order.tableName}` : ''}</span>
          {order.id && <span className="muted">#{order.id}</span>}
          {order.type === 'dine-in' && order.items.length > 0 && <span className="table-actions">
            <button className="ghost sm" onClick={() => openTableAction('move')}>Move or merge</button>
            <button className="ghost sm" onClick={() => openTableAction('split')}>Split bill</button>
          </span>}
          <button className="icon-btn cart-close" aria-label="Close order" onClick={() => setCartOpen(false)}><Icon name="x" /></button>
        </div>
        <div className="cust">
          <input placeholder="Phone (regulars earn points)" inputMode="tel" value={order.phone || ''}
            onChange={e => setOrder({ ...order, phone: e.target.value })} onBlur={e => lookup(e.target.value)} />
          <input placeholder="Customer name" value={order.customer || ''} onChange={e => setOrder({ ...order, customer: e.target.value })} />
          {order.type === 'delivery' && <input className="full" placeholder="Delivery address" value={order.address || ''} onChange={e => setOrder({ ...order, address: e.target.value })} />}
          {order.type === 'delivery' && zones.length > 0 && <select className="full" value={order.zone_id || ''} onChange={e => setOrder({ ...order, zone_id: +e.target.value || null })}>
            <option value="">Delivery area…</option>
            {zones.map(z => <option key={z.id} value={z.id}>{z.name} · {z.fee ? rs(z.fee) : 'free'}{z.min_order ? ` · min ${rs(z.min_order)}` : ''} · ~{z.eta_min} min</option>)}
          </select>}
          {order.regular && <div className="full regular">Regular: {order.regular.points} points, {order.regular.visits} visits, {rs(order.regular.spent)} spent</div>}
        </div>
        <div className="items">
          {!order.items.length && <div className="empty">Tap items on the left to add them</div>}
          {order.items.map((i, k) => (
            <div className="item" key={k}>
              <div className="iname"><b>{i.name}</b><small>{rs(i.price)}</small>
                {i.mods?.length > 0 && <small className="mods">+ {modsText(i.mods)}</small>}
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
          <div><span>Promo</span>
            <span className="promo-box">
              <input className="disc" placeholder="CODE" value={order.promo_code || ''}
                onChange={e => setOrder({ ...order, promo_code: e.target.value.toUpperCase(), promo: null })} onKeyDown={e => e.key === 'Enter' && applyPromo()} />
              {order.promo ? <b className="ok">-{rs(promoAmt)}</b> : <button className="ghost sm" onClick={applyPromo}>Apply</button>}
            </span></div>
          {order.regular?.points > 0 && pointValue > 0 && <div><span>Use points (max {order.regular.points})</span>
            <span className="promo-box">
              <input type="number" min="0" className="disc" placeholder="0" value={order.points_used || ''}
                onChange={e => setOrder({ ...order, points_used: Math.min(order.regular.points, Math.max(0, parseInt(e.target.value) || 0)) })} />
              {pointsUsed > 0 && <b className="ok">-{rs(pointsUsed * pointValue)}</b>}
            </span></div>}
          <div><span>Tax ({Math.round(menu.taxRate * 100)}%)</span><span>{rs(tax)}</span></div>
          {order.type === 'delivery' && zone && <div><span>Delivery ({zone.name})</span><span>{deliveryFee ? rs(deliveryFee) : 'Free'}</span></div>}
          <div className="grand"><span>Total</span><span>{rs(total)}</span></div>
        </div>
        <div className="actions">
          <button className="ghost danger" onClick={cancel}>Cancel</button>
          <button className="ghost" disabled={!order.items.length} onClick={hold}>Send to kitchen</button>
          <button id="pay-btn" className="primary" disabled={!order.items.length} onClick={() => setPaying(true)}>Pay {rs(total)}</button>
        </div>
      </aside>

      {activeProduct && (
        <ItemDetailModal
          product={activeProduct}
          category={menu.categories.find(c => c.id === activeProduct.category_id)}
          onAdd={addWithVariation}
          onClose={() => setActiveProduct(null)}
        />
      )}
      {paying && <PayModal total={total} onClose={() => setPaying(false)} onPay={pay} />}
      {receipt && <Receipt order={receipt} onClose={onDone} notify={notify} />}
      {pinAsk && <PinPrompt msg={pinAsk.msg} onDone={pin => { pinAsk.resolve(pin); setPinAsk(null) }} />}
      {tableAction === 'move' && <MoveModal order={order} onPick={moveTo} onClose={() => setTableAction(null)} />}
      {tableAction === 'split' && <SplitModal order={order} onSplit={split} onClose={() => setTableAction(null)} />}
    </section>
  )
}

function PayModal({ total, onClose, onPay }) {
  const { settings } = useContext(Ctx)
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
          {[['cash', 'Cash', 'cash'], ['card', 'Card', 'card'], ['online', 'QR / Raast', 'qr']].map(([id, l, ic]) => (
            <button key={id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}><Icon name={ic} size={20} />{l}</button>
          ))}
        </div>
        {method === 'cash' && <>
          <input id="cash-given" autoFocus type="number" placeholder="Cash received" value={given} onChange={e => setGiven(e.target.value)} />
          <div className="quick">{quick.map(v => <button key={v} onClick={() => setGiven(String(v))}>{rs(v)}</button>)}</div>
          <div className="change">Change: <b>{rs(change)}</b></div>
        </>}
        {method === 'online' && settings.payment_qr && <div className="pay-qr">
          <img src={settings.payment_qr} alt="Payment QR" />
          <div><b>Scan to pay {rs(total)}</b>{settings.payment_qr_label && <small className="muted">{settings.payment_qr_label}</small>}
            <small className="muted">Confirm only after you see the payment.</small></div>
        </div>}
        <div className="actions">
          <button className="ghost" onClick={onClose}>Back</button>
          <button id="confirm-pay" className="primary" disabled={!ok} onClick={() => onPay(method, method === 'cash' ? +given : total)}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

function PinPrompt({ msg, onDone }) {
  const [pin, setPin] = useState('')
  return (
    <div className="modal-bg" style={{ zIndex: 30 }} onClick={() => onDone(null)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Admin approval</h2>
        <p className="muted">{msg}</p>
        <input autoFocus type="password" inputMode="numeric" maxLength={4} placeholder="Admin PIN" value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && pin && onDone(pin)} />
        <div className="actions">
          <button className="ghost" onClick={() => onDone(null)}>Cancel</button>
          <button className="primary" disabled={pin.length < 4} onClick={() => onDone(pin)}>Approve</button>
        </div>
      </div>
    </div>
  )
}

// Pick a free table to move to, or a busy one to merge into
function MoveModal({ order, onPick, onClose }) {
  const [tables, setTables] = useState(null)
  useEffect(() => { api('/tables').then(setTables) }, [])
  const others = (tables || []).filter(t => t.id !== order.table_id)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 560, maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
        <h2>Move or merge {order.tableName ? `from ${order.tableName}` : ''}</h2>
        <p className="muted">Free table = move this bill there. Busy table = add this bill to theirs.</p>
        <div className="table-pick">
          {others.map(t => (
            <button key={t.id} className={t.order_id ? 'busy' : 'free'} onClick={() => onPick(t)}>
              <b>{t.name}</b><small>{t.order_id ? `Merge · ${rs(t.total)}` : `Move · ${t.floor || ''}`}</small>
            </button>
          ))}
        </div>
        <div className="actions"><button className="ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}

// Choose how many of each line go to a new bill on the same table
function SplitModal({ order, onSplit, onClose }) {
  const [take, setTake] = useState({})
  const set = (i, d) => setTake(t => ({ ...t, [i.id]: Math.min(i.qty, Math.max(0, (t[i.id] || 0) + d)) }))
  const lines = order.items.filter(i => take[i.id] > 0).map(i => ({ id: i.id, qty: take[i.id] }))
  const amount = order.items.reduce((s, i) => s + (take[i.id] || 0) * i.price, 0)
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 520, maxWidth: '95vw' }} onClick={e => e.stopPropagation()}>
        <h2>Split bill</h2>
        <p className="muted">Pick the items for the new bill.</p>
        <div className="split-lines">
          {order.items.map(i => (
            <div key={i.id} className="item">
              <div className="iname"><b>{i.name}</b><small>{i.qty} on bill · {rs(i.price)} each</small>
                {i.mods?.length > 0 && <small className="mods">+ {modsText(i.mods)}</small>}</div>
              <div className="qty"><button onClick={() => set(i, -1)}>−</button><span>{take[i.id] || 0}</span><button onClick={() => set(i, 1)}>+</button></div>
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!lines.length} onClick={() => onSplit(lines)}>New bill · {rs(amount)} + tax</button>
        </div>
      </div>
    </div>
  )
}

function Receipt({ order, onClose, notify, closeLabel = 'New Order' }) {
  const { settings: s } = useContext(Ctx)
  const [fiscalQr, setFiscalQr] = useState('')
  useEffect(() => { if (order.fiscal_no) QRCode.toDataURL(order.fiscal_no, { margin: 1, width: 120 }).then(setFiscalQr) }, [order.fiscal_no])
  const print = async () => {
    if (!s.receipt_printer) return window.print()
    try { await api(`/print/receipt/${order.id}`, {}); notify('Printed') } catch (e) { toastError(e.message) }
  }
  return (
    <div className="modal-bg">
      <div className="modal receipt-wrap">
        <div className="receipt" id="receipt">
          <h3>{s.logo} {s.name}</h3>
          {s.address && <p>{s.address}</p>}
          {s.phone && <p>Tel: {s.phone}</p>}
          {s.ntn && <p>NTN: {s.ntn}</p>}
          {s.strn && <p>STRN: {s.strn}</p>}
          {s.pos_id && <p>POS ID: {s.pos_id}</p>}
          <p><b>{order.tax > 0 ? 'SALES TAX INVOICE' : 'RECEIPT'}</b> · {order.invoice_no}</p>
          <p>Order #{order.id} · {order.type}{order.tableName ? ' · ' + order.tableName : ''}{order.customer ? ' · ' + order.customer : ''}</p>
          {order.address && <p>{order.address}</p>}
          <p>{new Date(order.paid_at).toLocaleString()}{order.user_name ? ' · ' + order.user_name : ''}</p>
          <hr />
          {order.items.map(i => <div key={i.id}>
            <div className="r-line"><span>{i.qty} × {i.name}</span><span>{rs(i.qty * i.price)}</span></div>
            {i.mods?.length > 0 && <div className="r-sub">+ {modsText(i.mods)}</div>}
          </div>)}
          <hr />
          <div className="r-line"><span>Subtotal</span><span>{rs(order.subtotal)}</span></div>
          {order.discount > 0 && <div className="r-line"><span>Discount</span><span>-{rs(order.discount)}</span></div>}
          {order.promo_amount > 0 && <div className="r-line"><span>Promo {order.promo_code}</span><span>-{rs(order.promo_amount)}</span></div>}
          {order.points_amount > 0 && <div className="r-line"><span>Points used ({order.points_used})</span><span>-{rs(order.points_amount)}</span></div>}
          <div className="r-line"><span>Sales tax{s.tax_rate ? ` ${s.tax_rate}%` : ''}</span><span>{rs(order.tax)}</span></div>
          {order.delivery_fee > 0 && <div className="r-line"><span>Delivery{order.zone ? ` (${order.zone})` : ''}</span><span>{rs(order.delivery_fee)}</span></div>}
          <div className="r-line big"><span>TOTAL</span><span>{rs(order.total)}</span></div>
          <div className="r-line"><span>Paid ({order.payment_method})</span><span>{rs(order.paid)}</span></div>
          {order.change_ > 0 && <div className="r-line"><span>Change</span><span>{rs(order.change_)}</span></div>}
          {order.status === 'refunded' && <p><b>REFUNDED</b> · {new Date(order.refunded_at).toLocaleString()}{order.refund_reason ? ' · ' + order.refund_reason : ''}</p>}
          {order.fiscal_no && <div className="fiscal"><p><b>{(s.fiscal_mode || '').toUpperCase()} Invoice No.</b><br />{order.fiscal_no}</p>{fiscalQr && <img src={fiscalQr} alt="" />}</div>}
          {!order.fiscal_no && order.fiscal_status === 'pending' && <p className="muted">Tax invoice no. pending — will be reported automatically</p>}
          {order.points_earned > 0 && <p>Points earned: {order.points_earned}, balance {order.customer_points}</p>}
          <p className="thanks">{s.footer}</p>
        </div>
        <div className="actions no-print">
          <button className="ghost" onClick={print}><Icon name="print" size={16} />{s.receipt_printer ? 'Reprint' : 'Print'}</button>
          <button id="new-order" className="primary" onClick={onClose}>{closeLabel}</button>
        </div>
      </div>
    </div>
  )
}

function Orders({ onOpen, notify }) {
  const [list, setList] = useState([])
  const [tab, setTab] = useState('open')
  const [receipt, setReceipt] = useState(null)
  const load = () => api('/orders?status=' + tab).then(setList)
  useEffect(() => { load() }, [tab])
  const refund = run(async o => {
    const reason = await promptBox(`${rs(o.total)} paid by ${o.payment_method}.${o.payment_method === 'cash' ? ' The cash comes out of this shift\'s drawer.' : ''} Loyalty points and stock are not changed.`, { title: `Refund order #${o.id}?`, placeholder: 'Reason, e.g. wrong item', confirmLabel: 'Refund', required: true })
    if (reason === null) return
    await api(`/orders/${o.id}/refund`, { reason }); notify(`Order #${o.id} refunded`); load()
  })
  return (
    <section className="orders">
      <div className="row-head"><h2>Orders</h2>
        <div className="tabs">{['open', 'paid', 'refunded', 'cancelled'].map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      </div>
      <div className="order-list">
        {!list.length && <div className="empty">No {tab} orders</div>}
        {list.map(o => (
          <div key={o.id} className="order-row" onClick={() => tab === 'open' && onOpen && onOpen(o.id)}>
            <b>#{o.id}</b>
            <span className="pill"><Icon name={TYPES.find(t => t.id === o.type)?.icon} size={15} />{o.type}</span>
            <span className="muted">{o.items.reduce((s, i) => s + i.qty, 0)} items{o.customer ? `, ${o.customer}` : ''}</span>
            <span className="muted">{new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <b className="amt">{rs(o.total)}</b>
            {tab === 'open' && onOpen && <span className="link">Open<Icon name="next" size={15} /></span>}
            {['paid', 'refunded'].includes(tab) && <span onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6 }}>
              <button className="ghost sm" onClick={() => setReceipt(o)}><Icon name="receipt" size={15} />Receipt</button>
              {tab === 'paid' && <button className="ghost sm danger" onClick={() => refund(o)}>Refund</button>}
            </span>}
          </div>
        ))}
      </div>
      {receipt && <Receipt order={receipt} notify={notify} closeLabel="Close" onClose={() => setReceipt(null)} />}
    </section>
  )
}
