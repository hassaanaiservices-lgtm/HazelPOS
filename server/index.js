// EasyPOS backend: Express + Node's built-in SQLite (Node 22.5+)
const express = require('express');
const cors = require('cors');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'pos.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT, color TEXT);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, price REAL, category_id INTEGER, emoji TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS tables_ (id INTEGER PRIMARY KEY, name TEXT, seats INTEGER);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, type TEXT, table_id INTEGER, customer TEXT, phone TEXT, address TEXT,
  status TEXT DEFAULT 'open', subtotal REAL, discount REAL, tax REAL, total REAL,
  payment_method TEXT, paid REAL, change_ REAL, created_at TEXT, paid_at TEXT,
  kitchen_status TEXT, kitchen_at TEXT, user_name TEXT);
CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, name TEXT, price REAL, qty INTEGER, note TEXT, sent INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, pin TEXT UNIQUE, role TEXT);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, title TEXT, category TEXT, amount REAL, payment_method TEXT, date TEXT, user_name TEXT);
CREATE TABLE IF NOT EXISTS register_sessions (
  id INTEGER PRIMARY KEY, opened_at TEXT, closed_at TEXT, opened_by TEXT, closed_by TEXT,
  opening_cash REAL DEFAULT 0, closing_cash REAL DEFAULT 0, expected_cash REAL DEFAULT 0,
  difference REAL DEFAULT 0, status TEXT DEFAULT 'open', notes TEXT);
