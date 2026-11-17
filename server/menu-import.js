// Menu import from Excel (.xlsx) or CSV. No packages: an .xlsx file is a zip of XML files, and Node's zlib unzips it.
//
// One row per item, or per size of an item. Columns (header names, any order, case doesn't matter):
//   Category | Item | Size | Price | Description | Emoji | Available | Deal items | Combo for
// Rows with the same Category + Item and different Sizes become one item with sizes. "Available" no/0/hidden hides it.
// Deals: "Deal items" lists what's inside, e.g. "2x Zinger Burger (Single); Fries (Regular); Coke 500ml". "Combo for"
// names the item it's also offered with ("Make it a combo" when that item is tapped).
const zlib = require('zlib');
const MAX_PART = 30 * 1024 * 1024, MAX_TOTAL = 60 * 1024 * 1024; // a real menu sheet is a few hundred KB

const COLUMNS = {
  category: ['category', 'categories', 'section', 'type'],
  item: ['item', 'name', 'item name', 'product', 'dish'],
  size: ['size', 'variant', 'portion'],
  price: ['price', 'rate', 'amount', 'price (rs)', 'rs'],
  description: ['description', 'details', 'info'],
  emoji: ['emoji', 'icon'],
  available: ['available', 'active', 'on menu', 'show'],
  deal: ['deal items', 'deal', 'includes', 'combo items', 'in the deal', "what's in the deal"],
  combo_for: ['combo for', 'offer with', 'combo on', 'offer as combo on'],
};
const TEMPLATE = [
  ['Category', 'Item', 'Size', 'Price', 'Description', 'Emoji', 'Available', 'Deal items', 'Combo for'],
  ['Pizza', 'Chicken Tikka Pizza', 'Small', 650, 'Tikka chunks, onion, capsicum', '🍕', 'yes', '', ''],
  ['Pizza', 'Chicken Tikka Pizza', 'Medium', 1150, '', '', '', '', ''],
  ['Pizza', 'Chicken Tikka Pizza', 'Large', 1550, '', '', '', '', ''],
  ['Burgers', 'Zinger Burger', '', 490, 'Crispy fillet, lettuce, mayo', '🍔', 'yes', '', ''],
  ['Sides', 'Fries', '', 250, '', '🍟', 'yes', '', ''],
  ['Drinks', 'Soft Drink', '', 120, '345 ml', '🥤', 'yes', '', ''],
  ['Deals', 'Zinger Combo', '', 799, 'Zinger + fries + drink', '🍔', 'yes', 'Zinger Burger; Fries; Soft Drink', 'Zinger Burger'],
  ['Deals', 'Family Deal', '', 2999, '', '🎁', 'yes', '1x Chicken Tikka Pizza (Large); 2x Zinger Burger; 2x Fries; 4x Soft Drink', ''],
];

// "2x Zinger Burger (Single); Fries; 1 Coke 500ml" -> [{name, size, qty}]
function parseDeal(text) {
  return String(text || '').split(/[;\n+]|,(?![^(]*\))/).map(s => s.trim()).filter(Boolean).map(s => {
    let qty = 1, m = /^(\d+)\s*[x×*]?\s+(.+)$/i.exec(s) || /^(\d+)\s*[x×*]\s*(.+)$/i.exec(s);
    if (m) { qty = +m[1]; s = m[2]; } else if ((m = /^(.+?)\s*[x×*]\s*(\d+)$/i.exec(s))) { qty = +m[2]; s = m[1]; }
    const sz = /^(.+?)\s*\(([^)]+)\)$/.exec(s);
    return { name: (sz ? sz[1] : s).trim(), size: sz ? sz[2].trim() : '', qty: Math.max(1, qty) };
  });
}

// Deal items must name items on this menu. names: lower-case names available (file + POS). -> [{row?, error}]
function checkDeals(items, names = new Set(items.map(i => i.name.toLowerCase()))) {
  const errors = [];
  for (const it of items) {
    for (const d of it.deal || []) {
      if (!names.has(d.name.toLowerCase())) errors.push({ row: it.row, error: `${it.name}: "${d.name}" is not on the menu` });
      else if (d.name.toLowerCase() === it.name.toLowerCase()) errors.push({ row: it.row, error: `${it.name}: a deal can't include itself` });
    }
    if (it.combo_for && !names.has(it.combo_for.toLowerCase())) errors.push({ row: it.row, error: `${it.name}: "Combo for" item "${it.combo_for}" is not on the menu` });
    if (it.combo_for && !(it.deal || []).length) errors.push({ row: it.row, error: `${it.name}: "Combo for" needs "Deal items" too` });
  }
  return errors;
}

