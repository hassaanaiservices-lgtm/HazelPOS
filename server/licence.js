// HazelPOS membership (licence). Only on installs that need one: HAZEL_LICENCE=1, which the desktop app sets.
// Your own PC (npm run server) and the public demo never ask for it.
//
// The install is activated with HazelPOS Cloud's address and the branch key (the same pair cloud sync uses). Every few
// hours it asks the cloud "is this restaurant's membership paid?" and remembers the last answer, so billing never stops
// because the internet dropped. Rules (see RISKS.md, L1-L3: not final):
//   - no answer from the cloud for OFFLINE_WARN_DAYS: banner; for OFFLINE_LOCK_DAYS: new orders locked
//   - membership ended: banner for GRACE_DAYS, then new orders locked
//   - suspended by you: new orders locked straight away
// "Locked" only stops NEW orders. Open bills can still be paid, and reports and data stay readable.
const OFFLINE_WARN_DAYS = 3, OFFLINE_LOCK_DAYS = 7, GRACE_DAYS = 3, DUE_SOON_DAYS = 5;
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000;
const DAY = 864e5;

module.exports = function licence(db, cloud) {
  const required = process.env.HAZEL_LICENCE === '1';
  // cloud_config is created by cloud-sync.js, which runs first
  const get = k => db.prepare('SELECT value FROM cloud_config WHERE key=?').get(k)?.value || '';
  const set = (k, v) => db.prepare('INSERT INTO cloud_config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));

  // Turning the PC clock back must not stretch the offline days: never use a time earlier than one we've already seen
  const clock = () => Math.max(Date.now(), +get('lic_clock') || 0);
  const tick = () => { const t = clock(); set('lic_clock', t); return t; }; // saved on each check, not on every read

  async function check() {
    if (!required || !get('url') || !get('key')) return state();
    try {
      const r = await fetch(get('url').replace(/\/+$/, '') + '/api/licence', {
        headers: { Authorization: 'Bearer ' + get('key') }, signal: AbortSignal.timeout(20000),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 401) { set('lic_answer', JSON.stringify({ active: false, revoked: true })); set('lic_checked_at', tick()); }
      else if (r.ok) { set('lic_answer', JSON.stringify(data)); set('lic_checked_at', tick()); set('lic_error', ''); }
      else set('lic_error', data.error || `Cloud replied ${r.status}`);
    } catch (e) { tick(); set('lic_error', e.name === 'TimeoutError' ? 'Cloud took too long to answer' : 'Cloud not reachable (no internet?)'); }
    return state();
  }

  // What the screens show. state: off | activate | ok | due_soon | warning | locked
  function state() {
    if (!required) return { state: 'off' };
    if (!get('url') || !get('key') || !get('lic_checked_at')) return { state: 'activate' };
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

  // First run: the cloud address + branch key you give the restaurant. Uses cloud sync's own connect.
  async function activate(url, key) {
    await cloud.connect(url, key);
    const s = await check();
    if (s.state === 'activate') throw new Error(get('lic_error') || 'The cloud did not confirm the membership');
    return s;
  }

  const locked = () => state().state === 'locked';

  if (required) { setTimeout(check, 3000).unref(); setInterval(check, CHECK_EVERY_MS).unref(); }
  return { required, state, check, activate, locked };
};