CREATE TABLE IF NOT EXISTS cash_moves (
  id INTEGER PRIMARY KEY, session_id INTEGER, type TEXT, amount REAL, reason TEXT, user_name TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS floors (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE, icon TEXT DEFAULT '🍽️', color TEXT DEFAULT '#ff9f43');
CREATE TABLE IF NOT EXISTS qr_requests (
  id INTEGER PRIMARY KEY, table_id INTEGER, items TEXT, customer TEXT, note TEXT,
  status TEXT DEFAULT 'pending', created_at TEXT, handled_at TEXT, handled_by TEXT, order_id INTEGER);
`);

// Migrations for columns
for (const sql of [
  'ALTER TABLE products ADD COLUMN active INTEGER DEFAULT 1',
  'ALTER TABLE orders ADD COLUMN kitchen_status TEXT',
  'ALTER TABLE orders ADD COLUMN kitchen_at TEXT',
  'ALTER TABLE orders ADD COLUMN user_name TEXT',
  'ALTER TABLE order_items ADD COLUMN sent INTEGER DEFAULT 0',
  "ALTER TABLE tables_ ADD COLUMN floor TEXT DEFAULT 'Main Dining'",
  "ALTER TABLE tables_ ADD COLUMN shape TEXT DEFAULT 'square'",
  'ALTER TABLE tables_ ADD COLUMN qr_token TEXT',
]) { try { db.exec(sql); } catch { /* column exists */ } }

// Give every table a random, unguessable QR token
const newToken = () => require('crypto').randomBytes(6).toString('hex');
const ensureQrTokens = () => {
  const set = db.prepare('UPDATE tables_ SET qr_token=? WHERE id=?');
  db.prepare("SELECT id FROM tables_ WHERE qr_token IS NULL OR qr_token=''").all().forEach(t => set.run(newToken(), t.id));
};

// Seed demo data on first run
if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
  const ci = db.prepare('INSERT INTO categories (name,color) VALUES (?,?)');
  [['Pizza', '#ff6b35'], ['Burgers', '#f7b32b'], ['Sides', '#2ec4b6'], ['Drinks', '#4d96ff'], ['Desserts', '#e056fd']].forEach(c => ci.run(...c));
  const pi = db.prepare('INSERT INTO products (name,price,category_id,emoji) VALUES (?,?,?,?)');
  [
    ['Margherita', 1200, 1, '🍕'], ['Pepperoni', 1500, 1, '🍕'], ['Chicken Tikka', 1600, 1, '🍕'], ['Fajita', 1550, 1, '🍕'], ['Veggie Supreme', 1350, 1, '🍕'],
    ['Zinger Burger', 650, 2, '🍔'], ['Beef Burger', 800, 2, '🍔'], ['Double Patty', 1100, 2, '🍔'],
    ['Fries', 300, 3, '🍟'], ['Loaded Fries', 550, 3, '🍟'], ['Garlic Bread', 400, 3, '🥖'], ['Nuggets (6)', 450, 3, '🍗'],
    ['Coke 500ml', 150, 4, '🥤'], ['Mineral Water', 80, 4, '💧'], ['Mint Margarita', 350, 4, '🍹'],
    ['Lava Cake', 450, 5, '🍫'], ['Ice Cream', 250, 5, '🍨'],
  ].forEach(p => pi.run(...p));
}

// Seed or update tables with floors and shapes
const initialTables = [
  // Main Dining
  ['T1', 4, 'Main Dining', 'square'],
  ['T2', 4, 'Main Dining', 'square'],
  ['T3', 6, 'Main Dining', 'rect'],
  ['T4', 4, 'Main Dining', 'square'],
  ['T5', 2, 'Main Dining', 'round'],
  ['T6', 8, 'Main Dining', 'rect'],
  // Family Section
  ['F1', 6, 'Family Section', 'rect'],
  ['F2', 6, 'Family Section', 'rect'],
  ['F3', 8, 'Family Section', 'rect'],
  ['F4', 10, 'Family Section', 'rect'],
  // Patio & Outdoor
  ['P1', 2, 'Patio & Outdoor', 'round'],
  ['P2', 4, 'Patio & Outdoor', 'square'],
  ['P3', 4, 'Patio & Outdoor', 'square'],
  ['P4', 6, 'Patio & Outdoor', 'rect'],
  // Rooftop Terrace
  ['R1', 4, 'Rooftop Terrace', 'square'],
  ['R2', 4, 'Rooftop Terrace', 'square'],
  ['R3', 6, 'Rooftop Terrace', 'round'],
  ['R4', 8, 'Rooftop Terrace', 'rect'],
];

if (db.prepare('SELECT COUNT(*) c FROM tables_').get().c === 0) {
  const ti = db.prepare('INSERT INTO tables_ (name,seats,floor,shape) VALUES (?,?,?,?)');
  initialTables.forEach(t => ti.run(...t));
}

if (db.prepare('SELECT COUNT(*) c FROM floors').get().c === 0) {
  const fi = db.prepare('INSERT OR IGNORE INTO floors (name, icon, color) VALUES (?, ?, ?)');
  [
    ['Main Dining', '🍽️', '#ff9f43'],
    ['Family Section', '👨‍👩‍👧‍👦', '#a55eea'],
    ['Patio & Outdoor', '🌿', '#26de81'],
    ['Rooftop Terrace', '✨', '#4bcffa']
  ].forEach(f => fi.run(...f));
}

const DEFAULT_SETTINGS = {
  name: 'Pizza Venu',
  address: 'Commercial Market, Block B, Main Boulevard',
  phone: '+92 300 1234567',
  tax_rate: '16',
  footer: 'Thank you! Visit again 🙏',
  logo: '🍕',
  ntn: 'NTN-8934521-7',
  bank_name: 'Meezan Bank Ltd',
  bank_account: 'PK36MEZN0001000123456789',
  bank_title: 'Pizza Venu Foods Private Limited'
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k, v);

if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  const ui = db.prepare('INSERT INTO users (name,pin,role) VALUES (?,?,?)');
  ui.run('Owner', '1234', 'admin'); ui.run('Cashier', '1111', 'cashier'); ui.run('Kitchen', '2222', 'kitchen');
}

// Seed demo expenses if empty
if (db.prepare('SELECT COUNT(*) c FROM expenses').get().c === 0) {
  const today = new Date().toISOString().slice(0, 10);
  const ei = db.prepare('INSERT INTO expenses (title,category,amount,payment_method,date,user_name) VALUES (?,?,?,?,?,?)');
  [
    ['Cheese & Dough Supplies', 'Ingredients', 4500, 'cash', today, 'Owner'],
    ['Chicken Breast (10kg)', 'Ingredients', 7200, 'cash', today, 'Owner'],
    ['Pizza Boxes & Bags (100 pcs)', 'Packaging', 2800, 'card', today, 'Cashier'],
    ['Commercial Gas Refill', 'Utilities', 3500, 'cash', today, 'Owner']
  ].forEach(e => ei.run(...e));
}

// Auto open register if never opened
if (db.prepare('SELECT COUNT(*) c FROM register_sessions').get().c === 0) {
  db.prepare(`INSERT INTO register_sessions (opened_at, opened_by, opening_cash, status) VALUES (?,?,?,?)`)
    .run(new Date().toISOString(), 'Owner', 5000, 'open');
}

const getSettings = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
const taxRate = () => (+getSettings().tax_rate || 0) / 100;

const app = express();
app.use(cors());
app.use(express.json());
const now = () => new Date().toISOString();

// ---------- Auth (PIN) ----------
app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT id,name,role FROM users WHERE pin=?').get(String(req.body.pin || ''));
  u ? res.json(u) : res.status(401).json({ error: 'Wrong PIN' });
});

// ---------- Settings ----------
app.get('/api/settings', (req, res) => res.json(getSettings()));
app.post('/api/settings', (req, res) => {
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in req.body) up.run(k, String(req.body[k]));
  res.json(getSettings());
});

// ---------- Menu ----------
app.get('/api/menu', (req, res) => {
  const all = req.query.all === '1';
  res.json({
    categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
    products: db.prepare(`SELECT * FROM products ${all ? '' : 'WHERE active=1'} ORDER BY name`).all(),
    taxRate: taxRate(),
  });
});

// Generic save/delete for simple tables
function crud(route, table, fields) {
  app.post(`/api/${route}`, (req, res) => {
    const b = req.body; const vals = fields.map(f => b[f] ?? null);
    if (b.id) db.prepare(`UPDATE ${table} SET ${fields.map(f => f + '=?').join(',')} WHERE id=?`).run(...vals, b.id);
    else b.id = db.prepare(`INSERT INTO ${table} (${fields}) VALUES (${fields.map(() => '?')})`).run(...vals).lastInsertRowid;
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(b.id));
  });
  app.post(`/api/${route}/:id/delete`, (req, res) => {
    try { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
}
crud('products', 'products', ['name', 'price', 'category_id', 'emoji', 'active']);
crud('categories', 'categories', ['name', 'color']);
crud('tables', 'tables_', ['name', 'seats', 'floor', 'shape']);
crud('users', 'users', ['name', 'pin', 'role']);
crud('expenses', 'expenses', ['title', 'category', 'amount', 'payment_method', 'date', 'user_name']);

app.get('/api/users', (req, res) => res.json(db.prepare('SELECT * FROM users ORDER BY id').all()));

app.get('/api/tables', (req, res) => {
  res.json(db.prepare(`
    SELECT t.*,
           COALESCE(f.color, '#ff9f43') floor_color,
           COALESCE(f.icon, '🍽️') floor_icon,
           o.id order_id,
           o.total,
           o.created_at seated_at,
           o.user_name waiter,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) item_count
    FROM tables_ t
    LEFT JOIN floors f ON f.name = t.floor
    LEFT JOIN orders o ON o.table_id = t.id AND o.status='open' AND o.type='dine-in'
    ORDER BY t.id
  `).all());
});

app.get('/api/floors', (req, res) => {
  const rows = db.prepare(`
    SELECT f.id,
           f.name,
           f.icon,
           f.color,
           COUNT(t.id) total,
           SUM(CASE WHEN o.id IS NOT NULL THEN 1 ELSE 0 END) occupied
    FROM floors f
    LEFT JOIN tables_ t ON t.floor = f.name
    LEFT JOIN orders o ON o.table_id = t.id AND o.status='open' AND o.type='dine-in'
    GROUP BY f.id
    ORDER BY f.id
  `).all();
  res.json(rows);
});

app.post('/api/floors', (req, res) => {
  const { id, name, icon = '🍽️', color = '#ff9f43', old_name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Floor name is required' });
  const trimName = name.trim();
  if (id) {
    const existing = db.prepare('SELECT name FROM floors WHERE id=?').get(id);
    db.prepare('UPDATE floors SET name=?, icon=?, color=? WHERE id=?').run(trimName, icon, color, id);
    if (existing && existing.name !== trimName) {
      db.prepare('UPDATE tables_ SET floor=? WHERE floor=?').run(trimName, existing.name);
    }
  } else if (old_name) {
    db.prepare('UPDATE floors SET name=?, icon=?, color=? WHERE name=?').run(trimName, icon, color, old_name);
    if (old_name !== trimName) {
      db.prepare('UPDATE tables_ SET floor=? WHERE floor=?').run(trimName, old_name);
    }
  } else {
    try {
      db.prepare('INSERT INTO floors (name, icon, color) VALUES (?, ?, ?)').run(trimName, icon, color);
    } catch {
      return res.status(400).json({ error: 'A floor with that name already exists' });
    }
  }
  res.json({ ok: true });
});

app.post('/api/floors/:id/delete', (req, res) => {
  const floor = db.prepare('SELECT name FROM floors WHERE id=?').get(req.params.id);
  if (floor) {
    const fallback = db.prepare('SELECT name FROM floors WHERE id != ? LIMIT 1').get(req.params.id);
    const fallbackName = fallback ? fallback.name : 'Main Dining';
    db.prepare('UPDATE tables_ SET floor=? WHERE floor=?').run(fallbackName, floor.name);
    db.prepare('DELETE FROM floors WHERE id=?').run(req.params.id);
  }
  res.json({ ok: true });
});

// ---------- Orders ----------
function getOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (o) {
    o.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id);
    o.invoice_no = `INV-${new Date(o.created_at).getFullYear()}-${String(o.id).padStart(4, '0')}`;
  }
  return o;
}

app.get('/api/orders', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare('SELECT id FROM orders WHERE status=? ORDER BY id DESC LIMIT 200').all(status)
    : db.prepare('SELECT id FROM orders ORDER BY id DESC LIMIT 200').all();
  res.json(rows.map(r => getOrder(r.id)));
});
app.get('/api/orders/:id', (req, res) => {
  const o = getOrder(req.params.id);
  o ? res.json(o) : res.status(404).json({ error: 'Not found' });
});

// Create/update an order
app.post('/api/orders', (req, res) => {
  const { id, type, table_id, customer, phone, address, items = [], discount = 0, user_name } = req.body;
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = Math.round((subtotal - discount) * taxRate());
  const total = Math.max(0, subtotal - discount + tax);
  let orderId = id;
  let prevQty = {};
  if (orderId) {
    db.prepare('SELECT product_id, SUM(qty) q FROM order_items WHERE order_id=? GROUP BY product_id').all(orderId).forEach(r => prevQty[r.product_id] = r.q);
    db.prepare('UPDATE orders SET type=?,table_id=?,customer=?,phone=?,address=?,subtotal=?,discount=?,tax=?,total=? WHERE id=?')
      .run(type, table_id ?? null, customer ?? '', phone ?? '', address ?? '', subtotal, discount, tax, total, orderId);
    db.prepare('DELETE FROM order_items WHERE order_id=?').run(orderId);
  } else {
    orderId = db.prepare('INSERT INTO orders (type,table_id,customer,phone,address,subtotal,discount,tax,total,created_at,user_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(type, table_id ?? null, customer ?? '', phone ?? '', address ?? '', subtotal, discount, tax, total, now(), user_name ?? '').lastInsertRowid;
  }
  const ins = db.prepare('INSERT INTO order_items (order_id,product_id,name,price,qty,note,sent) VALUES (?,?,?,?,?,?,1)');
  items.forEach(i => ins.run(orderId, i.product_id, i.name, i.price, i.qty, i.note ?? ''));
  const changed = items.some(i => i.qty > (prevQty[i.product_id] || 0));
  if (changed && items.length) db.prepare("UPDATE orders SET kitchen_status='new', kitchen_at=? WHERE id=?").run(now(), orderId);
  res.json(getOrder(orderId));
});

app.post('/api/orders/:id/pay', (req, res) => {
  const o = getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const { method, paid } = req.body;
  const change = Math.max(0, (paid ?? o.total) - o.total);
  db.prepare("UPDATE orders SET status='paid',payment_method=?,paid=?,change_=?,paid_at=? WHERE id=?")
    .run(method, paid ?? o.total, change, now(), o.id);
  res.json(getOrder(o.id));
});
app.post('/api/orders/:id/cancel', (req, res) => {
  db.prepare("UPDATE orders SET status='cancelled', kitchen_status='done' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ---------- Kitchen display ----------
app.get('/api/kitchen', (req, res) => {
  const rows = db.prepare(`SELECT o.id FROM orders o WHERE o.kitchen_status IN ('new','preparing','ready')
    AND o.status != 'cancelled' ORDER BY o.kitchen_at`).all();
  res.json(rows.map(r => {
    const o = getOrder(r.id);
    o.tableName = o.table_id ? db.prepare('SELECT name FROM tables_ WHERE id=?').get(o.table_id)?.name : null;
    return o;
  }));
});
app.post('/api/kitchen/:id', (req, res) => {
  const s = req.body.status;
  if (!['new', 'preparing', 'ready', 'done'].includes(s)) return res.status(400).json({ error: 'bad status' });
  db.prepare('UPDATE orders SET kitchen_status=? WHERE id=?').run(s, req.params.id);
  res.json({ ok: true });
});

// ---------- Cash Register Sessions & Shift Closing (Z-Report) ----------
function getSessionSummary(session) {
  if (!session) return null;
  const opened = session.opened_at;
  const closed = session.closed_at || now();

  // Cash sales in this session
  const cashSales = db.prepare(`SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM orders
    WHERE status='paid' AND payment_method='cash' AND paid_at >= ? AND paid_at <= ?`).get(opened, closed);

  // Card & Online sales in this session
  const otherSales = db.prepare(`SELECT payment_method m, COALESCE(SUM(total),0) s, COUNT(*) c FROM orders
    WHERE status='paid' AND payment_method != 'cash' AND paid_at >= ? AND paid_at <= ? GROUP BY m`).all(opened, closed);

  // Cash moves (cash in / cash out)
  const cashIn = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM cash_moves WHERE session_id=? AND type='in'`).get(session.id).s;
  const cashOut = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM cash_moves WHERE session_id=? AND type='out'`).get(session.id).s;

  const expectedCash = session.opening_cash + cashSales.s + cashIn - cashOut;
  const moves = db.prepare(`SELECT * FROM cash_moves WHERE session_id=? ORDER BY id DESC`).all(session.id);

  return {
    ...session,
    cashSales: cashSales.s,
    cashOrders: cashSales.c,
    otherSales,
    cashIn,
    cashOut,
    expectedCash,
    moves
  };
}

app.get('/api/register/current', (req, res) => {
  const sess = db.prepare(`SELECT * FROM register_sessions WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
  res.json(sess ? getSessionSummary(sess) : null);
});

