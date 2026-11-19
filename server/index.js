// HazelPOS backend: Express + Node's built-in SQLite (Node 22.5+)
const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// The last errors, so the health report to your admin app can show what went wrong at a restaurant (server/licence.js)
const recentErrors = [];
const logError = console.error;
console.error = (...a) => {
  if (/ExperimentalWarning|--trace-warnings/.test(String(a[0]))) return logError(...a); // Node's own notices, not problems
  recentErrors.push({ at: new Date().toISOString(), text: a.map(x => x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 1000) });
  if (recentErrors.length > 30) recentErrors.shift();
  logError(...a);
};

const db = new DatabaseSync(process.env.POS_DB || path.join(__dirname, 'pos.db')); // POS_DB: run against another database (testing)
db.exec('PRAGMA busy_timeout = 5000');
// DEMO=1: the free demo. The login screen offers the three roles without PINs (see client/src/Login.jsx).
const DEMO = process.env.DEMO === '1'; // another writer (backup, a script) briefly holds the file: wait instead of crashing
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
-- What the WhatsApp assistant may answer about the restaurant (Settings → WhatsApp bot → Questions and answers)
CREATE TABLE IF NOT EXISTS faq (id INTEGER PRIMARY KEY, question TEXT NOT NULL, answer TEXT DEFAULT '', sort INTEGER DEFAULT 0);
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
CREATE TABLE IF NOT EXISTS ingredients (id INTEGER PRIMARY KEY, name TEXT, unit TEXT DEFAULT 'kg', stock REAL DEFAULT 0, low_level REAL DEFAULT 0, cost REAL DEFAULT 0);
CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY, product_id INTEGER, size TEXT DEFAULT '', ingredient_id INTEGER, qty REAL);
CREATE TABLE IF NOT EXISTS stock_moves (id INTEGER PRIMARY KEY, ingredient_id INTEGER, qty REAL, reason TEXT, ref TEXT, note TEXT, user_name TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS supplier_ledger (id INTEGER PRIMARY KEY, supplier_id INTEGER, date TEXT, type TEXT, amount REAL, note TEXT, user_name TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, job TEXT, salary REAL DEFAULT 0, active INTEGER DEFAULT 1, joined TEXT);
CREATE TABLE IF NOT EXISTS payroll (id INTEGER PRIMARY KEY, employee_id INTEGER, month TEXT, date TEXT, type TEXT, amount REAL, note TEXT, user_name TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT UNIQUE, address TEXT, points INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS promos (id INTEGER PRIMARY KEY, code TEXT UNIQUE, type TEXT DEFAULT 'percent', value REAL, min_order REAL DEFAULT 0,
  max_discount REAL DEFAULT 0, uses_limit INTEGER DEFAULT 0, used INTEGER DEFAULT 0, expires TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS delivery_zones (id INTEGER PRIMARY KEY, name TEXT, fee REAL DEFAULT 0, min_order REAL DEFAULT 0, free_above REAL DEFAULT 0, eta_min INTEGER DEFAULT 45, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT); -- API tokens: never returned by /api/settings
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, at TEXT, user_id INTEGER, user_name TEXT, role TEXT, ip TEXT, action TEXT, status INTEGER, detail TEXT);
`);

// Migrations for columns
for (const sql of [
  'ALTER TABLE products ADD COLUMN active INTEGER DEFAULT 1',
  'ALTER TABLE products ADD COLUMN subtitle TEXT',
  'ALTER TABLE products ADD COLUMN description TEXT',
  'ALTER TABLE products ADD COLUMN ingredients TEXT',
  'ALTER TABLE products ADD COLUMN sizes TEXT',
  'ALTER TABLE orders ADD COLUMN kitchen_status TEXT',
  'ALTER TABLE orders ADD COLUMN kitchen_at TEXT',
  'ALTER TABLE orders ADD COLUMN user_name TEXT',
  'ALTER TABLE order_items ADD COLUMN sent INTEGER DEFAULT 0',
  "ALTER TABLE tables_ ADD COLUMN floor TEXT DEFAULT 'Main Dining'",
  "ALTER TABLE tables_ ADD COLUMN shape TEXT DEFAULT 'square'",
  'ALTER TABLE tables_ ADD COLUMN qr_token TEXT',
  'ALTER TABLE products ADD COLUMN modifiers TEXT',
  // Deals and combos: deal_items = [{product_id, size, qty}] — the items inside, for one price. combo_for = the item this
  // deal is offered with ("Zinger Combo" on Zinger Burger); empty = a stand-alone deal (Deals tab only).
  'ALTER TABLE products ADD COLUMN deal_items TEXT',
  'ALTER TABLE products ADD COLUMN combo_for INTEGER',
  'ALTER TABLE order_items ADD COLUMN size TEXT',
  'ALTER TABLE order_items ADD COLUMN mods TEXT',
  'ALTER TABLE orders ADD COLUMN customer_id INTEGER',
  'ALTER TABLE orders ADD COLUMN promo_code TEXT',
  'ALTER TABLE orders ADD COLUMN promo_amount REAL DEFAULT 0',
  'ALTER TABLE orders ADD COLUMN points_used INTEGER DEFAULT 0',
  'ALTER TABLE orders ADD COLUMN points_amount REAL DEFAULT 0',
  'ALTER TABLE orders ADD COLUMN points_earned INTEGER DEFAULT 0',
  'ALTER TABLE expenses ADD COLUMN ref TEXT', // set when a supplier payment or salary created the expense
  'ALTER TABLE orders ADD COLUMN zone_id INTEGER',
  'ALTER TABLE orders ADD COLUMN delivery_fee REAL DEFAULT 0',
  'ALTER TABLE orders ADD COLUMN rider_id INTEGER',
  "ALTER TABLE orders ADD COLUMN delivery_status TEXT", // null | 'out' | 'delivered'
  'ALTER TABLE orders ADD COLUMN dispatched_at TEXT',
  'ALTER TABLE orders ADD COLUMN delivered_at TEXT',
  'ALTER TABLE orders ADD COLUMN refunded_at TEXT',
  'ALTER TABLE orders ADD COLUMN refunded_by TEXT',
  'ALTER TABLE orders ADD COLUMN refund_reason TEXT',
  // Riders (Riders section): fee per delivery, the secret in the rider's phone link; per order the fee at the time,
  // the customer's tracking link secret, and whether the rider took it on their phone
  'ALTER TABLE employees ADD COLUMN delivery_fee REAL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN employee_id INTEGER', // a rider's login (role rider) points at their staff record
  'ALTER TABLE users ADD COLUMN pin_changed_at TEXT', // when this login's PIN last changed (the PIN list in the admin app compares it)
  'ALTER TABLE users ADD COLUMN must_change_pin INTEGER DEFAULT 0', // logged in with a starting PIN (1234…): must choose their own first
  'ALTER TABLE employees ADD COLUMN rider_token TEXT',
  'ALTER TABLE orders ADD COLUMN rider_fee REAL DEFAULT 0',
  'ALTER TABLE orders ADD COLUMN track_token TEXT',
  'ALTER TABLE orders ADD COLUMN accepted_by_rider INTEGER DEFAULT 0',
  'ALTER TABLE orders ADD COLUMN ready_at TEXT', // when the kitchen pressed Mark ready (the counter sees how long food has been waiting)
]) { try { db.exec(sql); } catch { /* column exists */ } }
// Every time a PIN is set or changed (any route), note the time
db.exec(`CREATE TRIGGER IF NOT EXISTS users_pin_ts AFTER UPDATE OF pin ON users BEGIN UPDATE users SET pin_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
  CREATE TRIGGER IF NOT EXISTS users_pin_ts_new AFTER INSERT ON users BEGIN UPDATE users SET pin_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;`);

// Product details & sizes
const PRODUCT_DETAILS = {
  'Margherita': {
    subtitle: 'Pizza · Serves 1–3 depending on size',
    description: 'Classic hand-stretched pizza with slow-cooked tomato sauce, fresh mozzarella and basil, baked in a stone oven.',
    sizes: JSON.stringify([
      { name: 'Small', detail: '8 inch', price: 800 },
      { name: 'Medium', detail: '10 inch', price: 1200 },
      { name: 'Large', detail: '12 inch', price: 1600 }
    ]),
    ingredients: JSON.stringify(['Mozzarella', 'Tomato sauce', 'Fresh basil', 'Olive oil'])
  },
  'Pepperoni': {
    subtitle: 'Pizza · Serves 1–3 depending on size',
    description: 'Rich marinara, melted mozzarella cheese, and crispy beef pepperoni slices with Italian herb seasoning.',
    sizes: JSON.stringify([
      { name: 'Small', detail: '8 inch', price: 1000 },
      { name: 'Medium', detail: '10 inch', price: 1500 },
      { name: 'Large', detail: '12 inch', price: 1950 }
    ]),
    ingredients: JSON.stringify(['Beef Pepperoni', 'Mozzarella', 'Marinara', 'Oregano'])
  },
  'Chicken Tikka': {
    subtitle: 'Pizza · Serves 1–3 depending on size',
    description: 'Spiced char-grilled chicken tikka chunks, red onions, bell peppers, mozzarella, and special herbs.',
    sizes: JSON.stringify([
      { name: 'Small', detail: '8 inch', price: 1100 },
      { name: 'Medium', detail: '10 inch', price: 1600 },
      { name: 'Large', detail: '12 inch', price: 2100 }
    ]),
    ingredients: JSON.stringify(['Tikka Chicken', 'Mozzarella', 'Onions', 'Bell Peppers'])
  },
  'Fajita': {
    subtitle: 'Pizza · Serves 1–3 depending on size',
    description: 'Mexican-style fajita chicken, sautéed bell peppers, sweet corn, melted mozzarella, and spicy jalapeños.',
    sizes: JSON.stringify([
      { name: 'Small', detail: '8 inch', price: 1050 },
      { name: 'Medium', detail: '10 inch', price: 1550 },
      { name: 'Large', detail: '12 inch', price: 2050 }
    ]),
    ingredients: JSON.stringify(['Fajita Chicken', 'Mozzarella', 'Jalapeños', 'Capsicum'])
  },
  'Veggie Supreme': {
    subtitle: 'Pizza · Serves 1–3 depending on size',
    description: 'Loaded with black olives, button mushrooms, bell peppers, sweet corn, onions, and premium mozzarella.',
    sizes: JSON.stringify([
      { name: 'Small', detail: '8 inch', price: 900 },
      { name: 'Medium', detail: '10 inch', price: 1350 },
      { name: 'Large', detail: '12 inch', price: 1800 }
    ]),
    ingredients: JSON.stringify(['Mushrooms', 'Black Olives', 'Sweet Corn', 'Mozzarella'])
  },
  'Zinger Burger': {
    subtitle: 'Burgers · Crispy & Juicy',
    description: 'Golden fried crispy chicken fillet topped with spicy mayo and shredded lettuce on a toasted sesame bun.',
    sizes: JSON.stringify([
      { name: 'Single', detail: 'Regular patty', price: 650 },
      { name: 'Double', detail: 'Double crispy patty', price: 950 },
      { name: 'Combo', detail: 'With fries & drink', price: 1100 }
    ]),
    ingredients: JSON.stringify(['Crispy Fillet', 'Spicy Mayo', 'Iceberg Lettuce', 'Brioche Bun'])
  },
  'Beef Burger': {
    subtitle: 'Burgers · 100% Prime Beef',
    description: 'Flame-grilled seasoned beef patty with melted cheddar cheese, caramelized onions, pickles, and secret sauce.',
    sizes: JSON.stringify([
      { name: 'Single', detail: '150g patty', price: 800 },
      { name: 'Double', detail: '300g patties', price: 1150 },
      { name: 'Combo', detail: 'With fries & drink', price: 1300 }
    ]),
    ingredients: JSON.stringify(['Beef Patty', 'Cheddar Cheese', 'Pickles', 'Caramelized Onions'])
  },
  'Double Patty': {
    subtitle: 'Burgers · Extra Large',
    description: 'Two smashed prime beef patties, double cheddar cheese slices, smokey BBQ mayo, and crisp lettuce.',
    sizes: JSON.stringify([
      { name: 'Regular', detail: 'Two patties', price: 1100 },
      { name: 'Monster', detail: 'Triple patties', price: 1450 },
      { name: 'Combo', detail: 'With fries & drink', price: 1600 }
    ]),
    ingredients: JSON.stringify(['Double Beef', 'Double Cheddar', 'BBQ Sauce', 'Sesame Bun'])
  },
  'Fries': {
    subtitle: 'Sides · Crispy Golden',
    description: 'Freshly cut skin-on potatoes deep fried to golden crispiness and dusted with special salt seasoning.',
    sizes: JSON.stringify([
      { name: 'Regular', detail: 'Single portion', price: 300 },
      { name: 'Large', detail: 'Sharing portion', price: 450 },
      { name: 'Jumbo', detail: 'Family bucket', price: 600 }
    ]),
    ingredients: JSON.stringify(['Potato', 'Sea Salt', 'Vegetable Oil'])
  },
  'Loaded Fries': {
    subtitle: 'Sides · Cheesy & Saucy',
    description: 'Golden fries smothered in warm cheddar cheese sauce, crispy jalapeno bites, and chipotle garlic drizzle.',
    sizes: JSON.stringify([
      { name: 'Regular', detail: 'Single bowl', price: 550 },
      { name: 'Large', detail: 'Party platter', price: 800 }
    ]),
    ingredients: JSON.stringify(['Fries', 'Cheddar Sauce', 'Jalapeños', 'Chipotle Mayo'])
  },
  'Garlic Bread': {
    subtitle: 'Sides · Warm & Buttery',
    description: 'Crispy baguette slices toasted with roasted garlic herb butter and fresh Italian parsley.',
    sizes: JSON.stringify([
      { name: 'Plain', detail: '4 slices', price: 400 },
      { name: 'Cheesy', detail: '4 slices with mozzarella', price: 550 }
    ]),
    ingredients: JSON.stringify(['French Baguette', 'Garlic Butter', 'Parsley', 'Oregano'])
  },
  'Nuggets (6)': {
    subtitle: 'Sides · Tender Bites',
    description: 'Bite-sized tender all-white chicken breast nuggets battered and fried golden brown with dipping sauce.',
    sizes: JSON.stringify([
      { name: '6 Pcs', detail: 'Single box', price: 450 },
      { name: '12 Pcs', detail: 'Sharing box', price: 800 }
    ]),
    ingredients: JSON.stringify(['Chicken Breast', 'Crispy Breading', 'Dip Sauce'])
  },
  'Coke 500ml': {
    subtitle: 'Drinks · Chilled Refreshment',
    description: 'Classic Coca-Cola served ice cold.',
    sizes: JSON.stringify([
      { name: '500ml', detail: 'Bottle', price: 150 },
      { name: '1.5L', detail: 'Large bottle', price: 280 }
    ]),
    ingredients: JSON.stringify(['Carbonated Water', 'Cola Syrup', 'Caramel Color'])
  },
  'Mineral Water': {
    subtitle: 'Drinks · Pure Hydration',
    description: 'Pure natural mineral drinking water, chilled.',
    sizes: JSON.stringify([
      { name: 'Small', detail: '500ml', price: 80 },
      { name: 'Large', detail: '1.5L', price: 140 }
    ]),
    ingredients: JSON.stringify(['Natural Mineral Water'])
  },
  'Mint Margarita': {
    subtitle: 'Drinks · Freshly Blended',
    description: 'Refreshing mocktail blended with fresh mint leaves, lemon juice, ice, and fizzy soda.',
    sizes: JSON.stringify([
      { name: 'Regular', detail: '350ml glass', price: 350 },
      { name: 'Pitcher', detail: '1 Litre sharing', price: 850 }
    ]),
    ingredients: JSON.stringify(['Fresh Mint', 'Lemon Juice', 'Soda', 'Black Salt'])
  },
  'Lava Cake': {
    subtitle: 'Desserts · Warm & Decadent',
    description: 'Warm dark chocolate sponge cake with a rich molten Belgian chocolate center, dusted with icing sugar.',
    sizes: JSON.stringify([
      { name: 'Standard', detail: 'Warm cake', price: 450 },
      { name: 'With Ice Cream', detail: 'With vanilla scoop', price: 600 }
    ]),
    ingredients: JSON.stringify(['Dark Chocolate', 'Belgian Cocoa', 'Butter', 'Eggs'])
  },
  'Ice Cream': {
    subtitle: 'Desserts · Creamy Scoops',
    description: 'Artisanal creamy ice cream served chilled in your choice of flavors with chocolate drizzle.',
    sizes: JSON.stringify([
      { name: 'Single Scoop', detail: '1 scoop cup', price: 250 },
      { name: 'Double Scoop', detail: '2 scoops cup', price: 420 },
      { name: 'Sundae Bowl', detail: 'With nuts & syrup', price: 550 }
    ]),
    ingredients: JSON.stringify(['Fresh Cream', 'Milk', 'Natural Flavors', 'Chocolate Sauce'])
  }
};

// Seed demo data on first run
if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
  const ci = db.prepare('INSERT INTO categories (name,color) VALUES (?,?)');
  [['Pizza', '#ff6b35'], ['Burgers', '#f7b32b'], ['Sides', '#2ec4b6'], ['Drinks', '#4d96ff'], ['Desserts', '#e056fd']].forEach(c => ci.run(...c));
  const pi = db.prepare('INSERT INTO products (name,price,category_id,emoji,subtitle,description,ingredients,sizes) VALUES (?,?,?,?,?,?,?,?)');
  [
    ['Margherita', 1200, 1, '🍕'], ['Pepperoni', 1500, 1, '🍕'], ['Chicken Tikka', 1600, 1, '🍕'], ['Fajita', 1550, 1, '🍕'], ['Veggie Supreme', 1350, 1, '🍕'],
    ['Zinger Burger', 650, 2, '🍔'], ['Beef Burger', 800, 2, '🍔'], ['Double Patty', 1100, 2, '🍔'],
    ['Fries', 300, 3, '🍟'], ['Loaded Fries', 550, 3, '🍟'], ['Garlic Bread', 400, 3, '🥖'], ['Nuggets (6)', 450, 3, '🍗'],
    ['Coke 500ml', 150, 4, '🥤'], ['Mineral Water', 80, 4, '💧'], ['Mint Margarita', 350, 4, '🍹'],
    ['Lava Cake', 450, 5, '🍫'], ['Ice Cream', 250, 5, '🍨'],
  ].forEach(([name, price, category_id, emoji]) => {
    const det = PRODUCT_DETAILS[name] || {};
    pi.run(name, price, category_id, emoji, det.subtitle || null, det.description || null, det.ingredients || null, det.sizes || null);
  });
}

// Update existing items in database if sizes or description are not populated
const updateDetails = db.prepare("UPDATE products SET subtitle=?, description=?, ingredients=?, sizes=? WHERE name=? AND (sizes IS NULL OR sizes='')");
for (const [name, det] of Object.entries(PRODUCT_DETAILS)) {
  try {
    updateDetails.run(det.subtitle, det.description, det.ingredients, det.sizes, name);
  } catch {}
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
  logo_image: '', // data URL of the restaurant's logo picture; shown instead of the emoji when set
  // End-of-day WhatsApp to the owner when ingredients are really low (server/stock-alert.js)
  low_stock_alert: '0', low_stock_alert_to: '', low_stock_alert_time: '22:00', low_stock_alert_percent: '50', low_stock_alert_min_items: '1', low_stock_alert_last: '',
  ntn: 'NTN-8934521-7',
  bank_name: 'Meezan Bank Ltd',
  bank_account: 'PK36MEZN0001000123456789',
  bank_title: 'Pizza Venu Foods Private Limited',
  strn: '',
  pos_id: '',
  receipt_printer: '', // "192.168.1.50:9100" or "/dev/usb/lp0"; empty = browser print
  kitchen_printer: '',
  paper_width: '80',
  open_drawer: '1', // kick the cash drawer when a cash receipt prints
  cashier_discount_limit: '10', // % of subtotal a cashier may give without an admin PIN
  closed_drawer_cash: 'auto_open', // cash taken while no shift is open: 'auto_open' (start a shift with Rs 0 float) | 'refuse'
  loyalty_earn: '1', // points earned per Rs 100 spent (0 = loyalty off)
  loyalty_value: '1', // Rs off per point redeemed
  payment_qr: '', // data URL of the bank / Raast QR shown on the payment screen
  payment_qr_label: '',
  fiscal_mode: 'off', // 'off' | 'pra' | 'fbr'
  fiscal_url: '',
  fiscal_pos_id: '',
  fiscal_pct_code: '',
  // How the WhatsApp assistant writes (tone, length, what to ask). Facts and rules stay fixed in rag/prompts/system.md
  bot_behaviour: "- Keep every reply to 1 or 2 short lines. No long paragraphs, no lists unless the customer asks for the menu.\n- When an order is missing something (delivery or takeaway, the address, a size), ask only for that one thing, directly.\n- Don't repeat what the customer just said and don't explain what you are about to do.\n- Reply in Roman Urdu unless the customer writes in English or Urdu script.\n- Friendly and casual, like a helpful person at the counter. At most one emoji per message.\n- Greet only at the start of a conversation, not in every message.",
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k, v);

if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  const ui = db.prepare('INSERT INTO users (name,pin,role) VALUES (?,?,?)');
  ui.run('Owner', '1234', 'admin'); ui.run('Cashier', '1111', 'cashier'); ui.run('Kitchen', '2222', 'kitchen');
}

// PINs are stored as salted scrypt hashes ("s1$salt$hash"); plain PINs from older databases are hashed on startup
const crypto = require('crypto');
// A PIN is 4 to 12 letters or numbers. Capital and small letters count as the same (easier on a touch keyboard).
const normPin = pin => String(pin ?? '').trim().toLowerCase();
const PIN_OK = pin => /^[a-z0-9]{4,12}$/.test(normPin(pin));
const PIN_RULE = 'PIN must be 4 to 12 letters or numbers';
// The starting PINs of a new install. On a real install (the desktop app) nobody keeps them: the owner must choose their
// own PIN at the first login, and no PIN set later may be one of these. Off in the demo and in the dev server.
const DEFAULT_PINS = ['1234', '1111', '2222', '3333'];
const WEAK_PINS = [...DEFAULT_PINS, '0000', '4321'];
const FORCE_PIN = !DEMO && (process.env.HAZEL_LICENCE === '1' || process.env.FORCE_PIN_CHANGE === '1');
const PIN_WEAK = pin => FORCE_PIN && WEAK_PINS.includes(normPin(pin));
// The PIN list in your admin app: a PIN set or changed here is sent to HazelPOS Cloud (encrypted there), so you can see it and
// help someone who forgot it. A PIN changed in the admin app comes here (PIN reset, below). Offline: kept in memory and sent
// as soon as the internet is back. The POS itself only stores the scrambled PIN.
const pinOutbox = new Map(); // login id -> the PIN just set, until the cloud has it
let pinPushing = false;
async function pushPins() {
  if (pinPushing || !cloud?.status().connected || cloud.isHeld()) return;
  pinPushing = true;
  try {
    const users = db.prepare('SELECT id, name, role, pin_changed_at changed_at FROM users ORDER BY id').all().map(u => ({ ...u, pin: pinOutbox.get(u.id) }));
    await cloud.call('/api/sync/pins', { users });
    for (const u of users) if (u.pin !== undefined && pinOutbox.get(u.id) === u.pin) pinOutbox.delete(u.id);
  } catch { /* offline or an older cloud: the next minute */ } finally { pinPushing = false; }
}
const vaultPin = (id, pin) => { if (id && pin) pinOutbox.set(+id, String(pin)); setTimeout(pushPins, 400).unref?.(); };
setInterval(() => { if (pinOutbox.size) pushPins(); }, 60_000).unref();
setInterval(pushPins, 10 * 60_000).unref(); // also keeps the list of logins (names, roles) up to date
setTimeout(pushPins, 25_000).unref();
const PIN_WEAK_MSG = 'That PIN is too easy to guess. Choose another (letters and numbers, for example your name and a number).';
const hashPin = pin => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `s1$${salt}$${crypto.scryptSync(normPin(pin), salt, 32, { N: 4096 }).toString('hex')}`;
};
const pinMatches = (pin, stored) => {
  const [v, salt, hash] = String(stored).split('$');
  if (v !== 's1' || !hash) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(normPin(pin), salt, 32, { N: 4096 }), Buffer.from(hash, 'hex'));
};
const userByPin = pin => db.prepare('SELECT id,name,role,pin,must_change_pin FROM users').all().find(u => pinMatches(pin, u.pin));
for (const u of db.prepare("SELECT id,pin FROM users WHERE pin NOT LIKE 's1$%'").all())
  db.prepare('UPDATE users SET pin=? WHERE id=?').run(hashPin(u.pin), u.id);

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

// Demo: the role picker has a Rider; make sure a rider login exists (PIN 3333, the first rider on the staff list)
if (DEMO && !db.prepare("SELECT 1 FROM users WHERE role='rider'").get()) {
  let e = db.prepare("SELECT id, name FROM employees WHERE active=1 AND lower(job) LIKE '%rider%' ORDER BY id").get();
  if (!e) e = { id: db.prepare("INSERT INTO employees (name,phone,job,salary,active,joined) VALUES ('Sample Rider','03000000107','Rider',0,1,date('now'))").run().lastInsertRowid, name: 'Sample Rider' };
  db.prepare("UPDATE employees SET delivery_fee=COALESCE(NULLIF(delivery_fee,0),100) WHERE id=?").run(e.id);
  db.prepare('INSERT INTO users (name,pin,role,employee_id) VALUES (?,?,?,?)').run(e.name, hashPin('3333'), 'rider', e.id);
}
const getSettings = () => Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
const taxRate = () => (+getSettings().tax_rate || 0) / 100;

const app = express();
// No CORS: every screen (POS window, kitchen tablet, customer QR page) is served by this server itself. A website the cashier
// visits in another tab must not be able to call the POS (or lock the PIN screen by guessing PINs from the cashier's PC).
app.disable('x-powered-by');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; " +
  "img-src 'self' data: blob: https://tile.openstreetmap.org; media-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer' });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store'); // settings, links and reports are never kept by a browser or a proxy
  next();
});
app.use(express.json({ limit: '2mb' })); // payment QR image is stored as a data URL in settings

// The public demo gives every visitor the Owner screen, so whatever makes THIS server reach out or write somewhere is shut:
// a printer "address" can be a file path or a host:port, and the fiscal and cloud addresses are fetched by the server.
if (DEMO) {
  const NOT_IN_DEMO = ['receipt_printer', 'kitchen_printer', 'fiscal_mode', 'fiscal_url', 'fiscal_pos_id', 'fiscal_pct_code'];
  app.use('/api', (req, res, next) => {
    // code 'demo': the screen shows this as a popup (client/src/lib.js), saying what the real HazelPOS does instead
    const DEMO_ONLY = [
      [/^\/whatsapp\/(connect|logout)/, "WhatsApp isn't available in the demo. In the real HazelPOS, you link the restaurant's own WhatsApp here by scanning a QR code with the phone. The assistant then answers customers, sends the menu and takes orders."],
      [/^\/print\//, "Printing isn't available in the demo. In the real HazelPOS, receipts and kitchen tickets print straight to your thermal printer."],
      [/^\/cloud\/(connect|sync|backup|restore)/, "HazelPOS Cloud isn't available in the demo. In the real HazelPOS, every sale is backed up and the owner sees all branches from their phone."],
      [/^\/(secrets|fiscal\/retry)/, "PRA / FBR reporting isn't available in the demo. In the real HazelPOS, each invoice is reported to PRA or FBR automatically."],
    ];
    const hit = req.method !== 'GET' && DEMO_ONLY.find(([re]) => re.test(req.path));
    if (hit) return res.status(403).json({ error: hit[1], code: 'demo' });
    if (req.method === 'POST' && req.path === '/settings' && req.body) for (const k of NOT_IN_DEMO) delete req.body[k];
    // The demo's logins are fixed (the role picker uses them): a visitor can't change a PIN and lock everyone else out
    if (req.method === 'POST' && /^\/(users|riders)$/.test(req.path) && req.body) delete req.body.pin;
    next();
  });
}
const now = () => new Date().toISOString();

// ---------- Auth (PIN + session token) ----------
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const ALL = ['admin', 'cashier', 'kitchen'], STAFF = ['admin', 'cashier'], ADMIN = ['admin'], RIDER = ['rider'];
const ROLES = [...ALL, 'rider']; // riders log in too (their own screen); they get only the /rider routes
// First match wins; anything not listed is admin-only. null = public.
const ACCESS = [
  [/^POST \/login$/, null],
  [/^GET \/settings$/, null], // logged-out callers only get name + logo
  [/^(GET|POST) \/qr\//, null], // customer table ordering, guarded by the table's QR token
  [/^GET \/licence$/, null], // the activation screen shows before anyone can log in
  [/^(GET|POST) \/internal\//, null], // the desktop app itself, guarded by its own secret (App updates, below)
  [/^GET \/menu-images(\/\d+\/image)?$/, null], // menu card pictures: public like the menu itself (QR page)
  [/^POST \/licence\/(activate|check)$/, null], // activate: only until activated, then admin (checked in the route)
  [/^POST \/logout$/, ROLES],
  [/^POST \/me\/pin$/, ROLES], // choosing one's own PIN (first login with a starting PIN)
  [/^(GET|POST) \/rider(\/|$)/, RIDER], // the rider's own screen (client/src/RiderHome.jsx)
  [/^GET \/(menu|tables|summary|kitchen)$/, ALL],
  [/^POST \/kitchen\/\d+$/, ALL],
  [/^(GET|POST) \/(orders|register|qr-requests)(\/|$)/, STAFF],
  [/^GET \/floors$/, STAFF], // floors are edited by admin only
  [/^GET \/qr-info$/, STAFF],
  [/^POST \/print\/(receipt|kitchen)\/\d+$/, STAFF],
  [/^GET \/customers\/lookup$/, STAFF],
  [/^POST \/promos\/check$/, STAFF],
  [/^GET \/delivery-zones$/, STAFF],
  [/^POST \/riders$/, ADMIN], // add or edit a rider; their link, accounts and payouts: admin only
  [/^POST \/riders\/\d+\/(link|send-link|pay)$/, ADMIN],
  [/^(GET \/riders\/accounts|POST \/riders\/sync)$/, ADMIN],
  [/^(GET|POST) \/(deliveries|riders)(\/|$)/, STAFF],
  [/^(GET|POST) \/whatsapp\//, STAFF],
];

const audit = (req, action, status, detail = '') => db.prepare(
  'INSERT INTO audit_log (at,user_id,user_name,role,ip,action,status,detail) VALUES (?,?,?,?,?,?,?,?)'
).run(now(), req.user?.id ?? null, req.user?.name ?? '', req.user?.role ?? '', req.ip, action, status, String(detail).slice(0, 500));

app.use('/api', (req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const s = token && db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (s && Date.now() - Date.parse(s.last_seen) < SESSION_IDLE_MS) {
    req.user = db.prepare('SELECT id,name,role,employee_id,must_change_pin FROM users WHERE id=?').get(s.user_id);
    if (req.user) { req.token = token; db.prepare('UPDATE sessions SET last_seen=? WHERE token=?').run(now(), token); }
  } else if (s) db.prepare('DELETE FROM sessions WHERE token=?').run(token);

  const rule = ACCESS.find(([re]) => re.test(`${req.method} ${req.path}`));
  const roles = rule ? rule[1] : ADMIN;
  if (roles && !req.user) return res.status(401).json({ error: 'Please log in again' });
  if (roles && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
  // Logged in with a starting PIN: nothing works until they choose their own
  // set by a starting PIN on a real install, a PIN from the vendor's setup, or a PIN reset from the admin app
  if (req.user?.must_change_pin && !/^(POST \/me\/pin|POST \/logout|GET \/settings)$/.test(`${req.method} ${req.path}`))
    return res.status(403).json({ error: 'Choose your own PIN first', code: 'change_pin' });

  // Record every change made by staff
  if (req.method !== 'GET' && req.user) res.on('finish', () => {
    const { pin, approve_pin, key, secret, ...body } = req.body || {}; // never log PINs, keys or API tokens
    audit(req, `${req.method} ${req.path}`, res.statusCode, JSON.stringify(body));
  });
  next();
});

// Membership locked (server/licence.js): no NEW orders from any channel. Paying open bills, reports and data keep working.
const NEW_ORDER = /^POST \/(qr\/[^/]+\/order|qr-requests\/\d+\/accept|whatsapp\/orders\/\d+\/accept)$/;
app.use('/api', (req, res, next) => {
  const isNew = (req.method === 'POST' && req.path === '/orders' && !req.body?.id) || NEW_ORDER.test(`${req.method} ${req.path}`);
  if (!isNew || !lic.locked()) return next();
  if (req.path.startsWith('/qr/')) return res.status(402).json({ error: 'Ordering from the table is not available right now. Please ask the staff.' });
  res.status(402).json({ error: lic.state().message });
});

// 5 wrong PINs from one device locks it out for 5 minutes
const loginFails = new Map();
app.post('/api/login', (req, res) => {
  const f = loginFails.get(req.ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: `Too many wrong PINs. Try again in ${Math.ceil((f.until - Date.now()) / 60000)} min` });
  // A new install that is not activated yet has the starting PINs: nobody can log in until it is activated (the screen shows Activate)
  if (lic.state().state === 'activate') return res.status(403).json({ error: 'Activate HazelPOS first' });
  const u = userByPin(String(req.body.pin || ''));
  if (!u) {
    f.n++; if (f.n >= 5) { f.n = 0; f.until = Date.now() + 5 * 60 * 1000; }
    loginFails.set(req.ip, f);
    audit(req, 'LOGIN FAILED', 401);
    return res.status(401).json({ error: 'Wrong PIN' });
  }
  // A starting PIN (1234, 1111…) on a real install: only the owner may use it, and only to choose their own PIN.
  // The others (cashier, kitchen, rider) wait until the owner gives them a PIN, so nobody can grab their login first.
  if (FORCE_PIN && DEFAULT_PINS.includes(normPin(req.body.pin))) {
    if (u.role !== 'admin') {
      audit(req, 'LOGIN REFUSED (starting PIN)', 403);
      return res.status(403).json({ error: 'This is a starting PIN. Ask the owner to give you a new PIN (Settings → Staff & PINs).' });
    }
    db.prepare('UPDATE users SET must_change_pin=1 WHERE id=?').run(u.id); u.must_change_pin = 1;
  }
  loginFails.delete(req.ip);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id,created_at,last_seen) VALUES (?,?,?,?)').run(token, u.id, now(), now());
  req.user = u; audit(req, 'LOGIN', 200);
  res.json({ token, user: { id: u.id, name: u.name, role: u.role, must_change_pin: !!u.must_change_pin } });
});
app.post('/api/logout', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token=?').run(req.token);
  res.json({ ok: true });
});

// ---------- Settings ----------
app.get('/api/settings', (req, res) => {
  const s = getSettings();
  const licence = lic.state();
  res.json(req.user ? { ...s, bot_behaviour_default: DEFAULT_SETTINGS.bot_behaviour, demo: DEMO, licence } : { name: s.name, logo: s.logo, logo_image: s.logo_image, demo: DEMO, licence });
});
app.post('/api/settings', (req, res) => {
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in req.body) up.run(k, String(req.body[k]));
  res.json(getSettings());
});

// ---------- Menu ----------
app.get('/api/menu', (req, res) => {
  const all = req.query.all === '1' && req.user.role === 'admin'; // hidden items: admin only
  res.json({
    categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
    products: db.prepare(`SELECT * FROM products ${all ? '' : 'WHERE active=1'} ORDER BY name`).all(),
    taxRate: taxRate(),
  });
});

// Generic save/delete for simple tables
function crud(route, table, fields) {
  app.post(`/api/${route}`, (req, res) => {
    const b = req.body;
    if (fields.includes('name') && !String(b.name ?? '').trim()) return res.status(400).json({ error: 'Name is required' });
    const vals = fields.map(f => b[f] ?? null);
    if (b.id) db.prepare(`UPDATE ${table} SET ${fields.map(f => f + '=?').join(',')} WHERE id=?`).run(...vals, b.id);
    else b.id = db.prepare(`INSERT INTO ${table} (${fields}) VALUES (${fields.map(() => '?')})`).run(...vals).lastInsertRowid;
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(b.id));
  });
  app.post(`/api/${route}/:id/delete`, (req, res) => {
    try { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
}
app.post('/api/products/:id/delete', (req, res, next) => {
  const o = db.prepare("SELECT o.id FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id=? AND o.status='open' LIMIT 1").get(req.params.id);
  if (o) return res.status(400).json({ error: `This item is on open bill #${o.id}. Remove it from that bill first, or hide the item instead (Edit → untick "Show on menu").` });
  next();
});
crud('products', 'products', ['name', 'price', 'category_id', 'emoji', 'active', 'subtitle', 'description', 'ingredients', 'sizes', 'modifiers', 'deal_items', 'combo_for']);
crud('categories', 'categories', ['name', 'color']);

