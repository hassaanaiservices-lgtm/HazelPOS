import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import CustomerOrder from './CustomerOrder.jsx'

// Customers scanning a table QR land on /t/<token>
const qrMatch = window.location.pathname.match(/^\/t\/([a-z0-9]+)/i)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {qrMatch ? <CustomerOrder token={qrMatch[1]} /> : <App />}
  </StrictMode>,
)
