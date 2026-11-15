// Menu import from Excel (.xlsx) or CSV. No packages: an .xlsx file is a zip of XML files, and Node's zlib unzips it.
//
// One row per item, or per size of an item. Columns (header names, any order, case doesn't matter):
//   Category | Item | Size | Price | Description | Emoji | Available
// Rows with the same Category + Item and different Sizes become one item with sizes. "Available" no/0/hidden hides it.
const zlib = require('zlib');

const COLUMNS = {
  category: ['category', 'categories', 'section', 'type'],
  item: ['item', 'name', 'item name', 'product', 'dish'],
  size: ['size', 'variant', 'portion'],
  price: ['price', 'rate', 'amount', 'price (rs)', 'rs'],
  description: ['description', 'details', 'deal items', "what's in the deal", 'info'],
  emoji: ['emoji', 'icon'],
  available: ['available', 'active', 'on menu', 'show'],
};
const TEMPLATE = [
  ['Category', 'Item', 'Size', 'Price', 'Description', 'Emoji', 'Available'],
  ['Pizza', 'Chicken Tikka Pizza', 'Small', 650, 'Tikka chunks, onion, capsicum', '🍕', 'yes'],
  ['Pizza', 'Chicken Tikka Pizza', 'Medium', 1150, '', '', ''],
  ['Pizza', 'Chicken Tikka Pizza', 'Large', 1550, '', '', ''],
  ['Burgers', 'Zinger Burger', '', 490, 'Crispy fillet, lettuce, mayo', '🍔', 'yes'],
  ['Deals', 'Deal 1', '', 999, '1 Zinger burger, 1 regular fries, 1 soft drink', '🎁', 'yes'],
];

// ---------- reading the file ----------
function unzip(buf) {
  // End of central directory: last 22+ bytes, signature 0x06054b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (/^xl\/(sharedStrings|workbook)\.xml$|^xl\/worksheets\/sheet\d+\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(name))
      files[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
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
const price = v => { const n = Number(String(v ?? '').replace(/rs\.?|pkr|,|\s/gi, '')); return Number.isFinite(n) ? n : NaN; };
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
    if (no(get(r, 'available'))) it.active = false;
    items.set(key, it);
  });
  const list = [...items.values()].map(it => ({ ...it, price: it.price ?? Math.min(...it.sizes.map(s => s.price)) }));
  return { items: list, errors };
}

// What importing would change in this POS database (dry run) or does change (apply=true).
// Items are matched by name (case doesn't matter); existing items keep their id, so old orders stay linked.
// hideMissing: items on the POS menu that aren't in the file are hidden (never deleted).
// inTransaction: the caller already opened one (setup.js)
function importMenu(db, menu, { apply = false, hideMissing = false, inTransaction = false } = {}) {
  const cats = db.prepare('SELECT id, name FROM categories').all();
  const prods = db.prepare('SELECT id, name, price, category_id, sizes, description, emoji, active FROM products').all();
  const catBy = new Map(cats.map(c => [c.name.toLowerCase(), c.id]));
  const prodBy = new Map(prods.map(p => [p.name.toLowerCase(), p]));
  const COLORS = ['#ff6b35', '#3ecf8e', '#6aa8ff', '#f2b44c', '#c084fc', '#ff5d6c', '#2dd4bf'];
  const plan = { new_categories: [], added: [], updated: [], unchanged: 0, hidden: [] };
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
      const changed = Object.keys(next).some(k => String(next[k] ?? '') !== String(old[k] ?? ''));
      if (!changed) { plan.unchanged++; continue; }
      plan.updated.push(it.name);
      if (apply) db.prepare('UPDATE products SET price=?, category_id=?, sizes=?, description=?, emoji=?, active=? WHERE id=?')
        .run(next.price, next.category_id, next.sizes, next.description, next.emoji, next.active, old.id);
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

module.exports = { readSheet, toMenu, importMenu, TEMPLATE };