app.post('/api/register/open', (req, res) => {
  const { opening_cash = 0, opened_by = 'Staff' } = req.body;
  const openExists = db.prepare(`SELECT id FROM register_sessions WHERE status='open'`).get();
  if (openExists) return res.status(400).json({ error: 'A register session is already open' });

  const id = db.prepare(`INSERT INTO register_sessions (opened_at, opened_by, opening_cash, status) VALUES (?,?,?,?)`)
    .run(now(), opened_by, +opening_cash, 'open').lastInsertRowid;
  res.json(getSessionSummary(db.prepare(`SELECT * FROM register_sessions WHERE id=?`).get(id)));
});

app.post('/api/register/close', (req, res) => {
  const sess = db.prepare(`SELECT * FROM register_sessions WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
  if (!sess) return res.status(400).json({ error: 'No open register session found' });

  const summary = getSessionSummary(sess);
  const closing_cash = +req.body.closing_cash || 0;
  const difference = closing_cash - summary.expectedCash;
  const closed_by = req.body.closed_by || sess.opened_by;
  const notes = req.body.notes || '';
  const closed_at = now();

  db.prepare(`UPDATE register_sessions SET closed_at=?, closed_by=?, closing_cash=?, expected_cash=?, difference=?, status='closed', notes=? WHERE id=?`)
    .run(closed_at, closed_by, closing_cash, summary.expectedCash, difference, notes, sess.id);

  const closedSess = db.prepare(`SELECT * FROM register_sessions WHERE id=?`).get(sess.id);
  res.json(getSessionSummary(closedSess));
});

app.post('/api/register/cash-move', (req, res) => {
  const sess = db.prepare(`SELECT id FROM register_sessions WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
  if (!sess) return res.status(400).json({ error: 'No active register session' });
  const { type, amount, reason, user_name } = req.body;
  if (!['in', 'out'].includes(type) || !amount) return res.status(400).json({ error: 'Invalid cash movement' });

  db.prepare(`INSERT INTO cash_moves (session_id, type, amount, reason, user_name, created_at) VALUES (?,?,?,?,?,?)`)
    .run(sess.id, type, +amount, reason || '', user_name || '', now());

  const updated = db.prepare(`SELECT * FROM register_sessions WHERE id=?`).get(sess.id);
  res.json(getSessionSummary(updated));
});

app.get('/api/register/history', (req, res) => {
  const rows = db.prepare(`SELECT * FROM register_sessions ORDER BY id DESC LIMIT 30`).all();
  res.json(rows.map(getSessionSummary));
});

// ---------- Invoicing & Expenses ----------
app.get('/api/expenses', (req, res) => {
  res.json(db.prepare(`SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 200`).all());
});

app.get('/api/invoicing/summary', (req, res) => {
  const totalSales = db.prepare(`SELECT COALESCE(SUM(total),0) rev, COUNT(*) count FROM orders WHERE status='paid'`).get();
  const totalExpenses = db.prepare(`SELECT COALESCE(SUM(amount),0) exp, COUNT(*) count FROM expenses`).get();
  const receivables = db.prepare(`SELECT COALESCE(SUM(total),0) rec, COUNT(*) count FROM orders WHERE status='open'`).get();
  const taxCollected = db.prepare(`SELECT COALESCE(SUM(tax),0) tax FROM orders WHERE status='paid'`).get();

  const reg = db.prepare(`SELECT * FROM register_sessions WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
  const cashInRegister = reg ? getSessionSummary(reg).expectedCash : 0;

  const expensesByCategory = db.prepare(`SELECT category, SUM(amount) amount, COUNT(*) count FROM expenses GROUP BY category ORDER BY amount DESC`).all();

  res.json({
    revenue: totalSales.rev,
    paidOrders: totalSales.count,
    expenses: totalExpenses.exp,
    expenseCount: totalExpenses.count,
    netProfit: totalSales.rev - totalExpenses.exp,
    receivables: receivables.rec,
    openOrders: receivables.count,
    taxCollected: taxCollected.tax,
    cashInRegister,
    expensesByCategory
  });
});

// ---------- Reports ----------
app.get('/api/summary', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA');
  res.json(db.prepare(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue FROM orders
    WHERE status='paid' AND date(paid_at,'localtime')=?`).get(today));
});

