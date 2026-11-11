import { useState, useMemo, useEffect } from 'react'
import { api, rs } from './lib'
import { Icon } from './ui'
import { QrCodesModal } from './QrOrders'
import { confirmBox } from './notify'

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

export default function TablesFloor({ tables, onPick, onBack, onRefresh, canEditFloors = false }) {
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
    if (await confirmBox(`Delete "${f.name}" floor? Its tables will be moved to another floor.`)) {
      await api(`/floors/${f.id}/delete`, {})
      await loadFloors()
      if (onRefresh) onRefresh()
    }
  }

  const onFloor = t => activeFloor === 'All' || (t.floor || 'Main Dining') === activeFloor
  const floorTables = tables.filter(onFloor)

  return (
    <section className="tables-floor-view">
      <div className="floor-top-header">
        <div className="header-left">
          <button className="ghost sm" onClick={onBack}><Icon name="back" size={16} />Back</button>
          <h2>Tables</h2>
        </div>
        <div className="floor-global-stats">
          <span className="stat-pill free">Free <b>{freeCount}</b></span>
          <span className="stat-pill busy">Occupied <b>{occupiedCount}</b></span>
          {totalOccupiedRevenue > 0 && <span className="stat-pill">Open bills <b>{rs(totalOccupiedRevenue)}</b></span>}
          <button className="ghost sm" id="qr-codes-btn" onClick={() => setShowQr(true)}><Icon name="qr" size={16} />QR codes</button>
          {canEditFloors && <button className="ghost sm edit-floors-btn" onClick={openFloorManager}><Icon name="edit" size={16} />Floors</button>}
        </div>
      </div>

      <div className="floor-tabs-bar" role="tablist">
        <button className={'floor-tab-btn ' + (activeFloor === 'All' ? 'active' : '')} onClick={() => setActiveFloor('All')}>
          All floors <span className="floor-counter">{tables.length}</span>
        </button>
        {floorTabs.map(f => (
          <button key={f.name} id={`floor-tab-${f.name.replace(/\s+/g, '-').toLowerCase()}`}
            className={'floor-tab-btn ' + (activeFloor === f.name ? 'active' : '')} style={{ '--tab-color': f.color }} onClick={() => setActiveFloor(f.name)}>
            <span className="floor-icon" aria-hidden="true">{f.icon}</span>{f.name}<span className="floor-counter">{f.free}/{f.total} free</span>
          </button>
        ))}
      </div>

      <div className="floor-controls-bar">
        <div className="status-filter-group">
          <button className={'filter-btn ' + (filter === 'all' ? 'active' : '')} onClick={() => setFilter('all')}>All ({floorTables.length})</button>
          <button className={'filter-btn ' + (filter === 'free' ? 'active' : '')} onClick={() => setFilter('free')}>Free ({floorTables.filter(t => !t.order_id).length})</button>
          <button className={'filter-btn ' + (filter === 'occupied' ? 'active' : '')} onClick={() => setFilter('occupied')}>Occupied ({floorTables.filter(t => t.order_id).length})</button>
        </div>
        <div className="table-search-input">
          <input type="search" placeholder="Find a table" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {!filteredTables.length ? (
        <div className="empty-floor-state">
          <h3>No tables match</h3>
          <p>Clear the search or pick another floor.</p>
        </div>
      ) : (
        <div className="floor-tables-grid">
          {filteredTables.map(t => {
            const isOccupied = !!t.order_id
            const tableFloor = t.floor || 'Main Dining'
            const floorColor = floorMeta.get(tableFloor)?.color || t.floor_color
            return (
              <button key={t.id} id={`table-${t.id}`} className={'floor-table-card ' + (isOccupied ? 'occupied' : 'available')}
                style={{ '--floor-c': floorColor }} onClick={() => onPick(t)}>
                <span className="table-card-top">
                  <span className="table-code">{t.name}</span>
                  <span className={'status-indicator ' + (isOccupied ? 'busy' : 'free')}>{isOccupied ? 'Occupied' : 'Free'}</span>
                </span>
                <span className="table-capacity">{t.seats} seats{activeFloor === 'All' && <span className="floor-tag">{tableFloor}</span>}</span>
                {isOccupied && <>
                  <span className="bill-total">{rs(t.total)}</span>
                  <span className="order-meta">
                    <span className="time-tag"><Icon name="clock" size={13} />{formatMins(t.seated_at)}</span>
                    {t.item_count > 0 && <span className="items-tag">{t.item_count} items</span>}
                    {t.open_bills > 1 && <span className="items-tag">{t.open_bills} bills</span>}
                  </span>
                  {t.waiter && <span className="waiter-name">{t.waiter}</span>}
                </>}
              </button>
            )
          })}
        </div>
      )}

      {showQr && <QrCodesModal onClose={() => setShowQr(false)} />}

      {/* Edit Floor Names & Colors Modal */}
      {editingFloors && (
        <div className="modal-bg" onClick={() => setEditingFloors(false)}>
          <div className="modal floor-manager-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header-row">
              <h2>Floors</h2>
              <button className="ghost sm" onClick={() => setEditingFloors(false)} aria-label="Remove"><Icon name="x" size={16} /></button>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 14px 0' }}>
              Rename a floor, change its colour, or add a new dining area. Its tables follow the new name.
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
                      aria-label="Delete floor"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Floor Box */}
            <div className="add-new-floor-box">
              <h4>Add a floor</h4>
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
              <button className="primary" onClick={saveAllFloors}>Save floors</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