// ---------- Menu import from Excel / CSV (server/menu-import.js) ----------
// Dry run first (shows what would change), then the same call with apply:true. Rows with errors block the import.
const menuImport = require('./menu-import');
app.get('/api/menu/import-template', (req, res) => res.json(menuImport.TEMPLATE));
app.post('/api/menu/import', (req, res) => { // body limit 2 MB (base64), so files up to ~1.4 MB
  const buf = Buffer.from(String(req.body.file || ''), 'base64');
  if (!buf.length) throw new UserError('Choose the Excel file');
  if (buf.length > 1.4 * 1024 * 1024) throw new UserError('That file is too large (max 1.4 MB). A menu sheet is usually under 100 KB: remove pictures from it');
  let menu;
  try { menu = menuImport.toMenu(menuImport.readSheet(buf, String(req.body.name || ''))); }
  catch (e) { throw new UserError(e.message); }
  if (!menu.items.length) throw new UserError('No menu items found in this file');
  const dry = menuImport.importMenu(db, menu, { hideMissing: !!req.body.hide_missing });
  const errors = [...menu.errors, ...dry.deal_errors];
  const apply = !!req.body.apply && !errors.length;
  const plan = apply ? menuImport.importMenu(db, menu, { apply: true, hideMissing: !!req.body.hide_missing }) : dry;
  res.json({ applied: apply, items: menu.items.length, ...plan, errors });
});

