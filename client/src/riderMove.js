import L from 'leaflet'

// The moving rider on the owner's map. Same as server/public/move.js (rider and customer pages); the look is in App.css (.hz-rider).
const bearing = (a, b) => {
  const r = Math.PI / 180, dl = (b.lng - a.lng) * r
  const y = Math.sin(dl) * Math.cos(b.lat * r), x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos(dl)
  return (Math.atan2(y, x) / r + 360) % 360
}
export const riderIcon = (label, cls = '') => L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22],
  html: `<div class="hz-rider ${cls}"><div class="hz-pulse"></div><div class="hz-arrow"></div><div class="hz-bike">🛵</div>${label ? `<b class="hz-name">${label}</b>` : ''}</div>` })
export const turn = m => { const a = m.getElement()?.querySelector('.hz-arrow'); if (a && m._hzDeg != null) { a.style.transform = `rotate(${m._hzDeg}deg)`; a.style.opacity = 1 } }
// Glide marker m to (lat, lng) over ms, pointing the way it goes. A far jump (over ~5 km) or a hidden tab just moves it.
export function moveMarker(m, lat, lng, ms) {
  const from = m.getLatLng(), d = Math.abs(from.lat - lat) + Math.abs(from.lng - lng)
  if (m._hzRaf) cancelAnimationFrame(m._hzRaf)
  if (d > 0.00004) m._hzDeg = bearing(from, { lat, lng })
  turn(m)
  if (!d || d > 0.05 || document.hidden) return m.setLatLng([lat, lng])
  const start = performance.now()
  const step = t => { const k = Math.min(1, (t - start) / ms); m.setLatLng([from.lat + (lat - from.lat) * k, from.lng + (lng - from.lng) * k]); if (k < 1) m._hzRaf = requestAnimationFrame(step) }
  m._hzRaf = requestAnimationFrame(step)
}
