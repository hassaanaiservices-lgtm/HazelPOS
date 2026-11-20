// Hourly backups: DATA_DIR/backups/<YYYY-MM-DD-HH>/ (UTC) holds control.db and one <slug>.db per restaurant.
// Kept: the newest 48 hourly folders plus the last folder of each of the 14 newest days. With S3_ENDPOINT, S3_BUCKET, S3_KEY
// and S3_SECRET set (Cloudflare R2, Backblaze B2...), every run is also uploaded (old uploads: set a lifecycle rule on the bucket).
const fs = require('fs');
const path = require('path');
const sqlite = require('node:sqlite');
const tenancy = require('./tenancy');

const ROOT = () => path.join(tenancy.DATA_DIR, 'backups');
const HOURLY = 48, DAILY = 14;
const FOLDER = /^\d{4}-\d{2}-\d{2}-\d{2}$/;
const folderName = d => d.toISOString().slice(0, 13).replace('T', '-');

// Deletes the folders the policy no longer keeps; returns the names it deleted
function rotate(root = ROOT()) {
  const all = fs.existsSync(root) ? fs.readdirSync(root).filter(n => FOLDER.test(n)).sort() : [];
  const keep = new Set(all.slice(-HOURLY));
  const lastOfDay = new Map();
  for (const n of all) lastOfDay.set(n.slice(0, 10), n); // sorted, so the last write per day wins
  [...lastOfDay.values()].slice(-DAILY).forEach(n => keep.add(n));
  const gone = all.filter(n => !keep.has(n));
  for (const n of gone) fs.rmSync(path.join(root, n), { recursive: true, force: true });
  return gone;
}

const s3Config = () => {
  const { S3_ENDPOINT, S3_BUCKET, S3_KEY, S3_SECRET } = process.env;
  return S3_ENDPOINT && S3_BUCKET && S3_KEY && S3_SECRET ? { endpoint: S3_ENDPOINT, bucket: S3_BUCKET, key: S3_KEY, secret: S3_SECRET, region: process.env.S3_REGION || 'auto' } : null;
};

async function upload(cfg, name, files) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'); // loaded only when S3 is set up
  const client = new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true, credentials: { accessKeyId: cfg.key, secretAccessKey: cfg.secret } });
  for (const f of files) await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: `hazelpos-backups/${name}/${path.basename(f)}`, Body: fs.readFileSync(f) }));
}

let running = false;
// One backup run. `date` is injectable so a test can fake the clock.
async function runOnce(date = new Date()) {
  if (running) return null;
  running = true;
  try {
    const name = folderName(date), dir = path.join(ROOT(), name);
    const files = await tenancy.backupAll(dir);
    const ctl = path.join(dir, 'control.db');
    await sqlite.backup(tenancy.control, ctl);
    files.push(ctl);
    const gone = rotate();
    const cfg = s3Config();
    if (cfg) await upload(cfg, name, files).catch(e => console.error('Backup upload failed:', e.message));
    console.log(`Backup ${name}: ${files.length} files${gone.length ? `, removed ${gone.length} old` : ''}${cfg ? ', uploaded' : ''}`);
    return { name, files, removed: gone };
  } catch (e) { console.error('Backup failed:', e.message); return null; }
  finally { running = false; }
}

// Every hour, and once a minute after start so a fresh deploy has a backup soon
function start() {
  setTimeout(() => runOnce(), 60_000).unref();
  setInterval(() => runOnce(), 3_600_000).unref();
}

// Backups that hold this restaurant, newest first: [{ name, size }]
function listFor(slug) {
  const root = ROOT();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(n => FOLDER.test(n) && fs.existsSync(path.join(root, n, `${slug}.db`))).sort().reverse().slice(0, 100)
    .map(name => ({ name, size: fs.statSync(path.join(root, name, `${slug}.db`)).size }));
}
const fileFor = (slug, name) => FOLDER.test(String(name)) ? path.join(ROOT(), name, `${slug}.db`) : null;

module.exports = { listFor, fileFor, start, runOnce, rotate, folderName };