// ---------- Menu pictures (photos of the menu card) ----------
// Kept in the database, so they're in the daily cloud backup. The WhatsApp assistant sends them when a customer
// asks to see the menu (rag/prompts/system.md rule 10).
db.exec('CREATE TABLE IF NOT EXISTS menu_images (id INTEGER PRIMARY KEY, caption TEXT, mime TEXT, data BLOB, sort INTEGER, created_at TEXT)');
const MAX_MENU_IMAGES = 6;
app.get('/api/menu-images', (req, res) => res.json(db.prepare('SELECT id, caption, sort, length(data) size FROM menu_images ORDER BY sort, id').all()));
app.get('/api/menu-images/:id/image', (req, res) => {
  const m = db.prepare('SELECT mime, data FROM menu_images WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'public, max-age=300').type(m.mime).send(Buffer.from(m.data));
});
app.post('/api/menu-images', (req, res) => { // UserError -> 400 via the error handler at the end
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(req.body.data || ''));
  if (!m) throw new UserError('Choose a JPG, PNG or WebP picture');
  const data = Buffer.from(m[3], 'base64');
  if (data.length > 1.5 * 1024 * 1024) throw new UserError('That picture is too large (max 1.5 MB)');
  if (db.prepare('SELECT COUNT(*) c FROM menu_images').get().c >= MAX_MENU_IMAGES) throw new UserError(`Up to ${MAX_MENU_IMAGES} menu pictures. Delete one first`);
  const sort = (db.prepare('SELECT MAX(sort) s FROM menu_images').get().s ?? 0) + 1;
  const id = db.prepare('INSERT INTO menu_images (caption, mime, data, sort, created_at) VALUES (?,?,?,?,?)')
    .run(String(req.body.caption || '').slice(0, 200), m[1], data, sort, now()).lastInsertRowid;
  res.json({ id });
});
app.post('/api/menu-images/:id', (req, res) => {
  db.prepare('UPDATE menu_images SET caption=? WHERE id=?').run(String(req.body.caption || '').slice(0, 200), req.params.id);
  res.json({ ok: true });
});
app.post('/api/menu-images/:id/delete', (req, res) => { db.prepare('DELETE FROM menu_images WHERE id=?').run(req.params.id); res.json({ ok: true }); });
crud('tables', 'tables_', ['name', 'seats', 'floor', 'shape']);
app.post('/api/expenses', (req, res, next) => { req.body.user_name = req.user.name; next(); });
app.post('/api/expenses/:id/delete', (req, res, next) => {
  const ref = db.prepare('SELECT ref FROM expenses WHERE id=?').get(req.params.id)?.ref;
  if (ref) return res.status(400).json({ error: ref.startsWith('payroll') ? 'Delete this from Salaries instead' : 'Delete this from the supplier khata instead' });
  next();
});
crud('expenses', 'expenses', ['title', 'category', 'amount', 'payment_method', 'date', 'user_name']);

// ---------- Staff (PINs are never sent back) ----------
const adminCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
app.get('/api/users', (req, res) => res.json(db.prepare("SELECT id,name,role FROM users ORDER BY role='rider', id").all()));
app.post('/api/users', (req, res) => {
  const { id, name, pin, role } = req.body;
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!id) return res.status(400).json({ error: 'There are three fixed logins (admin, cashier, kitchen); change their PINs instead' });
  if (pin) {
    if (!PIN_OK(pin)) return res.status(400).json({ error: PIN_RULE });
    if (PIN_WEAK(pin)) return res.status(400).json({ error: PIN_WEAK_MSG });
    const taken = userByPin(pin);
    if (taken && taken.id !== +id) return res.status(400).json({ error: 'That PIN is already used' });
  }
  if (id) {
    const cur = db.prepare('SELECT role FROM users WHERE id=?').get(id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    if (cur.role === 'admin' && role !== 'admin' && adminCount() === 1) return res.status(400).json({ error: 'Keep at least one admin' });
    db.prepare('UPDATE users SET name=?, role=? WHERE id=?').run(name.trim(), role, id);
    if (pin) {
      db.prepare('UPDATE users SET pin=?, must_change_pin=0 WHERE id=?').run(hashPin(pin), id); vaultPin(id, pin);
      if (+id !== req.user.id) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); // new PIN: that person is signed out everywhere
    }
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token != ?').run(id, req.token); // PIN/role change logs them out elsewhere
  }
  const uid = id || db.prepare('INSERT INTO users (name,pin,role) VALUES (?,?,?)').run(name.trim(), hashPin(pin), role).lastInsertRowid;
  res.json(db.prepare('SELECT id,name,role FROM users WHERE id=?').get(uid));
});
// First login with a starting PIN: the person chooses their own
app.post('/api/me/pin', (req, res) => {
  const pin = String(req.body.pin ?? '');
  if (!PIN_OK(pin)) return res.status(400).json({ error: PIN_RULE });
  if (PIN_WEAK(pin)) return res.status(400).json({ error: PIN_WEAK_MSG });
  const taken = userByPin(pin);
  if (taken && taken.id !== req.user.id) return res.status(400).json({ error: 'That PIN is already used by someone else. Choose another.' });
  db.prepare('UPDATE users SET pin=?, must_change_pin=0 WHERE id=?').run(hashPin(pin), req.user.id); vaultPin(req.user.id, pin);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token != ?').run(req.user.id, req.token); // other devices signed in with the old PIN are out
  res.json({ ok: true });
});
app.post('/api/users/:id/delete', (req, res) => res.status(400).json({ error: 'The admin, cashier and kitchen logins cannot be deleted' }));

// ---------- What the WhatsApp assistant may answer (Settings → WhatsApp bot) ----------
// Owner-written answers (opening hours, delivery, halal, parking…). Read live by the assistant: rag/src/loaders/pos-db.js.
// Every answer goes into every WhatsApp prompt, so the total is capped (cost and speed).
const FAQ_STARTER = ['Opening hours / Timings', 'Do you deliver? Delivery time', 'Payment methods', 'Is the food halal?', 'Dine-in, takeaway, parking',
  'Do you take bulk / party orders?', 'How do I complain or give feedback?'];
const FAQ_MAX_ITEMS = 60, FAQ_MAX_CHARS = 8000;
const faqChars = (exceptId = 0) => db.prepare('SELECT COALESCE(SUM(LENGTH(question) + LENGTH(answer)), 0) c FROM faq WHERE id != ?').get(exceptId).c;
app.get('/api/faq', (req, res) => res.json({ items: db.prepare('SELECT id, question, answer, sort FROM faq ORDER BY sort, id').all(), max_chars: FAQ_MAX_CHARS, used_chars: faqChars() }));
app.post('/api/faq', (req, res) => { // a UserError thrown here becomes a 400 (error handler at the end of this file)
  const question = String(req.body.question ?? '').trim().slice(0, 200), answer = String(req.body.answer ?? '').trim().slice(0, 1000);
  if (!question) throw new UserError('Write the question');
  const id = +req.body.id || 0;
  if (id && !db.prepare('SELECT 1 FROM faq WHERE id=?').get(id)) throw new UserError('That question no longer exists');
  if (!id && db.prepare('SELECT COUNT(*) c FROM faq').get().c >= FAQ_MAX_ITEMS) throw new UserError(`Up to ${FAQ_MAX_ITEMS} questions`);
  if (faqChars(id) + question.length + answer.length > FAQ_MAX_CHARS) throw new UserError(`Too much text: the assistant reads all answers with every message, so they must stay under ${FAQ_MAX_CHARS} characters in total. Shorten some answers.`);
  if (id) db.prepare('UPDATE faq SET question=?, answer=? WHERE id=?').run(question, answer, id);
  else db.prepare('INSERT INTO faq (question, answer, sort) VALUES (?,?,COALESCE((SELECT MAX(sort) FROM faq), 0) + 1)').run(question, answer);
  res.json({ ok: true });
});
app.post('/api/faq/:id/delete', (req, res) => { db.prepare('DELETE FROM faq WHERE id=?').run(req.params.id); res.json({ ok: true }); });
// The usual questions with empty answers, to fill in (questions already there are not added twice)
app.post('/api/faq/starter', (req, res) => {
  const have = new Set(db.prepare('SELECT LOWER(question) q FROM faq').all().map(r => r.q));
  let n = 0;
  for (const q of FAQ_STARTER) if (!have.has(q.toLowerCase())) { db.prepare('INSERT INTO faq (question, answer, sort) VALUES (?,?,COALESCE((SELECT MAX(sort) FROM faq), 0) + 1)').run(q, ''); n++; }
  res.json({ ok: true, added: n });
});

app.get('/api/audit', (req, res) => {
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(1000, +req.query.limit || 300)));
});

