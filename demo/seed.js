// Builds the demo restaurant every free-demo visitor starts from (demo/template.db).
//
//   node demo/seed.js            -> writes demo/template.db
//
// It starts a private POS server on a spare port against a fresh database, fills it through the POS's own API (so every
// price, tax and total is calculated by the real system), then moves the past orders back over the last seven days.
// All names, phone numbers and amounts are samples.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'template.db');
// Built in the temp folder (fast to write) and copied over OUT only when complete, so a failed run never leaves a half file
const WORK = path.join(os.tmpdir(), `hazelpos-seed-${process.pid}.db`);
const PORT = 4390;
const BASE = `http://localhost:${PORT}/api`;

// ---------- the sample restaurant ----------
const CATEGORIES = [
  ['BBQ & Karahi', '#e8590c'], ['Biryani & Rice', '#f2b44c'], ['Burgers', '#d9480f'], ['Pizza', '#c92a2a'],
  ['Breads & Sides', '#94d82d'], ['Drinks', '#4dabf7'], ['Desserts', '#cc5de8'],
];
const S = (name, price, detail = '') => ({ name, detail, price });
const spice = { name: 'Spice level', min: 0, max: 1, options: [{ name: 'Mild', price: 0 }, { name: 'Medium', price: 0 }, { name: 'Hot', price: 0 }] };
const cheese = { name: 'Extras', min: 0, max: 2, options: [{ name: 'Extra cheese', price: 200 }, { name: 'Jalapenos', price: 100 }] };
// [category index, name, emoji, sizes, description, modifiers]
const PRODUCTS = [
  [0, 'Chicken Karahi', '🍲', [S('Half', 1400, 'serves 2'), S('Full', 2600, 'serves 4')], 'Fresh chicken cooked in a wok with tomatoes, green chillies and ginger.', [spice]],
  [0, 'Mutton Karahi', '🍲', [S('Half', 2400, 'serves 2'), S('Full', 4600, 'serves 4')], 'Tender mutton in a slow-cooked tomato and black pepper masala.', [spice]],
  [0, 'Chicken Tikka', '🍗', [S('Leg', 450), S('Breast', 500)], 'Charcoal-grilled chicken piece in a yoghurt and red chilli marinade.', [spice]],
  [0, 'Seekh Kabab', '🍢', [S('4 pcs', 900)], 'Minced beef kababs grilled on skewers, served with mint chutney.', []],
  [1, 'Chicken Biryani', '🍛', [S('Single', 450), S('Double', 800)], 'Layered rice and spiced chicken, served with raita and salad.', []],
  [1, 'Beef Pulao', '🍚', [S('Single', 500), S('Double', 900)], 'Aromatic rice cooked in beef stock with whole spices.', []],
  [2, 'Zinger Burger', '🍔', [S('Single', 650), S('Combo', 950, 'with fries and a drink')], 'Crispy fried chicken fillet, lettuce and spicy mayo.', []],
  [2, 'Beef Smash Burger', '🍔', [S('Single', 850), S('Double', 1250)], 'Smashed beef patty, cheddar, onions and house sauce.', [cheese]],
  [3, 'Chicken Tikka Pizza', '🍕', [S('Small', 900, '8 inch'), S('Medium', 1500, '10 inch'), S('Large', 2000, '12 inch')], 'Tikka chunks, onions, green peppers and mozzarella.', [cheese]],
  [3, 'Fajita Pizza', '🍕', [S('Small', 950, '8 inch'), S('Medium', 1550, '10 inch'), S('Large', 2100, '12 inch')], 'Fajita chicken, peppers, sweet corn and mozzarella.', [cheese]],
  [4, 'Garlic Naan', '🫓', [S('1 pc', 120)], 'Tandoor naan brushed with garlic butter.', []],
  [4, 'Roghni Naan', '🫓', [S('1 pc', 80)], 'Soft tandoor naan topped with sesame.', []],
  [4, 'Fries', '🍟', [S('Regular', 300), S('Large', 450)], 'Crispy salted fries.', []],
  [4, 'Raita', '🥣', [S('1 bowl', 100)], 'Yoghurt with cucumber, mint and roasted cumin.', []],
  [5, 'Soft Drink', '🥤', [S('500ml', 150), S('1.5L', 280)], 'Chilled cola, lemon-lime or orange.', []],
  [5, 'Mint Margarita', '🍹', [S('Glass', 350)], 'Fresh mint, lemon and soda.', []],
  [5, 'Sweet Lassi', '🥛', [S('Glass', 250)], 'Chilled yoghurt drink.', []],
  [5, 'Mineral Water', '💧', [S('Small', 80), S('Large', 140)], '', []],
  [6, 'Kheer', '🍮', [S('1 bowl', 300)], 'Slow-cooked rice pudding with cardamom and pistachio.', []],
  [6, 'Gulab Jamun', '🍡', [S('2 pcs', 200)], 'Warm milk dumplings in syrup.', []],
];
// [name, unit, stock bought, low level, cost per unit Rs]
const INGREDIENTS = [
  ['Chicken', 'kg', 60, 10, 650], ['Mutton', 'kg', 12, 6, 2200], ['Beef mince', 'kg', 15, 4, 1300], ['Basmati rice', 'kg', 50, 10, 380],
  ['Burger buns', 'pcs', 120, 30, 35], ['Pizza dough', 'pcs', 40, 15, 60], ['Mozzarella', 'kg', 8, 3, 1900], ['Cooking oil', 'L', 40, 10, 520],
  ['Potatoes', 'kg', 30, 8, 90], ['Yoghurt', 'kg', 20, 5, 260], ['Soft drinks 500ml', 'pcs', 96, 24, 95], ['Flour', 'kg', 40, 10, 120],
];
// product name -> [[ingredient, qty per item (for the size, '' = all sizes)]]
const RECIPES = {
  'Chicken Karahi': { Half: [['Chicken', 0.5], ['Cooking oil', 0.1]], Full: [['Chicken', 1], ['Cooking oil', 0.2]] },
  'Mutton Karahi': { Half: [['Mutton', 0.5], ['Cooking oil', 0.1]], Full: [['Mutton', 1], ['Cooking oil', 0.2]] },
  'Chicken Tikka': { '': [['Chicken', 0.25]] },
  'Seekh Kabab': { '': [['Beef mince', 0.3]] },
  'Chicken Biryani': { Single: [['Basmati rice', 0.15], ['Chicken', 0.15], ['Yoghurt', 0.05]], Double: [['Basmati rice', 0.3], ['Chicken', 0.3], ['Yoghurt', 0.1]] },
  'Beef Pulao': { Single: [['Basmati rice', 0.15], ['Beef mince', 0.1]], Double: [['Basmati rice', 0.3], ['Beef mince', 0.2]] },
  'Zinger Burger': { '': [['Burger buns', 1], ['Chicken', 0.15], ['Cooking oil', 0.05]] },
  'Beef Smash Burger': { Single: [['Burger buns', 1], ['Beef mince', 0.15]], Double: [['Burger buns', 1], ['Beef mince', 0.3]] },
  'Chicken Tikka Pizza': { '': [['Pizza dough', 1], ['Mozzarella', 0.12], ['Chicken', 0.1]] },
  'Fajita Pizza': { '': [['Pizza dough', 1], ['Mozzarella', 0.12], ['Chicken', 0.1]] },
  'Fries': { '': [['Potatoes', 0.25], ['Cooking oil', 0.05]] },
  'Garlic Naan': { '': [['Flour', 0.12]] }, 'Roghni Naan': { '': [['Flour', 0.1]] },
  'Raita': { '': [['Yoghurt', 0.15]] }, 'Soft Drink': { '500ml': [['Soft drinks 500ml', 1]] }, 'Sweet Lassi': { '': [['Yoghurt', 0.2]] },
};
const STAFF = [['Bilal', '03000000101', 'Cashier', 40000], ['Usman', '03000000102', 'Head chef', 75000], ['Imran', '03000000103', 'Cook', 45000],
  ['Kamran', '03000000104', 'Rider', 35000], ['Faisal', '03000000105', 'Rider', 35000], ['Zubair', '03000000106', 'Waiter', 32000]];
