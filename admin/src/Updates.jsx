import { useEffect, useState } from 'react'
import { api, ago } from './lib'
import { run, toast, confirmBox } from './notify'

// App versions across all restaurants. How a new version goes out:
// 1. You publish it (GitHub release, desktop/README.md). Every app downloads it in the background.
// 2. Test clients install it first (at night, or when they press "Update now").
// 3. Once it's fine there, "Release to everyone": the others install it the same way.
// "Ask all to update now" makes every app check within 3 hours instead of waiting for its next 6-hourly check.
export default function Updates() {
  const [d, setD] = useState(null)
  const [version, setVersion] = useState('')
  const load = () => api('/updates').then(x => { setD(x); setVersion(v => v || newest(x.branches) || '') })
  useEffect(() => { run(load)() }, [])
  if (!d) return <p className="muted">Loading…</p>

  const latest = newest(d.branches)
  const owners = [...new Map(d.branches.map(b => [b.owner_id, b])).values()]
  const early = run(async (b, on) => { await api(`/owners/${b.owner_id}/early`, { early: on }); load() })
  const release = run(async () => {
    if (!await confirmBox(`Release version ${version} to every restaurant? Their apps install it at night with no open orders (or when the owner presses Update now).`, { confirmLabel: 'Release' })) return
    await api('/updates/release', { version }); toast(`Released ${version} to everyone`); load()
  })
  const ask = run(async () => { await api('/updates/request', {}); toast('Every app checks for the update within 3 hours'); load() })

  return (
    <>
      <div className="page-head"><h1>Updates</h1><span className="sp" /><button onClick={ask}>Ask all apps to check now</button></div>
      <div className="grid2">
        <div className="card"><h3>Release to everyone</h3>
          <p className="muted">Test clients get every new version first. The others install a version only after you release it here.
            {d.release_version ? <> Released now: <b>{d.release_version}</b>.</> : ' Nothing held back yet: everyone installs new versions.'}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <input style={{ maxWidth: 160 }} value={version} onChange={e => setVersion(e.target.value)} placeholder="1.2.0" aria-label="Version" />
            <button className="primary" onClick={release} disabled={!/^\d+\.\d+\.\d+$/.test(version)}>Release to everyone</button>
          </div>
          {d.requested_at && <p className="muted small" style={{ marginTop: 8 }}>Last "check now" request: {ago(d.requested_at)}.</p>}
        </div>
        <div className="card"><h3>Test clients</h3>
          <p className="muted">Pick one or two restaurants you trust (or your own PC) to get new versions first.</p>
          <div style={{ marginTop: 8 }}>{owners.map(b => <label key={b.owner_id} className="check"><input type="checkbox" checked={b.early} onChange={e => early(b, e.target.checked)} /> {b.owner}</label>)}
            {!owners.length && <span className="muted">No clients yet.</span>}</div>
        </div>
      </div>
      <div className="card scroll" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Client</th><th>Branch</th><th>Version</th><th>Update</th><th>Last report</th></tr></thead>
          <tbody>{d.branches.map(b => (
            <tr key={b.id}><td><b>{b.owner}</b>{b.early && <span className="pill info" style={{ marginLeft: 8 }}>Test</span>}</td><td>{b.name}</td>
              <td>{b.version || '—'} {b.version && latest && b.version !== latest && <span className="pill warn">behind</span>}</td>
              <td className="muted small">{b.update?.state === 'ready' ? `${b.update.version} downloaded, waiting to install` : b.update?.state === 'downloading' ? 'downloading' : b.update?.state || '—'}</td>
              <td>{ago(b.health_at)}</td></tr>))}</tbody>
        </table>
        {!d.branches.length && <div className="empty">No branches yet.</div>}
      </div>
    </>
  )
}

const newest = branches => branches.map(b => b.version).filter(Boolean)
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
