import { useState } from 'react'
import Reports from './Reports'
import Invoicing from './Invoicing'

// The owner's first screen: sales reports and the accounts (expenses, tax invoices, all-time overview) in one place
const TABS = [['sales', 'Sales'], ['expenses', 'Expenses'], ['invoices', 'Tax invoices'], ['accounts', 'Profit & loss']]

export default function Dashboard({ user, notify }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('dashboard_tab') || 'sales' } catch { return 'sales' } })
  const pick = t => { setTab(t); try { localStorage.setItem('dashboard_tab', t) } catch { /* private window */ } }
  return (
    <section className="dashboard">
      <div className="row-head">
        <h2>Dashboard</h2>
        <div className="tabs" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id}
          className={tab === id ? 'active' : ''} onClick={() => pick(id)}>{label}</button>)}</div>
      </div>
      {tab === 'sales' ? <Reports embedded />
        : <Invoicing user={user} notify={notify} tab={tab === 'accounts' ? 'summary' : tab} />}
    </section>
  )
}
