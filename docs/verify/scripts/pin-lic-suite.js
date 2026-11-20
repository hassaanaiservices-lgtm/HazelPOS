// PIN-1..4, LIC-1, LIC-2, SETUP-1 against git HEAD on installed-app settings (HAZEL_LICENCE=1). Ports 4960-4979.
// Run: PATH=/tmp/claude-1000/hz-verify/bin:$PATH node docs/verify/scripts/pin-lic-suite.js
const L = require('./lib');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dir = path.join(L.SCRATCH, 'pinlic'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const E = {};
const ev = (id, k, v) => { (E[id] ||= {})[k] = v; L.say(id, k, typeof v === 'string' ? v : JSON.stringify(v).slice(0, 700)); };
const q = (file, sql, ...a) => { const d = new DatabaseSync(file); d.exec('PRAGMA busy_timeout = 8000'); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const cloudOpts = { name: 'pl-cloud', port: 4960, waPort: 4962, dsPort: 4961, dataDir: path.join(dir, 'cloud') };
const cloudDb = path.join(cloudOpts.dataDir, 'cloud.db');
const LIC = { HAZEL_LICENCE: '1', WHATSAPP: 'off' };
let cloud;
const posOpts = (n, port) => ({ name: 'pl-' + n, port, waPort: port + 1, db: path.join(dir, n + '.db'), dataDir: path.join(dir, n + '-data'), extraEnv: LIC });

(async () => {
  L.fakeDeepseek(4961);
  cloud = await L.startCloud(cloudOpts);

  // ---------- LIC-1 ----------
  const P = await L.newClient(cloud, 'PinCo');
  let pos = await L.startPos(posOpts('p', 4964));
  ev('LIC-1', 'GET /api/licence before activation', (await pos.api('GET', '/licence')).data);
  const pre = await L.login(pos, '1234');
  ev('LIC-1', 'login 1234 before activation', [pre.status, pre.data]);
  const act = await pos.api('POST', '/licence/activate', { url: cloud.base, code: P.code }, null);
  ev('LIC-1', 'activate with code', [act.status, act.data.state, act.data.error]);
  const pos2 = await L.startPos(posOpts('p2', 4966));
  const reuse = await pos2.api('POST', '/licence/activate', { url: cloud.base, code: P.code }, null);
  ev('LIC-1', 'same code on a second fresh POS', [reuse.status, reuse.data.error]);
  const X = await L.newClient(cloud, 'ExpiredCo');
  q(cloudDb, 'UPDATE branches SET code_created_at=? WHERE id=? RETURNING id', new Date(Date.now() - 15 * 864e5).toISOString(), X.branch_id);
  const exp = await pos2.api('POST', '/licence/activate', { url: cloud.base, code: X.code }, null);
  ev('LIC-1', 'expired code (15 days old)', [exp.status, exp.data.error]);
  const wrong = await pos2.api('POST', '/licence/activate', { url: cloud.base, code: 'HZ-AAAA-BBBB' }, null);
  ev('LIC-1', 'wrong code', [wrong.status, wrong.data.error]);
  ev('LIC-1', 'login on second POS still blocked', (await L.login(pos2, '1234')).status);
  await L.stopProc(pos2.p);

  // ---------- PIN-4 (POS side) ----------
  const lg = await L.login(pos, '1234');
  ev('PIN-4', 'login 1234 after activation', [lg.status, lg.data.user]);
  const cand = ['1234', '1111', '2222', '3333', '0000', '4321', 'abc', 'ab_12', '1234567890123', '123456', 'abcd', 'Ab12Cd'];
  const matrix = {};
  for (const p of cand) { const r = await pos.api('POST', '/me/pin', { pin: p }); matrix[p] = { pos_me_pin: r.status === 200 ? 'accept' : `reject (${r.data.error})` }; }
  const lower = await L.login(pos, 'ab12cd');
  ev('PIN-4', "login 'ab12cd' after setting 'Ab12Cd'", [lower.status, lower.data.user?.name]);
  const cashierLogin1111 = await pos.api('POST', '/login', { pin: '1111' }, null);
  ev('PIN-4', 'cashier with starting PIN 1111', [cashierLogin1111.status, cashierLogin1111.data.error]);
  // Admin setup + Set PIN surfaces on the cloud
  for (const p of cand) {
    const s = await cloud.v('POST', `/branches/${X.branch_id}/setup`, { staff: [{ name: 'Owner', role: 'admin', pin: p }] });
    matrix[p].cloud_setup = s.status === 200 ? 'accept' : `reject (${s.data.error})`;
  }
  // POS users list for the cloud: pushed by pushPins (25 s after start) and with the health report
  const known = await L.waitFor(async () => { const r = await cloud.v('GET', `/branches/${P.branch_id}/pins`); return r.data.length ? r.data : null; }, 60000, 3000);
  ev('PIN-1', 'logins known to the cloud', known);
  for (const p of cand) {
    const s = await cloud.v('POST', `/branches/${P.branch_id}/pin-reset`, { user_id: 3, pin: p }); // kitchen login: harmless target
    matrix[p].cloud_set_pin = s.status === 200 ? 'accept' : `reject (${s.data.error})`;
  }
  ev('PIN-4', 'matrix', matrix);
  // the last accepted Set PIN for kitchen is pending; it applies within a minute (harmless)

  // ---------- PIN-1 / PIN-3 ----------
  const setCash = await pos.api('POST', '/users', { id: 2, name: 'Cashier', role: 'cashier', pin: 'cash9876' });
  ev('PIN-1', 'owner sets cashier PIN cash9876', setCash.status);
  const cs = await pos.api('POST', '/login', { pin: 'cash9876' }, null);
  const cashierToken = cs.data.token;
  const t0 = Date.now();
  const rs = await cloud.v('POST', `/branches/${P.branch_id}/pin-reset`, { user_id: 2, pin: 'temp5678', force_change: true });
  ev('PIN-1', 'reset with force_change:true (API only; admin UI never sends it)', [rs.status, rs.data]);
  // Poll the cloud row (polling the login would trip the 5-wrong-PINs lockout), then log in once
  const applied = await L.waitFor(async () => q(cloudDb, 'SELECT applied_at, result FROM pin_resets WHERE branch_id=? AND user_id=2 ORDER BY id DESC LIMIT 1', P.branch_id)[0]?.applied_at, 90000, 2000);
  const works = await pos.api('POST', '/login', { pin: 'temp5678' }, null);
  ev('PIN-1', 'temp PIN applied on POS after s', applied ? ((Date.parse(applied) - t0) / 1000).toFixed(1) : 'not within 90 s');
  ev('PIN-1', 'login with temp PIN', works.status);
  ev('PIN-1', 'login response', works?.data.user);
  ev('PIN-1', 'blocked until changed (GET /api/orders with temp session)', works && (await pos.api('GET', '/orders', undefined, works.data.token)).data);
  ev('PIN-1', 'old cashier session after reset', (await pos.api('GET', '/orders', undefined, cashierToken)).status);
  ev('PIN-1', 'choose new PIN', works && (await pos.api('POST', '/me/pin', { pin: 'cashnew42' }, works.data.token)).status);
  ev('PIN-1', 'cloud pin_resets rows', q(cloudDb, 'SELECT id, user_id, pin IS NULL pin_null, applied_at, result, force_change FROM pin_resets WHERE branch_id=? ORDER BY id', P.branch_id));
  // PIN-3: Set PIN as the admin app sends it (no force_change)
  const t3 = Date.now();
  const rs3 = await cloud.v('POST', `/branches/${P.branch_id}/pin-reset`, { user_id: 2, pin: 'setpin7788' });
  const ap3 = await L.waitFor(async () => q(cloudDb, 'SELECT applied_at FROM pin_resets WHERE branch_id=? AND user_id=2 ORDER BY id DESC LIMIT 1', P.branch_id)[0]?.applied_at, 90000, 2000);
  const w3r = await pos.api('POST', '/login', { pin: 'setpin7788' }, null); const w3 = w3r.status === 200 ? w3r : null;
  ev('PIN-3', 'Set PIN (admin app body {user_id, pin})', { status: rs3.status, works_after_s: ap3 ? ((Date.parse(ap3) - t3) / 1000).toFixed(1) : 'no', login: w3r.status, login_user: w3?.data.user });
  ev('PIN-3', 'pin_resets force_change', q(cloudDb, 'SELECT force_change, result FROM pin_resets WHERE branch_id=? ORDER BY id DESC LIMIT 1', P.branch_id));
  ev('PIN-3', 'can work straight away (GET /api/orders)', w3 && (await pos.api('GET', '/orders', undefined, w3.data.token)).status);

  // ---------- PIN-2: offline ----------
  await L.stopProc(pos.p);
  const r0 = await cloud.v('POST', `/branches/${P.branch_id}/pin-reset`, { user_id: 2, pin: 'first1234' });
  const r1 = await cloud.v('POST', `/branches/${P.branch_id}/pin-reset`, { user_id: 2, pin: 'offl1234' });
  ev('PIN-2', 'two resets while POS off', [r0.status, r1.status]);
  ev('PIN-2', 'rows (newer replaces older)', q(cloudDb, 'SELECT id, pin IS NULL pin_null, applied_at IS NOT NULL applied, result FROM pin_resets WHERE branch_id=? ORDER BY id DESC LIMIT 2', P.branch_id));
  await L.stopProc(cloud.p);
  pos = await L.startPos(posOpts('p', 4964));
  ev('PIN-2', 'old PIN with cloud unreachable', (await pos.api('POST', '/login', { pin: 'setpin7788' }, null)).status);
  ev('PIN-2', 'licence state offline', (await pos.api('GET', '/licence')).data.state);
  const pdb = path.join(dir, 'p.db');
  ev('LIC-1', 'activated WITHOUT a setup, after one restart: demo data back?', { demo_cleared_at: q(pdb, "SELECT value FROM settings WHERE key='demo_cleared_at'")[0]?.value,
    products: q(pdb, 'SELECT COUNT(*) c FROM products')[0].c, sample: q(pdb, 'SELECT name FROM products ORDER BY id LIMIT 3').map(r => r.name),
    expenses: q(pdb, 'SELECT title, amount FROM expenses'), tables: q(pdb, 'SELECT COUNT(*) c FROM tables_')[0].c, open_register: q(pdb, "SELECT opened_by, opening_cash FROM register_sessions WHERE status='open'") });
  q(cloudDb, "UPDATE pin_resets SET created_at=? WHERE branch_id=? AND applied_at IS NULL RETURNING id", new Date(Date.now() - 25 * 3600e3).toISOString(), P.branch_id);
  cloud = await L.startCloud(cloudOpts);
  await L.sleep(75000);
  ev('PIN-2', 'after 25 h back-date and POS online 75 s', { temp_pin: (await pos.api('POST', '/login', { pin: 'offl1234' }, null)).status, old_pin: (await pos.api('POST', '/login', { pin: 'setpin7788' }, null)).status,
    rows: q(cloudDb, 'SELECT id, pin IS NULL pin_null, result FROM pin_resets WHERE branch_id=? ORDER BY id DESC LIMIT 2', P.branch_id) });

  // ---------- LIC-2 ----------
  await L.login(pos, 'setpin7788'); // cashier
  const cashTok = pos.token;
  await L.login(pos, 'ab12cd'); // owner
  const menu = (await pos.api('GET', '/menu')).data.products;
  ev('LIC-2', 'menu after activation without setup (demo cleared?)', menu.length);
  // demo menu was cleared: add a product to sell
  const cat = (await pos.api('POST', '/categories', { name: 'Test', color: '#888' })).data;
  const prod = (await pos.api('POST', '/products', { name: 'Tea', price: 100, category_id: cat.id, active: 1 })).data;
  await pos.api('POST', '/register/open', { opening_cash: 0 });
  const open1 = await pos.api('POST', '/orders', { type: 'takeaway', items: [{ product_id: prod.id, qty: 1 }] });
  ev('LIC-2', 'open order before unpaid', [open1.status, open1.data.id]);
  ev('LIC-2', 'owner marked unpaid (paid_until 2026-01-01)', (await cloud.v('POST', `/owners/${P.owner_id}`, { paid_until: '2026-01-01' })).data.pos_active);
  ev('LIC-2', 'licence check', (await pos.api('POST', '/licence/check', {})).data.state);
  const newOrder = await pos.api('POST', '/orders', { type: 'takeaway', items: [{ product_id: prod.id, qty: 1 }] });
  ev('LIC-2', 'new order while locked', [newOrder.status, newOrder.data.error]);
  const pay = await pos.api('POST', `/orders/${open1.data.id}/pay`, { method: 'cash', paid: 1000 });
  ev('LIC-2', 'pay the open order while locked', [pay.status, pay.data.status]);
  const today = new Date().toISOString().slice(0, 10);
  ev('LIC-2', 'reports while locked', (await pos.api('GET', `/reports?from=${today}&to=${today}`)).status);
  ev('LIC-2', 'cashier new order while locked', (await pos.api('POST', '/orders', { type: 'takeaway', items: [{ product_id: prod.id, qty: 1 }] }, cashTok)).status);
  // Forge: change the stored signed answer to "paid until 2099"
  const posDb = path.join(dir, 'p.db');
  const signed = q(posDb, "SELECT value FROM cloud_config WHERE key='lic_signed'")[0].value;
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(signed, 'base64').toString()), paid_until: '2099-01-01', ai_until: '2099-01-04', pos_until: '2099-01-08', active: true, pos_active: true })).toString('base64');
  q(posDb, "UPDATE cloud_config SET value=? WHERE key='lic_signed' RETURNING key", forged);
  q(posDb, "UPDATE cloud_config SET value=? WHERE key='lic_answer' RETURNING key", JSON.stringify({ paid_until: '2099-01-01', pos_until: '2099-01-08', ai_until: '2099-01-04', active: true }));
  const lf = (await pos.api('GET', '/licence')).data;
  ev('LIC-2', 'forged signed answer (paid 2099)', { state: lf.state, message: lf.message });
  ev('LIC-2', 'new order with forged answer', (await pos.api('POST', '/orders', { type: 'takeaway', items: [{ product_id: prod.id, qty: 1 }] })).status);
  // Forged answer from a fake "cloud" (wrong key): check() must not store it
  ev('LIC-2', 'paid again', (await cloud.v('POST', `/owners/${P.owner_id}/extend`, { months: 1 })).data.pos_active);
  ev('LIC-2', 'licence check after paying', (await pos.api('POST', '/licence/check', {})).data.state);
  ev('LIC-2', 'new order after paying', (await pos.api('POST', '/orders', { type: 'takeaway', items: [{ product_id: prod.id, qty: 1 }] })).status);
  await L.stopProc(pos.p);

  // ---------- SETUP-1 ----------
  const S = await L.newClient(cloud, 'SetupCo');
  const setup1 = {
    restaurant: { name: 'Karachi Grill', address: 'Main Blvd', phone: '0421234567' },
    menu: [{ category: 'BBQ', name: 'Tikka', price: 500 }, { category: 'BBQ', name: 'Seekh Kabab', price: 400 }],
    zones: [{ name: 'Gulberg', fee: 100 }],
    staff: [{ name: 'Owner S', role: 'admin', pin: 'own3r77' }, { name: 'Cash S', role: 'cashier', pin: 'cash3r77' },
      { name: 'Rider Bilal', role: 'rider', pin: 'ride7788', phone: '03001112222', delivery_fee: 150 }],
  };
  ev('SETUP-1', 'save setup', (await cloud.v('POST', `/branches/${S.branch_id}/setup`, setup1)).status);
  ev('SETUP-1', 'cloud copy of rider', (await cloud.v('GET', `/branches/${S.branch_id}/setup`)).data.setup.staff.find(u => u.role === 'rider'));
  const sp = await L.startPos(posOpts('s', 4968));
  const sact = await sp.api('POST', '/licence/activate', { url: cloud.base, code: S.code }, null);
  ev('SETUP-1', 'activate', [sact.status, sact.data.state, sact.data.setup_applied_at, sact.data.setup_error, sact.data.demo_cleared]);
  const sdb = path.join(dir, 's.db');
  const snap = () => ({
    name: q(sdb, "SELECT value FROM settings WHERE key='name'")[0].value, logo: q(sdb, "SELECT value FROM settings WHERE key='logo'")[0].value,
    products: q(sdb, 'SELECT name, price FROM products ORDER BY id').map(p => `${p.name} ${p.price}`), users: q(sdb, 'SELECT name, role, must_change_pin FROM users ORDER BY id'),
    riders: q(sdb, "SELECT name, phone, delivery_fee FROM employees WHERE lower(job) LIKE '%rider%'"), zones: q(sdb, 'SELECT name, fee FROM delivery_zones').length,
    demo_leftovers: { customers: q(sdb, 'SELECT COUNT(*) c FROM customers')[0].c, promos: q(sdb, 'SELECT COUNT(*) c FROM promos')[0].c, faq: q(sdb, 'SELECT COUNT(*) c FROM faq')[0].c,
      expenses: q(sdb, 'SELECT COUNT(*) c FROM expenses')[0].c, bank: q(sdb, "SELECT value FROM settings WHERE key='bank_account'")[0]?.value },
  });
  ev('SETUP-1', 'after activation', snap());
  const ol = await L.login(sp, 'own3r77');
  ev('SETUP-1', 'owner login with setup PIN', [ol.status, ol.data.user]);
  ev('SETUP-1', 'owner chooses own PIN', (await sp.api('POST', '/me/pin', { pin: 'mine2468' })).status);
  ev('SETUP-1', 'change setup (add item, rename)', (await cloud.v('POST', `/branches/${S.branch_id}/setup`, { restaurant: { name: 'Karachi Grill 2' }, menu: [...setup1.menu, { category: 'BBQ', name: 'Malai Boti', price: 650 }] })).status);
  ev('SETUP-1', 'licence/check (else up to 3 h)', (await sp.api('POST', '/licence/check', {}, null)).data.state);
  await L.sleep(3000);
  const s2 = snap();
  ev('SETUP-1', 'after change', { name: s2.name, products: s2.products, users: s2.users });
  ev('SETUP-1', 'POS-chosen owner PIN still works after re-apply', (await L.login(sp, 'mine2468')).status);
  await L.login(sp, 'mine2468');
  await sp.api('POST', '/register/open', { opening_cash: 0 });
  const pid = q(sdb, 'SELECT id FROM products LIMIT 1')[0].id;
  ev('SETUP-1', 'first order', (await sp.api('POST', '/orders', { type: 'takeaway', items: [{ product_id: pid, qty: 1 }] })).status);
  await cloud.v('POST', `/branches/${S.branch_id}/setup`, { menu: [{ category: 'X', name: 'Should Not Arrive', price: 1 }] });
  await sp.api('POST', '/licence/check', {}, null);
  await L.sleep(3000);
  ev('SETUP-1', 'after order + change', { products: snap().products, cloud_summary: (await cloud.v('GET', `/branches/${S.branch_id}/setup`)).data.summary });
  await L.stopProc(sp.p); const sp2 = await L.startPos(posOpts('s', 4968));
  ev('SETUP-1', 'after a restart of the set-up POS', { ...snap(), tables: q(sdb, 'SELECT name FROM tables_').map(r => r.name), open_register: q(sdb, "SELECT opened_by, opening_cash FROM register_sessions WHERE status='open'"), expenses: q(sdb, 'SELECT title, amount FROM expenses') });
  await L.stopProc(sp2.p);

  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1));
  L.say('done');
  process.exit(0);
})().catch(e => { console.error('FAILED', e); fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(E, null, 1)); process.exit(1); });
