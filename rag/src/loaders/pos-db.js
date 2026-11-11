// Reads what customers may know straight from the POS database (read-only). Used by the export script and by the
// live menu prompt, so both always see the same data.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const json = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

function readPos(dbPath, dataConfig) {
  if (!fs.existsSync(dbPath)) throw new Error(`POS database not found: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000'); // the POS may be writing right now: wait for it instead of failing
    const categories = db.prepare('SELECT id, name FROM categories ORDER BY id').all().map(c => ({ ...c }));
    // Hidden (inactive) products are included, marked active:false, so the assistant can say "not available right now"
    const menu = db.prepare('SELECT * FROM products ORDER BY category_id, id').all().map(p => ({
      id: p.id, name: p.name, category_id: p.category_id, active: !!p.active,
      price: p.price, subtitle: p.subtitle || '', description: p.description || '',
      ingredients: json(p.ingredients, []), sizes: json(p.sizes, []), modifiers: json(p.modifiers, []),
    }));
    const delivery_zones = db.prepare('SELECT id, name, fee, min_order, free_above, eta_min FROM delivery_zones WHERE active=1 ORDER BY name').all().map(z => ({ ...z }));
    const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
    const restaurant = Object.fromEntries(dataConfig.restaurant_fields.map(k => [k, settings[k] || '']));
    const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // not toLocaleDateString: needs full locale data
    const promos = dataConfig.include_promo_codes
      ? db.prepare(`SELECT code, type, value, min_order, max_discount, expires FROM promos
          WHERE active=1 AND (expires IS NULL OR expires='' OR expires >= ?) AND (uses_limit=0 OR used < uses_limit)`).all(today).map(p => ({ ...p }))
      : [];
    return { menu, categories, delivery_zones, restaurant, promos, behaviour: String(settings.bot_behaviour || '').slice(0, 2000) };
  } finally { db.close(); }
}

module.exports = { readPos };
