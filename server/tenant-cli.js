#!/usr/bin/env node
// Creating restaurants by hand, until the admin panel does it (phase 2). Always set DATA_DIR to pick the data folder.
//   node server/tenant-cli.js create --slug karachi-grill --name "Karachi Grill" --owner-phone 03001234567 --owner-name Ali --password <pw>
//   node server/tenant-cli.js link --slug lahore-bbq --owner-phone 03001234567        (the owner also gets an admin login there)
//   node server/tenant-cli.js add-staff --slug karachi-grill --name Sara --role cashier --pin 4821
//   node server/tenant-cli.js restore <slug> <backup-file>     (old data kept as pos.db.before-restore-*; with the server running, use Admin -> Backups instead)
//   node server/tenant-cli.js list | suspend <slug> | activate <slug>
const crypto = require('crypto');
const tenancy = require('./tenancy');
const { hashPin } = require('./tenant-init');
const { hashPassword, normPhone } = require('./auth');
const { PIN_OK, ROLES, isWeakPin } = require('./pin-rules');

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]; else pos.push(rest[i]); }
const die = msg => { console.error(msg); process.exit(1); };
const need = (...names) => names.forEach(n => { if (!flags[n]) die(`Missing --${n}`); });
const randomPin = () => { for (;;) { const p = String(crypto.randomInt(100000, 1000000)); if (!isWeakPin(p)) return p; } };
const tenantOf = slug => tenancy.bySlug(slug) || die(`No restaurant with the code "${slug}"`);

// The owner's admin login inside a restaurant, with a random PIN (the owner's PIN on tills)
function addOwnerLogin(owner, tenant) {
  const pin = randomPin();
  const userId = tenancy.run(tenant.id, () => Number(tenancy.db.prepare('INSERT INTO users (name,pin,role) VALUES (?,?,?)').run(owner.name || 'Owner', hashPin(pin), 'admin').lastInsertRowid));
  tenancy.control.prepare('INSERT INTO owner_tenants (owner_id, tenant_id, user_id) VALUES (?,?,?)').run(owner.id, tenant.id, userId);
  return pin;
}
const ownerByPhone = phone => tenancy.control.prepare('SELECT * FROM owners WHERE phone=?').get(normPhone(phone));

try {
  if (cmd === 'create') {
    need('slug', 'name', 'owner-phone', 'password');
    const phone = normPhone(flags['owner-phone']);
    if (!phone) die('Enter the owner phone number');
    tenancy.createTenant({ slug: flags.slug, name: flags.name });
    let owner = ownerByPhone(phone);
    if (!owner) {
      const id = Number(tenancy.control.prepare('INSERT INTO owners (phone,name,pass_hash,created_at) VALUES (?,?,?,?)')
        .run(phone, flags['owner-name'] || 'Owner', hashPassword(flags.password), new Date().toISOString()).lastInsertRowid);
      owner = tenancy.control.prepare('SELECT * FROM owners WHERE id=?').get(id);
    }
    const pin = addOwnerLogin(owner, tenancy.bySlug(flags.slug));
    console.log(`Created ${flags.name} (${flags.slug}). Owner ${owner.name} ${phone}. Owner PIN on tills: ${pin}`);
  } else if (cmd === 'link') {
    need('slug', 'owner-phone');
    const owner = ownerByPhone(flags['owner-phone']) || die('No owner with that phone number');
    const t = tenantOf(flags.slug);
    if (tenancy.control.prepare('SELECT 1 FROM owner_tenants WHERE owner_id=? AND tenant_id=?').get(owner.id, t.id)) die('Already linked');
    console.log(`Linked ${owner.name} to ${t.name}. Owner PIN on tills there: ${addOwnerLogin(owner, t)}`);
  } else if (cmd === 'add-staff') {
    need('slug', 'name', 'role', 'pin');
    if (!ROLES.includes(flags.role)) die(`Role must be one of ${ROLES.join(', ')}`);
    if (!PIN_OK(flags.pin)) die('PIN must be 4 to 12 letters or numbers');
    const t = tenantOf(flags.slug);
    tenancy.run(t.id, () => tenancy.db.prepare('INSERT INTO users (name,pin,role) VALUES (?,?,?)').run(flags.name, hashPin(flags.pin), flags.role));
    console.log(`Added ${flags.name} (${flags.role}) to ${t.name}`);
  } else if (cmd === 'list') {
    for (const t of tenancy.control.prepare('SELECT * FROM tenants ORDER BY id').all()) {
      const owners = tenancy.control.prepare('SELECT o.name, o.phone FROM owner_tenants ot JOIN owners o ON o.id=ot.owner_id WHERE ot.tenant_id=?').all(t.id);
      console.log(`${t.slug}\t${t.name}\t${t.status}\tid=${t.id}\t${owners.map(o => `${o.name} ${o.phone}`).join(', ')}`);
    }
  } else if (cmd === 'suspend' || cmd === 'activate') {
    const t = tenantOf(pos[0] || die(`Usage: ${cmd} <slug>`));
    tenancy.control.prepare('UPDATE tenants SET status=? WHERE id=?').run(cmd === 'suspend' ? 'suspended' : 'active', t.id);
    console.log(`${t.name} is now ${cmd === 'suspend' ? 'suspended' : 'active'}`);
  } else if (cmd === 'restore') {
    const t = tenantOf(pos[0] || die('Usage: restore <slug> <backup-file>'));
    const file = require('path').resolve(pos[1] || die('Usage: restore <slug> <backup-file>'));
    if (!require('fs').existsSync(file)) die(`No such file: ${file}`);
    tenancy.restoreTenant(t.id, file);
    console.log(`Restored ${t.name} from ${file}. Start (or restart) the server.`);
  } else die('Commands: create, link, add-staff, list, restore <slug> <file>, suspend <slug>, activate <slug>');
} catch (e) { die(e.message); }
