// Restore this POS from HazelPOS Cloud's newest backup of its branch: orders, history, menu, staff (hashed PINs),
// customers, stock, settings, WhatsApp chats. Used on a new PC right after activation (server/licence.js), and by the
// owner's "Restore from cloud backup" button.
//
// The live database stays open: the backup is attached and copied table by table inside one transaction, so a
// failure changes nothing. Kept as they are on this PC: the cloud connection and licence (cloud_config, it's this
// install's key) and logins (sessions: everyone logs in again). Columns are matched by name, so a backup from an
// older version (fewer columns) still restores.
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP = new Set(['cloud_config', 'sessions']);

module.exports = function restorer(db, cloud) {
  async function fromCloud() {
    const { buffer, at } = await cloud.downloadLatestBackup(); // throws 'No backup of this branch yet' etc.
    if (buffer.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error('The backup from the cloud is not a database file');
    const file = path.join(os.tmpdir(), `hazelpos-restore-${process.pid}-${Date.now()}.db`);
    fs.writeFileSync(file, buffer);
    try {
      db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS bk`);
      try {
        const tables = db.prepare("SELECT name FROM bk.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name)
          .filter(t => !KEEP.has(t) && db.prepare("SELECT 1 FROM main.sqlite_master WHERE type='table' AND name=?").get(t));
        if (!tables.includes('orders') || !tables.includes('products')) throw new Error('That backup is not a HazelPOS database');
        const counts = {};
        db.exec('BEGIN');
        try {
          for (const t of tables) {
            const mine = new Set(db.prepare(`PRAGMA main.table_info("${t}")`).all().map(c => c.name));
            const cols = db.prepare(`PRAGMA bk.table_info("${t}")`).all().map(c => c.name).filter(c => mine.has(c)).map(c => `"${c}"`).join(',');
            db.exec(`DELETE FROM main."${t}"`);
            db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM bk."${t}"`);
            if (['orders', 'products', 'users', 'customers'].includes(t)) counts[t] = db.prepare(`SELECT COUNT(*) c FROM main."${t}"`).get().c;
          }
          db.exec('DELETE FROM sessions');
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        // A restored POS must not get the vendor's setup applied on top of it
        db.prepare("INSERT INTO settings (key,value) VALUES ('setup_applied_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
        return { at, ...counts };
      } finally { db.exec('DETACH DATABASE bk'); }
    } finally { fs.rmSync(file, { force: true }); }
  }
  return { fromCloud };
};
