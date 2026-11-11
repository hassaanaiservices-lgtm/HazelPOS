import { useEffect, useState } from 'react'
import { api, rs, localDate, downloadCsv } from './lib'
import { Icon } from './ui'

const RANGES = {
  Today: () => [localDate(), localDate()],
  Yesterday: () => { const d = new Date(Date.now() - 864e5); return [localDate(d), localDate(d)] },
  '7 days': () => [localDate(new Date(Date.now() - 6 * 864e5)), localDate()],
  'This month': () => { const d = new Date(); return [localDate(new Date(d.getFullYear(), d.getMonth(), 1)), localDate()] },
}

export default function Reports() {
  const [range, setRange] = useState(RANGES.Today())
  const [label, setLabel] = useState('Today')
  const [r, setR] = useState(null)
  useEffect(() => { api(`/reports?from=${range[0]}&to=${range[1]}`).then(setR) }, [range])
  if (!r) return null

  const hours = Array.from({ length: 24 }, (_, h) => r.byHour.find(x => x.hour === h)?.revenue || 0)
  const maxH = Math.max(1, ...hours)
  const maxP = Math.max(1, ...r.topProducts.map(p => p.qty))

  return (
    <section className="reports">
      <div className="row-head">
        <h2>Reports</h2>
        <div className="tabs">
          {Object.keys(RANGES).map(k => <button key={k} className={label === k ? 'active' : ''} onClick={() => { setLabel(k); setRange(RANGES[k]()) }}>{k}</button>)}
        </div>
        <input type="date" value={range[0]} onChange={e => { setLabel(''); setRange([e.target.value, range[1]]) }} />
        <input type="date" value={range[1]} onChange={e => { setLabel(''); setRange([range[0], e.target.value]) }} />
        <button className="ghost" aria-label="Print report" onClick={() => window.print()}><Icon name="print" size={16} />Print</button>
      </div>
      <div className="export-row no-print">
        {[['sales', 'Sales'], ['items', 'Items sold'], ['expenses', 'Expenses']].map(([k, l]) => (
          <button key={k} className="ghost sm" onClick={async () => downloadCsv(`${k}_${range[0]}_to_${range[1]}.csv`, await api(`/export/${k}?from=${range[0]}&to=${range[1]}`))}>
            <Icon name="download" size={15} />{l} (Excel)
          </button>
        ))}
      </div>

      <div className="kpis">
        <Kpi label="Revenue" value={rs(r.totals.revenue)} big />
        <Kpi label="Expenses" value={rs(r.periodExpenses || 0)} color="var(--red)" />
        <Kpi label="Net Profit" value={rs(r.totals.revenue - (r.periodExpenses || 0))}
          color={(r.totals.revenue - (r.periodExpenses || 0)) >= 0 ? 'var(--green)' : 'var(--red)'} />
        <Kpi label="Orders" value={r.totals.orders} />
        <Kpi label="Avg. order" value={rs(r.totals.avg)} />
        <Kpi label="Tax collected" value={rs(r.totals.tax)} />
      </div>

      <div className="r-grid">
        <div className="card wide">
          <h3>Sales by hour</h3>
          <div className="bars">
            {hours.map((v, h) => (
              <div key={h} className="bar-wrap" title={`${h}:00 — ${rs(v)}`}>
                <div className="bar" style={{ height: (v / maxH) * 100 + '%' }} />
                <small>{h % 3 === 0 ? h : ''}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Top items</h3>
          {!r.topProducts.length && <div className="muted">No sales yet</div>}
          {r.topProducts.map(p => (
            <div key={p.name} className="hbar">
              <div className="hbar-label"><span>{p.name}</span><span className="muted">{p.qty} sold · {rs(p.revenue)}</span></div>
              <div className="hbar-track"><div style={{ width: (p.qty / maxP) * 100 + '%' }} /></div>
            </div>
          ))}
        </div>

        <div className="card">
          <h3>Payment methods</h3>
          <Split rows={r.byMethod} total={r.totals.revenue} />
          <h3 style={{ marginTop: 20 }}>Order types</h3>
          <Split rows={r.byType} total={r.totals.revenue} />
        </div>

        {r.byDay.length > 1 && (
          <div className="card wide">
            <h3>Daily sales</h3>
            <table className="tbl"><thead><tr><th>Date</th><th>Orders</th><th>Revenue</th></tr></thead>
              <tbody>{r.byDay.map(d => <tr key={d.day}><td>{d.day}</td><td>{d.orders}</td><td>{rs(d.revenue)}</td></tr>)}</tbody></table>
          </div>
        )}
      </div>
    </section>
  )
}

const Kpi = ({ label, value, big, color }) => (
  <div className={'kpi' + (big ? ' big' : '')}>
    <span>{label}</span>
    <b style={color ? { color } : undefined}>{value}</b>
  </div>
)
const Split = ({ rows, total }) => !rows.length ? <div className="muted">—</div> : rows.map(x => (
  <div key={x.k} className="split"><span>{x.k}</span><span className="muted">{x.orders} orders</span><b>{rs(x.revenue)}</b>
    <small>{total ? Math.round(x.revenue / total * 100) : 0}%</small></div>
))