// ---------- reading the file ----------
function unzip(buf) {
  // End of central directory: last 22+ bytes, signature 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (/^xl\/(sharedStrings|workbook)\.xml$|^xl\/worksheets\/sheet\d+\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(name))
    {
      // A few KB of Excel can unpack to gigabytes (a "zip bomb"): cap each part and the total
      const tooBig = () => new Error('That Excel file is too big once unpacked. Save it again as a plain .xlsx with just the menu');
      let one;
      try { one = method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_PART }) : raw; } catch (e) { throw e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError ? tooBig() : e; }
      if (one.length > MAX_PART || (total += one.length) > MAX_TOTAL) throw tooBig();
      files[name] = one.toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const texts = xml => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join('');
const colIndex = ref => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function readXlsx(buf) {
  const f = unzip(buf);
  const shared = [...(f['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  // The first sheet in the workbook's order
  const firstId = /<sheet [^>]*r:id="([^"]+)"/.exec(f['xl/workbook.xml'] || '')?.[1];
  const target = firstId && new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${firstId}"`).exec(f['xl/_rels/workbook.xml.rels'] || '');
  const sheetName = target ? 'xl/' + (target[1] || target[2]).replace(/^\/?xl\//, '') : Object.keys(f).filter(k => k.startsWith('xl/worksheets/')).sort()[0];
  const sheet = f[sheetName];
  if (!sheet) throw new Error('No sheet found in this Excel file');
  const rows = [];
  for (const r of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+\d+)"/.exec(c[1])?.[1], type = /t="(\w+)"/.exec(c[1])?.[1], body = c[2] || '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const val = type === 's' ? shared[+v] ?? '' : type === 'inlineStr' ? texts(body) : v != null ? unxml(v) : '';
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return rows;
}

function readCsv(text) {
  text = text.replace(/^﻿/, '');
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// buffer + file name -> rows of cells (strings)
function readSheet(buf, name = '') {
  if (buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf); // zip = .xlsx
  if (/\.xls$/i.test(name)) throw new Error('Old .xls files can\'t be read. In Excel: File → Save as → Excel Workbook (.xlsx)');
  return readCsv(buf.toString('utf8'));
}

// ---------- rows -> menu ----------
// An empty price is a mistake, not Rs 0 (Number('') would be 0)
const price = v => { const t = String(v ?? '').replace(/rs\.?|pkr|,|\s/gi, ''); if (!t) return NaN; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const no = v => /^(no|n|0|false|hidden|off|nahi)$/i.test(String(v ?? '').trim());

// rows -> { items: [{category, name, price, sizes, description, emoji, active}], errors: [{row, error}] }
function toMenu(rows) {
  const headerAt = rows.findIndex(r => r.some(c => COLUMNS.item.includes(String(c).trim().toLowerCase())));
  if (headerAt < 0) throw new Error('No "Item" column found. Use the template: Category, Item, Size, Price, Description, Emoji, Available');
  const head = rows[headerAt].map(c => String(c).trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, head.findIndex(h => names.includes(h))]));
  if (col.price < 0) throw new Error('No "Price" column found');
  const get = (r, k) => col[k] < 0 ? '' : String(r[col[k]] ?? '').trim();
  const items = new Map(), errors = [];
  let lastCategory = '';
  rows.slice(headerAt + 1).forEach((r, i) => {
    const line = headerAt + i + 2;
    if (!r.some(c => String(c).trim())) return; // empty row
    const category = get(r, 'category') || lastCategory; lastCategory = category; // a category written once covers the rows under it
    const name = get(r, 'item'), size = get(r, 'size'), p = price(get(r, 'price'));
    if (!name) return errors.push({ row: line, error: 'Item name is empty' });
    if (!category) return errors.push({ row: line, error: `${name}: no category` });
    if (!(p >= 0)) return errors.push({ row: line, error: `${name}: price "${get(r, 'price')}" is not a number` });
    const key = (category + '\u0000' + name).toLowerCase();
    const it = items.get(key) || { category, name, price: null, sizes: [], description: '', emoji: '', active: true };
    if (size) {
      if (it.sizes.some(s => s.name.toLowerCase() === size.toLowerCase())) errors.push({ row: line, error: `${name}: size "${size}" is listed twice` });
      else it.sizes.push({ name: size, detail: '', price: p });
    } else it.price = p;
    it.description ||= get(r, 'description'); it.emoji ||= get(r, 'emoji');
    if (!it.deal?.length && get(r, 'deal')) it.deal = parseDeal(get(r, 'deal'));
    it.combo_for ||= get(r, 'combo_for'); it.row ||= line;
    if (no(get(r, 'available'))) it.active = false;
    items.set(key, it);
  });
  const list = [...items.values()].map(it => ({ ...it, deal: it.deal || [], combo_for: it.combo_for || '', price: it.price ?? Math.min(...it.sizes.map(s => s.price)) }));
  return { items: list, errors, deals: col.deal >= 0 }; // deals:false = the file has no "Deal items" column: leave deals alone
}

// What importing would change in this POS database (dry run) or does change (apply=true).
// Items are matched by name (case doesn't matter); existing items keep their id, so old orders stay linked.
// hideMissing: items on the POS menu that aren't in the file are hidden (never deleted).
// inTransaction: the caller already opened one (setup.js)
function importMenu(db, menu, { apply = false, hideMissing = false, inTransaction = false } = {}) {
  const cats = db.prepare('SELECT id, name FROM categories').all();
  const prods = db.prepare('SELECT id, name, price, category_id, sizes, description, emoji, active, deal_items, combo_for FROM products').all();
  const catBy = new Map(cats.map(c => [c.name.toLowerCase(), c.id]));
  const prodBy = new Map(prods.map(p => [p.name.toLowerCase(), p]));
  const COLORS = ['#ff6b35', '#3ecf8e', '#6aa8ff', '#f2b44c', '#c084fc', '#ff5d6c', '#2dd4bf'];
  const plan = { new_categories: [], added: [], updated: [], unchanged: 0, hidden: [], deal_errors: [] };
  // Deals name their items; checked against the file and what's already on the POS menu
  plan.deal_errors = checkDeals(menu.items, new Set([...menu.items.map(i => i.name.toLowerCase()), ...prods.map(p => p.name.toLowerCase())]));
  const nameOf = id => prods.find(p => p.id === +id)?.name.toLowerCase() || '';
  const dealKey = list => JSON.stringify((list || []).map(d => [String(d.name ?? '').toLowerCase(), d.size || '', +d.qty || 1]));
  const oldDealKey = p => { try { return dealKey((JSON.parse(p.deal_items || '[]') || []).map(d => ({ ...d, name: nameOf(d.product_id) }))) } catch { return '[]' } };
  const run = () => {
    for (const it of menu.items) {
      let cid = catBy.get(it.category.toLowerCase());
      if (!cid) {
        plan.new_categories.push(it.category);
        cid = apply ? db.prepare('INSERT INTO categories (name, color) VALUES (?,?)').run(it.category, COLORS[catBy.size % COLORS.length]).lastInsertRowid : -catBy.size - 1;
        catBy.set(it.category.toLowerCase(), cid);
      }
      const sizes = it.sizes.length ? JSON.stringify(it.sizes) : '';
      const old = prodBy.get(it.name.toLowerCase());
      if (!old) {
        plan.added.push(it.name);
        if (apply) db.prepare(`INSERT INTO products (name, price, category_id, emoji, active, description, sizes, subtitle, ingredients, modifiers)
          VALUES (?,?,?,?,?,?,?,'','[]','[]')`).run(it.name, it.price, cid, it.emoji || '🍽️', it.active ? 1 : 0, it.description, sizes);
        continue;
      }
      const next = { price: it.price, category_id: cid, sizes, description: it.description || old.description || '', emoji: it.emoji || old.emoji, active: it.active ? 1 : 0 };
      const dealChanged = menu.deals !== false && (it.deal?.length || old.deal_items) && (dealKey(it.deal) !== oldDealKey(old) || (it.combo_for || '').toLowerCase() !== nameOf(old.combo_for));
      const changed = dealChanged || Object.keys(next).some(k => String(next[k] ?? '') !== String(old[k] ?? ''));
      if (!changed) { plan.unchanged++; continue; }
      plan.updated.push(it.name);
      if (apply) db.prepare('UPDATE products SET price=?, category_id=?, sizes=?, description=?, emoji=?, active=? WHERE id=?')
        .run(next.price, next.category_id, next.sizes, next.description, next.emoji, next.active, old.id);
    }
    // Deals last: their items may have been added just above
    if (apply && menu.deals !== false) {
      const idBy = name => db.prepare('SELECT id FROM products WHERE lower(name)=lower(?) ORDER BY id DESC').get(name)?.id;
      for (const it of menu.items) {
        if (!it.deal?.length && !(prodBy.get(it.name.toLowerCase())?.deal_items)) continue;
        const items = (it.deal || []).map(d => ({ product_id: idBy(d.name), size: d.size || '', qty: Math.max(1, +d.qty || 1) })).filter(d => d.product_id);
        db.prepare('UPDATE products SET deal_items=?, combo_for=? WHERE id=?').run(items.length ? JSON.stringify(items) : '', items.length && it.combo_for ? idBy(it.combo_for) || null : null, idBy(it.name));
      }
    }
    if (hideMissing) {
      const inFile = new Set(menu.items.map(it => it.name.toLowerCase()));
      for (const p of prods) if (p.active && !inFile.has(p.name.toLowerCase())) {
        plan.hidden.push(p.name);
        if (apply) db.prepare('UPDATE products SET active=0 WHERE id=?').run(p.id);
      }
    }
  };
  if (apply && !inTransaction) { db.exec('BEGIN'); try { run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } }
  else run();
  return plan;
}

module.exports = { readSheet, toMenu, importMenu, checkDeals, parseDeal, TEMPLATE };
