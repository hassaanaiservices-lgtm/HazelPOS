// HazelPOS membership (licence). Only on installs that need one: HAZEL_LICENCE=1, which the desktop app sets.
// Your own PC (npm run server) and the public demo never ask for it.
//
// The install is activated with an activation code (HZ-XXXX-XXXX, from your admin app) or the long branch key. The
// cloud's address comes with the installer (HAZEL_CLOUD_URL). Right after activation the POS downloads the restaurant's
// setup (server/setup.js), if you prepared one. Every few
// hours it asks the cloud "is this restaurant's membership paid?" and remembers the last answer.
// Rules (set per client in the admin app; defaults on the cloud: WA_GRACE_DAYS 3, POS_GRACE_DAYS 7):
//   - paid up: everything works. Due within DUE_SOON_DAYS: a reminder banner.
//   - unpaid: a banner; after ai_until the WhatsApp bot stops; after pos_until new orders stop
//   - stopped now (suspended) or cancelled by you: new orders and the bot stop straight away
// Internet doesn't matter: no answer from the cloud never locks anything; the last answer keeps applying.
// "Locked" only stops NEW orders. Open bills can still be paid, and reports and data stay readable.
const DUE_SOON_DAYS = 5;
const crypto = require('crypto');
// S10: answers are signed by the cloud (Ed25519). The public key comes with the installer (HAZEL_LICENCE_PUBKEY, from
// desktop/package.json hazel.licencePublicKey); without it, the key the cloud showed at activation is kept and used.
// With a key, only a valid signed answer for THIS branch key counts: editing or copying the answer locks new orders
// until the POS reaches the cloud again.
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
const DAY = 864e5;

