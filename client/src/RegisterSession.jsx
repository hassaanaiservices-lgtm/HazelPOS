import { useEffect, useState } from 'react'
import { api, rs } from './lib'
import { Icon } from './ui'

export default function RegisterSession({ user, notify }) {
  const [session, setSession] = useState(null)
  const [history, setHistory] = useState([])
  const [tab, setTab] = useState('current') // current | history
  const [openingCash, setOpeningCash] = useState('5000')
  const [closingCash, setClosingCash] = useState('')
  const [notes, setNotes] = useState('')
  const [cashMove, setCashMove] = useState(null) // { type: 'in'|'out', amount: '', reason: '' }
  const [closingMode, setClosingMode] = useState(false)
  const [zReport, setZReport] = useState(null)

  const load = async () => {
    const cur = await api('/register/current')
    setSession(cur)
    const hist = await api('/register/history')
    setHistory(hist)
  }

  useEffect(() => { load() }, [])

  const openRegister = async () => {
    await api('/register/open', { opening_cash: +openingCash, opened_by: user.name })
    notify('Register opened')
    load()
  }

  const submitCashMove = async () => {
    if (!cashMove.amount) return
    await api('/register/cash-move', { ...cashMove, amount: +cashMove.amount, user_name: user.name })
    setCashMove(null)
    notify(`Cash ${cashMove.type === 'in' ? 'deposit' : 'withdrawal'} recorded`)
    load()
  }

  const closeRegister = async () => {
    const rep = await api('/register/close', { closing_cash: +closingCash, closed_by: user.name, notes })
    setClosingMode(false)
    setZReport(rep)
    notify('Register closed! Z-Report ready')
    load()
  }

  const diff = session ? (+closingCash || 0) - session.expectedCash : 0

  return (
    <section className="register-session">
      <div className="row-head">
        <h2>Cash Drawer & Shift Closing</h2>
        <div className="tabs">
          <button className={tab === 'current' ? 'active' : ''} onClick={() => setTab('current')}>Current Shift</button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Shift History & Z-Reports ({history.length})</button>
        </div>
      </div>

      {tab === 'current' && (
        <>
          {!session ? (
            <div className="open-register-card">
              <div className="open-icon"><Icon name="wallet" size={40} /></div>
              <h2>Register is Closed</h2>
              <p className="muted">Enter your starting cash float to open the till for orders.</p>
              <div className="open-form">
                <label>Opening Cash Float (Rs.)
                  <input type="number" autoFocus value={openingCash} onChange={e => setOpeningCash(e.target.value)} />
                </label>
                <div className="quick">
                  {[2000, 3000, 5000, 10000].map(v => (
                    <button key={v} className="ghost sm" onClick={() => setOpeningCash(String(v))}>{rs(v)}</button>
                  ))}
                </div>
                <button className="primary" onClick={openRegister}>Open Register</button>
              </div>
            </div>
          ) : (
            <div className="session-dashboard">
              <div className="session-header-card">
                <div>
                  <b style={{ fontSize: 18 }}>Shift open</b>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Opened by <b>{session.opened_by}</b> on {new Date(session.opened_at).toLocaleString()}
                  </div>
                </div>
                <div className="session-quick-btns">
                  <button className="ghost sm" onClick={() => setCashMove({ type: 'in', amount: '', reason: '' })}>+ Cash In</button>
                  <button className="ghost sm" onClick={() => setCashMove({ type: 'out', amount: '', reason: '' })}>− Cash Out</button>
                  <button className="primary sm danger-btn" onClick={() => { setClosingCash(String(session.expectedCash)); setClosingMode(true) }}>
                    Close Shift (Z-Report)
                  </button>
                </div>
              </div>

              <div className="kpis" style={{ marginTop: 16 }}>
                <div className="kpi">
                  <span>Opening Float</span>
                  <b>{rs(session.opening_cash)}</b>
                  <small className="muted">Initial cash drawer</small>
                </div>
                <div className="kpi">
                  <span>Cash Sales</span>
                  <b style={{ color: 'var(--green)' }}>+{rs(session.cashSales)}</b>
                  <small className="muted">{session.cashOrders} cash orders</small>
                </div>
                <div className="kpi">
                  <span>Cash In / Deposits</span>
                  <b>+{rs(session.cashIn)}</b>
                  <small className="muted">Manual cash added</small>
                </div>
                <div className="kpi">
                  <span>Cash Out / Drops</span>
                  <b style={{ color: 'var(--red)' }}>−{rs(session.cashOut)}</b>
                  <small className="muted">Petty payouts</small>
                </div>
                <div className="kpi big">
                  <span>Expected Drawer Cash</span>
                  <b style={{ color: 'var(--accent2)' }}>{rs(session.expectedCash)}</b>
                  <small className="muted">Must be in drawer right now</small>
                </div>
              </div>

              {session.otherSales?.length > 0 && (
                <div className="card" style={{ marginTop: 14 }}>
                  <h3>Digital / Card Payments in this shift</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {session.otherSales.map(s => (
                      <div key={s.m} className="pill" style={{ padding: '8px 16px', fontSize: 14 }}>
                        <span style={{ textTransform: 'capitalize' }}>{s.m}</span>: <b>{rs(s.s)}</b> ({s.c} orders)
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {session.moves?.length > 0 && (
                <div className="card" style={{ marginTop: 14 }}>
                  <h3>Cash Movements in this shift</h3>
                  <table className="tbl">
                    <thead><tr><th>Time</th><th>Type</th><th>Reason</th><th>Staff</th><th>Amount</th></tr></thead>
                    <tbody>
                      {session.moves.map(m => (
                        <tr key={m.id}>
                          <td>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                          <td>
                            <span className={'pill ' + (m.type === 'in' ? 'pill-in' : 'pill-out')}>
                              {m.type === 'in' ? 'Cash in' : 'Cash out'}
                            </span>
                          </td>
                          <td>{m.reason || '—'}</td>
                          <td className="muted">{m.user_name}</td>
                          <td style={{ fontWeight: 700, color: m.type === 'in' ? 'var(--green)' : 'var(--red)' }}>
                            {m.type === 'in' ? '+' : '−'}{rs(m.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <div className="card" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Shift #</th>
                <th>Opened</th>
                <th>Closed</th>
                <th>Opened By</th>
                <th>Opening</th>
                <th>Closing Cash</th>
                <th>Expected</th>
                <th>Variance</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!history.length && (
                <tr><td colSpan="9" className="muted" style={{ textAlign: 'center', padding: 20 }}>No shift history yet</td></tr>
              )}
              {history.map(h => (
                <tr key={h.id}>
                  <td><b>#{h.id}</b></td>
                  <td>{new Date(h.opened_at).toLocaleDateString()} {new Date(h.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{h.closed_at ? new Date(h.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span className="pill">Active</span>}</td>
                  <td>{h.opened_by}</td>
                  <td>{rs(h.opening_cash)}</td>
                  <td><b>{rs(h.closing_cash)}</b></td>
                  <td>{rs(h.expected_cash || h.expectedCash)}</td>
                  <td>
                    <span style={{
                      fontWeight: 700,
                      color: h.difference === 0 ? 'var(--green)' : h.difference > 0 ? 'var(--accent2)' : 'var(--red)'
                    }}>
                      {h.difference > 0 ? `+${rs(h.difference)} (Over)` : h.difference < 0 ? `${rs(h.difference)} (Short)` : 'Balanced'}
                    </span>
                  </td>
                  <td>
                    <button className="ghost sm" onClick={() => setZReport(h)}><Icon name="receipt" size={15} />Z-report</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cash In / Out Modal */}
      {cashMove && (
        <div className="modal-bg" onClick={() => setCashMove(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{cashMove.type === 'in' ? 'Deposit Cash (Cash In)' : 'Payout Cash (Cash Out)'}</h2>
            <label>Amount (Rs.)
              <input type="number" autoFocus placeholder="0" value={cashMove.amount}
                onChange={e => setCashMove({ ...cashMove, amount: e.target.value })} />
            </label>
            <label>Reason / Note
              <input placeholder={cashMove.type === 'in' ? 'e.g. Added change / 100 notes' : 'e.g. Milk & bread purchase'}
                value={cashMove.reason} onChange={e => setCashMove({ ...cashMove, reason: e.target.value })} />
            </label>
            <div className="actions">
              <button className="ghost" onClick={() => setCashMove(null)}>Cancel</button>
              <button className="primary" disabled={!cashMove.amount} onClick={submitCashMove}>Confirm Movement</button>
            </div>
          </div>
        </div>
      )}

      {/* Close Register Modal */}
      {closingMode && session && (
        <div className="modal-bg" onClick={() => setClosingMode(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Close Shift / Day End</h2>
            <div className="kpi big" style={{ margin: '10px 0' }}>
              <span>Expected Cash in Drawer</span>
              <b>{rs(session.expectedCash)}</b>
            </div>
            <label>Counted Cash in Till (Rs.)
              <input type="number" autoFocus value={closingCash} onChange={e => setClosingCash(e.target.value)} />
            </label>
            <div className={'diff-badge ' + (diff === 0 ? 'good' : diff > 0 ? 'over' : 'short')}>
              Variance: <b>{diff > 0 ? `+${rs(diff)} (Surplus)` : diff < 0 ? `${rs(diff)} (Shortage)` : 'Exact Match (Balanced)'}</b>
            </div>
            <label>Closing Notes (optional)
              <input placeholder="Remarks / discrepancies" value={notes} onChange={e => setNotes(e.target.value)} />
            </label>
            <div className="actions">
              <button className="ghost" onClick={() => setClosingMode(false)}>Cancel</button>
              <button className="primary danger-btn" onClick={closeRegister}>Confirm & Print Z-Report</button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Z-Report Modal */}
      {zReport && (
        <ZReportModal session={zReport} onClose={() => setZReport(null)} />
      )}
    </section>
  )
}

function ZReportModal({ session, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal receipt-wrap" onClick={e => e.stopPropagation()}>
        <div className="receipt z-report-ticket" id="z-report">
          <h3>SHIFT CLOSING / Z-REPORT</h3>
          <p>Shift #{session.id} · Status: CLOSED</p>
          <p>Opened: {new Date(session.opened_at).toLocaleString()} by {session.opened_by}</p>
          {session.closed_at && <p>Closed: {new Date(session.closed_at).toLocaleString()} by {session.closed_by || session.opened_by}</p>}
          <hr />
          <div className="r-line"><span>Opening Cash Float:</span><b>{rs(session.opening_cash)}</b></div>
          <div className="r-line"><span>Cash Sales:</span><b>+{rs(session.cashSales)}</b></div>
          <div className="r-line"><span>Cash In:</span><b>+{rs(session.cashIn)}</b></div>
          <div className="r-line"><span>Cash Out:</span><b>−{rs(session.cashOut)}</b></div>
          <hr />
          <div className="r-line big"><span>Expected Cash:</span><b>{rs(session.expected_cash || session.expectedCash)}</b></div>
          <div className="r-line big"><span>Actual Counted:</span><b>{rs(session.closing_cash)}</b></div>
          <div className="r-line">
            <span>Variance / Difference:</span>
            <b style={{ color: session.difference === 0 ? 'green' : session.difference > 0 ? 'blue' : 'red' }}>
              {session.difference > 0 ? `+${rs(session.difference)} (Over)` : session.difference < 0 ? `${rs(session.difference)} (Short)` : '0 (Balanced)'}
            </b>
          </div>
          <hr />
          {session.otherSales?.map(s => (
            <div className="r-line" key={s.m}><span>{s.m} Sales ({s.c} ord):</span><b>{rs(s.s)}</b></div>
          ))}
          {session.notes && <p style={{ fontSize: 12, marginTop: 8 }}>Notes: {session.notes}</p>}
          <p className="thanks">Manager Signature: __________________</p>
        </div>
        <div className="actions no-print" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="primary" onClick={() => window.print()}><Icon name="print" size={16} />Print Z-report</button>
        </div>
      </div>
    </div>
  )
}