app.get('/api/tables', (req, res) => {
  res.json(db.prepare(`
    SELECT t.*,
           COALESCE(f.color, '#ff9f43') floor_color,
           COALESCE(f.icon, '🍽️') floor_icon,
           o.id order_id,
           o.total,
           o.created_at seated_at,
           o.user_name waiter,
           (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) item_count,
           (SELECT COUNT(*) FROM orders x WHERE x.table_id = t.id AND x.status='open' AND x.type='dine-in') open_bills,
           (SELECT COUNT(*) FROM orders x WHERE x.table_id = t.id AND x.status='open' AND x.type='dine-in' AND x.kitchen_status='ready') food_ready
    FROM tables_ t
    LEFT JOIN floors f ON f.name = t.floor
    LEFT JOIN orders o ON o.id = (SELECT MAX(id) FROM orders x WHERE x.table_id = t.id AND x.status='open' AND x.type='dine-in')
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
           SUM(CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.id AND o.status='open' AND o.type='dine-in') THEN 1 ELSE 0 END) occupied
    FROM floors f
    LEFT JOIN tables_ t ON t.floor = f.name
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
const printer = require('./printer');
const parseJSON = (v, fallback) => { try { return (typeof v === 'string' ? JSON.parse(v) : v) ?? fallback; } catch { return fallback; } };
class UserError extends Error { constructor(msg, extra) { super(msg); Object.assign(this, extra); } }
// Route wrapper: a UserError becomes a 400 with its message
const userErrors = fn => (req, res) => {
  try { fn(req, res); }
  catch (e) { if (e instanceof UserError) res.status(400).json({ error: e.message }); else throw e; }
};

// What's inside a deal, with today's item names: [{product_id, name, size, qty}] (empty for a normal item)
function dealIncludes(productId) {
  const items = parseJSON(db.prepare('SELECT deal_items FROM products WHERE id=?').get(productId)?.deal_items, []) || [];
  return items.filter(d => d && d.product_id).map(d => ({
    product_id: +d.product_id, size: d.size || '', qty: Math.max(1, +d.qty || 1),
    name: db.prepare('SELECT name FROM products WHERE id=?').get(d.product_id)?.name || 'Item removed from menu',
  }));
}
function getOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (o) {
    // includes: a deal's items, so the kitchen ticket and receipt show what to make
    o.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id).map(i => ({ ...i, mods: parseJSON(i.mods, []), includes: dealIncludes(i.product_id) }));
    o.invoice_no = `INV-${new Date(o.created_at).getFullYear()}-${String(o.id).padStart(4, '0')}`;
    o.tableName = o.table_id ? db.prepare('SELECT name FROM tables_ WHERE id=?').get(o.table_id)?.name : null;
    o.customer_points = o.customer_id ? db.prepare('SELECT points FROM customers WHERE id=?').get(o.customer_id)?.points : null;
    o.zone = o.zone_id ? db.prepare('SELECT name, eta_min FROM delivery_zones WHERE id=?').get(o.zone_id)?.name : null;
    o.rider = o.rider_id ? db.prepare('SELECT name, phone FROM employees WHERE id=?').get(o.rider_id) : null;
    o.track_url = o.track_token ? trackUrl(o) : null; // customer's live-tracking page on the cloud (null when not connected)
    o.promo = o.promo_code ? db.prepare('SELECT code, type, value, min_order, max_discount FROM promos WHERE code=?').get(o.promo_code) : null;
  }
  return o;
}

// The server is the price authority: name and price are rebuilt from the menu, never taken from the client.
// item = { product_id, size?, mods?: [{group, name}], qty, note? }
function priceItem(i, { activeOnly = false } = {}) {
  const p = db.prepare(`SELECT * FROM products WHERE id=? ${activeOnly ? 'AND active=1' : ''}`).get(i.product_id);
  if (!p) throw new UserError('An item in this order is no longer on the menu');
  const sizes = parseJSON(p.sizes, []) || [];
  let sizeName = i.size;
  if (!sizeName && sizes.length > 1) sizeName = /\(([^)]+)\)$/.exec(i.name || '')?.[1]; // lines saved before sizes were stored
  const size = sizeName ? sizes.find(s => s.name === sizeName) : sizes.length === 1 ? sizes[0] : null;
  if (sizes.length > 1 && !size) throw new UserError(`Choose a size for ${p.name}`);

  const picked = Array.isArray(i.mods) ? i.mods : [];
  const mods = [];
  for (const g of parseJSON(p.modifiers, []) || []) {
    const chosen = (g.options || []).filter(o => picked.some(m => m.group === g.name && m.name === o.name));
    if (chosen.length < (+g.min || 0)) throw new UserError(`${p.name}: choose ${g.name}`);
    if (+g.max && chosen.length > +g.max) throw new UserError(`${p.name}: at most ${g.max} for ${g.name}`);
    chosen.forEach(o => mods.push({ group: g.name, name: o.name, price: +o.price || 0 }));
  }
  if (mods.length !== picked.length) throw new UserError(`${p.name}: an option is no longer available`);

  const qty = Math.min(999, Math.max(0, parseInt(i.qty) || 0));
  const showSize = size && (sizes.length > 1 || size.name !== 'Regular');
  return {
    product_id: p.id, qty, note: String(i.note || '').slice(0, 200),
    name: p.name + (showSize ? ` (${size.name})` : ''), size: size?.name ?? null, mods,
    price: (size ? +size.price : p.price) + mods.reduce((s, m) => s + m.price, 0),
  };
}
const lineKey = i => JSON.stringify([i.product_id, i.name, (i.mods || []).map(m => m.name), i.note || '']);

const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
// Local date as YYYY-MM-DD, built by hand: toLocaleDateString('en-CA') returns "11/10/2026" on Node builds without full
// locale data, which silently broke every date comparison (today's total, promo expiry, default dates)
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => localDay();

// Rs off for a promo code on `base` (subtotal after the manual discount); throws UserError when it doesn't apply
function promoAmount(code, base) {
  const p = db.prepare('SELECT * FROM promos WHERE code=?').get(String(code || '').trim().toUpperCase());
  if (!p || !p.active) throw new UserError('Promo code not valid');
  if (p.expires && p.expires < today()) throw new UserError('Promo code has expired');
  if (p.uses_limit && p.used >= p.uses_limit) throw new UserError('Promo code has been used up');
  if (base < (p.min_order || 0)) throw new UserError(`Promo needs an order of at least Rs ${p.min_order}`);
  let amount = p.type === 'percent' ? base * p.value / 100 : p.value;
  if (p.max_discount) amount = Math.min(amount, p.max_discount);
  return Math.round(Math.min(amount, base));
}

// Totals: subtotal − manual discount − promo − loyalty points, then tax on what is left
function recalc(orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  const subtotal = db.prepare('SELECT COALESCE(SUM(price*qty),0) s FROM order_items WHERE order_id=?').get(orderId).s;
  const discount = Math.min(o.discount || 0, subtotal);
  let promo = 0;
  if (o.promo_code) try { promo = promoAmount(o.promo_code, subtotal - discount); } catch { promo = 0; }
  const value = +getSettings().loyalty_value || 0;
  const pointsUsed = value ? Math.min(o.points_used || 0, Math.floor((subtotal - discount - promo) / value)) : 0; // never burn more than the bill
  const points = pointsUsed * value;
  const net = subtotal - discount - promo - points;
  const tax = Math.round(net * taxRate());
  const fee = o.type === 'delivery' ? deliveryFee(o.zone_id, subtotal) : 0; // delivery charge is added after tax
  db.prepare('UPDATE orders SET subtotal=?, discount=?, promo_amount=?, points_used=?, points_amount=?, tax=?, delivery_fee=?, total=? WHERE id=?')
    .run(subtotal, discount, promo, pointsUsed, points, tax, fee, net + tax + fee, orderId);
}
function deliveryFee(zoneId, subtotal) {
  const z = zoneId && db.prepare('SELECT * FROM delivery_zones WHERE id=?').get(zoneId);
  return !z || (z.free_above && subtotal >= z.free_above) ? 0 : z.fee;
}

// Phone numbers are stored as 03XXXXXXXXX so +92 / 92 / 0 forms match the same customer
const normPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('92') ? '0' + d.slice(2) : d; };
function upsertCustomer({ name, phone, address }) {
  const ph = normPhone(phone);
  if (ph.length < 10) return null;
  const c = db.prepare('SELECT id FROM customers WHERE phone=?').get(ph);
  if (!c) return db.prepare('INSERT INTO customers (name,phone,address,points,created_at) VALUES (?,?,?,0,?)').run(name || '', ph, address || '', now()).lastInsertRowid;
  db.prepare("UPDATE customers SET name=COALESCE(NULLIF(?,''),name), address=COALESCE(NULLIF(?,''),address) WHERE id=?").run(name || '', address || '', c.id);
  return c.id;
}

const moveStock = (ingredientId, qty, reason, ref, userName, note = '') => {
  db.prepare('UPDATE ingredients SET stock = stock + ? WHERE id=?').run(qty, ingredientId);
  db.prepare('INSERT INTO stock_moves (ingredient_id,qty,reason,ref,note,user_name,at) VALUES (?,?,?,?,?,?,?)').run(ingredientId, qty, reason, ref, note, userName, now());
};
// Recipe for this size, falling back to the product's all-sizes recipe
function recipeFor(productId, size) {
  const q = db.prepare('SELECT ingredient_id, qty FROM recipes WHERE product_id=? AND size=?');
  const lines = size ? q.all(productId, size) : [];
  return lines.length ? lines : q.all(productId, '');
}
// On payment: take the ingredients out of stock, spend redeemed points, count the promo use, award new points
function settle(o, userName) {
  for (const i of o.items) {
    // A deal without its own recipe uses the recipes of the items inside it
    const own = recipeFor(i.product_id, i.size);
    const lines = own.length ? own : dealIncludes(i.product_id).flatMap(d => recipeFor(d.product_id, d.size).map(r => ({ ...r, qty: r.qty * d.qty })));
    for (const r of lines) moveStock(r.ingredient_id, -r.qty * i.qty, 'sale', `order:${o.id}`, userName, i.name);
  }
  if (o.points_used) {
    const c = db.prepare('SELECT points FROM customers WHERE id=?').get(o.customer_id);
    if (!c || c.points < o.points_used) throw new UserError('Customer no longer has enough points');
    db.prepare('UPDATE customers SET points = points - ? WHERE id=?').run(o.points_used, o.customer_id);
  }
  if (o.promo_code && o.promo_amount > 0) {
    promoAmount(o.promo_code, o.subtotal - o.discount); // still valid (not used up meanwhile)?
    db.prepare('UPDATE promos SET used = used + 1 WHERE code=?').run(o.promo_code);
  }
  if (o.customer_id) {
    const earned = Math.floor((o.total - o.tax) / 100 * (+getSettings().loyalty_earn || 0));
    db.prepare('UPDATE customers SET points = points + ? WHERE id=?').run(earned, o.customer_id);
    db.prepare('UPDATE orders SET points_earned=? WHERE id=?').run(earned, o.id);
  }
}
const insertItem = (orderId, i) => db.prepare('INSERT INTO order_items (order_id,product_id,name,price,qty,note,sent,size,mods) VALUES (?,?,?,?,?,?,1,?,?)')
  .run(orderId, i.product_id, i.name, i.price, i.qty, i.note ?? '', i.size ?? null, JSON.stringify(i.mods || [])).lastInsertRowid;

// Prints the lines the kitchen hasn't seen. Returns a short status for the UI; never throws.
async function printKitchen(orderId, items, addOn) {
  const s = getSettings();
  if (!s.kitchen_printer || !items.length) return undefined;
  try { await printer.send(s.kitchen_printer, printer.kitchenTicket(getOrder(orderId), items, { addOn, s })); return 'ok'; }
  catch (e) { return e.message; }
}

app.get('/api/orders', (req, res) => {
  const { status } = req.query;
  const rows = status
    ? db.prepare('SELECT id FROM orders WHERE status=? ORDER BY id DESC LIMIT 200').all(status)
    : db.prepare("SELECT id FROM orders WHERE status != 'merged' ORDER BY id DESC LIMIT 200").all();
  res.json(rows.map(r => getOrder(r.id)));
});
app.get('/api/orders/:id', (req, res) => {
  const o = getOrder(req.params.id);
  o ? res.json(o) : res.status(404).json({ error: 'Not found' });
});

// Create/update an order
app.post('/api/orders', async (req, res) => {
  const { id, type, table_id, customer, phone, address } = req.body;
  let items, prev;
  try {
    items = (req.body.items || []).map(i => priceItem(i)).filter(i => i.qty > 0);
    prev = id && db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    if (id && !prev) throw new UserError('Order not found');
    if (prev && prev.status !== 'open') throw new UserError(`This order is already ${prev.status}`);
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = Math.min(subtotal, Math.max(0, Math.round(+req.body.discount || 0)));

  // Cashiers may give up to cashier_discount_limit % on their own; more needs an admin PIN
  const limit = (+getSettings().cashier_discount_limit || 0) / 100;
  if (req.user.role !== 'admin' && discount > (prev?.discount || 0) && discount > subtotal * limit) {
    const approver = req.body.approve_pin && userByPin(String(req.body.approve_pin));
    if (approver?.role !== 'admin')
      return res.status(403).json({ error: req.body.approve_pin ? 'That is not an admin PIN' : `Discounts over ${limit * 100}% need an admin PIN`, code: 'approval_needed' });
    audit(req, 'DISCOUNT APPROVED', 200, `Rs ${discount} on ${subtotal} approved by ${approver.name}`);
  }

  let customerId, promoCode = null, pointsUsed = Math.max(0, parseInt(req.body.points_used) || 0);
  try {
    customerId = upsertCustomer({ name: customer, phone, address });
    if (req.body.promo_code) { promoAmount(req.body.promo_code, subtotal - discount); promoCode = String(req.body.promo_code).trim().toUpperCase(); }
    if (type === 'delivery' && db.prepare('SELECT 1 FROM delivery_zones WHERE active=1').get()) {
      const z = db.prepare('SELECT * FROM delivery_zones WHERE id=? AND active=1').get(+req.body.zone_id || 0);
      if (!z) throw new UserError('Choose the delivery area');
      if (subtotal < z.min_order) throw new UserError(`Minimum order for ${z.name} is Rs ${z.min_order}`);
    }
    if (pointsUsed) {
      if (!customerId) throw new UserError("Enter the customer's phone number to use points");
      const have = db.prepare('SELECT points FROM customers WHERE id=?').get(customerId).points;
      if (have < pointsUsed) throw new UserError(`Customer has only ${have} points`);
    }
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const tax = Math.round((subtotal - discount) * taxRate());
  const total = subtotal - discount + tax;
  let orderId = id;
  const prevQty = {};
  if (orderId) {
    db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId)
      .forEach(r => { const k = lineKey({ ...r, mods: parseJSON(r.mods, []) }); prevQty[k] = (prevQty[k] || 0) + r.qty; });
    db.prepare('UPDATE orders SET type=?,table_id=?,customer=?,phone=?,address=?,subtotal=?,discount=?,tax=?,total=? WHERE id=?')
      .run(type, table_id ?? null, customer ?? '', phone ?? '', address ?? '', subtotal, discount, tax, total, orderId);
    db.prepare('DELETE FROM order_items WHERE order_id=?').run(orderId);
  } else {
    orderId = db.prepare('INSERT INTO orders (type,table_id,customer,phone,address,subtotal,discount,tax,total,created_at,user_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(type, table_id ?? null, customer ?? '', phone ?? '', address ?? '', subtotal, discount, tax, total, now(), req.user.name).lastInsertRowid;
  }
  items.forEach(i => insertItem(orderId, i));
  db.prepare('UPDATE orders SET customer_id=?, promo_code=?, points_used=?, zone_id=? WHERE id=?')
    .run(customerId, promoCode, pointsUsed, type === 'delivery' ? req.body.zone_id || null : null, orderId);
  recalc(orderId);

  // Only what was added since the last save goes to the kitchen
  const fresh = [];
  for (const i of items) {
    const k = lineKey(i), seen = Math.min(prevQty[k] || 0, i.qty);
    prevQty[k] = (prevQty[k] || 0) - seen;
    if (i.qty > seen) fresh.push({ ...i, qty: i.qty - seen });
  }
  if (fresh.length) db.prepare("UPDATE orders SET kitchen_status='new', kitchen_at=? WHERE id=?").run(now(), orderId);
  const kitchen_print = await printKitchen(orderId, fresh, !!prev);
  res.json({ ...getOrder(orderId), kitchen_print });
});

// Cash must land in a shift. With no open shift: start one with Rs 0 float, or refuse (Settings → Restaurant)
function ensureDrawer(userName) {
  const open = db.prepare("SELECT id FROM register_sessions WHERE status='open' ORDER BY id DESC LIMIT 1").get();
  if (open) return open.id;
  if (getSettings().closed_drawer_cash === 'refuse') throw new UserError('The cash drawer is closed. Open it under Cash Drawer first.');
  return db.prepare("INSERT INTO register_sessions (opened_at, opened_by, opening_cash, status, notes) VALUES (?,?,0,'open',?)")
    .run(now(), userName, 'Opened automatically for a cash payment').lastInsertRowid;
}

// Marks an open order paid: stock, points and promo are settled in the same transaction
function payOrder(o, method, paidRaw, userName) {
  if (!['cash', 'card', 'online'].includes(method)) throw new UserError('Choose a payment method');
  if (method === 'cash') ensureDrawer(userName);
  const paid = Math.max(o.total, +paidRaw || 0);
  tx(() => {
    settle(o, userName);
    db.prepare("UPDATE orders SET status='paid',payment_method=?,paid=?,change_=?,paid_at=? WHERE id=? AND status='open'")
      .run(method, paid, paid - o.total, now(), o.id);
  });
  afterPaid(o.id);
  // Dine-in / takeaway paid after the food was ready = handed over: off the counter's Food-ready strip
  if (o.type !== 'delivery') db.prepare("UPDATE orders SET kitchen_status='done' WHERE id=? AND kitchen_status='ready'").run(o.id);
}
const afterPaidHooks = [];
const afterPaid = id => afterPaidHooks.forEach(fn => { try { fn(id); } catch (e) { console.error('after-paid hook:', e.message); } });

app.post('/api/orders/:id/pay', async (req, res) => {
  const o = getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  if (o.status !== 'open') return res.status(400).json({ error: `This order is already ${o.status}` });
  const { method } = req.body;
  if (method === 'cash' && (+req.body.paid || 0) < o.total) return res.status(400).json({ error: 'Cash received is less than the total' });
  try { payOrder(o, method, req.body.paid, req.user.name); }
  catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    throw e;
  }
  if (fisc.enabled()) await fisc.submit(o.id).catch(() => {}); // fiscal number goes on the receipt; if offline it is retried later
  const done = getOrder(o.id), s = getSettings();
  let receipt_print;
  if (s.receipt_printer) {
    try { await printer.send(s.receipt_printer, printer.receipt(done, s, { openDrawer: method === 'cash' && s.open_drawer === '1' })); receipt_print = 'ok'; }
    catch (e) { receipt_print = e.message; }
  }
  res.json({ ...done, receipt_print });
});
app.post('/api/orders/:id/cancel', (req, res) => {
  db.prepare("UPDATE orders SET status='cancelled', kitchen_status='done' WHERE id=? AND status='open'").run(req.params.id);
  res.json({ ok: true });
});
// Refund a paid order. Cash refunds are paid out of the current shift's drawer. Stock and loyalty points are not reversed.
app.post('/api/orders/:id/refund', userErrors((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw new UserError('Order not found');
  if (o.status !== 'paid') throw new UserError(`Only paid orders can be refunded (this one is ${o.status})`);
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  if (!reason) throw new UserError('Write the reason for the refund');
  tx(() => {
    if (o.payment_method === 'cash') {
      const sid = ensureDrawer(req.user.name);
      db.prepare("INSERT INTO cash_moves (session_id, type, amount, reason, user_name, created_at) VALUES (?, 'out', ?, ?, ?, ?)")
        .run(sid, o.total, `Refund #${o.id}: ${reason}`, req.user.name, now());
    }
    db.prepare("UPDATE orders SET status='refunded', refunded_at=?, refunded_by=?, refund_reason=? WHERE id=?").run(now(), req.user.name, reason, o.id);
    db.prepare("DELETE FROM sync_log WHERE tbl='orders' AND local_id=?").run(o.id); // cloud gets the new status on the next sync
  });
  res.json(getOrder(o.id));
}));

