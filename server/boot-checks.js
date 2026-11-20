// Production safety checks, run first thing at startup. With NODE_ENV=production the server refuses to start (and says why)
// instead of running with a setting that would lose data or leave a door open.
const fs = require('fs');
const path = require('path');

function problems(env = process.env) {
  const bad = [], warn = [];
  if (env.NODE_ENV !== 'production') return { bad, warn };
  if (String(env.VENDOR_API_KEY || '').trim().length < 32) bad.push('VENDOR_API_KEY is missing or shorter than 32 characters. Make one with: openssl rand -hex 32');
  if (!/^https:\/\//.test(String(env.BASE_URL || ''))) bad.push('BASE_URL is missing or does not start with https:// (it builds the links sent to owners and customers)');
  if (env.OTP_OFF) bad.push('OTP_OFF is set. It switches off the sign-in code and must never be used in production');
  if (env.DEMO) bad.push('DEMO is set. Demo mode has no PINs and must never be used in production');
  const dir = path.resolve(env.DATA_DIR || path.join(__dirname, 'data'));
  try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `.write-test-${process.pid}`); fs.writeFileSync(f, 'x'); fs.unlinkSync(f); }
  catch (e) { bad.push(`DATA_DIR (${dir}) is not writable: ${e.message}`); }
  if (env.RAILWAY_ENVIRONMENT) {
    const vol = env.RAILWAY_VOLUME_MOUNT_PATH && path.resolve(env.RAILWAY_VOLUME_MOUNT_PATH);
    if (!vol || (dir !== vol && !dir.startsWith(vol + path.sep)))
      bad.push(`DATA_DIR (${dir}) is not inside the Railway Volume (${vol || 'no Volume is attached'}). Without that, every deploy would erase all restaurant data. Add a Volume mounted at /data and set DATA_DIR=/data`);
    if (!env.TRUST_PROXY) warn.push('TRUST_PROXY is not set. On Railway set TRUST_PROXY=1, or the rate limits see every visitor as one address');
  }
  return { bad, warn };
}

function check() {
  const { bad, warn } = problems();
  warn.forEach(w => console.warn('WARNING: ' + w));
  if (bad.length) { console.error('HazelPOS cannot start in production:\n- ' + bad.join('\n- ')); process.exit(1); }
}

module.exports = { check, problems };
