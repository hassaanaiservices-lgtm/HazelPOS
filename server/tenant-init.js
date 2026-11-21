// What a restaurant's database contains when it is opened: tables, migrations, seed data. Runs once per database
// (server/tenancy.js calls initTenant(db) for every restaurant). Nothing here may touch another restaurant's database.
const crypto = require('crypto');
const { normPin } = require('./pin-rules');
const DEMO = process.env.DEMO === '1';

// PINs are stored as salted scrypt hashes ("s1$salt$hash")
const hashPin = pin => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `s1$${salt}$${crypto.scryptSync(normPin(pin), salt, 32, { N: 4096 }).toString('hex')}`;
};

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
  // (printer addresses live in the Bridge's own config file in the shop: bridge/config.json)
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

function ensureQrTokens(db) {
  const missing = db.prepare("SELECT id FROM tables_ WHERE qr_token IS NULL OR qr_token=''").all();
  const up = db.prepare('UPDATE tables_ SET qr_token=? WHERE id=?');
  for (const t of missing) up.run(crypto.randomBytes(8).toString('hex'), t.id);
}

function initTenant(db) {
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
-- What the WhatsApp assistant may answer about the restaurant (Settings → WhatsApp → Questions and answers)
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
CREATE TABLE IF NOT EXISTS menu_images (id INTEGER PRIMARY KEY, caption TEXT, mime TEXT, data BLOB, sort INTEGER, created_at TEXT);
-- Tills and tablets the owner set up ("Use this device as a till"); only the sha256 of the key is kept
CREATE TABLE IF NOT EXISTS print_jobs (id INTEGER PRIMARY KEY, kind TEXT, label TEXT, data TEXT, status TEXT DEFAULT 'queued', error TEXT, created_at TEXT, sent_at TEXT, done_at TEXT, tries INTEGER DEFAULT 0, retried INTEGER DEFAULT 0); -- the server only queues bytes; the Bridge prints them
CREATE TABLE IF NOT EXISTS devices (id INTEGER PRIMARY KEY, name TEXT, key_hash TEXT UNIQUE, created_at TEXT, last_seen TEXT, revoked_at TEXT);
-- Each rider's last spot, so a server restart (a deploy) does not empty the map
CREATE TABLE IF NOT EXISTS rider_spots (rider_id INTEGER PRIMARY KEY, lat REAL, lng REAL, acc REAL, on_duty INTEGER, at TEXT);
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
  "ALTER TABLE devices ADD COLUMN kind TEXT DEFAULT 'till'", // 'till' | 'bridge'
  'ALTER TABLE orders ADD COLUMN ready_at TEXT', // when the kitchen pressed Mark ready (the counter sees how long food has been waiting)
]) { try { db.exec(sql); } catch { /* column exists */ } }
// Every time a PIN is set or changed (any route), note the time
db.exec(`CREATE TRIGGER IF NOT EXISTS users_pin_ts AFTER UPDATE OF pin ON users BEGIN UPDATE users SET pin_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
  CREATE TRIGGER IF NOT EXISTS users_pin_ts_new AFTER INSERT ON users BEGIN UPDATE users SET pin_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;`);
  // Fiscal columns (server/fiscal.js)
  for (const sql of ['ALTER TABLE orders ADD COLUMN fiscal_no TEXT', 'ALTER TABLE orders ADD COLUMN fiscal_status TEXT', 'ALTER TABLE orders ADD COLUMN fiscal_error TEXT'])
    try { db.exec(sql); } catch { /* column exists */ }

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

for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(k, v);

  // No default users online: the owner's admin login is made by the owner's sign-up (server/tenant-cli.js). The demo keeps its three.
  if (DEMO && db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    const ui = db.prepare('INSERT INTO users (name,pin,role) VALUES (?,?,?)');
    ui.run('Owner', hashPin('1234'), 'admin'); ui.run('Cashier', hashPin('1111'), 'cashier'); ui.run('Kitchen', hashPin('2222'), 'kitchen');
  }
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
  ensureQrTokens(db);
}

module.exports = { initTenant, hashPin, ensureQrTokens, DEFAULT_SETTINGS };