// setup: server/setup.js applier · health: () => what the POS reports to your admin app (version, WhatsApp, errors)
// restore: server/restore.js (a new PC takes the branch's newest cloud backup on activation)
module.exports = function licence(db, cloud, { setup = null, health = () => ({}), restore = null } = {}) {
  const required = process.env.HAZEL_LICENCE === '1';
  // cloud_config is created by cloud-sync.js, which runs first
  const get = k => db.prepare('SELECT value FROM cloud_config WHERE key=?').get(k)?.value || '';
  const set = (k, v) => db.prepare('INSERT INTO cloud_config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));

  // Turning the PC clock back must not stretch the offline days: never use a time earlier than one we've already seen
  const clock = () => Math.max(Date.now(), +get('lic_clock') || 0);
  const tick = () => { const t = clock(); set('lic_clock', t); return t; }; // saved on each check, not on every read

  const base = () => get('url').replace(/\/+$/, '');
  async function call(urlPath, body, timeout = 20000) {
    const r = await fetch(base() + urlPath, {
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(timeout),
      headers: { Authorization: 'Bearer ' + get('key'), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return [r, await r.json().catch(() => ({}))];
  }

  const pubkey = () => (process.env.HAZEL_LICENCE_PUBKEY || get('lic_pubkey') || '').replace(/\\n/g, '\n');
  const keyHash = () => crypto.createHash('sha256').update(get('key')).digest('hex');
  // A signed answer -> its content, or null when the signature, branch key or date doesn't check out
  function verified(signed, sig) {
    try {
      if (!signed || !sig || !crypto.verify(null, Buffer.from(signed), crypto.createPublicKey(pubkey()), Buffer.from(sig, 'base64'))) return null;
      const a = JSON.parse(Buffer.from(signed, 'base64').toString());
      if (a.key_hash !== keyHash()) return null;                                     // issued for another branch/PC
      if (Date.parse(a.issued_at) > Date.now() + 2 * DAY) return null;               // from the future: clock games
      return a;
    } catch { return null; }
  }

  async function check() {
    if (!required || !get('url') || !get('key')) return state();
    let data = {};
    try {
      const [r, d] = await call('/api/licence'); data = d;
      if (r.status === 401) { set('lic_answer', JSON.stringify({ active: false, revoked: true })); set('lic_revoked', '1'); set('lic_checked_at', tick()); }
      else if (r.ok && pubkey()) {
        const a = verified(d.signed, d.sig);
        if (a) { set('lic_signed', d.signed); set('lic_sig', d.sig); set('lic_answer', JSON.stringify(a)); set('lic_revoked', ''); set('lic_checked_at', tick()); set('lic_error', ''); }
        else set('lic_error', 'The answer from HazelPOS Cloud was not signed correctly');
      }
      else if (r.ok) { set('lic_answer', JSON.stringify(d)); set('lic_checked_at', tick()); set('lic_error', ''); }
      else set('lic_error', d.error || `Cloud replied ${r.status}`);
    } catch (e) { tick(); set('lic_error', e.name === 'TimeoutError' ? 'Cloud took too long to answer' : 'Cloud not reachable (no internet?)'); return state(); }
    // You prepared (or finished) the restaurant's setup after they activated: take it now, while there are no orders yet
    if (data.setup_ready && setup && !setup.appliedAt() && !setup.hasOrders()) await pullSetup();
    call('/api/sync/health', { ...health(), licence: state().state, setup_applied_at: setup?.appliedAt() || null, setup_error: get('setup_error') || null })
      .catch(() => {}); // only for your admin app: never matters to the POS
    return state();
  }

  // The restaurant's menu, tables, staff… from the vendor cloud (server/setup.js). Returns what was set up, or null.
  async function pullSetup() {
    if (!setup) return null;
    try {
      const [r, d] = await call('/api/setup', undefined, 60000);
      if (!r.ok || !d.setup) return null;
      const done = setup.apply(d.setup);
      set('setup_error', '');
      await call('/api/setup/applied', { done }).catch(() => {});
      return done;
    } catch (e) {
      set('setup_error', e.message);
      call('/api/setup/applied', { error: e.message }).catch(() => {});
      return null;
    }
  }

  // What the screens show. state: off | activate | ok | due_soon | warning | locked
  const day = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const plus = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
  const answer = () => {
    if (get('lic_revoked') === '1') return { revoked: true };
    // With a public key, the stored answer only counts if its signature still checks out (lic_answer is just a copy)
    const a = pubkey() ? verified(get('lic_signed'), get('lic_sig')) || { tampered: true } : JSON.parse(get('lic_answer') || '{}');
    if (a.paid_until && !a.pos_until) Object.assign(a, { ai_until: plus(a.paid_until, 3), pos_until: plus(a.paid_until, 7) }); // older cloud
    return a;
  };

  // What the screens show. state: off | activate | ok | due_soon | warning | locked
  function state() {
    if (!required) return { state: 'off' };
    if (!get('url') || !get('key') || !get('lic_checked_at')) return { state: 'activate', default_url: process.env.HAZEL_CLOUD_URL || '' };
    const today = day(clock()), a = answer();
    const base = { paid_until: a.paid_until || null, ai_until: a.ai_until || null, pos_until: a.pos_until || null, update_requested_at: a.update_requested_at || null, update_policy: a.update_policy || null, last_check: new Date(+get('lic_checked_at')).toISOString(), error: get('lic_error') };
    if (a.revoked) return { ...base, state: 'locked', message: 'This branch key was removed from HazelPOS Cloud. Contact HazelPOS to reconnect.' };
    if (a.tampered) return { ...base, state: 'locked', message: "HazelPOS couldn't confirm your membership on this PC (the saved details are missing or were changed). Connect to the internet: it fixes itself within a few minutes." };
    if (a.cancelled) return { ...base, state: 'locked', message: 'Your HazelPOS membership was cancelled. New orders and the WhatsApp assistant are off. Contact HazelPOS.' };
    if (a.suspended) return { ...base, state: 'locked', message: 'HazelPOS has paused your membership. New orders and the WhatsApp assistant are off until it is renewed. Contact HazelPOS.' };
    if (!a.paid_until) return a.active === false ? { ...base, state: 'locked', message: 'Your HazelPOS membership has not started yet. Contact HazelPOS.' } : { ...base, state: 'ok' };
    if (today > a.pos_until) return { ...base, state: 'locked', message: `Your HazelPOS membership ended on ${a.paid_until} and wasn't renewed. New orders and the WhatsApp assistant are off until you pay. Contact HazelPOS.` };
    if (today > a.paid_until) return { ...base, state: 'warning', message: today > a.ai_until
      ? `Your HazelPOS membership ended on ${a.paid_until}. The WhatsApp assistant is paused, and new orders stop after ${a.pos_until}. Please pay to keep using HazelPOS.`
      : `Your HazelPOS membership ended on ${a.paid_until}. Please pay: the WhatsApp assistant stops after ${a.ai_until}, and new orders after ${a.pos_until}.` };
    const daysLeft = Math.round((Date.parse(a.paid_until) - Date.parse(today)) / DAY);
    if (daysLeft < DUE_SOON_DAYS) return { ...base, state: 'due_soon', message: `Your HazelPOS membership is due on ${a.paid_until}.` };
    return { ...base, state: 'ok' };
  }

  // May the WhatsApp assistant reply? (server/whatsapp/assistant.js asks before every reply)
  function aiAllowed() {
    if (!required) return true;
    const s = state();
    if (['activate', 'locked'].includes(s.state)) return false;
    return !(s.ai_until && day(clock()) > s.ai_until);
  }

  // First run. code: the short activation code (one use; the cloud swaps it for this branch's key) or the long key.
  // url: empty = the cloud address that came with the installer. Uses cloud sync's own connect.
  async function activate(url, code) {
    url = String(url || process.env.HAZEL_CLOUD_URL || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) throw new Error('Enter the cloud address');
    let key = String(code || '').trim();
    if (/^hz-/i.test(key)) {
      const r = await fetch(url + '/api/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: key }), signal: AbortSignal.timeout(20000) })
        .catch(() => { throw new Error('Cloud not reachable (no internet?)'); });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Cloud replied ${r.status}`);
      key = d.key;
    }
    cloud.hold(true);
    try { await cloud.connect(url, key, { sync: false }); } catch (e) { cloud.hold(false); throw e; }
    if (!process.env.HAZEL_LICENCE_PUBKEY && !get('lic_pubkey')) { // no key in the installer: trust the one shown now
      try { const r = await fetch(url + '/api/licence/public-key', { signal: AbortSignal.timeout(20000) }); if (r.ok) set('lic_pubkey', await r.text()); } catch { /* an older cloud: answers stay unsigned */ }
    }
    set('setup_error', '');
    // A new PC for a branch that already ran: bring its data back (orders, menu, staff…) instead of the setup
    let restored = null;
    if (restore && setup && !setup.hasOrders()) {
      try { restored = await restore.fromCloud(); }
      catch (e) { if (!/No backup/.test(e.message)) set('setup_error', `Backup not restored: ${e.message}`); }
    }
    let s;
    try { s = await check(); } finally { cloud.hold(false); } // check() also downloads the setup if one is ready (skipped after a restore)
    if (s.state === 'activate') throw new Error(get('lic_error') || 'The cloud did not confirm the membership');
    // Nothing was restored or set up for this restaurant: clear the demo restaurant instead of leaving it on a real PC
    let demoCleared = false;
    if (!restored && setup && !setup.appliedAt() && !setup.hasOrders()) { try { demoCleared = setup.clearDemo(); } catch (e) { set('setup_error', `Could not clear the demo data: ${e.message}`); } }
    cloud.syncNow(); // only now: the first backup is of the restored / set-up restaurant, not the demo
    return { ...s, restored, demo_cleared: demoCleared, setup_applied_at: setup?.appliedAt() || null, setup_error: get('setup_error') || null };
  }

  const locked = () => state().state === 'locked';

  if (required) { setTimeout(check, 3000).unref(); setInterval(check, CHECK_EVERY_MS).unref(); }
  return { required, state, check, activate, locked, pullSetup, aiAllowed };
};
