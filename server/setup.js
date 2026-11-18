// A restaurant's setup, prepared by HazelPOS on the vendor cloud before the client installs: restaurant details, menu,
// menu pictures, tables, delivery areas and staff. The installed app downloads it right after activation and replaces
// the demo restaurant with it. Applied only while the POS has no orders yet, so it can never overwrite real work.
//
// setup = { restaurant: {name, address, phone, logo, tax_rate, ntn, strn, footer, bank_name, bank_account, bank_title},
//           menu: [{category, name, price, sizes, description, emoji, active}]   (shape of menu-import.js toMenu().items)
//           floors: [{name}], tables: [{name, seats, floor}], zones: [{name, fee, min_order, free_above, eta_min}],
//           staff: [{name, role, pin}], images: [{caption, mime, data (base64)}] }
const { importMenu } = require('./menu-import');

const RESTAURANT_KEYS = ['name', 'address', 'phone', 'logo', 'logo_image', 'tax_rate', 'ntn', 'strn', 'footer', 'bank_name', 'bank_account', 'bank_title'];
const ROLES = ['admin', 'cashier', 'kitchen'];
const FLOOR_COLORS = ['#ff9f43', '#a55eea', '#26de81', '#4bcffa', '#ff6b81'];

module.exports = function setupApplier(db, { hashPin }) {
  const hasOrders = () => db.prepare('SELECT COUNT(*) c FROM orders').get().c > 0;

  // Throws with a message for the owner. Returns what was set up.
  function apply(setup) {
    if (hasOrders()) throw new Error('This POS already has orders, so the setup from HazelPOS was not applied (it would replace your menu and staff)');
    const s = setup || {};
    const done = {};
    const firstTime = !appliedAt();
    db.exec('BEGIN');
    try {
      // The demo restaurant goes: menu, recipes, tables, floors, delivery areas, sample expenses, the demo cash drawer
      for (const t of ['recipes', 'products', 'categories', 'tables_', 'floors', 'delivery_zones', 'expenses', 'cash_moves', 'register_sessions', 'menu_images'])
        db.exec(`DELETE FROM ${t}`);

      const setSetting = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      // Demo bank details and NTN must not stay on a real restaurant's receipts
      for (const k of ['ntn', 'strn', 'bank_name', 'bank_account', 'bank_title']) setSetting.run(k, '');
      if (s.restaurant?.logo_image && !/^data:image\/(png|jpeg|webp);base64,/.test(s.restaurant.logo_image)) delete s.restaurant.logo_image;
      for (const k of RESTAURANT_KEYS) if (s.restaurant?.[k] != null && String(s.restaurant[k]).trim() !== '') setSetting.run(k, String(s.restaurant[k]).trim());
      done.restaurant = s.restaurant?.name || '';

      if (Array.isArray(s.menu) && s.menu.length) done.menu = importMenu(db, { items: s.menu }, { apply: true, inTransaction: true }).added.length;

      const tables = (s.tables || []).filter(t => String(t.name || '').trim());
      const floors = [...new Set([...(s.floors || []).map(f => String(f.name || f).trim()), ...tables.map(t => String(t.floor || '').trim() || 'Main Dining')].filter(Boolean))];
      floors.forEach((f, i) => db.prepare('INSERT OR IGNORE INTO floors (name, icon, color) VALUES (?,?,?)').run(f, '🍽️', FLOOR_COLORS[i % FLOOR_COLORS.length]));
      for (const t of tables) db.prepare('INSERT INTO tables_ (name, seats, floor, shape) VALUES (?,?,?,?)')
        .run(String(t.name).trim(), Math.max(1, +t.seats || 4), String(t.floor || '').trim() || 'Main Dining', (+t.seats || 4) > 4 ? 'rect' : 'square');
      done.tables = tables.length;

      for (const z of (s.zones || []).filter(z => String(z.name || '').trim()))
        db.prepare('INSERT INTO delivery_zones (name, fee, min_order, free_above, eta_min, active) VALUES (?,?,?,?,?,1)')
          .run(String(z.name).trim(), +z.fee || 0, +z.min_order || 0, +z.free_above || 0, +z.eta_min || 45);
      done.zones = (s.zones || []).length;

      (s.images || []).slice(0, 6).forEach((im, i) => db.prepare('INSERT INTO menu_images (caption, mime, data, sort, created_at) VALUES (?,?,?,?,?)')
        .run(String(im.caption || ''), im.mime, Buffer.from(im.data, 'base64'), i + 1, new Date().toISOString()));
      done.images = (s.images || []).length;

      // Staff: only when the setup has an owner, so nobody is ever locked out of Settings
      const staff = (s.staff || []).filter(u => String(u.name || '').trim() && ROLES.includes(u.role) && /^[a-z0-9]{4,12}$/i.test(String(u.pin).trim())); // 4 to 12 letters or numbers
      // Only the first time: when you change the setup again later (before the first order), the logins people already
      // use, and the PINs they chose, stay as they are. PINs are changed on the POS itself (Settings → Staff & PINs).
      if (!firstTime) done.staff_kept = true;
      else if (staff.some(u => u.role === 'admin')) {
        if (new Set(staff.map(u => String(u.pin).trim().toLowerCase())).size !== staff.length) throw new Error('Two staff members in the setup have the same PIN');
        db.exec('DELETE FROM sessions'); db.exec('DELETE FROM users');
        for (const u of staff) db.prepare('INSERT INTO users (name, pin, role, must_change_pin) VALUES (?,?,?,1)').run(String(u.name).trim(), hashPin(String(u.pin)), u.role); // each person chooses their own PIN at the first login (the cloud held this one in plain text)
        done.staff = staff.length;
      }
      setSetting.run('setup_applied_at', new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return done;
  }

  // Activated with NO setup prepared: the demo restaurant must not stay on a real restaurant's PC (its menu, tables, sample
  // expenses, bank details, the name "Pizza Venu"). Only while there are no orders. The logins stay (their starting PINs
  // are replaced at the first login, see FORCE_PIN in index.js).
  function clearDemo() {
    if (hasOrders()) return false;
    db.exec('BEGIN');
    try {
      for (const t of ['recipes', 'products', 'categories', 'tables_', 'floors', 'delivery_zones', 'expenses', 'cash_moves', 'register_sessions', 'menu_images', 'customers', 'promos', 'faq'])
        db.exec(`DELETE FROM ${t}`);
      const setSetting = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      for (const [k, v] of [['name', 'My Restaurant'], ['logo', '🍽️'], ['logo_image', ''], ['address', ''], ['phone', ''], ['ntn', ''], ['strn', ''], ['bank_name', ''], ['bank_account', ''], ['bank_title', ''], ['demo_cleared_at', new Date().toISOString()]])
        setSetting.run(k, v);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return true;
  }
  const appliedAt = () => db.prepare("SELECT value FROM settings WHERE key='setup_applied_at'").get()?.value || '';
  return { apply, appliedAt, hasOrders, clearDemo };
};