// ---------- Tables: transfer, merge, split ----------
const openOrder = id => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!o) throw new UserError('Order not found');
  if (o.status !== 'open') throw new UserError(`Order #${o.id} is already ${o.status}`);
  return o;
};

// Move a bill to an empty table
app.post('/api/orders/:id/transfer', userErrors((req, res) => {
  const o = openOrder(req.params.id);
  const t = db.prepare('SELECT id FROM tables_ WHERE id=?').get(req.body.table_id);
  if (!t) throw new UserError('Table not found');
  if (db.prepare("SELECT id FROM orders WHERE table_id=? AND status='open' AND type='dine-in' AND id != ?").get(t.id, o.id))
    throw new UserError('That table already has a bill. Use merge instead.');
  db.prepare("UPDATE orders SET table_id=?, type='dine-in' WHERE id=?").run(t.id, o.id);
  res.json(getOrder(o.id));
}));

// Move every line of this bill into another open bill
app.post('/api/orders/:id/merge', userErrors((req, res) => {
  const from = openOrder(req.params.id), into = openOrder(req.body.into_id);
  if (from.id === into.id) throw new UserError('Pick a different bill');
  db.prepare('UPDATE order_items SET order_id=? WHERE order_id=?').run(into.id, from.id);
  db.prepare('UPDATE orders SET discount=? WHERE id=?').run((into.discount || 0) + (from.discount || 0), into.id);
  db.prepare("UPDATE orders SET status='merged', kitchen_status='done', subtotal=0, discount=0, tax=0, total=0 WHERE id=?").run(from.id);
  recalc(into.id);
  res.json(getOrder(into.id));
}));

// Move some lines (or part of a line's qty) to a new bill on the same table, e.g. to pay separately
app.post('/api/orders/:id/split', userErrors((req, res) => {
  const o = openOrder(req.params.id);
  const lines = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
  const moves = (req.body.items || []).map(m => ({ line: lines.find(l => l.id === +m.id), qty: parseInt(m.qty) || 0 }))
    .filter(m => m.line && m.qty > 0);
  if (!moves.length) throw new UserError('Choose items to move');
  if (moves.some(m => m.qty > m.line.qty)) throw new UserError('Cannot move more than ordered');
  const moved = moves.reduce((s, m) => s + m.qty, 0), all = lines.reduce((s, l) => s + l.qty, 0);
  if (moved >= all) throw new UserError('Leave at least one item on the original bill');

  const newId = db.prepare('INSERT INTO orders (type,table_id,customer,phone,address,subtotal,discount,tax,total,created_at,user_name,kitchen_status,kitchen_at) VALUES (?,?,?,?,?,0,0,0,0,?,?,?,?)')
    .run(o.type, o.table_id, o.customer, o.phone, o.address, now(), req.user.name, o.kitchen_status, o.kitchen_at).lastInsertRowid;
  for (const { line, qty } of moves) {
    if (qty === line.qty) db.prepare('UPDATE order_items SET order_id=? WHERE id=?').run(newId, line.id);
    else {
      db.prepare('UPDATE order_items SET qty=qty-? WHERE id=?').run(qty, line.id);
      insertItem(newId, { ...line, qty, mods: parseJSON(line.mods, []) });
    }
  }
  recalc(o.id); recalc(newId);
  res.json(getOrder(newId));
}));

// ---------- Delivery: zones, dispatch, rider cash ----------
app.get('/api/delivery-zones', (req, res) => res.json(db.prepare('SELECT * FROM delivery_zones ORDER BY active DESC, name').all()));
crud('delivery-zones', 'delivery_zones', ['name', 'fee', 'min_order', 'free_above', 'eta_min', 'active']);

// Riders are staff whose job contains "rider" (the Riders section adds them with a per-delivery fee). cash_due = unpaid
// (COD) orders they have delivered: still on the way does not count. A rider's phone screen lives on the cloud
// (rider-sync.js); its link holds a secret, so only the admin gets the link.
const { onTheWayMessage, statusMessage, readyPickupMessage } = require('./whatsapp/messages');
const newToken = () => crypto.randomBytes(16).toString('hex');
const cloudBase = () => cloud.status().connected ? cloud.status().url.replace(/\/+$/, '') : null;
const riderLink = e => e.rider_token && cloudBase() ? `${cloudBase()}/r/${e.rider_token}` : null;
const trackUrl = o => o.track_token && cloudBase() ? `${cloudBase()}/track/${o.track_token}` : null;
const RIDER_COLS = `e.id, e.name, e.phone, e.active, COALESCE(e.delivery_fee,0) delivery_fee, e.rider_token,
      (SELECT COUNT(*) FROM orders o WHERE o.rider_id=e.id AND o.delivery_status='out') on_road,
      (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.rider_id=e.id AND o.status='open' AND o.delivery_status='delivered') cash_due,
      (SELECT COUNT(*) FROM orders o WHERE o.rider_id=e.id AND o.status='open' AND o.delivery_status='delivered') cod_orders,
      (SELECT COUNT(*) FROM orders o WHERE o.rider_id=e.id AND o.delivery_status='delivered' AND date(o.delivered_at,'localtime')=date('now','localtime')) delivered_today`;
const riderRows = (where, admin) => {
  const pos = riderSync.positions();
  return db.prepare(`SELECT ${RIDER_COLS}, (SELECT COUNT(*) FROM users u WHERE u.employee_id=e.id AND u.role='rider') has_login
      FROM employees e WHERE lower(e.job) LIKE '%rider%' AND ${where} ORDER BY e.active DESC, e.name`).all()
    .map(e => ({ ...e, has_login: !!e.has_login, link: admin ? riderLink(e) : undefined, rider_token: undefined, ...(pos[e.id] || {}) }));
};
// A rider's own login (role rider): made or changed from the Riders section; gone when they stop working here
function setRiderLogin(employeeId, name, pin, active) {
  const u = db.prepare("SELECT id FROM users WHERE employee_id=? AND role='rider'").get(employeeId);
  if (!active) { if (u) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); db.prepare('DELETE FROM users WHERE id=?').run(u.id); } return; }
  if (pin) {
    if (!PIN_OK(pin)) throw new UserError(PIN_RULE);
    if (PIN_WEAK(pin)) throw new UserError(PIN_WEAK_MSG);
    const taken = userByPin(String(pin));
    if (taken && taken.id !== u?.id) throw new UserError('That PIN is already used by someone else');
  }
  if (u) {
    db.prepare('UPDATE users SET name=? WHERE id=?').run(name, u.id);
    if (pin) { vaultPin(u.id, pin); db.prepare('UPDATE users SET pin=?, must_change_pin=0 WHERE id=?').run(hashPin(String(pin)), u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); }
  } else if (pin) vaultPin(db.prepare('INSERT INTO users (name,pin,role,employee_id) VALUES (?,?,?,?)').run(name, hashPin(String(pin)), 'rider', employeeId).lastInsertRowid, pin);
}
app.get('/api/riders', (req, res) => res.json(riderRows(req.query.all ? '1' : 'e.active=1', req.user.role === 'admin')));
// Where every rider is (from their phones, through the cloud), for the map
app.get('/api/riders/positions', (req, res) => {
  res.json({ cloud: !!cloudBase(), ...riderSync.status(), riders: riderRows('e.active=1', false).map(r => ({ id: r.id, name: r.name, on_road: r.on_road, lat: r.lat, lng: r.lng, acc: r.acc, at: r.at, on_duty: r.on_duty })) });
});
app.post('/api/riders/sync', async (req, res) => res.json(await riderSync.tick()));
// Add or edit a rider (admin). The first save makes the secret for their phone link.
app.post('/api/riders', userErrors((req, res) => {
  const { id, name, phone, delivery_fee, active } = req.body;
  if (!String(name || '').trim()) throw new UserError('Name is required');
  const fee = Math.max(0, Math.round(+delivery_fee || 0)), on = active === false || active === 0 || active === '0' ? 0 : 1;
  let rid = id;
  tx(() => {
    if (id) {
      if (!db.prepare("SELECT 1 FROM employees WHERE id=? AND lower(job) LIKE '%rider%'").get(id)) throw new UserError('Rider not found');
      db.prepare('UPDATE employees SET name=?, phone=?, delivery_fee=?, active=?, rider_token=COALESCE(rider_token, ?) WHERE id=?').run(name.trim(), String(phone || '').trim(), fee, on, newToken(), id);
    } else {
      rid = db.prepare('INSERT INTO employees (name,phone,job,salary,active,joined,delivery_fee,rider_token) VALUES (?,?,?,?,?,?,?,?)')
        .run(name.trim(), String(phone || '').trim(), 'Rider', 0, 1, today(), fee, newToken()).lastInsertRowid;
    }
    setRiderLogin(+rid, name.trim(), req.body.pin, on);
  });
  riderSync.poke();
  res.json(riderRows('e.id=' + (Math.trunc(+rid) || 0), true)[0]);
}));
// A new link for this rider's phone; the old one stops working at the next sync
app.post('/api/riders/:id/link', userErrors((req, res) => {
  if (!db.prepare("SELECT 1 FROM employees WHERE id=? AND lower(job) LIKE '%rider%'").get(req.params.id)) throw new UserError('Rider not found');
  db.prepare('UPDATE employees SET rider_token=? WHERE id=?').run(newToken(), req.params.id);
  riderSync.poke();
  res.json(riderRows('e.id=' + (Math.trunc(+req.params.id) || 0), true)[0]);
}));
// Send the rider their link from the restaurant's WhatsApp
app.post('/api/riders/:id/send-link', userErrors(async (req, res) => {
  const r = riderRows('e.id=' + (Math.trunc(+req.params.id) || 0), true)[0];
  if (!r) throw new UserError('Rider not found');
  if (!r.link) throw new UserError('Connect the cloud first (Settings → Cloud): the rider screen runs there');
  const jid = lowStock.toJid(r.phone);
  if (!jid) throw new UserError("Add the rider's WhatsApp number first");
  if (!waModule.wa.isConnected()) throw new UserError('WhatsApp is not connected (Settings → WhatsApp bot)');
  await waModule.wa.send(jid, `Salam ${r.name}! ${getSettings().name} ka rider screen: ${r.link}\n\nIsay phone par kholein aur browser ke menu se "Add to Home screen" karein. Delivery ke waqt yeh screen khuli rakhein.`, 'Rider link', 'system');
  res.json({ ok: true });
}));
// ---------- The rider's own screen (role rider, client/src/RiderHome.jsx) ----------
// Same actions as the rider page on the cloud (rider-sync.js), for a rider logged in to the POS itself.
const riderMe = req => {
  const e = req.user.employee_id && db.prepare("SELECT * FROM employees WHERE id=? AND active=1 AND lower(job) LIKE '%rider%'").get(req.user.employee_id);
  if (!e) throw new UserError('This login is not linked to a rider. Ask the owner (Riders section)');
  return e;
};
const riderOrder = (o, mine) => ({ id: o.id, status: o.delivery_status || (['ready', 'done'].includes(o.kitchen_status) ? 'ready' : 'cooking'), customer: o.customer, address: o.address,
  zone: o.zone, total: o.total, cod: o.status !== 'paid', items: o.items.map(i => `${i.qty}× ${i.name}`).join(', '), created_at: o.created_at, dispatched_at: o.dispatched_at,
  delivered_at: o.delivered_at, phone: mine ? o.phone : undefined, track_url: mine ? o.track_url : undefined });
app.get('/api/rider/board', userErrors((req, res) => {
  const e = riderMe(req), month = today().slice(0, 7);
  const orders = db.prepare(`SELECT id FROM orders WHERE type='delivery' AND status NOT IN ('cancelled','merged')
    AND (status='open' OR delivery_status='out' OR date(COALESCE(delivered_at, paid_at, created_at),'localtime') = date('now','localtime')) ORDER BY id`).all().map(r => getOrder(r.id));
  const mine = orders.filter(o => o.rider_id === e.id && o.delivery_status === 'out').map(o => riderOrder(o, true));
  const ready = orders.filter(o => !o.delivery_status && o.status !== 'cancelled').map(o => riderOrder(o, false));
  const doneToday = orders.filter(o => o.rider_id === e.id && o.delivery_status === 'delivered');
  const M = "rider_id=? AND delivery_status='delivered' AND strftime('%Y-%m', delivered_at, 'localtime')=?";
  const m = db.prepare(`SELECT COUNT(*) deliveries, COALESCE(SUM(rider_fee),0) earned FROM orders WHERE ${M}`).get(e.id, month);
  const paid = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payroll WHERE employee_id=? AND month=? AND type='delivery'").get(e.id, month).s;
  const pos = riderSync.positions()[e.id] || {};
  res.json({
    me: { id: e.id, name: e.name, fee: e.delivery_fee || 0, on_duty: !!pos.on_duty, at: pos.at || null },
    mine, ready, others_out: orders.filter(o => o.delivery_status === 'out' && o.rider_id !== e.id).length,
    today: { delivered: doneToday.length, earned: doneToday.reduce((s, o) => s + (o.rider_fee || 0), 0) },
    cash_with_me: db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE rider_id=? AND status='open' AND delivery_status='delivered'").get(e.id).s,
    month: { ...m, paid, owed: m.earned - paid },
    phone_link: riderLink(e), // their own cloud page: shares location when this screen is opened over plain http (no GPS there)
  });
}));
app.post('/api/rider/accept', userErrors((req, res) => res.json(riderOrder(dispatchOrder(+req.body.order, riderMe(req).id, { byRider: true }), true))));
app.post('/api/rider/delivered', userErrors((req, res) => res.json(riderOrder(deliverOrder(+req.body.order, { riderId: riderMe(req).id }), true))));
app.post('/api/rider/location', userErrors((req, res) => {
  const lat = +req.body.lat, lng = +req.body.lng;
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new UserError('Bad position');
  riderSync.setLocal(riderMe(req).id, { lat, lng, acc: Math.min(9999, Math.max(0, +req.body.acc || 0)), on_duty: true });
  res.json({ ok: true });
}));
app.post('/api/rider/duty', userErrors((req, res) => {
  const e = riderMe(req), cur = riderSync.positions()[e.id] || {};
  riderSync.setLocal(e.id, { lat: cur.lat ?? null, lng: cur.lng ?? null, acc: cur.acc ?? null, on_duty: !!req.body.on });
  res.json({ ok: true, on_duty: !!req.body.on });
}));

