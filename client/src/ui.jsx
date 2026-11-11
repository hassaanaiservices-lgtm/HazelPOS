// Line icons (24px grid, 1.75 stroke). One set for the whole interface; see /DESIGN.md.
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  flame: 'M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.4-4.8C10.6 10 12 8 12 3z',
  bike: 'M5.5 17.5a3 3 0 1 0 0-.01M18.5 17.5a3 3 0 1 0 0-.01M5.5 17.5 9 9h5l4.5 8.5M9 9 7.5 6H5M14 9l1.5-3H18',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  badge: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11',
  menu: 'M4 6h16M4 12h16M4 18h16',
  x: 'M18 6 6 18M6 6l12 12',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  table: 'M3 10h18M6 10v9M18 10v9M5 6h14l2 4H3z',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  pin: 'M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  cash: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
  card: 'M3 5h18v14H3zM3 10h18M7 15h3',
  check: 'M5 12l5 5L20 7',
  bank: 'M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
}
export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={'icon ' + className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] || PATHS.list} />
    </svg>
  )
}

// Writes each table column's heading onto its cells (data-label), so narrow screens can show tables as stacked cards
export function labelTables() {
  for (const table of document.querySelectorAll('table.tbl')) {
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim())
    for (const row of table.querySelectorAll('tbody tr'))
      [...row.children].forEach((cell, i) => { const label = heads[i] ?? ''; if (cell.dataset.label !== label) cell.dataset.label = label })
  }
}
export function watchTables() {
  let queued = false
  const run = () => { queued = false; labelTables() }
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run) } }).observe(document.body, { childList: true, subtree: true })
  run()
}

// Small add/edit dialog driven by a field list: [key, label, type?, options?]
export function FormModal({ title, fields, value, onChange, onSave, onClose, saveLabel = 'Save', children }) {
  const set = (k, v) => onChange({ ...value, [k]: v })
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        {fields.map(([k, l, type, opts]) => type === 'checkbox' ? (
          <label key={k} className="check"><input type="checkbox" checked={!!value[k]} onChange={e => set(k, e.target.checked ? 1 : 0)} /> {l}</label>
        ) : (
          <label key={k}>{l}
            {type === 'select' ? (
              <select value={value[k] ?? ''} onChange={e => set(k, e.target.value)}>
                {opts.map(o => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={type || 'text'} value={value[k] ?? ''} onChange={e => set(k, e.target.value)} />
            )}
          </label>
        ))}
        {children}
        <div className="actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onSave}>{saveLabel}</button>
        </div>
      </div>
    </div>
  )
}
