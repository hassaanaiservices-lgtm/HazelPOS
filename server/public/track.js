(() => {
  const [, , slug, token] = location.pathname.split('/'); // /track/<restaurant>/<token>
  const $ = id => document.getElementById(id);
  const rs = n => 'Rs ' + Math.round(+n || 0).toLocaleString('en-PK');
  const mins = iso => iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 0;
  const km = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  let map, rider, home, trail = [], line;
  const showMap = (r, c) => {
    const el = $('map'); el.style.display = 'block';
    if (!map) {
      map = L.map('map', { zoomControl: true }).setView([r.lat, r.lng], 15);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      rider = L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', html: '<div class="rider-marker">🛵</div>', iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(map);
      if (c) home = L.marker([c.lat, c.lng], { icon: L.divIcon({ className: '', html: '<div class="home-marker">🏠</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(map);
      line = L.polyline([], { color: '#ff7a1a', weight: 3, opacity: .6 }).addTo(map);
      if (c) map.fitBounds([[r.lat, r.lng], [c.lat, c.lng]], { padding: [40, 40] });
    } else rider.setLatLng([r.lat, r.lng]);
    const last = trail[trail.length - 1];
    if (!last || last[0] !== r.lat || last[1] !== r.lng) { trail.push([r.lat, r.lng]); line.setLatLngs(trail); }
  };
  async function load() {
    let d;
    try { const res = await fetch('/api/track/' + token, { headers: { 'x-tenant': slug } }); d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(res.status === 404 || res.status === 401 ? 'This link does not work any more. Ask the restaurant for a new one.' : d.error); }
    catch (e) {
      if (e instanceof TypeError) return; // offline: keep what is on screen and retry
      $('fatal').textContent = e.message || 'This link does not work. Ask the restaurant for a new one.'; $('fatal').hidden = false; document.body.classList.add('invalid'); return;
    }
    $('title').textContent = `Order #${d.order}`; $('restaurant').textContent = 'from ' + d.restaurant; document.title = `Order #${d.order} · ${d.restaurant}`;
    const st = $('status'); st.className = 'status ' + d.status;
    ['s1', 's2', 's3'].forEach(id => $(id).className = 'step');
    if (d.status === 'delivered') { st.textContent = '✅ Delivered'; $('detail').textContent = `${mins(d.delivered_at)} min ago. Enjoy your meal!`; ['s1', 's2', 's3'].forEach(id => $(id).classList.add('done')); $('map').style.display = 'none'; return; }
    if (d.status === 'out') {
      $('s1').classList.add('done'); $('s2').classList.add('now');
      st.textContent = `🛵 On the way${d.rider ? ' with ' + d.rider.name : ''}`;
      let detail = `Left ${mins(d.dispatched_at)} min ago.`;
      if (d.rider && d.rider.lat != null) {
        const age = Math.round((Date.now() - Date.parse(d.rider.at)) / 1000);
        detail += age > 120 ? ` Rider's location is ${Math.round(age / 60)} min old.` : '';
        showMap(d.rider);
      } else detail += " The rider's location isn't available right now.";
      $('detail').textContent = detail; return;
    }
    $('s1').classList.add('now');
    st.textContent = d.status === 'ready' ? '👨‍🍳 Packed, rider leaving soon' : '👨‍🍳 Being prepared';
    $('detail').textContent = 'This page updates by itself.';
  }
  load(); setInterval(load, 10000);
})();