// Board: everything not yet delivered, plus today's delivered orders
app.get('/api/deliveries', (req, res) => {
  res.json(db.prepare(`SELECT id FROM orders WHERE type='delivery' AND status != 'cancelled' AND status != 'merged'
      AND (status='open' OR delivery_status='out' OR date(COALESCE(delivered_at, paid_at, created_at),'localtime') = date('now','localtime'))
    ORDER BY id`).all().map(r => getOrder(r.id)));
});
// Out with a rider: from the Delivery board, or the rider pressed Accept on their phone (byRider, via rider-sync.js)
function dispatchOrder(orderId, riderId, { byRider = false } = {}) {
  const o = getOrder(orderId);
  if (!o || o.type !== 'delivery' || !['open', 'paid'].includes(o.status)) throw new UserError('Delivery order not found');
  if (o.delivery_status === 'delivered') throw new UserError('Already delivered');
  if (byRider && o.delivery_status === 'out') throw new UserError(o.rider_id === +riderId ? 'Already yours' : `Already taken by ${o.rider?.name || 'another rider'}`);
  if (byRider && !['ready', 'done'].includes(o.kitchen_status)) throw new UserError('Not ready yet: the kitchen is still making it');
  const r = db.prepare("SELECT id, name, COALESCE(delivery_fee,0) delivery_fee FROM employees WHERE id=? AND active=1 AND lower(job) LIKE '%rider%'").get(riderId);
  if (!r) throw new UserError('Choose a rider');
  // Food was ready: the ticket leaves the kitchen board. Sent early (still cooking): it stays, so the kitchen still makes it.
  db.prepare(`UPDATE orders SET rider_id=?, rider_fee=?, delivery_status='out', dispatched_at=?, accepted_by_rider=?, track_token=COALESCE(track_token, ?),
    kitchen_status = CASE WHEN kitchen_status='ready' THEN 'done' ELSE kitchen_status END WHERE id=?`).run(r.id, r.delivery_fee, now(), byRider ? 1 : 0, newToken(), o.id);
  riderSync.poke();
  notifyOnTheWay(o.id, r.name);
  return getOrder(o.id);
}
function deliverOrder(orderId, { riderId = null } = {}) {
  const o = db.prepare("SELECT * FROM orders WHERE id=? AND delivery_status='out'").get(orderId);
  if (!o) throw new UserError('This order is not out for delivery');
  if (riderId && o.rider_id !== +riderId) throw new UserError('This order is with another rider');
  db.prepare("UPDATE orders SET delivery_status='delivered', delivered_at=? WHERE id=?").run(now(), o.id);
  riderSync.poke();
  return getOrder(o.id);
}
// A WhatsApp takeaway customer hears their order is ready to collect
// An order the cloud WhatsApp bot took: its chat is on the cloud, so the message goes out from there
function waNotify(w, text, what) {
  const sent = w.cloud_id ? cloud.call('/api/sync/wa-send', { chat_id: w.chat_id, text })
    : waModule.wa.isConnected() ? waModule.wa.send(w.chat_id, text, 'Order update', 'system') : null;
  sent?.catch(e => console.error(`${what} message:`, e.message));
}
function notifyReadyForPickup(orderId) {
  const w = waModule?.store.chatForOrder(orderId);
  if (w) waNotify(w, readyPickupMessage({ id: orderId }, w.lang, getSettings().name), 'Ready');
}
// A WhatsApp customer hears that their order left, with the live-tracking link when the cloud is connected
function notifyOnTheWay(orderId, riderName) {
  const w = waModule?.store.chatForOrder(orderId);
  if (!w) return;
  const o = getOrder(orderId);
  waNotify(w, onTheWayMessage(o, w.lang, riderName, trackUrl(o)), 'On-the-way');
}
// "Where is my order?" on WhatsApp: this chat's delivery order of today, as text (null = nothing to say, the AI answers)
function deliveryStatus(chatId, lang) {
  const w = waModule.store.ordersFor(chatId).find(x => x.order_id && x.status === 'accepted');
  const o = w && getOrder(w.order_id);
  if (!o || o.type !== 'delivery' || o.status === 'cancelled' || localDay(new Date(o.created_at)) !== today()) return null;
  const mins = iso => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (o.delivery_status === 'delivered') return statusMessage(o, w.lang || lang, 'delivered', o.rider?.name, mins(o.delivered_at));
  if (o.delivery_status === 'out') return statusMessage(o, w.lang || lang, 'out', o.rider?.name, mins(o.dispatched_at), trackUrl(o));
  return statusMessage(o, w.lang || lang, ['ready', 'done'].includes(o.kitchen_status) ? 'ready' : 'cooking');
}
app.post('/api/orders/:id/dispatch', userErrors((req, res) => res.json(dispatchOrder(req.params.id, req.body.rider_id))));
app.post('/api/orders/:id/delivered', userErrors((req, res) => res.json(deliverOrder(req.params.id))));
// Rider hands over the cash: their delivered COD orders (or just order_ids) are paid in cash. Orders still on the way are never included.
app.post('/api/riders/:id/settle', userErrors((req, res) => {
  const ids = (req.body.order_ids || []).map(Number);
  const orders = db.prepare("SELECT id FROM orders WHERE rider_id=? AND status='open' AND delivery_status='delivered'").all(req.params.id)
    .filter(o => !ids.length || ids.includes(o.id));
  if (!orders.length) throw new UserError('Nothing to settle');
  let total = 0;
  for (const { id } of orders) {
    const o = getOrder(id);
    payOrder(o, 'cash', o.total, req.user.name);
    total += o.total;
  }
  riderSync.poke();
  res.json({ ok: true, orders: orders.length, total });
}));
// Rider accounts for a month (admin): deliveries, what they earned (fee per delivery, as it was at the time), what was
// paid out, the COD cash they collected and handed in, and what is still in their pocket right now.
app.get('/api/riders/accounts', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : today().slice(0, 7);
  const M = "o.rider_id=e.id AND o.delivery_status='delivered' AND strftime('%Y-%m', o.delivered_at, 'localtime')=?";
  const riders = db.prepare(`SELECT e.id, e.name, e.phone, e.active, COALESCE(e.delivery_fee,0) delivery_fee,
      (SELECT COUNT(*) FROM orders o WHERE ${M}) deliveries,
      (SELECT COALESCE(SUM(o.rider_fee),0) FROM orders o WHERE ${M}) earned,
      (SELECT COALESCE(ROUND(AVG((julianday(o.delivered_at)-julianday(o.dispatched_at))*1440)),0) FROM orders o WHERE ${M} AND o.dispatched_at IS NOT NULL) avg_minutes,
      (SELECT COUNT(*) FROM orders o WHERE ${M} AND (julianday(o.delivered_at)-julianday(o.dispatched_at))*1440 > 45) late,
      (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE ${M} AND (o.status='open' OR o.paid_at > o.dispatched_at)) cash_collected,
      (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE ${M} AND o.status='paid' AND o.paid_at > o.dispatched_at) handed_in,
      (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.rider_id=e.id AND o.status='open' AND o.delivery_status='delivered') with_rider,
      (SELECT COALESCE(SUM(p.amount),0) FROM payroll p WHERE p.employee_id=e.id AND p.month=? AND p.type='delivery') paid
    FROM employees e WHERE lower(e.job) LIKE '%rider%' ORDER BY e.active DESC, e.name`).all(month, month, month, month, month, month, month)
    .filter(r => r.active || r.deliveries || r.paid).map(r => ({ ...r, owed: r.earned - r.paid }));
  const payments = db.prepare(`SELECT p.*, e.name FROM payroll p JOIN employees e ON e.id=p.employee_id WHERE p.type='delivery' AND p.month=? ORDER BY p.id DESC`).all(month);
  res.json({ month, riders, payments });
});
// Pay a rider their delivery fees (goes to Expenses under Salaries, like a salary payment)
app.post('/api/riders/:id/pay', userErrors((req, res) => {
  const e = db.prepare("SELECT * FROM employees WHERE id=? AND lower(job) LIKE '%rider%'").get(req.params.id);
  if (!e) throw new UserError('Rider not found');
  const amount = Math.round(+req.body.amount || 0);
  if (amount <= 0) throw new UserError('Enter the amount');
  const date = req.body.date || today(), month = /^\d{4}-\d{2}$/.test(req.body.month || '') ? req.body.month : date.slice(0, 7);
  tx(() => {
    const id = db.prepare('INSERT INTO payroll (employee_id,month,date,type,amount,note,user_name,at) VALUES (?,?,?,?,?,?,?,?)')
      .run(e.id, month, date, 'delivery', amount, String(req.body.note || ''), req.user.name, now()).lastInsertRowid;
    addExpense(`Delivery fees — ${e.name} (${month})`, 'Salaries', amount, req.body.method || 'cash', date, req.user.name, `payroll:${id}`);
  });
  res.json({ ok: true });
}));

