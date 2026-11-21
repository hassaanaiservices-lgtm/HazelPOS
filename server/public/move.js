// The moving rider on a map (customer tracking page and rider page). The POS has the same in client/src/riderMove.js.
// A 🛵 in a circle, an arrow that turns to the way the rider is going, and a glide from the last spot to the new one,
// so the rider drives across the map instead of jumping every few seconds.
window.HzMove = (() => {
  const css = document.createElement('style');
  css.textContent = `
  .hz-rider { position: relative; width: 44px; height: 44px; }
  .hz-rider .hz-bike { position: absolute; inset: 4px; border-radius: 50%; background: var(--accent); border: 3px solid #fff; display: grid; place-items: center; font-size: 19px; box-shadow: 0 2px 10px rgba(0,0,0,.45); }
  .hz-rider .hz-arrow { position: absolute; inset: 0; opacity: 0; transition: transform .6s ease, opacity .3s; }
  .hz-rider .hz-arrow::before { content: ''; position: absolute; left: 50%; top: -9px; transform: translateX(-50%); border: 8px solid transparent; border-top: 0; border-bottom: 12px solid var(--accent); }
  .hz-rider .hz-pulse { position: absolute; inset: 4px; border-radius: 50%; background: var(--accent); opacity: .35; animation: hz-pulse 2s ease-out infinite; }
  .hz-rider.stale .hz-pulse { display: none; } .hz-rider.stale .hz-bike { filter: grayscale(1); }
  .hz-home { width: 34px; height: 34px; border-radius: 50%; background: var(--ok); border: 3px solid #fff; display: grid; place-items: center; font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
  @keyframes hz-pulse { from { transform: scale(1); opacity: .45; } to { transform: scale(2.4); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .hz-rider .hz-pulse { animation: none; } }`;
  document.head.appendChild(css);
  const bearing = (a, b) => { const r = Math.PI / 180, dl = (b.lng - a.lng) * r;
    const y = Math.sin(dl) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(dl);
    return (Math.atan2(y, x) / r + 360) % 360; };
  const riderIcon = () => L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22], html: '<div class="hz-rider"><div class="hz-pulse"></div><div class="hz-arrow"></div><div class="hz-bike">🛵</div></div>' });
  const homeIcon = () => L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="hz-home">🏠</div>' });
  const turn = m => { const a = m.getElement()?.querySelector('.hz-arrow'); if (a && m._hzDeg != null) { a.style.transform = `rotate(${m._hzDeg}deg)`; a.style.opacity = 1; } };
  // Glide marker m to (lat, lng) over ms. A far jump (over ~5 km) or a hidden page just moves it.
  function move(m, lat, lng, ms) {
    const from = m.getLatLng(), d = Math.abs(from.lat - lat) + Math.abs(from.lng - lng);
    if (m._hzRaf) cancelAnimationFrame(m._hzRaf);
    if (d > 0.00004) m._hzDeg = bearing(from, { lat, lng }); // moved more than a few metres: point the way it goes
    turn(m);
    if (!d || d > 0.05 || document.hidden) return m.setLatLng([lat, lng]);
    const start = performance.now();
    const step = t => { const k = Math.min(1, (t - start) / ms); m.setLatLng([from.lat + (lat - from.lat) * k, from.lng + (lng - from.lng) * k]); if (k < 1) m._hzRaf = requestAnimationFrame(step); };
    m._hzRaf = requestAnimationFrame(step);
  }
  const stale = (m, on) => m.getElement()?.querySelector('.hz-rider')?.classList.toggle('stale', !!on);
  return { riderIcon, homeIcon, move, stale };
})();