const CUSTOMERS = [['Sample Customer A', '03000000001', 'House 1, Street 1, Block A'], ['Sample Customer B', '03000000002', 'Flat 4, Sample Tower, Main Road'],
  ['Sample Customer C', '03000000003', ''], ['Sample Customer D', '03000000004', 'House 22, Street 7, Block C']];
const ZONES = [['Within 3 km', 0, 1000, 0, 30], ['3 to 6 km', 150, 1500, 4000, 40], ['6 to 10 km', 250, 2000, 6000, 55]];
const SETTINGS = {
  name: 'Your Restaurant', logo: '🍽️', address: 'Your restaurant address', phone: 'Your phone number', tax_rate: '16',
  ntn: '', strn: '', bank_name: '', bank_account: '', bank_title: '', footer: 'Thank you for dining with us', closed_drawer_cash: 'auto_open',
};

// ---------- helpers ----------
let tok = {};
async function call(role, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { Authorization: 'Bearer ' + (tok[role] || ''), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${j.error || ''}`);
  return j;
}
const post = (p, b, role = 'admin') => call(role, 'POST', p, b);
const get = (p, role = 'admin') => call(role, 'GET', p);
let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // repeatable
const pick = a => a[Math.floor(rand() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const clean = f => { for (const x of [f, f + '-wal', f + '-shm', f + '-journal']) fs.rmSync(x, { force: true }); };
  clean(WORK);
  const env = { ...process.env, POS_DB: WORK, PORT: String(PORT), WHATSAPP: 'off' }; // never touch the real WhatsApp login
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env, cwd: path.join(ROOT, 'server'), stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => { if (!/ExperimentalWarning|trace-warnings/.test(d)) process.stderr.write(d); });
  srv.stdout?.on('data', () => {});
  try {
    let up = false
    // A fresh database takes a while to create on a slow disk: wait up to 90 s
    for (let i = 0; i < 450 && !up; i++) { if (srv.exitCode != null) break; try { await fetch(BASE + '/settings'); up = true } catch { await sleep(200) } }
    if (!up) throw new Error('the seed server did not start')
    for (const [role, pin] of [['admin', '1234'], ['cashier', '1111']]) tok[role] = (await call('', 'POST', '/login', { pin })).token;
    const db = new DatabaseSync(WORK);
    db.exec('PRAGMA busy_timeout = 10000'); // the server writes to the same file; wait instead of failing

    // restaurant + replace the built-in pizza menu
    await post('/settings', SETTINGS);
    db.exec('DELETE FROM products; DELETE FROM categories; DELETE FROM expenses;');
    const cats = [];
    for (const [name, color] of CATEGORIES) cats.push((await post('/categories', { name, color })).id);
    const prod = {};
    for (const [ci, name, emoji, sizes, description, mods] of PRODUCTS)
      prod[name] = await post('/products', { name, emoji, price: sizes[0].price, category_id: cats[ci], active: 1, description, subtitle: CATEGORIES[ci][0],
        sizes: JSON.stringify(sizes), modifiers: JSON.stringify(mods), ingredients: '[]' });

    // delivery areas, staff, customers, a promo
    for (const [name, fee, min_order, free_above, eta_min] of ZONES) await post('/delivery-zones', { name, fee, min_order, free_above, eta_min, active: 1 });
    const staff = {};
    for (const [name, phone, job, salary] of STAFF) staff[name] = await post('/employees', { name, phone, job, salary, active: 1, joined: '2026-01-15' });
    for (const [name, phone, address] of CUSTOMERS) await post('/customers', { name, phone, address, points: 0 });
    await post('/promos', { code: 'WELCOME10', type: 'percent', value: 10, min_order: 1500, max_discount: 500, uses_limit: 0, expires: null, active: 1 });

    // stock: two suppliers on khata, purchases add the stock
    const ing = {};
    for (const [name, unit, , low_level, cost] of INGREDIENTS) ing[name] = await post('/ingredients', { name, unit, low_level, cost });
    const poultry = await post('/suppliers', { name: 'Sample Poultry Supplier', phone: '03000000201', note: 'Chicken and mutton' });
    const wholesale = await post('/suppliers', { name: 'Sample Cash & Carry', phone: '03000000202', note: 'Rice, oil, flour, drinks' });
    const buy = (sup, names, paid) => post(`/suppliers/${sup.id}/purchase`, { date: daysAgo(6), note: 'Weekly stock',
      items: names.map(n => { const r = INGREDIENTS.find(x => x[0] === n); return { ingredient_id: ing[n].id, qty: r[2], cost: r[2] * r[4] } }), paid, method: 'cash' });
    await buy(poultry, ['Chicken', 'Mutton', 'Beef mince'], 30000);
    await buy(wholesale, ['Basmati rice', 'Burger buns', 'Pizza dough', 'Mozzarella', 'Cooking oil', 'Potatoes', 'Yoghurt', 'Soft drinks 500ml', 'Flour'], 60000);
    for (const [pname, bySize] of Object.entries(RECIPES))
      for (const [size, lines] of Object.entries(bySize))
        await post(`/recipes/${prod[pname].id}`, { size, lines: lines.map(([n, qty]) => ({ ingredient_id: ing[n].id, qty })) });

    // a week of sales: orders paid through the API, then moved back in time
    const tables = await get('/tables', 'cashier');
    const sized = name => { const p = PRODUCTS.find(x => x[1] === name); return pick(p[3]).name; };
    const randomItems = () => Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
      const name = pick(['Chicken Karahi', 'Chicken Biryani', 'Zinger Burger', 'Beef Smash Burger', 'Chicken Tikka Pizza', 'Fajita Pizza', 'Chicken Tikka', 'Seekh Kabab', 'Beef Pulao', 'Mutton Karahi']);
      return { product_id: prod[name].id, size: sized(name), qty: 1 + Math.floor(rand() * 2), mods: [] };
    }).concat(rand() < 0.7 ? [{ product_id: prod['Soft Drink'].id, size: '500ml', qty: 1 + Math.floor(rand() * 3) }] : [], rand() < 0.4 ? [{ product_id: prod['Garlic Naan'].id, size: '1 pc', qty: 2 }] : []);
    const past = [];
    for (let d = 7; d >= 1; d--) {
      const n = 14 + Math.floor(rand() * 10) + (d % 7 === 2 ? 8 : 0);
      for (let k = 0; k < n; k++) {
        const type = pick(['dine-in', 'dine-in', 'takeaway', 'delivery']);
        const body = { type, items: randomItems() };
        if (type === 'dine-in') body.table_id = pick(tables).id;
        if (type === 'delivery') { // every delivery area has a minimum order: delivery orders always carry a main dish
          body.items.push({ product_id: prod['Chicken Karahi'].id, size: 'Full', qty: 1, mods: [] });
          Object.assign(body, { zone_id: 1, customer: pick(CUSTOMERS)[0], phone: pick(CUSTOMERS)[1], address: 'Sample address' });
        }
        if (type === 'takeaway' && rand() < 0.3) Object.assign(body, { customer: pick(CUSTOMERS)[0], phone: pick(CUSTOMERS)[1] });
        const o = await post('/orders', body, 'cashier');
        const method = pick(['cash', 'cash', 'cash', 'card', 'online']);
        await post(`/orders/${o.id}/pay`, { method, paid: method === 'cash' ? Math.ceil(o.total / 500) * 500 : o.total }, 'cashier');
        const hour = pick([12, 13, 13, 14, 15, 18, 19, 20, 20, 21, 21, 22, 23]);
        past.push([o.id, d, hour, Math.floor(rand() * 60)]);
      }
    }
    // mid-week restock on khata: everything back to a healthy level, except two items left low for the stock alert
    const LOW = ['Mozzarella', 'Soft drinks 500ml'];
    const now = await get('/ingredients');
    for (const [sup, names] of [[poultry, ['Chicken', 'Mutton', 'Beef mince']], [wholesale, INGREDIENTS.map(r => r[0]).filter(n => !['Chicken', 'Mutton', 'Beef mince'].includes(n))]]) {
      const items = names.map(n => {
        const row = now.find(i => i.name === n), cost = INGREDIENTS.find(r => r[0] === n)[4];
        const target = LOW.includes(n) ? row.low_level * 0.6 : row.low_level * 3.5;
        const qty = Math.max(0, Math.ceil(target - row.stock));
        return { ingredient_id: row.id, qty, cost: qty * cost };
      }).filter(l => l.qty > 0);
      if (items.length) await post(`/suppliers/${sup.id}/purchase`, { date: daysAgo(3), note: 'Mid-week restock', items, paid: 0, method: 'cash' });
    }
    await post('/register/close', { closing_cash: 0, notes: 'Seed' }, 'cashier').catch(() => {});
    const at = (d, h, m) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, m, 0, 0); return t.toISOString(); };
    for (const [id, d, h, m] of past) {
      db.prepare("UPDATE orders SET created_at=?, paid_at=?, kitchen_status='done', kitchen_at=? WHERE id=?").run(at(d, h, m), at(d, h, m + 25), at(d, h, m), id);
      db.prepare('UPDATE stock_moves SET at=? WHERE ref=?').run(at(d, h, m + 25), `order:${id}`);
    }
    // the shift history: one closed shift per past day is too much detail; keep one closed and one open today
    db.exec('DELETE FROM register_sessions; DELETE FROM cash_moves;');
    db.prepare("INSERT INTO register_sessions (opened_at, closed_at, opened_by, closed_by, opening_cash, closing_cash, expected_cash, difference, status, notes) VALUES (?,?,?,?,?,?,?,?, 'closed', '')")
      .run(at(1, 11, 0), at(1, 23, 50), 'Cashier', 'Cashier', 5000, 41200, 41500, -300);
    await post('/register/open', { opening_cash: 5000 }, 'cashier');
    db.prepare('UPDATE register_sessions SET opened_at=? WHERE status=?').run(at(0, 11, 0), 'open');
    await post('/register/cash-move', { type: 'out', amount: 1200, reason: 'Ice and vegetables' }, 'cashier');

    // today: running tables, kitchen tickets, a rider on the road
    const today = async (body, pay) => { const o = await post('/orders', body, 'cashier'); if (pay) await post(`/orders/${o.id}/pay`, { method: 'cash', paid: Math.ceil(o.total / 500) * 500 }, 'cashier'); return o; };
    const it = (name, size, qty = 1, mods = []) => ({ product_id: prod[name].id, size, qty, mods });
    for (let k = 0; k < 9; k++) await today({ type: pick(['dine-in', 'takeaway']), table_id: pick(tables).id, items: randomItems() }, true);
    db.exec("UPDATE orders SET kitchen_status='done' WHERE status='paid'");
    const t1 = await today({ type: 'dine-in', table_id: tables[0].id, items: [it('Chicken Karahi', 'Full', 1, [{ group: 'Spice level', name: 'Medium' }]), it('Garlic Naan', '1 pc', 4), it('Raita', '1 bowl', 2), it('Soft Drink', '1.5L')] });
    const t3 = await today({ type: 'dine-in', table_id: tables[2].id, items: [it('Chicken Biryani', 'Double', 2), it('Chicken Tikka', 'Leg', 2), it('Mint Margarita', 'Glass', 2)] });
    await today({ type: 'dine-in', table_id: tables[6].id, items: [it('Fajita Pizza', 'Large'), it('Fries', 'Large'), it('Soft Drink', '1.5L')] });
    const tk = await today({ type: 'takeaway', customer: 'Sample Customer C', phone: '03000000003', items: [it('Zinger Burger', 'Combo', 2), it('Beef Smash Burger', 'Double')] });
    const dl = await today({ type: 'delivery', zone_id: 2, customer: 'Sample Customer B', phone: '03000000002', address: 'Flat 4, Sample Tower, Main Road', items: [it('Mutton Karahi', 'Half'), it('Roghni Naan', '1 pc', 4), it('Kheer', '1 bowl', 2)] });
    const dl2 = await today({ type: 'delivery', zone_id: 1, customer: 'Sample Customer A', phone: '03000000001', address: 'House 1, Street 1, Block A', items: [it('Chicken Tikka Pizza', 'Medium'), it('Soft Drink', '500ml', 2)] });
    await post(`/kitchen/${t1.id}`, { status: 'preparing' }, 'admin');
    await post(`/kitchen/${t3.id}`, { status: 'ready' }, 'admin');
    await post(`/kitchen/${dl.id}`, { status: 'done' }, 'admin');
    await post(`/orders/${dl.id}/dispatch`, { rider_id: staff.Kamran.id }, 'cashier');
    const ago = m => new Date(Date.now() - m * 60000).toISOString();
    for (const [id, m] of [[t1.id, 18], [t3.id, 31], [tk.id, 6], [dl.id, 24], [dl2.id, 3]]) db.prepare('UPDATE orders SET created_at=?, kitchen_at=? WHERE id=?').run(ago(m + 4), ago(m), id);
    db.prepare('UPDATE orders SET dispatched_at=? WHERE id=?').run(ago(12), dl.id);

    // salaries this month, running costs
    await post('/payroll', { employee_id: staff.Imran.id, type: 'advance', amount: 10000, date: daysAgo(3), method: 'cash' });
    for (const [title, category, amount, d] of [['Shop rent', 'Rent', 150000, 6], ['Gas cylinder refill', 'Utilities', 9500, 4], ['Electricity bill', 'Utilities', 38000, 2], ['Takeaway boxes', 'Packaging', 7200, 3]])
      await post('/expenses', { title, category, amount, payment_method: 'cash', date: daysAgo(d) });

    // nothing private, no leftovers from the seed run
    db.exec("DELETE FROM sessions; DELETE FROM audit_log; DELETE FROM sync_log; DELETE FROM cloud_config; DELETE FROM secrets;");
    db.exec("UPDATE settings SET value='' WHERE key IN ('receipt_printer','kitchen_printer','payment_qr','payment_qr_label','fiscal_url','fiscal_pos_id')");
    const n = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status='paid'").get();
    db.close();
    // Stop the server, fold everything into the one file, then swap it in place of the old template in one step
    srv.kill(); await new Promise(r => srv.exitCode != null ? r() : srv.once('exit', r));
    const fin = new DatabaseSync(WORK); fin.exec('PRAGMA wal_checkpoint(TRUNCATE)'); fin.close();
    fs.copyFileSync(WORK, OUT + '.new'); fs.renameSync(OUT + '.new', OUT);
    for (const x of ['-wal', '-shm', '-journal']) fs.rmSync(OUT + x, { force: true });
    console.log(`demo/template.db ready: ${PRODUCTS.length} menu items, ${n.c} paid orders (Rs ${Math.round(n.s).toLocaleString('en-PK')}), 3 tables running, 1 rider out`);
  } finally { srv.kill(); clean(WORK); }
}
function daysAgo(d) { const t = new Date(); t.setDate(t.getDate() - d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; }
main().catch(e => { console.error(e); process.exit(1); });
