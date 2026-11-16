// Riders' phones and the POS talk through the cloud (cloud/index.js, /api/sync/riders and /r/<token>). A rider on the
// road can't reach the restaurant PC, and a phone's GPS only works on an https page, so the rider's screen lives on
// the cloud. Every few seconds while deliveries are going on (once a minute otherwise):
//   POS -> cloud: the riders (name, phone, the secret in their link) and today's delivery board
//   cloud -> POS: what riders pressed on their phones (Accept, Delivered) and where they are now
// The POS stays the source of truth: a rider's Accept becomes a normal dispatch here, and when it fails (another rider
// was faster) the rider's phone shows why. Positions are kept in memory only; the cloud keeps the day's trail.
module.exports = function riderSync(db, cloud, { getOrder, dispatchOrder, deliverOrder, log = console }) {
  const positions = new Map(); // rider id -> { lat, lng, acc, at, on_duty }: from the cloud (rider's phone page)
  const local = new Map();     // same, from a rider logged in to the POS itself (RiderHome.jsx)
  const FAST = 8000, SLOW = 60000;
  let lastSync = null, lastError = '', timer = null, running = false;

  const board = () => db.prepare(`SELECT id FROM orders WHERE type='delivery' AND status NOT IN ('cancelled','merged')
      AND (status='open' OR delivery_status='out' OR date(COALESCE(delivered_at, paid_at, created_at),'localtime') = date('now','localtime')) ORDER BY id`).all()
    .map(r => getOrder(r.id)).map(o => ({
      local_id: o.id,
      status: o.delivery_status === 'delivered' ? 'delivered' : o.delivery_status === 'out' ? 'out' : ['ready', 'done'].includes(o.kitchen_status) ? 'ready' : 'cooking',
      rider_local_id: o.rider_id || null, customer: o.customer || '', phone: o.phone || '', address: o.address || '', zone: o.zone || '',
      total: o.total, cod: o.status !== 'paid', items: o.items.map(i => `${i.qty}× ${i.name}`).join(', ').slice(0, 300),
      created_at: o.created_at, dispatched_at: o.dispatched_at, delivered_at: o.delivered_at, track_token: o.track_token,
    }));
  const riders = () => db.prepare("SELECT id local_id, name, phone, rider_token token FROM employees WHERE active=1 AND lower(job) LIKE '%rider%' AND rider_token IS NOT NULL").all();
  // Deliveries on, or a rider on duty: poll fast
  const busy = () => [...positions.values(), ...local.values()].some(p => p.on_duty)
    || !!db.prepare("SELECT 1 FROM orders WHERE type='delivery' AND status NOT IN ('cancelled','merged') AND (status='open' OR delivery_status='out') LIMIT 1").get();

  async function tick() {
    if (!cloud.status().connected || cloud.isHeld()) return { skipped: 'cloud not connected' };
    if (running) return { skipped: 'already running' };
    running = true;
    try {
      const mine = () => [...local].filter(([, p]) => p.lat != null).map(([id, p]) => ({ rider_local_id: id, ...p }));
      let r = await cloud.call('/api/sync/riders', { riders: riders(), board: board(), positions: mine() });
      const results = [];
      for (const e of r.events || []) {
        try {
          if (e.type === 'accept') dispatchOrder(e.order_local_id, e.rider_local_id, { byRider: true });
          else if (e.type === 'delivered') deliverOrder(e.order_local_id, { riderId: e.rider_local_id });
          else throw new Error('Unknown action');
          results.push({ id: e.id, result: 'ok' });
        } catch (err) { results.push({ id: e.id, result: err.message }); }
      }
      // Something was applied: send the board again right away with the results, so the phones see it at once
      if (results.length) r = await cloud.call('/api/sync/riders', { riders: riders(), board: board(), ack: results, positions: mine() });
      positions.clear();
      for (const p of r.positions || []) positions.set(+p.rider_local_id, { lat: p.lat, lng: p.lng, acc: p.acc, at: p.at, on_duty: !!p.on_duty });
      lastSync = new Date().toISOString(); lastError = '';
      return { ok: true, events: results.length, positions: positions.size };
    } catch (e) {
      lastError = e.message;
      return { error: e.message };
    } finally { running = false; }
  }

  const schedule = ms => { clearTimeout(timer); timer = setTimeout(loop, ms); timer.unref?.(); };
  async function loop() {
    try { await tick(); } catch (e) { log.error?.('Rider sync:', e.message); }
    schedule(busy() ? FAST : SLOW);
  }
  const poke = () => schedule(300); // something changed here (a dispatch, a new rider): tell the cloud now
  schedule(7000);

  const merged = () => {
    const out = Object.fromEntries(positions);
    for (const [id, p] of local) if (!out[id] || Date.parse(p.at) >= Date.parse(out[id].at || 0)) out[id] = p;
    return out;
  };
  const setLocal = (id, p) => { local.set(+id, { ...p, at: new Date().toISOString() }); };
  return { tick, poke, setLocal, positions: merged, status: () => ({ last_sync: lastSync, last_error: lastError }) };
};
