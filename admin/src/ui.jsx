import { daysTo, ago } from './lib'

// Shared labels so every screen says the same thing about a client or a branch

export function Membership({ o }) {
  if (o.cancelled) return <span className="pill bad">Cancelled</span>
  if (o.suspended) return <span className="pill bad">Stopped</span>
  if (!o.paid_until) return <span className="pill bad">Not paid</span>
  const d = daysTo(o.paid_until)
  if (d < 0) return <span className={'pill ' + (o.pos_active ? 'warn' : 'bad')}>Unpaid {-d} day{-d === 1 ? '' : 's'}{!o.pos_active ? ' · POS off' : !o.ai_active ? ' · bot off' : ''}</span>
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
  const money = o.suspended || o.cancelled || !o.paid_until || daysTo(o.paid_until) < 5
  const branches = o.branches.some(b => ['Offline', 'Setup failed'].includes(stageOf(b)[1]) || b.errors_24h > 0)
  return money || branches
}

// Bot / POS status for an unpaid client: "On", "Stops after 18 Nov", "Off since 18 Nov"
export function Service({ on, until, stopped }) {
  if (stopped) return <span className="pill bad">Off</span>
  if (!until) return <span className="pill">—</span>
  const left = daysTo(until)
  if (!on) return <span className="pill bad">Off since {until}</span>
  if (left < 7) return <span className="pill warn">Stops after {until}</span>
  return <span className="pill ok">On</span>
}

export const Check = ({ ok, children }) => <span className={'pill ' + (ok ? 'ok' : '')}>{ok ? '✓' : '○'} {children}</span>