app.get('/api/reports', (req, res) => {
  const from = req.query.from, to = req.query.to; // YYYY-MM-DD (local)
  const W = `status='paid' AND date(paid_at,'localtime') BETWEEN ? AND ?`;
  const p = [from, to];
  const expP = [from, to];
  const periodExpenses = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date BETWEEN ? AND ?`).get(...expP).s;

  res.json({
    totals: db.prepare(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue, COALESCE(SUM(tax),0) tax,
      COALESCE(SUM(discount),0) discount, COALESCE(AVG(total),0) avg FROM orders WHERE ${W}`).get(...p),
    byDay: db.prepare(`SELECT date(paid_at,'localtime') day, COUNT(*) orders, SUM(total) revenue FROM orders WHERE ${W} GROUP BY day ORDER BY day`).all(...p),
    byHour: db.prepare(`SELECT CAST(strftime('%H',paid_at,'localtime') AS INTEGER) hour, SUM(total) revenue FROM orders WHERE ${W} GROUP BY hour`).all(...p),
    byMethod: db.prepare(`SELECT payment_method k, COUNT(*) orders, SUM(total) revenue FROM orders WHERE ${W} GROUP BY k`).all(...p),
    byType: db.prepare(`SELECT type k, COUNT(*) orders, SUM(total) revenue FROM orders WHERE ${W} GROUP BY k`).all(...p),
    topProducts: db.prepare(`SELECT i.name, SUM(i.qty) qty, SUM(i.qty*i.price) revenue FROM order_items i
      JOIN orders o ON o.id=i.order_id WHERE o.${W.replace(/paid_at/g, 'o.paid_at')} GROUP BY i.name ORDER BY qty DESC LIMIT 10`).all(...p),
    cancelled: db.prepare(`SELECT COUNT(*) c FROM orders WHERE status='cancelled' AND date(created_at,'localtime') BETWEEN ? AND ?`).get(...p).c,
    periodExpenses
  });
});

