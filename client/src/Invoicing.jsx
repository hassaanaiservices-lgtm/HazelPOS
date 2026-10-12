import { useEffect, useState, useContext } from 'react'
import { api, rs, localDate, TYPES } from './lib'

const EXP_CATEGORIES = ['Ingredients', 'Packaging', 'Utilities', 'Salaries', 'Rent', 'Maintenance', 'Marketing', 'Miscellaneous']

export default function Invoicing({ user, notify }) {
  const [tab, setTab] = useState('summary') // summary | expenses | invoices
  const [summary, setSummary] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [orders, setOrders] = useState([])
  const [settings, setSettings] = useState({})
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [newExp, setNewExp] = useState({ title: '', category: 'Ingredients', amount: '', payment_method: 'cash', date: localDate() })

  const loadData = () => {
    api('/invoicing/summary').then(setSummary)
    api('/expenses').then(setExpenses)
    api('/orders').then(setOrders)
    api('/settings').then(setSettings)
  }

  useEffect(() => { loadData() }, [])

  const saveExpense = async () => {
    if (!newExp.title || !newExp.amount) return
    await api('/expenses', { ...newExp, amount: +newExp.amount, user_name: user.name })
    setShowAddExpense(false)
    setNewExp({ title: '', category: 'Ingredients', amount: '', payment_method: 'cash', date: localDate() })
    loadData()
    notify('Expense recorded ✔')
  }

  const deleteExpense = async id => {
    if (confirm('Delete this expense?')) {
      await api(`/expenses/${id}/delete`, {})
      loadData()
      notify('Expense deleted')
    }
  }

  if (!summary) return <div className="loading">Loading Invoicing & Accounts...</div>

  return (
    <section className="invoicing">
      <div className="row-head">
        <h2>Invoicing & Accounts</h2>
        <div className="tabs">
          <button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Overview</button>
          <button className={tab === 'expenses' ? 'active' : ''} onClick={() => setTab('expenses')}>Expenses ({expenses.length})</button>
          <button className={tab === 'invoices' ? 'active' : ''} onClick={() => setTab('invoices')}>Tax Invoices ({orders.length})</button>
        </div>
        {tab === 'expenses' && (
          <button className="primary sm" onClick={() => setShowAddExpense(true)}>+ Log Expense</button>
        )}
      </div>

      {tab === 'summary' && (
        <>
          <div className="kpis">
            <div className="kpi big">
              <span>Total Revenue</span>
              <b>{rs(summary.revenue)}</b>
              <small className="muted">{summary.paidOrders} paid orders</small>
            </div>
            <div className="kpi">
              <span>Total Expenses</span>
              <b style={{ color: 'var(--red)' }}>{rs(summary.expenses)}</b>
              <small className="muted">{summary.expenseCount} entries</small>
            </div>
            <div className="kpi" style={{ borderColor: summary.netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
              <span>Net Profit</span>
              <b style={{ color: summary.netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{rs(summary.netProfit)}</b>
              <small className="muted">
                {summary.revenue > 0 ? `${Math.round((summary.netProfit / summary.revenue) * 100)}% Margin` : '—'}
              </small>
            </div>
            <div className="kpi">
              <span>Cash in Register</span>
              <b>{rs(summary.cashInRegister)}</b>
              <small className="muted">Active Drawer Float + Cash</small>
            </div>
            <div className="kpi">
              <span>Receivables (Unpaid)</span>
              <b style={{ color: 'var(--accent2)' }}>{rs(summary.receivables)}</b>
              <small className="muted">{summary.openOrders} open orders</small>
            </div>
            <div className="kpi">
              <span>Tax Collected (GST)</span>
              <b>{rs(summary.taxCollected)}</b>
              <small className="muted">FBR / PRA Payable</small>
            </div>
          </div>

          <div className="r-grid" style={{ marginTop: 20 }}>
            <div className="card">
              <h3>Expense Breakdown</h3>
              {!summary.expensesByCategory.length && <div className="muted">No expenses recorded yet</div>}
              {summary.expensesByCategory.map(c => (
                <div key={c.category} className="hbar">
                  <div className="hbar-label">
                    <span>{c.category}</span>
                    <span className="muted">{rs(c.amount)} ({c.count} bills)</span>
                  </div>
                  <div className="hbar-track">
                    <div style={{
                      width: summary.expenses > 0 ? `${(c.amount / summary.expenses) * 100}%` : '0%',
                      background: 'linear-gradient(90deg, #ff5470, #ff8e71)'
                    }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <h3>Bank & Electronic Invoicing Details</h3>
              <div className="bank-info-box">
                <div className="bank-logo">🏛️</div>
                <div className="bank-details">
                  <b>{settings.bank_name || 'Bank Account'}</b>
                  <div>Title: <span>{settings.bank_title || settings.name}</span></div>
                  <div>IBAN / A/C: <code>{settings.bank_account || 'PK00...'}</code></div>
                  <div>NTN / STRN: <code>{settings.ntn || 'Not configured'}</code></div>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                These details appear automatically on generated Tax Invoices for corporate, catering, and delivery customers.
              </p>
            </div>
          </div>
        </>
      )}

      {tab === 'expenses' && (
        <div className="card" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Expense Item</th>
                <th>Category</th>
                <th>Method</th>
                <th>Recorded By</th>
                <th>Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!expenses.length && (
                <tr><td colSpan="7" className="muted" style={{ textAlign: 'center', padding: 20 }}>No expenses recorded</td></tr>
              )}
              {expenses.map(e => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td><b>{e.title}</b></td>
                  <td><span className="pill">{e.category}</span></td>
                  <td style={{ textTransform: 'capitalize' }}>{e.payment_method}</td>
                  <td className="muted">{e.user_name || '—'}</td>
                  <td style={{ fontWeight: 700, color: 'var(--red)' }}>-{rs(e.amount)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="ghost sm danger" onClick={() => deleteExpense(e.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="card" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Type</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Tax</th>
                <th>Total</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!orders.length && (
                <tr><td colSpan="9" className="muted" style={{ textAlign: 'center', padding: 20 }}>No invoices generated</td></tr>
              )}
              {orders.map(o => (
                <tr key={o.id}>
                  <td><b>{o.invoice_no || `INV-${o.id}`}</b></td>
                  <td>{new Date(o.created_at).toLocaleDateString()}</td>
                  <td><span className="pill">{TYPES.find(t => t.id === o.type)?.icon} {o.type}</span></td>
                  <td>{o.customer || 'Walk-in Customer'}</td>
                  <td>{o.items.reduce((s, i) => s + i.qty, 0)} items</td>
                  <td>{rs(o.tax)}</td>
                  <td style={{ fontWeight: 700, color: 'var(--accent2)' }}>{rs(o.total)}</td>
                  <td>
                    <span className={'dot ' + (o.status === 'paid' ? 'free' : o.status === 'open' ? 'busy' : '')} />
                    <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{o.status}</span>
                  </td>
                  <td>
                    <button className="ghost sm" onClick={() => setSelectedInvoice(o)}>
                      📄 View Tax Invoice
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="modal-bg" onClick={() => setShowAddExpense(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Log New Expense</h2>
            <label>Title / Description
              <input autoFocus placeholder="e.g. Milk & Cream supplies" value={newExp.title}
                onChange={e => setNewExp({ ...newExp, title: e.target.value })} />
            </label>
            <div className="two">
              <label>Amount (Rs.)
                <input type="number" placeholder="0" value={newExp.amount}
                  onChange={e => setNewExp({ ...newExp, amount: e.target.value })} />
              </label>
              <label>Category
                <select value={newExp.category} onChange={e => setNewExp({ ...newExp, category: e.target.value })}>
                  {EXP_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="two">
              <label>Payment Method
                <select value={newExp.payment_method} onChange={e => setNewExp({ ...newExp, payment_method: e.target.value })}>
                  <option value="cash">Cash (Drawer)</option>
                  <option value="card">Bank Card</option>
                  <option value="online">Online / Transfer</option>
                </select>
              </label>
              <label>Date
                <input type="date" value={newExp.date} onChange={e => setNewExp({ ...newExp, date: e.target.value })} />
              </label>
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => setShowAddExpense(false)}>Cancel</button>
              <button className="primary" disabled={!newExp.title || !newExp.amount} onClick={saveExpense}>Save Expense</button>
            </div>
          </div>
        </div>
      )}

      {/* Printable A4 Tax Invoice Modal */}
      {selectedInvoice && (
        <TaxInvoiceModal order={selectedInvoice} settings={settings} onClose={() => setSelectedInvoice(null)} />
      )}
    </section>
  )
}

function TaxInvoiceModal({ order, settings, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal a4-modal" onClick={e => e.stopPropagation()}>
        <div className="a4-invoice" id="tax-invoice">
          <div className="inv-header">
            <div>
              <h1 className="inv-brand">{settings.logo} {settings.name}</h1>
              <p>{settings.address}</p>
              <p>Phone: {settings.phone}</p>
              {settings.ntn && <p><b>NTN / Tax ID:</b> {settings.ntn}</p>}
            </div>
            <div className="inv-meta">
              <h2 className="tax-inv-badge">TAX INVOICE</h2>
              <p><b>Invoice No:</b> {order.invoice_no || `INV-${order.id}`}</p>
              <p><b>Date:</b> {new Date(order.created_at).toLocaleString()}</p>
              <p><b>Status:</b> <span style={{ textTransform: 'uppercase', color: order.status === 'paid' ? 'green' : 'orange' }}>{order.status}</span></p>
            </div>
          </div>

          <hr className="inv-hr" />

          <div className="inv-billto">
            <div>
              <small className="muted">BILL TO / CUSTOMER:</small>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{order.customer || 'Walk-in Customer'}</div>
              {order.phone && <div>Contact: {order.phone}</div>}
              {order.address && <div>Address: {order.address}</div>}
            </div>
            <div>
              <small className="muted">ORDER TYPE:</small>
              <div style={{ textTransform: 'capitalize', fontWeight: 600 }}>{order.type} {order.tableName ? `(${order.tableName})` : ''}</div>
              {order.payment_method && <div>Payment Method: <b style={{ textTransform: 'capitalize' }}>{order.payment_method}</b></div>}
            </div>
          </div>

          <table className="inv-items-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Description</th>
                <th style={{ textAlign: 'center' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Unit Price</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, idx) => (
                <tr key={it.id || idx}>
                  <td>{idx + 1}</td>
                  <td><b>{it.name}</b>{it.note ? <span className="muted"> ({it.note})</span> : ''}</td>
                  <td style={{ textAlign: 'center' }}>{it.qty}</td>
                  <td style={{ textAlign: 'right' }}>{rs(it.price)}</td>
                  <td style={{ textAlign: 'right' }}>{rs(it.qty * it.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="inv-totals-box">
            <div className="bank-pay-details">
              <b>Payment / Bank Transfer:</b>
              <div>Bank: {settings.bank_name || 'N/A'}</div>
              <div>Title: {settings.bank_title || settings.name}</div>
              <div>IBAN: <code>{settings.bank_account || 'N/A'}</code></div>
            </div>
            <div className="inv-summary-rows">
              <div><span>Subtotal:</span> <b>{rs(order.subtotal)}</b></div>
              {order.discount > 0 && <div><span>Discount:</span> <b>-{rs(order.discount)}</b></div>}
              <div><span>GST / Sales Tax:</span> <b>{rs(order.tax)}</b></div>
              <div className="inv-grand"><span>Total Due:</span> <b>{rs(order.total)}</b></div>
            </div>
          </div>

          <div className="inv-footer">
            <p>{settings.footer || 'Thank you for your business!'}</p>
            <p className="muted" style={{ fontSize: 11 }}>This is a computer-generated tax invoice. No signature required.</p>
          </div>
        </div>

        <div className="actions no-print" style={{ marginTop: 16 }}>
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="primary" onClick={() => window.print()}>🖨️ Print Tax Invoice</button>
        </div>
      </div>
    </div>
  )
}
