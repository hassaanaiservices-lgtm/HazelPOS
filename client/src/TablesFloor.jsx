import { useState, useMemo, useEffect } from 'react'
import { api, rs } from './lib'
import { QrCodesModal } from './QrOrders'

const PRESET_COLORS = [
  '#ff9f43', // Warm Amber
  '#a55eea', // Royal Purple
  '#26de81', // Emerald Mint
  '#4bcffa', // Electric Cyan
  '#ff5252', // Coral Crimson
  '#fd79a8', // Rose Pink
  '#eccc68', // Golden Yellow
  '#2ed573', // Lime Green
]

const formatMins = dateStr => {
  if (!dateStr) return null
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.max(0, Math.floor(diffMs / 60000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

export default function TablesFloor({ tables, onPick, onBack, onRefresh }) {
  const [dbFloors, setDbFloors] = useState([])
  const [activeFloor, setActiveFloor] = useState('All')
  const [filter, setFilter] = useState('all') // all | free | occupied
  const [search, setSearch] = useState('')
  const [editingFloors, setEditingFloors] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [floorsList, setFloorsList] = useState([])
  const [newFloorName, setNewFloorName] = useState('')
  const [newFloorIcon, setNewFloorIcon] = useState('🍽️')
  const [newFloorColor, setNewFloorColor] = useState('#ff9f43')

  const loadFloors = async () => {
    const list = await api('/floors')
    setDbFloors(list)
    setFloorsList(list.map(f => ({ ...f })))
  }

  useEffect(() => { loadFloors() }, [])

  // Map floor metadata by name
  const floorMeta = useMemo(() => {
    const map = new Map()
    dbFloors.forEach(f => {
      map.set(f.name, { color: f.color || '#ff9f43', icon: f.icon || '🍽️' })
    })
    return map
  }, [dbFloors])

  // Extract distinct floors with real-time table counts
  const floorTabs = useMemo(() => {
    const map = new Map()

    // First populate from dbFloors so all configured floors appear even if empty
    dbFloors.forEach(f => {
      map.set(f.name, {
        id: f.id,
        name: f.name,
        icon: f.icon || '🍽️',
        color: f.color || '#ff9f43',
        total: 0,
        occupied: 0,
        free: 0,
        seats: 0
      })
    })

    // Now populate counts from tables
    tables.forEach(t => {
      const fName = t.floor || 'Main Dining'
      if (!map.has(fName)) {
        map.set(fName, {
          id: null,
          name: fName,
          icon: t.floor_icon || '🍽️',
          color: t.floor_color || '#ff9f43',
          total: 0,
          occupied: 0,
          free: 0,
          seats: 0
        })
      }
      const data = map.get(fName)
      data.total += 1
      data.seats += t.seats || 4
      if (t.order_id) data.occupied += 1
      else data.free += 1
    })

    return Array.from(map.values())
  }, [dbFloors, tables])

  // Filtered tables list
  const filteredTables = useMemo(() => {
    return tables.filter(t => {
      const f = t.floor || 'Main Dining'
      const matchesFloor = activeFloor === 'All' || f === activeFloor
      const matchesStatus =
        filter === 'all' ||
        (filter === 'free' && !t.order_id) ||
        (filter === 'occupied' && !!t.order_id)
      const matchesSearch =
        !search ||
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        f.toLowerCase().includes(search.toLowerCase())
      return matchesFloor && matchesStatus && matchesSearch
    })
  }, [tables, activeFloor, filter, search])

  // Overall stats
  const totalTables = tables.length
  const occupiedCount = tables.filter(t => t.order_id).length
  const freeCount = totalTables - occupiedCount
  const totalOccupiedRevenue = tables.reduce((acc, t) => acc + (t.total || 0), 0)

  // Current active floor color
  const activeColor = activeFloor === 'All'
    ? '#ff6b35'
    : (floorMeta.get(activeFloor)?.color || '#ff9f43')

  // Floor management modal handlers
  const openFloorManager = () => {
    setFloorsList(dbFloors.map(f => ({ ...f, originalName: f.name })))
    setNewFloorName('')
    setEditingFloors(true)
  }

  const saveAllFloors = async () => {
    for (const f of floorsList) {
      if (f.name && f.name.trim()) {
        await api('/floors', {
          id: f.id,
          name: f.name.trim(),
          icon: f.icon || '🍽️',
          color: f.color || '#ff9f43',
          old_name: f.originalName
        })
      }
    }
    if (newFloorName.trim()) {
      await api('/floors', {
        name: newFloorName.trim(),
        icon: newFloorIcon,
        color: newFloorColor
      })
      setNewFloorName('')
    }
    setEditingFloors(false)
    await loadFloors()
    if (onRefresh) onRefresh()
  }

  const deleteFloor = async (f) => {
    if (confirm(`Delete "${f.name}" floor? Any existing tables will be moved to Main Dining.`)) {
      await api(`/floors/${f.id}/delete`, {})
      await loadFloors()
      if (onRefresh) onRefresh()
    }
  }

  return (
    <section className="tables-floor-view">
      {/* Top Header */}
      <div className="floor-top-header">
        <div className="header-left">
          <button className="ghost sm" onClick={onBack}>← Back</button>
          <div>
            <h2>Floor Plan & Tables</h2>
            <p className="muted" style={{ fontSize: 13, margin: '2px 0 0 0' }}>
              Distinct floor themes and real-time occupancy status
            </p>
          </div>
        </div>

        {/* Global Occupancy Stats & Manage Floors Button */}
        <div className="floor-global-stats">
          <div className="stat-pill">
            <span className="dot free" />
            <span>Available: <b>{freeCount}</b></span>
          </div>
          <div className="stat-pill">
            <span className="dot busy" />
            <span>Occupied: <b>{occupiedCount}</b></span>
          </div>
          {totalOccupiedRevenue > 0 && (
            <div className="stat-pill rev">
              <span>Running: <b>{rs(totalOccupiedRevenue)}</b></span>
            </div>
          )}
          <button className="ghost sm" id="qr-codes-btn" onClick={() => setShowQr(true)}>
            📱 Table QR Codes
          </button>
          <button className="ghost sm edit-floors-btn" onClick={openFloorManager}>
            ✏️ Manage Floors
          </button>
        </div>
      </div>

      {/* Floor Selection Tabs with Distinct Colors */}
      <div className="floor-tabs-bar">
        <button
          className={'floor-tab-btn ' + (activeFloor === 'All' ? 'active' : '')}
          style={{ '--tab-color': '#ff6b35' }}
          onClick={() => setActiveFloor('All')}
        >
          <span className="floor-icon">🏛️</span>
          <span className="floor-name">All Floors</span>
          <span className="floor-counter">{tables.length}</span>
        </button>

        {floorTabs.map(f => (
          <button
            key={f.name}
            id={`floor-tab-${f.name.replace(/\s+/g, '-').toLowerCase()}`}
            className={'floor-tab-btn ' + (activeFloor === f.name ? 'active' : '')}
            style={{ '--tab-color': f.color }}
            onClick={() => setActiveFloor(f.name)}
          >
            <span className="floor-dot" style={{ background: f.color }} />
            <span className="floor-icon">{f.icon}</span>
            <span className="floor-name">{f.name}</span>
            <span className={'floor-counter ' + (f.occupied > 0 ? 'has-occupied' : '')} style={activeFloor === f.name ? { background: f.color, color: '#111' } : {}}>
              {f.free}/{f.total}
            </span>
          </button>
        ))}
      </div>

      {/* Filter and Quick Search Bar */}
      <div className="floor-controls-bar">
        <div className="status-filter-group">
          <button
            className={'filter-btn ' + (filter === 'all' ? 'active' : '')}
            onClick={() => setFilter('all')}
          >
            All Tables ({activeFloor === 'All' ? totalTables : tables.filter(t => (t.floor || 'Main Dining') === activeFloor).length})
          </button>
          <button
            className={'filter-btn free ' + (filter === 'free' ? 'active' : '')}
            onClick={() => setFilter('free')}
          >
            🟢 Available ({activeFloor === 'All' ? freeCount : tables.filter(t => (t.floor || 'Main Dining') === activeFloor && !t.order_id).length})
          </button>
          <button
            className={'filter-btn busy ' + (filter === 'occupied' ? 'active' : '')}
            onClick={() => setFilter('occupied')}
          >
            🟠 Occupied ({activeFloor === 'All' ? occupiedCount : tables.filter(t => (t.floor || 'Main Dining') === activeFloor && t.order_id).length})
          </button>
        </div>

        <div className="table-search-input">
          <input
            placeholder="🔍 Search table name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Floor Canvas Area with Distinct Floor Color Theme */}
      <div className="floor-canvas-container" style={{ '--current-floor-c': activeColor }}>
        {activeFloor !== 'All' && (
          <div className="floor-zone-badge" style={{ borderColor: `${activeColor}60`, background: `linear-gradient(135deg, ${activeColor}18, #181b24ee)` }}>
            <span className="floor-badge-color-strip" style={{ background: activeColor }} />
            <span className="zone-icon">{floorMeta.get(activeFloor)?.icon || '🍽️'}</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ color: activeColor }}>{activeFloor}</h3>
                <span className="floor-color-swatch-sm" style={{ background: activeColor }} />
              </div>
              <small className="muted">
                {tables.filter(t => (t.floor || 'Main Dining') === activeFloor).length} tables •{' '}
                {tables.filter(t => (t.floor || 'Main Dining') === activeFloor).reduce((s, t) => s + (t.seats || 4), 0)} seats capacity
              </small>
            </div>
            <button className="ghost sm edit-this-floor-btn" onClick={openFloorManager}>
              ✏️ Rename / Edit Floor
            </button>
          </div>
        )}

        {!filteredTables.length ? (
          <div className="empty-floor-state">
            <div style={{ fontSize: 48 }}>🍽️</div>
            <h3>No tables found on this floor</h3>
            <p className="muted">Use the search box or check other floors.</p>
          </div>
        ) : (
          <div className="floor-tables-grid">
            {filteredTables.map(t => {
              const isOccupied = !!t.order_id
              const shape = t.shape || (t.seats >= 6 ? 'rect' : 'square')
              const duration = formatMins(t.seated_at)
              const tableFloor = t.floor || 'Main Dining'
              const floorColor = floorMeta.get(tableFloor)?.color || t.floor_color || '#ff9f43'

              return (
                <div
                  key={t.id}
                  id={`table-${t.id}`}
                  className={`floor-table-card ${shape} ${isOccupied ? 'occupied' : 'available'}`}
                  style={{ '--floor-c': floorColor }}
                  onClick={() => onPick(t)}
                >
                  {/* Chairs Styled with Floor Color Tint */}
                  <div className={`table-chair-layout ${shape}-chairs`}>
                    <span className="chair top" />
                    <span className="chair bottom" />
                    {(shape === 'rect' || shape === 'square') && <span className="chair left" />}
                    {(shape === 'rect' || shape === 'square') && <span className="chair right" />}
                    {shape === 'rect' && t.seats >= 8 && (
                      <>
                        <span className="chair top-extra" />
                        <span className="chair bottom-extra" />
                      </>
                    )}
                  </div>

                  {/* Main Table Surface */}
                  <div className="table-surface">
                    <div className="table-card-top">
                      <span className="table-code" style={{ color: isOccupied ? 'var(--text)' : floorColor }}>
                        {t.name}
                      </span>
                      <span className={`status-indicator ${isOccupied ? 'busy' : 'free'}`} style={!isOccupied ? { color: floorColor, borderColor: `${floorColor}60`, background: `${floorColor}18` } : {}}>
                        {isOccupied ? 'Occupied' : 'Free'}
                      </span>
                    </div>

                    <div className="table-capacity">
                      <span>👥 {t.seats} seats</span>
                      <button
                        type="button"
                        className="table-qr-badge-btn"
                        title="View / Print QR Code"
                        onClick={e => { e.stopPropagation(); setShowQr(true); }}
                      >
                        📱 QR
                      </button>
                      {activeFloor === 'All' && (
                        <span className="floor-tag" style={{ borderLeft: `3px solid ${floorColor}` }}>
                          {tableFloor}
                        </span>
                      )}
                    </div>

                    {isOccupied ? (
                      <div className="occupied-bill-info">
                        <div className="bill-total">{rs(t.total)}</div>
                        <div className="order-meta">
                          {duration && <span className="time-tag">⏱️ {duration}</span>}
                          {t.item_count > 0 && <span className="items-tag">{t.item_count} items</span>}
                        </div>
                        {t.waiter && (
                          <div className="waiter-name">Server: {t.waiter}</div>
                        )}
                        <div className="action-hint">Tap to view bill →</div>
                      </div>
                    ) : (
                      <div className="free-table-prompt">
                        <span className="free-cta" style={{ color: floorColor }}>Tap to Open</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showQr && <QrCodesModal onClose={() => setShowQr(false)} />}

      {/* Edit Floor Names & Colors Modal */}
      {editingFloors && (
        <div className="modal-bg" onClick={() => setEditingFloors(false)}>
          <div className="modal floor-manager-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header-row">
              <h2>✏️ Manage Floors & Color Themes</h2>
              <button className="ghost sm" onClick={() => setEditingFloors(false)}>✕</button>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 14px 0' }}>
              Rename floors, change colors, or add new dining sections. Tables update automatically!
            </p>

            <div className="floor-edit-list">
              {floorsList.map((f, idx) => (
                <div key={f.id || idx} className="floor-edit-row">
                  <div className="icon-selector">
                    <input
                      className="emoji-input"
                      title="Floor Icon (Emoji)"
                      value={f.icon || '🍽️'}
                      onChange={e => {
                        const copy = [...floorsList]
                        copy[idx].icon = e.target.value
                        setFloorsList(copy)
                      }}
                    />
                  </div>

                  <div className="name-input-wrap">
                    <label style={{ fontSize: 11, marginBottom: 2 }}>Floor Name</label>
                    <input
                      value={f.name}
                      placeholder="e.g. Main Dining"
                      onChange={e => {
                        const copy = [...floorsList]
                        copy[idx].name = e.target.value
                        setFloorsList(copy)
                      }}
                    />
                  </div>

                  <div className="color-picker-wrap">
                    <label style={{ fontSize: 11, marginBottom: 2 }}>Theme Color</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="color"
                        value={f.color || '#ff9f43'}
                        onChange={e => {
                          const copy = [...floorsList]
                          copy[idx].color = e.target.value
                          setFloorsList(copy)
                        }}
                      />
                      <span className="color-code" style={{ color: f.color }}>{f.color}</span>
                    </div>
                  </div>

                  <div className="row-actions">
                    <button
                      className="ghost sm danger"
                      title="Delete Floor"
                      onClick={() => deleteFloor(f)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Floor Box */}
            <div className="add-new-floor-box">
              <h4>+ Add New Floor / Dining Area</h4>
              <div className="floor-edit-row" style={{ background: 'transparent', padding: 0, border: 'none' }}>
                <input
                  className="emoji-input"
                  title="Icon"
                  value={newFloorIcon}
                  onChange={e => setNewFloorIcon(e.target.value)}
                />
                <input
                  style={{ flex: 1 }}
                  placeholder="New floor name (e.g. Executive Lounge)"
                  value={newFloorName}
                  onChange={e => setNewFloorName(e.target.value)}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="color"
                    value={newFloorColor}
                    onChange={e => setNewFloorColor(e.target.value)}
                  />
                  <span className="color-code" style={{ color: newFloorColor }}>{newFloorColor}</span>
                </div>
              </div>
            </div>

            <div className="actions" style={{ marginTop: 16 }}>
              <button className="ghost" onClick={() => setEditingFloors(false)}>Cancel</button>
              <button className="primary" onClick={saveAllFloors}>Save Changes ✔</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
