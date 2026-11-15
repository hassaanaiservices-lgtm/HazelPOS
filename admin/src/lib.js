// api(url) = GET, api(url, body) = POST. Goes to this app's own server (server.js), which passes it on to the cloud.
export async function api(url, body) {
  const r = await fetch('/api' + url, body === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-Hazel-Admin': '1' },
  })
  const data = await r.json().catch(() => ({}))
  if (r.status === 401 && !['/login', '/me'].includes(url)) window.dispatchEvent(new Event('admin-logout'))
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`)
  return data
}

export const ago = iso => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
export const today = () => new Date().toISOString().slice(0, 10)
export const daysTo = d => Math.floor((Date.parse(d + 'T23:59:59Z') - Date.now()) / 864e5)
export const usd = n => '$' + (n || 0).toFixed(n >= 10 ? 0 : 2)
export const num = n => (n || 0).toLocaleString('en-US')

// File -> base64 (no "data:...;base64," prefix), for the menu Excel upload
export const fileBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] || '')
  r.onerror = () => reject(new Error('Could not read the file'))
  r.readAsDataURL(file)
})
// Phone photos are shrunk before upload (max 1600 px, JPEG ~300 KB)
export const shrinkImage = file => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => {
    const k = Math.min(1, 1600 / Math.max(img.width, img.height))
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) })
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(img.src)
    resolve(c.toDataURL('image/jpeg', 0.85))
  }
  img.onerror = () => reject(new Error('That file is not a picture'))
  img.src = URL.createObjectURL(file)
})
export const downloadCsv = (filename, rows) => {
  const cell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')
  const csv = rows.map(r => r.map(cell).join(',')).join('\r\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: filename })
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