// ---------- Printing ----------
app.post('/api/print/receipt/:id', async (req, res) => {
  const o = getOrder(req.params.id), s = getSettings();
  if (!o) return res.status(404).json({ error: 'Not found' });
  try { await printer.send(s.receipt_printer, printer.receipt(o, s)); res.json({ ok: true }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/print/kitchen/:id', async (req, res) => {
  const o = getOrder(req.params.id), s = getSettings();
  if (!o) return res.status(404).json({ error: 'Not found' });
  try { await printer.send(s.kitchen_printer, printer.kitchenTicket(o, o.items, { s })); res.json({ ok: true }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/print/test', async (req, res) => {
  try { await printer.send(req.body.target, printer.testPage(getSettings())); res.json({ ok: true }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- Kitchen display ----------
app.get('/api/kitchen', (req, res) => {
  const rows = db.prepare(`SELECT o.id FROM orders o WHERE o.kitchen_status IN ('new','preparing','ready')
    AND o.status NOT IN ('cancelled', 'merged') ORDER BY o.kitchen_at`).all();
  res.json(rows.map(r => getOrder(r.id)));
});
// After Ready, each order type goes its own way:
//   dine-in  -> the counter is told "Table 5: food ready"; whoever serves presses Served (done)
//   takeaway -> the counter is told; a WhatsApp customer gets "ready to pick up"; Picked up or paying clears it
//   delivery -> riders are told (rider-sync); it leaves the kitchen when a rider takes it (dispatchOrder)
app.post('/api/kitchen/:id', (req, res) => {
  const s = req.body.status;
  if (!['new', 'preparing', 'ready', 'done'].includes(s)) return res.status(400).json({ error: 'bad status' });
  const before = db.prepare('SELECT id, type, kitchen_status FROM orders WHERE id=?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Order not found' });
  db.prepare("UPDATE orders SET kitchen_status=?, ready_at=CASE WHEN ?='ready' THEN ? ELSE ready_at END WHERE id=?").run(s, s, now(), before.id);
  if (s === 'ready' && before.kitchen_status !== 'ready') {
    if (before.type === 'delivery') riderSync.poke(); // riders' phones beep within seconds
    if (before.type === 'takeaway') notifyReadyForPickup(before.id);
  }
  res.json({ ok: true });
});

// ---------- Cash Register Sessions & Shift Closing (Z-Report) ----------
function getSessionSummary(session) {
  if (!session) return null;
  const opened = session.opened_at;
  const closed = session.closed_at || now();

  // Cash sales in this session
  const cashSales = db.prepare(`SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM orders
    WHERE status IN ('paid','refunded') AND payment_method='cash' AND paid_at >= ? AND paid_at <= ?`).get(opened, closed); // a refund is a separate cash-out

  // Card & Online sales in this session
  const otherSales = db.prepare(`SELECT payment_method m, COALESCE(SUM(total),0) s, COUNT(*) c FROM orders
    WHERE status IN ('paid','refunded') AND payment_method != 'cash' AND paid_at >= ? AND paid_at <= ? GROUP BY m`).all(opened, closed);

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
  const { opening_cash = 0 } = req.body;
  const openExists = db.prepare(`SELECT id FROM register_sessions WHERE status='open'`).get();
  if (openExists) return res.status(400).json({ error: 'A register session is already open' });

  const id = db.prepare(`INSERT INTO register_sessions (opened_at, opened_by, opening_cash, status) VALUES (?,?,?,?)`)
    .run(now(), req.user.name, +opening_cash, 'open').lastInsertRowid;
  res.json(getSessionSummary(db.prepare(`SELECT * FROM register_sessions WHERE id=?`).get(id)));
});

app.post('/api/register/close', (req, res) => {
  const sess = db.prepare(`SELECT * FROM register_sessions WHERE status='open' ORDER BY id DESC LIMIT 1`).get();
  if (!sess) return res.status(400).json({ error: 'No open register session found' });

  const summary = getSessionSummary(sess);
  const closing_cash = +req.body.closing_cash || 0;
  const difference = closing_cash - summary.expectedCash;
  const closed_by = req.user.name;
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
  const { type, amount, reason } = req.body;
  if (!['in', 'out'].includes(type) || !amount) return res.status(400).json({ error: 'Invalid cash movement' });

  db.prepare(`INSERT INTO cash_moves (session_id, type, amount, reason, user_name, created_at) VALUES (?,?,?,?,?,?)`)
    .run(sess.id, type, +amount, reason || '', req.user.name, now());

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
  const today = localDay();
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

// ---------- Inventory: ingredients, recipes, stock ----------
app.get('/api/ingredients', (req, res) => res.json(db.prepare('SELECT *, stock <= low_level AS low FROM ingredients ORDER BY name').all()));
app.post('/api/ingredients/:id/delete', (req, res, next) => { db.prepare('DELETE FROM recipes WHERE ingredient_id=?').run(req.params.id); next(); });
crud('ingredients', 'ingredients', ['name', 'unit', 'low_level', 'cost']); // stock only changes through stock moves
app.get('/api/inventory/low', (req, res) => res.json(db.prepare('SELECT id, name, unit, stock, low_level FROM ingredients WHERE stock <= low_level ORDER BY name').all()));

// waste / correction (signed qty) or a physical count (sets stock to the counted amount)
app.post('/api/stock/adjust', userErrors((req, res) => {
  const ing = db.prepare('SELECT * FROM ingredients WHERE id=?').get(req.body.ingredient_id);
  if (!ing) throw new UserError('Ingredient not found');
  const reason = ['waste', 'adjust', 'count'].includes(req.body.reason) ? req.body.reason : 'adjust';
  const qty = reason === 'count' ? (+req.body.qty || 0) - ing.stock : reason === 'waste' ? -Math.abs(+req.body.qty || 0) : +req.body.qty || 0;
  if (!qty) throw new UserError('Nothing to change');
  moveStock(ing.id, qty, reason, '', req.user.name, String(req.body.note || ''));
  res.json(db.prepare('SELECT * FROM ingredients WHERE id=?').get(ing.id));
}));
app.get('/api/stock/moves', (req, res) => {
  res.json(db.prepare(`SELECT m.*, i.name ingredient, i.unit FROM stock_moves m JOIN ingredients i ON i.id = m.ingredient_id
    ${req.query.ingredient_id ? 'WHERE m.ingredient_id = ?' : ''} ORDER BY m.id DESC LIMIT 300`).all(...(req.query.ingredient_id ? [req.query.ingredient_id] : [])));
});

// Recipe lines per product and size ('' = every size), with food cost so the margin is visible
app.get('/api/recipes/:productId', (req, res) => {
  res.json(db.prepare(`SELECT r.size, r.ingredient_id, r.qty, i.name, i.unit, i.cost, r.qty * i.cost line_cost
    FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id=? ORDER BY r.size, i.name`).all(req.params.productId));
});
app.post('/api/recipes/:productId', (req, res) => {
  const size = String(req.body.size || '');
  tx(() => {
    db.prepare('DELETE FROM recipes WHERE product_id=? AND size=?').run(req.params.productId, size);
    for (const l of req.body.lines || []) if (+l.qty > 0)
      db.prepare('INSERT INTO recipes (product_id,size,ingredient_id,qty) VALUES (?,?,?,?)').run(req.params.productId, size, l.ingredient_id, +l.qty);
  });
  res.json({ ok: true });
});

// ---------- Suppliers & khata ----------
// Balance = purchases − payments (what we still owe them)
app.get('/api/suppliers', (req, res) => {
  res.json(db.prepare(`SELECT s.*, COALESCE(SUM(CASE l.type WHEN 'purchase' THEN l.amount ELSE -l.amount END), 0) balance
    FROM suppliers s LEFT JOIN supplier_ledger l ON l.supplier_id = s.id GROUP BY s.id ORDER BY s.name`).all());
});
app.post('/api/suppliers/:id/delete', (req, res, next) => {
  if (db.prepare('SELECT 1 FROM supplier_ledger WHERE supplier_id=?').get(req.params.id)) return res.status(400).json({ error: 'This supplier has khata entries; delete those first' });
  next();
});
crud('suppliers', 'suppliers', ['name', 'phone', 'note']);
app.get('/api/suppliers/:id/ledger', (req, res) => {
  res.json(db.prepare('SELECT * FROM supplier_ledger WHERE supplier_id=? ORDER BY date, id').all(req.params.id));
});
const addExpense = (title, category, amount, method, date, userName, ref) => db.prepare(
  'INSERT INTO expenses (title,category,amount,payment_method,date,user_name,ref) VALUES (?,?,?,?,?,?,?)').run(title, category, amount, method, date, userName, ref);
const ledgerEntry = (supplierId, type, amount, date, note, userName) => db.prepare(
  'INSERT INTO supplier_ledger (supplier_id,date,type,amount,note,user_name,at) VALUES (?,?,?,?,?,?,?)').run(supplierId, date, type, amount, note, userName, now()).lastInsertRowid;
function supplierPayment(sup, amount, date, method, note, userName) {
  const id = ledgerEntry(sup.id, 'payment', amount, date, note, userName);
  addExpense(`Payment to ${sup.name}`, 'Ingredients', amount, method, date, userName, `ledger:${id}`); // counts in expenses / net profit
}
// A purchase on credit: stock goes up, the khata balance goes up; anything paid now is a payment entry
app.post('/api/suppliers/:id/purchase', userErrors((req, res) => {
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(req.params.id);
  if (!sup) throw new UserError('Supplier not found');
  const date = req.body.date || today(), lines = (req.body.items || []).filter(l => +l.qty > 0);
  for (const l of lines) if (!db.prepare('SELECT 1 FROM ingredients WHERE id=?').get(+l.ingredient_id || 0))
    throw new UserError('Pick an ingredient for every item line. No ingredients yet? Add them under Inventory → Stock, or enter just the bill amount.');
  const total = lines.length ? lines.reduce((s, l) => s + (+l.cost || 0), 0) : +req.body.amount || 0;
  if (total <= 0) throw new UserError('Enter the bill amount');
  const paid = Math.min(total, Math.max(0, +req.body.paid || 0));
  tx(() => {
    const names = lines.map(l => `${l.qty} ${db.prepare('SELECT name FROM ingredients WHERE id=?').get(l.ingredient_id)?.name}`).join(', ');
    const id = ledgerEntry(sup.id, 'purchase', total, date, [req.body.note, names].filter(Boolean).join(' · '), req.user.name);
    for (const l of lines) {
      moveStock(l.ingredient_id, +l.qty, 'purchase', `ledger:${id}`, req.user.name, sup.name);
      if (+l.cost) db.prepare('UPDATE ingredients SET cost=? WHERE id=?').run(+l.cost / +l.qty, l.ingredient_id); // latest cost per unit
    }
    if (paid) supplierPayment(sup, paid, date, req.body.method || 'cash', 'Paid with purchase', req.user.name);
  });
  res.json({ ok: true });
}));
app.post('/api/suppliers/:id/payment', userErrors((req, res) => {
  const sup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(req.params.id);
  if (!sup) throw new UserError('Supplier not found');
  if (!(+req.body.amount > 0)) throw new UserError('Enter the amount paid');
  tx(() => supplierPayment(sup, +req.body.amount, req.body.date || today(), req.body.method || 'cash', String(req.body.note || ''), req.user.name));
  res.json({ ok: true });
}));
// Undo a khata entry together with the stock and expense it created
app.post('/api/supplier-ledger/:id/delete', (req, res) => {
  const ref = `ledger:${+req.params.id}`;
  tx(() => {
    for (const m of db.prepare('SELECT * FROM stock_moves WHERE ref=?').all(ref)) db.prepare('UPDATE ingredients SET stock = stock - ? WHERE id=?').run(m.qty, m.ingredient_id);
    db.prepare('DELETE FROM stock_moves WHERE ref=?').run(ref);
    db.prepare('DELETE FROM expenses WHERE ref=?').run(ref);
    db.prepare('DELETE FROM supplier_ledger WHERE id=?').run(req.params.id);
  });
  res.json({ ok: true });
});

// ---------- Staff salaries & advances ----------
// Per employee for a month: salary − advances − salary already paid = still to pay
app.get('/api/employees', (req, res) => {
  const month = req.query.month || today().slice(0, 7);
  res.json(db.prepare(`SELECT e.*,
      COALESCE((SELECT SUM(amount) FROM payroll p WHERE p.employee_id=e.id AND p.month=? AND p.type='advance'), 0) advances,
      COALESCE((SELECT SUM(amount) FROM payroll p WHERE p.employee_id=e.id AND p.month=? AND p.type='salary'), 0) paid
    FROM employees e ORDER BY e.active DESC, e.name`).all(month, month).map(e => ({ ...e, due: e.salary - e.advances - e.paid })));
});
app.post('/api/employees/:id/delete', (req, res, next) => {
  if (db.prepare('SELECT 1 FROM payroll WHERE employee_id=?').get(req.params.id)) return res.status(400).json({ error: 'This person has salary records; mark them inactive instead' });
  next();
});
crud('employees', 'employees', ['name', 'phone', 'job', 'salary', 'active', 'joined']);
app.get('/api/payroll', (req, res) => {
  res.json(db.prepare(`SELECT p.*, e.name FROM payroll p JOIN employees e ON e.id = p.employee_id
    ${req.query.employee_id ? 'WHERE p.employee_id=?' : ''} ORDER BY p.date DESC, p.id DESC LIMIT 300`).all(...(req.query.employee_id ? [req.query.employee_id] : [])));
});
app.post('/api/payroll', userErrors((req, res) => {
  const e = db.prepare('SELECT * FROM employees WHERE id=?').get(req.body.employee_id);
  if (!e) throw new UserError('Employee not found');
  const type = req.body.type === 'advance' ? 'advance' : 'salary', amount = +req.body.amount || 0;
  if (amount <= 0) throw new UserError('Enter the amount');
  const date = req.body.date || today(), month = /^\d{4}-\d{2}$/.test(req.body.month) ? req.body.month : date.slice(0, 7);
  tx(() => {
    const id = db.prepare('INSERT INTO payroll (employee_id,month,date,type,amount,note,user_name,at) VALUES (?,?,?,?,?,?,?,?)')
      .run(e.id, month, date, type, amount, String(req.body.note || ''), req.user.name, now()).lastInsertRowid;
    addExpense(`${type === 'advance' ? 'Advance' : 'Salary'} — ${e.name} (${month})`, 'Salaries', amount, req.body.method || 'cash', date, req.user.name, `payroll:${id}`);
  });
  res.json({ ok: true });
}));
app.post('/api/payroll/:id/delete', (req, res) => {
  tx(() => {
    db.prepare('DELETE FROM expenses WHERE ref=?').run(`payroll:${+req.params.id}`);
    db.prepare('DELETE FROM payroll WHERE id=?').run(req.params.id);
  });
  res.json({ ok: true });
});

// ---------- Customers, loyalty & promo codes ----------
app.get('/api/customers', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT c.*, COUNT(o.id) visits, COALESCE(SUM(o.total), 0) spent, MAX(o.paid_at) last_visit
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
    WHERE c.name LIKE ? OR c.phone LIKE ? GROUP BY c.id ORDER BY last_visit DESC NULLS LAST, c.id DESC LIMIT 300`).all(q, q));
});
// Register: type a phone number, get the regular's name, address and points
app.get('/api/customers/lookup', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE phone=?').get(normPhone(req.query.phone));
  if (!c) return res.json(null);
  const stats = db.prepare(`SELECT COUNT(*) visits, COALESCE(SUM(total),0) spent FROM orders WHERE customer_id=? AND status='paid'`).get(c.id);
  res.json({ ...c, ...stats });
});
app.post('/api/customers', (req, res, next) => {
  req.body.phone = normPhone(req.body.phone);
  if (req.body.phone.length < 10) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (db.prepare('SELECT 1 FROM customers WHERE phone=? AND id != ?').get(req.body.phone, req.body.id || 0)) return res.status(400).json({ error: 'A customer with this phone already exists' });
  req.body.points = Math.max(0, parseInt(req.body.points) || 0);
  next();
});
crud('customers', 'customers', ['name', 'phone', 'address', 'points']);

// Register preview: is this code valid for this amount? (nothing is saved)
app.post('/api/promos/check', userErrors((req, res) => {
  const amount = promoAmount(req.body.code, +req.body.base || 0);
  res.json({ ...db.prepare('SELECT code, type, value, min_order, max_discount FROM promos WHERE code=?').get(String(req.body.code).trim().toUpperCase()), amount });
}));
app.get('/api/promos', (req, res) => res.json(db.prepare('SELECT * FROM promos ORDER BY active DESC, id DESC').all()));
app.post('/api/promos', (req, res, next) => {
  req.body.code = String(req.body.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,20}$/.test(req.body.code)) return res.status(400).json({ error: 'Code must be 3–20 letters or digits' });
  if (!['percent', 'flat'].includes(req.body.type) || !(+req.body.value > 0)) return res.status(400).json({ error: 'Enter a discount value' });
  if (db.prepare('SELECT 1 FROM promos WHERE code=? AND id != ?').get(req.body.code, req.body.id || 0)) return res.status(400).json({ error: 'That code already exists' });
  next();
});
crud('promos', 'promos', ['code', 'type', 'value', 'min_order', 'max_discount', 'uses_limit', 'expires', 'active']);

// ---------- Cloud sync (admin) ----------
// The branch key lives in its own table so it never appears in /api/settings
const cloud = require('./cloud-sync')(db);
const riderSync = require('./rider-sync')(db, cloud, { getOrder, dispatchOrder, deliverOrder });
// WhatsApp bot on HazelPOS Cloud (cloud/wa-host.js): the cloud answers customers even when this PC is off. Every 2
// minutes the POS checks whether that is switched on and sends its menu, zones, FAQ and menu photos when they changed.
// While the cloud bot is on, this POS's own bot stays quiet, so a customer never gets two answers.
let waCloudMode = false;
const waKnowledge = () => {
  const { readPosDb } = require('../rag/src/loaders/pos-db');
  const { config: ragConfig } = require('../rag/src/config');
  const pos = readPosDb(db, ragConfig.data);
  const pictures = db.prepare('SELECT id, caption, mime, data FROM menu_images ORDER BY sort, id').all()
    .map(p => ({ id: p.id, caption: p.caption || '', mime: p.mime, data: Buffer.from(p.data).toString('base64') }));
  const hash = crypto.createHash('sha256').update(JSON.stringify({ pos, pictures })).digest('hex');
  return { pos, pictures, hash };
};
const syncWaCloud = async () => {
  if (!cloud.status().connected || cloud.isHeld()) return;
  try {
    const mode = await cloud.call('/api/sync/wa-mode');
    waCloudMode = !!mode?.cloud;
    if (!waCloudMode) return;
    const k = waKnowledge();
    if (k.hash !== mode.knowledge_hash) await cloud.call('/api/sync/wa-knowledge', k);
  } catch (e) { if (!/not reachable|too long/i.test(e.message)) console.error('Cloud WhatsApp:', e.message); }
};
setTimeout(syncWaCloud, 15_000).unref(); setInterval(syncWaCloud, 120_000).unref();
// Orders customers confirmed with the cloud bot: shown to the cashier within 20 s, like orders taken here
setInterval(async () => {
  if (!waCloudMode || !waModule || !cloud.status().connected || cloud.isHeld()) return;
  try {
    const list = await cloud.call('/api/sync/wa-orders');
    if (!Array.isArray(list) || !list.length) return;
    for (const o of list) waModule.store.importCloudOrder(o);
    await cloud.call('/api/sync/wa-orders/ack', { ids: list.map(o => o.id) });
  } catch (e) { if (!/not reachable|too long/i.test(e.message)) console.error('Cloud WhatsApp orders:', e.message); }
}, 20_000).unref();
// A PIN you reset from the admin app (someone forgot theirs): picked up within a minute. The person logs in with the
// temporary PIN and must choose a new one straight away; their other open sessions are signed out.
setInterval(async () => {
  if (!cloud.status().connected || cloud.isHeld()) return;
  try {
    const list = await cloud.call('/api/sync/pin-resets');
    if (!Array.isArray(list) || !list.length) return;
    const results = list.map(r => {
      const u = db.prepare('SELECT id, name FROM users WHERE id=?').get(r.user_id);
      if (!u) return { id: r.id, result: 'That login no longer exists on the POS' };
      const taken = userByPin(String(r.pin || ''));
      if (!PIN_OK(r.pin)) return { id: r.id, result: 'Not a valid PIN' };
      if (taken && taken.id !== u.id) return { id: r.id, result: 'Someone else on this POS already uses that PIN: choose another' };
      db.prepare('UPDATE users SET pin=?, must_change_pin=? WHERE id=?').run(hashPin(String(r.pin)), r.force_change ? 1 : 0, u.id); vaultPin(u.id, r.pin);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
      db.prepare('INSERT INTO audit_log (at,user_id,user_name,role,ip,action,status,detail) VALUES (?,?,?,?,?,?,?,?)').run(now(), null, 'HazelPOS (remote)', '', '', 'PIN RESET', 200, `PIN of ${u.name} reset from HazelPOS Admin`);
      return { id: r.id, result: 'ok' };
    });
    await cloud.call('/api/sync/pin-resets/ack', { results });
  } catch { /* offline: next minute */ }
}, 60_000).unref();
app.get('/api/cloud/status', (req, res) => res.json(cloud.status()));
app.post('/api/cloud/connect', async (req, res) => {
  const url = String(req.body.url || '').trim().replace(/\/+$/, ''); let key = String(req.body.key || '').trim();
  if (!/^https?:\/\//.test(url) || !key) return res.status(400).json({ error: 'Enter the cloud address and the branch key or activation code' });
  // An installed app talks to the HazelPOS Cloud that came with it, and to no other: otherwise its orders and backups could be sent anywhere
  const fixedCloud = String(process.env.HAZEL_CLOUD_URL || '').trim().replace(/\/+$/, '');
  if (lic.required && fixedCloud && url !== fixedCloud) return res.status(400).json({ error: 'This HazelPOS connects to HazelPOS Cloud only' });
  // An activation code (HZ-…) from the admin app works here too, for a POS run by hand (no installer): swap it for the branch key
  if (/^hz-/i.test(key)) {
    try {
      const r = await fetch(url + '/api/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: key }), signal: AbortSignal.timeout(20000) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(400).json({ error: d.error || 'That activation code did not work' });
      key = d.key;
    } catch (e) { return res.status(502).json({ error: `Could not reach the cloud: ${e.message}` }); }
  }
  try { const hello = await cloud.connect(url, key); res.json({ ...cloud.status(), branch: hello.branch }); }
  catch (e) { res.status(502).json({ error: `Could not connect: ${e.message}` }); }
});
app.post('/api/cloud/sync', async (req, res) => {
  const r = await cloud.syncNow();
  r.error ? res.status(502).json({ error: r.error }) : res.json({ ...cloud.status(), result: r });
});
app.post('/api/cloud/backup', async (req, res) => {
  try { await cloud.backupNow(); res.json(cloud.status()); } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/api/cloud/disconnect', (req, res) => {
  if (lic.required) return res.status(400).json({ error: 'This POS is activated with HazelPOS Cloud, so it stays connected' });
  cloud.disconnect(); res.json(cloud.status());
});

// ---------- Membership (installed app only: HAZEL_LICENCE=1, see server/licence.js) ----------
const setupApplier = require('./setup')(db, { hashPin, onPin: vaultPin });
// What your admin app sees about this POS. Never customer data: counts, statuses and error messages only.
const health = () => {
  const w = waModule?.wa.status() || {};
  return {
    users: db.prepare('SELECT id, name, role, pin_changed_at FROM users ORDER BY id').all().map(u => ({ ...u })), // names and roles only: your admin app's "Reset PIN"
    version: process.env.HAZEL_VERSION || require('./package.json').version, platform: `${process.platform} ${process.arch}`, node: process.versions.node,
    uptime_min: Math.round(process.uptime() / 60),
    whatsapp: { status: w.status, connected_at: w.connected_at, error: w.error || '', assistant: waModule?.assistant.enabled() ?? null },
    orders_today: db.prepare("SELECT COUNT(*) c FROM orders WHERE date(created_at,'localtime') = date('now','localtime')").get().c,
    cloud_sync: (({ last_sync, last_backup, last_error, pending_orders }) => ({ last_sync, last_backup, last_error, pending_orders }))(cloud.status()),
    errors: recentErrors.slice(-20),
    update: { state: appUpdate.state, version: appUpdate.version || null }, // appUpdate: App updates below
  };
};
const restorer = require('./restore')(db, cloud);
const lic = require('./licence')(db, cloud, { setup: setupApplier, health, restore: restorer });
// ---------- App updates (with the desktop app: desktop/main.js) ----------
// The desktop app downloads updates in the background and reports here; the owner sees it in Settings → Updates and
// can install now. Otherwise it installs at night with no open orders. Before installing: a cloud backup (prepare-update)
// and a copy of the database on this PC (done by the desktop app).
const INTERNAL = process.env.HAZEL_INTERNAL_TOKEN || '';
const internalOnly = (req, res, next) => INTERNAL && req.get('x-hazel-internal') === INTERNAL ? next() : res.status(403).json({ error: 'Not allowed' });
let appUpdate = { state: INTERNAL ? 'idle' : 'unavailable' }, updateAsk = { install: false, check: false }, vendorAskSeen = '';
const openOrders = () => db.prepare("SELECT COUNT(*) c FROM orders WHERE status='open'").get().c;
// Updates to a few clients first (admin app → Updates): a test client installs any version; the others only up to the
// version you released to everyone. No release set yet = everyone (nothing held back).
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const updateAllowed = version => {
  const p = lic.state().update_policy;
  return !version || !p || p.early || !p.release_version || !newer(version, p.release_version);
};
app.post('/api/internal/update-state', internalOnly, (req, res) => { appUpdate = { ...req.body }; res.json({ ok: true }); });
app.get('/api/internal/update-request', internalOnly, (req, res) => {
  const vendorAsk = lic.state().update_requested_at || ''; // you pressed "Ask all clients to update" in the admin app
  if (vendorAsk && vendorAsk !== vendorAskSeen) { vendorAskSeen = vendorAsk; updateAsk.check = true; }
  res.json({ ...updateAsk, open_orders: openOrders(), allowed: updateAllowed(appUpdate.version) });
  updateAsk = { install: false, check: false };
});
app.post('/api/internal/prepare-update', internalOnly, async (req, res) => {
  try { await cloud.backupNow(); res.json({ ok: true, cloud_backup: true }); } catch (e) { res.json({ ok: true, cloud_backup: false, error: e.message }); }
});
app.get('/api/update', (req, res) => res.json({ ...appUpdate, allowed: updateAllowed(appUpdate.version), current: process.env.HAZEL_VERSION || require('./package.json').version,
  desktop: !!INTERNAL, open_orders: openOrders(), vendor_requested_at: lic.state().update_requested_at || null }));
app.post('/api/update/check', (req, res) => { if (!INTERNAL) return res.status(400).json({ error: 'Updates come with the installed HazelPOS app' }); updateAsk.check = true; res.json({ ok: true }); });
app.post('/api/update/install', (req, res) => {
  if (appUpdate.state !== 'ready') return res.status(400).json({ error: 'No update is ready to install yet' });
  if (!updateAllowed(appUpdate.version)) return res.status(400).json({ error: 'HazelPOS is testing this version with a few restaurants first. It installs as soon as it is released to everyone' });
  updateAsk.install = true; res.json({ ok: true });
});

// Owner: replace everything on this PC with the cloud's newest backup of this branch
app.post('/api/cloud/restore', async (req, res) => {
  if (req.body.confirm !== 'RESTORE') return res.status(400).json({ error: 'Type RESTORE to confirm' });
  try { res.json(await restorer.fromCloud()); } catch (e) { res.status(400).json({ error: `Could not restore: ${e.message}` }); }
});
app.get('/api/licence', (req, res) => res.json(lic.state()));
app.post('/api/licence/check', async (req, res) => res.json(await lic.check()));
app.post('/api/licence/activate', async (req, res) => {
  if (!lic.required) return res.status(400).json({ error: 'This POS does not need activating' });
  // Before activation nobody can log in yet, so the screen is open; afterwards only the owner can re-point it
  if (lic.state().state !== 'activate' && req.user?.role !== 'admin') return res.status(403).json({ error: 'Already activated. Ask the owner' });
  const url = String(req.body.url || '').trim(), code = String(req.body.code || req.body.key || '').trim();
  if (!code) return res.status(400).json({ error: 'Enter the activation code' });
  try { res.json(await lic.activate(url, code)); }
  catch (e) { res.status(502).json({ error: `Could not activate: ${e.message}` }); }
});

// ---------- Fiscal invoicing (PRA / FBR) ----------
const secret = k => db.prepare('SELECT value FROM secrets WHERE key=?').get(k)?.value || '';
const fisc = require('./fiscal')(db, { getSettings, secret, getOrder });
afterPaidHooks.push(id => fisc.onPaid(id));

app.get('/api/secrets', (req, res) => res.json({ fiscal_token: !!secret('fiscal_token') }));
app.post('/api/secrets', (req, res) => {
  if (!['fiscal_token'].includes(req.body.name)) return res.status(400).json({ error: 'Unknown secret' });
  db.prepare('INSERT INTO secrets VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(req.body.name, String(req.body.secret || ''));
  res.json({ ok: true });
});
app.get('/api/fiscal/pending', (req, res) => res.json(fisc.pending()));
app.post('/api/fiscal/retry', async (req, res) => {
  let ok = 0;
  for (const p of fisc.pending()) { try { await fisc.submit(p.id); ok++; } catch (e) { return res.status(502).json({ error: e.message, sent: ok }); } }
  res.json({ ok: true, sent: ok });
});
// Shows exactly what would be sent to PRA/FBR for an order, to check against the authority's sandbox
app.get('/api/fiscal/preview/:id', (req, res) => {
  const o = getOrder(req.params.id);
  o ? res.json(fisc.payload(o, getSettings())) : res.status(404).json({ error: 'Not found' });
});

// ---------- WhatsApp (linked by QR; chats + assistant in the Cashier screen) ----------
// A WhatsApp order the cashier accepts becomes a normal POS order: same prices (re-checked now), same delivery-area
// rules, customer saved, sent to the kitchen. Throws UserError with a message for the cashier.
function createOrder({ type, zone_id, customer, phone, address, items, userName, note }) {
  const lines = items.map(i => ({ ...priceItem(i, { activeOnly: true }), note: note || '' })).filter(i => i.qty > 0);
  if (!lines.length) throw new UserError('This order has no items');
  const subtotal = lines.reduce((s, i) => s + i.price * i.qty, 0);
  if (type === 'delivery' && db.prepare('SELECT 1 FROM delivery_zones WHERE active=1').get()) {
    const z = db.prepare('SELECT * FROM delivery_zones WHERE id=? AND active=1').get(+zone_id || 0);
    if (!z) throw new UserError('Choose the delivery area');
    if (subtotal < z.min_order) throw new UserError(`Minimum order for ${z.name} is Rs ${z.min_order}`);
  }
  return tx(() => {
    const customerId = upsertCustomer({ name: customer, phone, address });
    const orderId = db.prepare('INSERT INTO orders (type,customer,phone,address,subtotal,discount,tax,total,created_at,user_name) VALUES (?,?,?,?,0,0,0,0,?,?)')
      .run(type, customer || '', normPhone(phone), address || '', now(), userName).lastInsertRowid;
    lines.forEach(i => insertItem(orderId, i));
    db.prepare("UPDATE orders SET customer_id=?, zone_id=?, kitchen_status='new', kitchen_at=? WHERE id=?")
      .run(customerId, type === 'delivery' ? +zone_id || null : null, now(), orderId);
    recalc(orderId);
    return orderId;
  });
}
const waModule = require('./whatsapp')(app, db, { createOrder, getOrder, printKitchen, getSettings, aiAllowed: () => lic.aiAllowed() && !waCloudMode, cloudBot: () => waCloudMode, cloudCall: (p, b) => cloud.call(p, b), deliveryStatus });
const lowStock = require('./stock-alert')(db, { getSettings, wa: waModule.wa });
// Settings → Alerts: what would be sent now, and a test send
app.get('/api/low-stock-alert/preview', (req, res) => { const r = lowStock.report(); res.json({ low: r.low, text: r.text, enough: r.enough }); });
app.post('/api/low-stock-alert/test', async (req, res) => {
  const r = await lowStock.run({ force: true });
  r.error ? res.status(400).json({ error: r.error }) : res.json(r);
});

// ---------- Excel / CSV export (rows; the client turns them into a file) ----------
const exportRange = req => [req.query.from || '0000-01-01', req.query.to || '9999-12-31'];
app.get('/api/export/sales', (req, res) => {
  res.json(db.prepare(`SELECT o.id "Order", 'INV-' || strftime('%Y', o.created_at) || '-' || printf('%04d', o.id) "Invoice",
      datetime(o.paid_at, 'localtime') "Paid at", o.type "Type", t.name "Table", o.customer "Customer", o.phone "Phone",
      o.subtotal "Subtotal", o.discount "Discount", o.promo_code "Promo code", o.promo_amount "Promo", o.points_amount "Points used (Rs)",
      o.tax "Tax", o.delivery_fee "Delivery", o.total "Total", o.payment_method "Payment", o.user_name "Staff"
    FROM orders o LEFT JOIN tables_ t ON t.id = o.table_id
    WHERE o.status='paid' AND date(o.paid_at,'localtime') BETWEEN ? AND ? ORDER BY o.paid_at`).all(...exportRange(req)));
});
app.get('/api/export/items', (req, res) => {
  res.json(db.prepare(`SELECT o.id "Order", datetime(o.paid_at, 'localtime') "Paid at", i.name "Item", i.mods "Options",
      i.qty "Qty", i.price "Unit price", i.qty * i.price "Line total", i.note "Note"
    FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.status='paid' AND date(o.paid_at,'localtime') BETWEEN ? AND ? ORDER BY o.paid_at, i.id`).all(...exportRange(req))
    .map(r => ({ ...r, Options: parseJSON(r.Options, []).map(m => m.name).join(', ') })));
});
app.get('/api/export/expenses', (req, res) => {
  res.json(db.prepare(`SELECT date "Date", title "Expense", category "Category", amount "Amount", payment_method "Paid by", user_name "Entered by"
    FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date, id`).all(...exportRange(req)));
});

// ---------- QR Table Ordering ----------
// Give every table a unique, unguessable QR token
function ensureQrTokens() {
  const missing = db.prepare("SELECT id FROM tables_ WHERE qr_token IS NULL OR qr_token=''").all();
  const up = db.prepare('UPDATE tables_ SET qr_token=? WHERE id=?');
  for (const t of missing) up.run(require('crypto').randomBytes(8).toString('hex'), t.id);
}
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
    restaurant: { name: s.name, logo: s.logo, logo_image: s.logo_image },
    categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
    products: db.prepare('SELECT id, name, price, category_id, emoji, subtitle, description, ingredients, sizes, modifiers, deal_items, combo_for FROM products WHERE active=1 ORDER BY name').all(),
    taxRate: taxRate(),
  });
});

// Public: customer places an order -> goes to staff for approval
const qrHits = new Map(); // ip -> recent order times
app.post('/api/qr/:token/order', (req, res) => {
  const table = tableByToken(req.params.token);
  if (!table) return res.status(404).json({ error: 'Invalid table QR code' });
  // Anyone with the QR code can send orders: a few per table and per phone, so nobody can flood the cashier's screen
  const recent = (qrHits.get(req.ip) || []).filter(t => Date.now() - t < 5 * 60e3);
  if (recent.length >= 8 || db.prepare("SELECT COUNT(*) c FROM qr_requests WHERE table_id=? AND status='pending'").get(table.id).c >= 5)
    return res.status(429).json({ error: 'Please wait: the staff are still looking at your earlier orders' });
  qrHits.set(req.ip, [...recent, Date.now()]);
  if (qrHits.size > 2000) for (const [ip, ts] of qrHits) if (!ts.some(t => Date.now() - t < 5 * 60e3)) qrHits.delete(ip);
  let items;
  try {
    items = (Array.isArray(req.body.items) ? req.body.items.slice(0, 40) : []).map(i => priceItem({ ...i, qty: Math.min(50, parseInt(i.qty) || 0) }, { activeOnly: true }))
      .filter(i => i.qty > 0).map(i => ({ ...i, note: i.note.slice(0, 120) }));
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    throw e;
  }
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
app.post('/api/qr-requests/:id/accept', async (req, res) => {
  const r = db.prepare("SELECT * FROM qr_requests WHERE id=? AND status='pending'").get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request already handled' });
  const items = JSON.parse(r.items);
  let order = db.prepare("SELECT id FROM orders WHERE table_id=? AND status='open' AND type='dine-in' ORDER BY id DESC LIMIT 1").get(r.table_id);
  const orderId = order ? order.id : db.prepare('INSERT INTO orders (type,table_id,customer,subtotal,discount,tax,total,created_at,user_name) VALUES (?,?,?,0,0,0,0,?,?)')
    .run('dine-in', r.table_id, r.customer || '', now(), req.user.name).lastInsertRowid;
  items.forEach(i => { i.note = [i.note, r.note].filter(Boolean).join(' · '); insertItem(orderId, i); });
  recalc(orderId);
  db.prepare("UPDATE orders SET kitchen_status='new', kitchen_at=? WHERE id=?").run(now(), orderId);
  db.prepare("UPDATE qr_requests SET status='accepted', handled_at=?, handled_by=?, order_id=? WHERE id=?").run(now(), req.user.name, orderId, r.id);
  const kitchen_print = await printKitchen(orderId, items, !!order);
  res.json({ ok: true, order_id: orderId, kitchen_print });
});

app.post('/api/qr-requests/:id/reject', (req, res) => {
  db.prepare("UPDATE qr_requests SET status='rejected', handled_at=?, handled_by=? WHERE id=? AND status='pending'").run(now(), req.user.name, req.params.id);
  res.json({ ok: true });
});

// Unknown API address: JSON, so the screen shows a message instead of "Unexpected token '<'"
app.use('/api', (req, res) => res.status(404).json({ error: `Unknown address: ${req.method} ${req.originalUrl}` }));

// Serve built frontend in production
// The public demo is one service: the landing page (site/) at /, the POS at /app. The POS still loads its own files from
// /assets, /favicon.svg and /icons.svg (no clash with site/, whose index.html wins at /).
if (DEMO) {
  app.get('/README.md', (req, res) => res.status(404).end()); // site/README.md is notes for us, not for visitors
  app.get(['/app', '/app/'], (req, res) => res.set('Content-Security-Policy', CSP).sendFile(path.join(__dirname, '../client/dist/index.html')));
  app.use('/images', express.static(path.join(__dirname, '../site/images'), { maxAge: '7d' })); // screenshots change rarely: let browsers keep them
  app.use(express.static(path.join(__dirname, '../site')));
}
app.use(express.static(path.join(__dirname, '../client/dist'), { setHeaders: (res, file) => { if (file.endsWith('.html')) res.set('Content-Security-Policy', CSP); } }));
app.get('/t/:token', (req, res) => res.set('Content-Security-Policy', CSP).sendFile(path.join(__dirname, '../client/dist/index.html')));

// Any error not handled above is answered as JSON (never Express's HTML error page)
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof UserError) return res.status(400).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request was not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large to save (e.g. the payment QR image)' });
  console.error(`${req.method} ${req.originalUrl}:`, err);
  res.status(err.status || 500).json({ error: `Something went wrong on the server: ${err.message}` });
});

const PORT = process.env.PORT || 4000;
if (DEMO) console.log('Demo mode: the login screen offers Owner, Cashier, Kitchen and Rider without PINs');
app.listen(PORT, '0.0.0.0', () => console.log(`HazelPOS server running on http://localhost:${PORT}`));
