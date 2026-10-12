export const api = async (url, body) => {
  const r = await fetch('/api' + url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || 'Request failed')
  return data
}
export const rs = n => 'Rs. ' + Math.round(n || 0).toLocaleString('en-PK')
export const TYPES = [
  { id: 'dine-in', label: 'Dine-in', icon: '🍽️' },
  { id: 'takeaway', label: 'Takeaway', icon: '🛍️' },
  { id: 'delivery', label: 'Delivery', icon: '🛵' },
]
export const localDate = (d = new Date()) => d.toLocaleDateString('en-CA')
