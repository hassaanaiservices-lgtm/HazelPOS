import { toast, toastError, infoBox } from './notify.jsx'
export const api = async (url, body) => {
  const headers = { Authorization: 'Bearer ' + (localStorage.getItem('pos_token') || '') }
  const r = await fetch('/api' + url, body ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { headers })
  const data = await r.json()
  // Expired or revoked session: send the terminal back to the PIN screen
  if (r.status === 401 && url !== '/login') window.dispatchEvent(new Event('pos-logout'))
  // Blocked in the public demo: a popup explaining the real feature. The error has no message, so no red toast as well.
  if (data.code === 'demo') { infoBox(data.error, { title: 'Not in the demo' }); throw Object.assign(new Error(''), { code: 'demo' }) }
  // Logged in with a starting PIN (1234…): the app shows the "Choose your own PIN" screen (ChoosePin.jsx)
  if (data.code === 'change_pin') window.dispatchEvent(new Event('pos-change-pin'))
  if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { code: data.code })
  return data
}
// Rows of objects -> CSV file download (BOM so Excel reads Urdu/Unicode correctly)
export const downloadCsv = (filename, rows) => {
  if (!rows.length) return toast('Nothing to export for this period', 'info')
  const cell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '')
  const csv = [Object.keys(rows[0]), ...rows.map(Object.values)].map(r => r.map(cell).join(',')).join('\r\n')
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: filename })
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
export const parseModifiers = product => {
  try {
    const g = typeof product?.modifiers === 'string' ? JSON.parse(product.modifiers) : product?.modifiers
    return Array.isArray(g) ? g.filter(x => x.name && x.options?.length) : []
  } catch { return [] }
}
export const modsText = mods => (mods || []).map(m => m.name).join(', ')
export const rs = n => 'Rs. ' + Math.round(n || 0).toLocaleString('en-PK')
export const TYPES = [
  { id: 'dine-in', label: 'Dine-in', icon: 'table' },
  { id: 'takeaway', label: 'Takeaway', icon: 'bag' },
  { id: 'delivery', label: 'Delivery', icon: 'bike' },
]
// YYYY-MM-DD in local time, built by hand (toLocaleDateString('en-CA') depends on the runtime's locale data)
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// Same rule as the server's promoAmount, for the live cart preview (the server has the final say)
export const promoPreview = (promo, base) => {
  if (!promo || base < (promo.min_order || 0)) return 0
  let amount = promo.type === 'percent' ? base * promo.value / 100 : promo.value
  if (promo.max_discount) amount = Math.min(amount, promo.max_discount)
  return Math.round(Math.min(amount, base))
}
// Wrap an async handler so API errors show up instead of failing silently
export const run = fn => async (...a) => { try { await fn(...a) } catch (e) { toastError(e.message) } }

// Deals and combos (products.deal_items, products.combo_for)
export const dealItems = p => { try { const d = typeof p?.deal_items === 'string' ? JSON.parse(p.deal_items || '[]') : p?.deal_items; return Array.isArray(d) ? d.filter(x => x?.product_id) : [] } catch { return [] } }
export const isDeal = p => dealItems(p).length > 0
// [{product_id, name, size, qty}] for a deal, names from the menu
export const dealIncludes = (p, products) => dealItems(p).map(d => ({ ...d, qty: Math.max(1, +d.qty || 1), name: products.find(x => x.id === +d.product_id)?.name || 'Item removed' }))
// "2× Zinger Burger, Fries (Regular), Coke 500ml"
export const includesText = list => (list || []).map(d => `${d.qty > 1 ? d.qty + '× ' : ''}${d.name}${d.size ? ` (${d.size})` : ''}`).join(', ')
// Combos offered on an item: deals whose combo_for is this item
export const combosOf = (p, products) => products.filter(x => +x.combo_for === p.id && x.active !== 0 && isDeal(x))
