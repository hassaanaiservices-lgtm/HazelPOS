import { daysTo, ago } from './lib'

// Shared labels so every screen says the same thing about a client or a branch

export function Membership({ o }) {
  if (o.suspended) return <span className="pill bad">Suspended</span>
  if (!o.paid_until) return <span className="pill bad">Not paid</span>
  const d = daysTo(o.paid_until)
  if (d < 0) return <span className="pill bad">Ended {-d} day{-d === 1 ? '' : 's'} ago</span>
  if (d < 5) return <span className="pill warn">Due in {d} day{d === 1 ? '' : 's'}</span>
  return <span className="pill ok">Paid</span>
}

// Where a branch is: New → Setup in progress → Activated → Running (reported in the last 24 h) / Offline / Setup failed
export function stageOf(b) {
  const s = b.setup || {}
  const recent = b.health_at && Date.now() - Date.parse(b.health_at) < 864e5
  if (recent) return s.error ? ['bad', 'Setup failed'] : ['ok', 'Running']
  if (b.code_used_at) return b.health_at ? ['warn', 'Offline'] : ['info', 'Activated']
  if (s.menu || s.restaurant) return ['info', 'Setup in progress']
  return ['', 'New']
}
export const Stage = ({ b }) => { const [k, l] = stageOf(b); return <span className={'pill ' + k}>{l}</span> }

export function WhatsApp({ h }) {
  if (!h?.whatsapp) return <span className="muted">—</span>
  const st = h.whatsapp.status
  return st === 'connected' ? <span className="pill ok">On</span> : <span className={'pill ' + (st ? 'warn' : '')}>{st || 'Not linked'}</span>
}

export const LastSeen = ({ b }) => <span title={b.health_at || b.last_sync || ''}>{ago(b.health_at || b.last_sync)}</span>

// A client needs attention when: membership ends within 5 days or ended, a branch is offline/failed, or errors today
export function needsAttention(o) {
  const money = o.suspended || !o.paid_until || daysTo(o.paid_until) < 5
  const branches = o.branches.some(b => ['Offline', 'Setup failed'].includes(stageOf(b)[1]) || b.errors_24h > 0)
  return money || branches
}

export const Check = ({ ok, children }) => <span className={'pill ' + (ok ? 'ok' : '')}>{ok ? '✓' : '○'} {children}</span>