// ---------- QR Table Ordering ----------
ensureQrTokens();
const tableByToken = token => db.prepare('SELECT id, name, floor FROM tables_ WHERE qr_token=?').get(String(token));

// LAN address so phones on the same WiFi can open the QR link
app.get('/api/qr-info', (req, res) => {
  ensureQrTokens();
  const ips = Object.values(require('os').networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  res.json({ ips, tables: db.prepare('SELECT id, name, floor, qr_token FROM tables_ ORDER BY id').all() });
});

// Public: customer menu for a table
app.get('/api/qr/:token', (req, res) => {
  const table = tableByToken(req.params.token);
  if (!table) return res.status(404).json({ error: 'Invalid table QR code' });
  const s = getSettings();
  res.json({
    table,
    restaurant: { name: s.name, logo: s.logo },
    categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
    products: db.prepare('SELECT id, name, price, category_id, emoji FROM products WHERE active=1 ORDER BY name').all(),
    taxRate: taxRate(),
  });
});

// Public: customer places an order -> goes to staff for approval
app.post('/api/qr/:token/order', (req, res) => {
  const table = tableByToken(req.params.token);
  if (!table) return res.status(404).json({ error: 'Invalid table QR code' });
  const getP = db.prepare('SELECT id, name, price FROM products WHERE id=? AND active=1');
  const items = (req.body.items || []).map(i => {
    const p = getP.get(i.product_id);
    const qty = Math.min(50, Math.max(0, parseInt(i.qty) || 0));
    return p && qty ? { product_id: p.id, name: p.name, price: p.price, qty, note: String(i.note || '').slice(0, 120) } : null;
  }).filter(Boolean);
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty' });
  const id = db.prepare('INSERT INTO qr_requests (table_id, items, customer, note, created_at) VALUES (?,?,?,?,?)')
    .run(table.id, JSON.stringify(items), String(req.body.customer || '').slice(0, 60), String(req.body.note || '').slice(0, 200), now()).lastInsertRowid;
  res.json({ id, status: 'pending' });
});

// Public: customer checks their order status
app.get('/api/qr/:token/status/:id', (req, res) => {
  const table = tableByToken(req.params.token);
  const r = table && db.prepare('SELECT id, status FROM qr_requests WHERE id=? AND table_id=?').get(req.params.id, table.id);
  r ? res.json(r) : res.status(404).json({ error: 'Not found' });
});

// Staff: pending QR orders
app.get('/api/qr-requests', (req, res) => {
  res.json(db.prepare(`SELECT r.*, t.name table_name, t.floor FROM qr_requests r LEFT JOIN tables_ t ON t.id=r.table_id
    WHERE r.status='pending' ORDER BY r.id`).all().map(r => ({ ...r, items: JSON.parse(r.items) })));
});

// Staff: accept -> merge into the table's open order (or create one) and send to kitchen
app.post('/api/qr-requests/:id/accept', (req, res) => {
  const r = db.prepare("SELECT * FROM qr_requests WHERE id=? AND status='pending'").get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request already handled' });
  const items = JSON.parse(r.items);
  let order = db.prepare("SELECT id FROM orders WHERE table_id=? AND status='open' AND type='dine-in' ORDER BY id DESC LIMIT 1").get(r.table_id);
  const orderId = order ? order.id : db.prepare('INSERT INTO orders (type,table_id,customer,subtotal,discount,tax,total,created_at,user_name) VALUES (?,?,?,0,0,0,0,?,?)')
    .run('dine-in', r.table_id, r.customer || '', now(), req.body.user_name || 'QR').lastInsertRowid;
  const ins = db.prepare('INSERT INTO order_items (order_id,product_id,name,price,qty,note,sent) VALUES (?,?,?,?,?,?,1)');
  items.forEach(i => ins.run(orderId, i.product_id, i.name, i.price, i.qty, [i.note, r.note].filter(Boolean).join(' · ')));
  const o = db.prepare('SELECT discount FROM orders WHERE id=?').get(orderId);
  const subtotal = db.prepare('SELECT COALESCE(SUM(price*qty),0) s FROM order_items WHERE order_id=?').get(orderId).s;
  const tax = Math.round((subtotal - (o.discount || 0)) * taxRate());
  db.prepare("UPDATE orders SET subtotal=?, tax=?, total=?, kitchen_status='new', kitchen_at=? WHERE id=?")
    .run(subtotal, tax, Math.max(0, subtotal - (o.discount || 0) + tax), now(), orderId);
  db.prepare("UPDATE qr_requests SET status='accepted', handled_at=?, handled_by=?, order_id=? WHERE id=?").run(now(), req.body.user_name || '', orderId, r.id);
  res.json({ ok: true, order_id: orderId });
});

app.post('/api/qr-requests/:id/reject', (req, res) => {
  db.prepare("UPDATE qr_requests SET status='rejected', handled_at=?, handled_by=? WHERE id=? AND status='pending'").run(now(), req.body.user_name || '', req.params.id);
  res.json({ ok: true });
});

// Serve built frontend in production
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('/t/:token', (req, res) => res.sendFile(path.join(__dirname, '../client/dist/index.html')));

const PORT = 4000;
app.listen(PORT, '0.0.0.0', () => console.log(`EasyPOS server running on http://localhost:${PORT}`));
