import { useEffect, useState } from 'react'
import { api } from './lib'
import { run } from './notify'

// Everything changed through this app, with who did it (cloud: vendor_audit). Newest first.
const WHAT = [
  [/^LOGIN$/, () => 'Logged in'],
  [/^POST \/owners$/, () => 'Added a client'],
  [/^POST \/owners\/(\d+)\/extend$/, d => `Marked paid +${d.months || 1} month(s)`],
  [/^POST \/owners\/(\d+)\/branches$/, () => 'Added a branch (new activation code)'],
  [/^POST \/owners\/(\d+)\/early$/, d => d.early ? 'Made a test client for updates' : 'Removed from test clients'],
  [/^POST \/owners\/(\d+)$/, d => d.cancelled === true ? 'Cancelled a membership' : d.cancelled === false ? 'Reactivated a membership' : d.suspended === true ? 'Stopped a client' : d.suspended === false ? 'Resumed a client' : d.paid_until ? `Set paid until ${d.paid_until}` : 'Changed client details'],
  [/^POST \/branches\/(\d+)\/code$/, () => 'Made a new activation code'],
  [/^POST \/branches\/(\d+)\/setup\/menu-photo$/, () => 'Read a menu photo (AI)'],
  [/^POST \/branches\/(\d+)\/setup/, () => 'Changed a branch setup'],
  [/^POST \/updates\/release$/, d => `Released version ${d.version} to everyone`],
  [/^POST \/updates\/request$/, () => 'Asked all apps to check for updates'],
  [/^POST \/team/, () => 'Changed the team'],
]
export default function Activity() {
  const [list, setList] = useState(null)
  useEffect(() => { run(async () => setList(await api('/audit?limit=500')))() }, [])
  if (!list) return <p className="muted">Loading…</p>
  const describe = a => {
    let d = {}; try { d = JSON.parse(String(a.detail).split(' + ')[0]) } catch { /* not JSON */ }
    const hit = WHAT.find(([re]) => re.test(a.action))
    return hit ? hit[1](d) : a.action
  }
  return (
    <>
      <div className="page-head"><h1>Activity</h1></div>
      <div className="card scroll" style={{ padding: 0 }}>
        {list.length ? <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
          <tbody>{list.map(a => <tr key={a.id}><td style={{ whiteSpace: 'nowrap' }}>{a.at.replace('T', ' ').slice(0, 16)}</td><td>{a.who}</td><td>{describe(a)}</td>
            <td className="muted small" style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{a.action}{a.detail && a.detail !== '{}' ? ` ${a.detail}` : ''}</td></tr>)}</tbody>
        </table> : <div className="empty">Nothing yet.</div>}
      </div>
    </>
  )
}
