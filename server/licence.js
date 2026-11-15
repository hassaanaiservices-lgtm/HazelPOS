// HazelPOS membership (licence). Only on installs that need one: HAZEL_LICENCE=1, which the desktop app sets.
// Your own PC (npm run server) and the public demo never ask for it.
//
// The install is activated with an activation code (HZ-XXXX-XXXX, from your admin app) or the long branch key. The
// cloud's address comes with the installer (HAZEL_CLOUD_URL). Right after activation the POS downloads the restaurant's
// setup (server/setup.js), if you prepared one. Every few
// hours it asks the cloud "is this restaurant's membership paid?" and remembers the last answer, so billing never stops
// because the internet dropped. Rules (see RISKS.md, L1-L3: not final):
//   - no answer from the cloud for OFFLINE_WARN_DAYS: banner; for OFFLINE_LOCK_DAYS: new orders locked
//   - membership ended: banner for GRACE_DAYS, then new orders locked
//   - suspended by you: new orders locked straight away
// "Locked" only stops NEW orders. Open bills can still be paid, and reports and data stay readable.
const OFFLINE_WARN_DAYS = 3, OFFLINE_LOCK_DAYS = 7, GRACE_DAYS = 3, DUE_SOON_DAYS = 5;
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
const DAY = 864e5;

// setup: server/setup.js applier · health: () => what the POS reports to your admin app (version, WhatsApp, errors)
module.exports = function licence(db, cloud, { setup = null, health = () => ({}) } = {}) {
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

  async function check() {
    if (!required || !get('url') || !get('key')) return state();
    let data = {};
    try {
      const [r, d] = await call('/api/licence'); data = d;
      if (r.status === 401) { set('lic_answer', JSON.stringify({ active: false, revoked: true })); set('lic_checked_at', tick()); }
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
  function state() {
    if (!required) return { state: 'off' };
    if (!get('url') || !get('key') || !get('lic_checked_at')) return { state: 'activate', default_url: process.env.HAZEL_CLOUD_URL || '' };
    const t = clock();
    const a = JSON.parse(get('lic_answer') || '{}');
    const offlineDays = (t - +get('lic_checked_at')) / DAY;
    const base = { paid_until: a.paid_until || null, last_check: new Date(+get('lic_checked_at')).toISOString(), error: get('lic_error') };
    if (a.revoked) return { ...base, state: 'locked', message: 'This branch key was removed from HazelPOS Cloud. Contact HazelPOS to reconnect.' };
    if (a.suspended) return { ...base, state: 'locked', message: 'Your HazelPOS membership is paused. New orders are off until it is renewed. Contact HazelPOS.' };
    if (a.active === false && !a.paid_until) return { ...base, state: 'locked', message: 'Your HazelPOS membership has not started yet. Contact HazelPOS.' };
    if (offlineDays > OFFLINE_LOCK_DAYS) return { ...base, state: 'locked', message: `The POS hasn't reached HazelPOS Cloud for ${Math.floor(offlineDays)} days. Connect this PC to the internet to unlock new orders.` };
    let lic = { ...base, state: 'ok' };
    if (a.paid_until) {
      const daysLeft = Math.floor((Date.parse(a.paid_until + 'T23:59:59') - t) / DAY); // paid_until is the last paid day
      if (daysLeft < -GRACE_DAYS) return { ...base, state: 'locked', message: `Your HazelPOS membership ended on ${a.paid_until}. New orders are off until it is renewed.` };
      if (daysLeft < 0) lic = { ...base, state: 'warning', message: `Your HazelPOS membership ended on ${a.paid_until}. New orders stop in ${GRACE_DAYS + daysLeft + 1} day(s) unless it is renewed.` };
      else if (daysLeft < DUE_SOON_DAYS) lic = { ...base, state: 'due_soon', message: `Your HazelPOS membership is due on ${a.paid_until}.` };
    }
    if (offlineDays > OFFLINE_WARN_DAYS && lic.state !== 'warning')
      lic = { ...base, state: 'warning', message: `The POS hasn't reached HazelPOS Cloud for ${Math.floor(offlineDays)} days. Connect to the internet: new orders stop after ${OFFLINE_LOCK_DAYS} days offline.` };
    return lic;
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
    await cloud.connect(url, key);
    set('setup_error', '');
    const s = await check(); // also downloads the setup if one is ready
    if (s.state === 'activate') throw new Error(get('lic_error') || 'The cloud did not confirm the membership');
    return { ...s, setup_applied_at: setup?.appliedAt() || null, setup_error: get('setup_error') || null };
  }

  const locked = () => state().state === 'locked';

  if (required) { setTimeout(check, 3000).unref(); setInterval(check, CHECK_EVERY_MS).unref(); }
  return { required, state, check, activate, locked, pullSetup };
};
