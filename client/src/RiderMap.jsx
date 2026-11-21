import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from './lib'

// Riders on a map. Their phones send positions to the server (rider page /r/<slug>/<token>); the POS asks every 10 s.
// Map tiles come from OpenStreetMap, so the map needs internet; the rest of the POS does not.
const ago = iso => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago` }
const esc = s => String(s).replace(/[<>&"']/g, '')

export default function RiderMap({ height = 340 }) {
  const box = useRef(null), map = useRef(null), markers = useRef(new Map()), fitted = useRef(false)
  const [d, setD] = useState(null)
  useEffect(() => {
    const load = () => api('/riders/positions').then(setD).catch(() => {})
    load(); const t = setInterval(load, 10000); return () => clearInterval(t)
  }, [])
  const riders = (d?.riders || []).filter(r => r.lat != null)
  useEffect(() => {
    if (!box.current) return
    if (!map.current) {
      map.current = L.map(box.current).setView([31.52, 74.35], 12) // Lahore until a rider shows up
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin', attribution: '© OpenStreetMap' }).addTo(map.current)
    }
    const seen = new Set()
    for (const r of riders) {
      seen.add(r.id)
      const stale = Date.now() - Date.parse(r.at) > 3 * 60e3
      const icon = L.divIcon({ className: '', iconSize: [160, 36], iconAnchor: [18, 18],
        html: `<div class="rider-pin${r.on_road ? ' busy' : ''}${stale || !r.on_duty ? ' stale' : ''}"><span>🛵</span><b>${esc(r.name)}</b></div>` })
      let m = markers.current.get(r.id)
      if (!m) { m = L.marker([r.lat, r.lng], { icon }).addTo(map.current); markers.current.set(r.id, m) } else { m.setLatLng([r.lat, r.lng]); m.setIcon(icon) }
      m.bindTooltip(`${esc(r.name)}: ${r.on_road ? `${r.on_road} order(s) out` : r.on_duty ? 'free' : 'off duty'}, seen ${ago(r.at)}`)
    }
    for (const [id, m] of markers.current) if (!seen.has(id)) { m.remove(); markers.current.delete(id) }
    if (riders.length && !fitted.current) { map.current.fitBounds(riders.map(r => [r.lat, r.lng]), { padding: [40, 40], maxZoom: 15 }); fitted.current = true }
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { map.current?.remove(); map.current = null; markers.current.clear() }, [])
  const foot = !d ? 'Loading…'
    : !d.cloud ? 'Rider locations are not available.'
    : !riders.length ? 'No rider has shared a location yet. Riders press "On duty" on their phone screen (Riders → Phone link).'
    : riders.map(r => `${r.name}: ${r.on_road ? 'delivering' : r.on_duty ? 'free' : 'off duty'}, ${ago(r.at)}`).join(' · ')
  return (
    <div className="rider-map-wrap">
      <div ref={box} className="rider-map" style={{ height }} aria-label="Map of riders" />
      <div className="muted rider-map-foot">{foot}{d?.last_error && d.cloud ? ` · Last sync problem: ${d.last_error}` : ''}</div>
    </div>
  )
}
