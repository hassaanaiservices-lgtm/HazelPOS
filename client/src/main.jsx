import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import CustomerOrder from './CustomerOrder.jsx'
import { Notifier } from './notify.jsx'
import { watchTables } from './ui.jsx'

// Customers scanning a table QR land on /t/<token>
const qrMatch = window.location.pathname.match(/^\/t\/([a-z0-9]+)/i)

// Any screen that crashes shows a message and a reload button, never a blank page
class Crash extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('Screen error:', error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg)', color: 'var(--text)', textAlign: 'center' }}>
        <div>
          <h2>Something went wrong on this screen</h2>
          <p style={{ color: 'var(--text-2)' }}>Your data is safe. Reload to continue.</p>
          <button className="btn primary" style={{ minHeight: 44, marginTop: 12 }} onClick={() => window.location.reload()}>Reload</button>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 16 }}>{String(this.state.error?.message || this.state.error).slice(0, 200)}</p>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Crash>{qrMatch ? <CustomerOrder token={qrMatch[1]} /> : <App />}</Crash>
    <Notifier />
  </StrictMode>,
)

watchTables() // tables turn into stacked cards on phones
