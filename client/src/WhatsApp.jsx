import { useEffect, useMemo, useRef, useState } from 'react'
import { api, run, rs } from './lib'
import { Icon } from './ui'
import './WhatsApp.css'
import { toastError, confirmBox, promptBox } from './notify'

// Restaurant's WhatsApp, linked by QR, in a WhatsApp-Web-style window. Phase 1: staff read and reply; no assistant yet.
const useEvery = (fn, ms, deps = []) => useEffect(() => { fn(); const t = setInterval(fn, ms); return () => clearInterval(t) }, deps) // eslint-disable-line

const clock = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dayLabel = iso => {
  const d = new Date(iso), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const listTime = iso => { const l = dayLabel(iso); return l === 'Today' ? clock(iso) : l }
const title = c => c.name || c.phone || c.id.split('@')[0]
const initials = c => (c.name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '#'
const Ticks = ({ s }) => <span className={'wa-ticks' + (s >= 3 ? ' read' : '')}>{s >= 2 ? '✓✓' : '✓'}</span>

export default function WhatsApp({ notify }) {
  const [st, setSt] = useState(null)
  useEvery(() => api('/whatsapp/status').then(setSt).catch(() => {}), 2000)
  if (!st) return <section className="wa-root" />
  const linked = st.status === 'connected' || st.status === 'reconnecting'
  return <section className="wa-root">{linked ? <Inbox st={st} notify={notify} onStatus={setSt} /> : <LinkScreen st={st} onStatus={setSt} />}</section>
}

function LinkScreen({ st, onStatus }) {
  const start = run(async () => onStatus(await api('/whatsapp/connect', {})))
  const waiting = st.status === 'connecting' || (st.status === 'qr' && !st.qr)
  return (
    <div className="wa-link">
      <div className="wa-link-card">
        <div className="wa-link-text">
          <h1>Link the restaurant's WhatsApp</h1>
          <ol>
            <li>Open <b>WhatsApp</b> on the restaurant's phone</li>
            <li>Tap <b>Menu</b> on Android, or <b>Settings</b> on iPhone</li>
            <li>Tap <b>Linked devices</b> and then <b>Link a device</b></li>
            <li>Point the phone at this screen to scan the QR code</li>
          </ol>
          <p className="wa-note">Customers' chats will then show here. The POS keeps working without internet;
            messages sent while it was offline appear when it reconnects, marked for you to contact.</p>
          {st.error && <p className="wa-error">{st.error}</p>}
        </div>
        <div className="wa-qr">
          {st.status === 'qr' && st.qr ? <img src={st.qr} alt="WhatsApp QR code" id="wa-qr-img" />
            : waiting ? <div className="wa-spinner" />
              : <button className="wa-btn" id="wa-link-btn" onClick={start}>Link WhatsApp</button>}
          {st.status === 'qr' && <small>The code refreshes by itself</small>}
        </div>
      </div>
    </div>
  )
}

function Inbox({ st, notify, onStatus }) {
  const [chats, setChats] = useState([])
  const [openId, setOpenId] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [menu, setMenu] = useState(false)
  useEvery(() => api('/whatsapp/chats').then(setChats).catch(() => {}), 2500)

  const shown = useMemo(() => chats.filter(c =>
    ({ all: true, unread: c.unread > 0, offline: c.offline_pending > 0, orders: c.orders_pending > 0 })[filter] &&
    (!q || `${c.name} ${c.phone} ${c.last_text}`.toLowerCase().includes(q.toLowerCase()))), [chats, q, filter])
  const open = chats.find(c => c.id === openId)
  const offlineChats = chats.filter(c => c.offline_pending > 0).length
  const orderChats = chats.filter(c => c.orders_pending > 0).length
  const toggleAssistant = run(async () => { await api('/whatsapp/assistant', { enabled: !st.assistant }); onStatus({ ...st, assistant: !st.assistant }); notify(st.assistant ? 'Assistant switched off: staff reply to everything' : 'Assistant switched on') })
  const logout = run(async () => {
    if (!await confirmBox('Unlink WhatsApp from this POS? Chats stay saved; you will need to scan the QR again.')) return
    onStatus(await api('/whatsapp/logout', {})); notify('WhatsApp unlinked')
  })

  return (
    <div className={'wa-app' + (open ? ' has-open' : '')}>
      <aside className="wa-side">
        <header className="wa-head">
          <div className="wa-head-name"><b>WhatsApp</b><small>{st.me ? `+92 ${st.me.slice(1)}` : ''}</small></div>
          <button id="wa-assistant" className={'wa-bot-switch' + (st.assistant ? ' on' : '')} onClick={toggleAssistant}
            title={st.assistant ? 'The assistant replies automatically. Click to switch off.' : 'Staff reply to everything. Click to let the assistant reply.'}>
            {st.assistant ? 'Auto-reply on' : 'Auto-reply off'}</button>
          <div className="wa-menu-wrap">
            <button className="wa-icon" title="More" aria-label="More" onClick={() => setMenu(!menu)}><Icon name="menu" /></button>
            {menu && <div className="wa-menu" onMouseLeave={() => setMenu(false)}><button id="wa-logout" onClick={logout}>Unlink WhatsApp</button></div>}
          </div>
        </header>
        {st.stt?.state === 'failed' && <div className="wa-conn">Voice notes can't be transcribed: {st.stt.error}</div>}
        {st.status === 'reconnecting' && <div className="wa-conn">No internet, reconnecting. The POS keeps working; new messages will arrive when it's back.</div>}
        {orderChats > 0 && <button className="wa-order-alert" onClick={() => setFilter('orders')}>
          <Icon name="receipt" size={16} />{orderChats} WhatsApp {orderChats === 1 ? 'order is' : 'orders are'} waiting for you to accept</button>}
        {offlineChats > 0 && <button className="wa-offline-alert" onClick={() => setFilter('offline')}>
          <Icon name="clock" size={16} />{offlineChats} {offlineChats === 1 ? 'customer' : 'customers'} messaged while the POS was offline — please contact them</button>}
        <div className="wa-search"><input placeholder="Search or start a new chat" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="wa-chips">
          {[['all', 'All'], ['unread', 'Unread'], ['orders', `Orders${orderChats ? ` (${orderChats})` : ''}`],
            ['offline', `While offline${offlineChats ? ` (${offlineChats})` : ''}`]].map(([k, l]) =>
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        <div className="wa-list">
          {!shown.length && <p className="wa-empty">{chats.length ? 'No chats match' : 'No chats yet. Message this number from another phone to test.'}</p>}
          {shown.map(c => (
            <button key={c.id} className={'wa-chat' + (c.id === openId ? ' active' : '')} onClick={() => setOpenId(c.id)}>
              <div className="wa-avatar">{initials(c)}</div>
              <div className="wa-chat-body">
                <div className="wa-row"><b>{title(c)}</b><span className={c.unread ? 'wa-time new' : 'wa-time'}>{c.last_at && listTime(c.last_at)}</span></div>
                <div className="wa-row">
                  <span className="wa-last">{c.last_text}</span>
                  {c.bot_paused ? <span className="wa-off-pill" title="Assistant paused for this chat">paused</span> : null}
                  {c.orders_pending > 0 && <span className="wa-order-pill" title="Order waiting for you to accept">order</span>}
                  {c.offline_pending > 0 && <span className="wa-off-pill" title="Messaged while the POS was offline">offline</span>}
                  {c.unread > 0 && <span className="wa-unread">{c.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>
      {open ? <Thread key={open.id} chat={open} connected={st.status === 'connected'} assistantOn={st.assistant} notify={notify} onBack={() => setOpenId(null)} />
        : <div className="wa-intro"><div className="wa-intro-logo"><Icon name="chat" size={48} /></div><h2>WhatsApp for {st.me ? `+92 ${st.me.slice(1)}` : 'the restaurant'}</h2>
          <p>Pick a chat on the left to read and reply.<br />Chats stay on this POS even when the internet is off.</p></div>}
    </div>
  )
}

function Thread({ chat, connected, assistantOn, notify, onBack }) {
  const [msgs, setMsgs] = useState([])
  const [orders, setOrders] = useState([])
  const [accepting, setAccepting] = useState(null)
  const [showLog, setShowLog] = useState(false)
  const cid = encodeURIComponent(chat.id)
  useEvery(() => api(`/whatsapp/chats/${cid}/orders`).then(setOrders).catch(() => {}), 2500, [chat.id])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const end = useRef(null)
  const lastId = useRef(0)
  useEvery(() => api(`/whatsapp/chats/${encodeURIComponent(chat.id)}/messages`).then(setMsgs).catch(() => {}), 2000, [chat.id])
  // Opening the chat (or a new message arriving while it's open) marks it read, which sends blue ticks
  useEffect(() => { if (chat.unread) api(`/whatsapp/chats/${encodeURIComponent(chat.id)}/read`, {}).catch(() => {}) }, [chat.id, chat.unread])
  useEffect(() => {
    const last = msgs[msgs.length - 1]?.id || 0
    if (last !== lastId.current) { end.current?.scrollIntoView({ block: 'end' }); lastId.current = last }
  }, [msgs])

  const send = async () => {
    const t = text.trim(); if (!t || sending) return
    setSending(true)
    try { const m = await api(`/whatsapp/chats/${encodeURIComponent(chat.id)}/send`, { text: t }); setText(''); setMsgs(x => [...x.filter(y => y.id !== m.id), m]) }
    catch (e) { toastError(e.message) } finally { setSending(false) }
  }
  const handled = run(async () => { await api(`/whatsapp/chats/${cid}/handled`, {}); notify('Marked as done') })
  const toggleBot = run(async () => { await api(`/whatsapp/chats/${cid}/bot`, { paused: !chat.bot_paused }); notify(chat.bot_paused ? 'Assistant resumed for this chat' : 'Assistant paused for this chat') })
  const reject = run(async o => {
    const reason = await promptBox('The customer gets this reason on WhatsApp. Leave it empty to send no reason.', { title: 'Reject this order?', placeholder: 'e.g. kitchen is closing', confirmLabel: 'Reject order' })
    if (reason === null) return
    const r = await api(`/whatsapp/orders/${o.id}/reject`, { reason })
    r.message_sent ? notify('Order rejected, customer informed') : notify('Order rejected, but WhatsApp is offline so the customer was not told', 'info')
    setOrders(await api(`/whatsapp/chats/${cid}/orders`))
  })
  const pending = orders.filter(o => o.status === 'pending_cashier')

  return (
    <div className="wa-thread">
      <header className="wa-head">
        <button className="wa-icon wa-back" aria-label="Back to chats" onClick={onBack}><Icon name="back" /></button>
        <div className="wa-avatar">{initials(chat)}</div>
        <div className="wa-head-name"><b>{title(chat)}</b><small>{chat.name && chat.phone ? chat.phone : ''}</small></div>
        {assistantOn && <button id="wa-bot-toggle" className={'wa-chip-btn' + (chat.bot_paused ? '' : ' on')} onClick={toggleBot}
          title={chat.bot_paused ? 'Assistant is paused in this chat. Click to let it reply again.' : 'Assistant replies in this chat. Click to pause it (you reply yourself).'}>
          {chat.bot_paused ? 'Bot paused' : 'Bot on'}</button>}
        <button className="wa-icon" title="Why the assistant replied (or stayed quiet)" aria-label="Assistant log" onClick={() => setShowLog(!showLog)}><Icon name="list" /></button>
        {chat.phone && <a className="wa-icon" href={`tel:${chat.phone}`} title="Call" aria-label="Call"><Icon name="phone" /></a>}
      </header>
      {showLog && <BotLog chatId={chat.id} onClose={() => setShowLog(false)} />}
      {chat.offline_pending > 0 && (
        <div className="wa-thread-banner">
          <span>This customer sent <b>{chat.offline_pending}</b> {chat.offline_pending === 1 ? 'message' : 'messages'} while the POS was offline. Reply here or call them{chat.phone ? ` (${chat.phone})` : ''}.</span>
          <button id="wa-handled" onClick={handled}>Mark contacted</button>
        </div>
      )}
      <div className="wa-msgs">
        {msgs.map((m, i) => {
          const day = dayLabel(m.at), sep = !i || day !== dayLabel(msgs[i - 1].at)
          return (
            <div key={m.id}>
              {sep && <div className="wa-day"><span>{day}</span></div>}
              <div className={'wa-msg ' + m.direction + (m.offline && !m.handled_at ? ' offline' : '')}>
                {m.direction === 'out' && <div className={'wa-by' + (m.sender === 'bot' ? ' bot' : '')}>{m.sender === 'bot' ? 'Assistant' : m.sender === 'system' ? 'Order update (automatic)' : m.sender === 'phone' ? 'From the phone' : m.by_user || 'POS'}</div>}
                {m.kind === 'location' && m.meta ? <a href={`https://maps.google.com/?q=${m.meta.lat},${m.meta.lng}`} target="_blank" rel="noreferrer">{m.text} — open map</a>
                  : m.meta?.file ? <VoiceNote m={m} notify={notify} />
                  : m.meta?.download_error ? <span className="wa-text">{m.text} <i className="wa-dl-err">— couldn't download from WhatsApp ({m.meta.download_error}). Ask the customer to send it again.</i></span>
                  : <span className="wa-text">{m.text}</span>}
                <span className="wa-meta">{m.offline ? <i title="Sent while the POS was offline">offline · </i> : null}{clock(m.at)}{m.direction === 'out' && <Ticks s={m.status} />}</span>
              </div>
            </div>
          )
        })}
        <div ref={end} />
      </div>
      {pending.map(o => (
        <div key={o.id} className="wa-order-card">
          <div className="wa-order-head"><Icon name="receipt" size={16} /><b>WhatsApp order</b>, confirmed by the customer {o.confirmed_at ? clock(o.confirmed_at) : ''}
            {o.fulfilment && <span className="wa-order-pill">{o.fulfilment}</span>}</div>
          <ul>{o.items.map((i, k) => <li key={k}>{i.qty}× {i.name}<span>{rs(i.total)}</span></li>)}</ul>
          {o.address && <div className="wa-order-addr"><Icon name="pin" size={15} />{o.address}</div>}
          {o.location && <div className="wa-order-addr"><Icon name="pin" size={15} /><a href={`https://maps.google.com/?q=${o.location.lat},${o.location.lng}`} target="_blank" rel="noreferrer">Customer's location pin — open map</a></div>}
          <div className="wa-order-foot"><b>Items: {rs(o.subtotal)}</b>
            <button className="wa-reject" onClick={() => reject(o)}>Reject</button>
            <button className="wa-accept" id="wa-accept" onClick={() => setAccepting(o)}>Accept…</button></div>
        </div>
      ))}
      {accepting && <AcceptOrder order={accepting} chat={chat} notify={notify} onClose={() => setAccepting(null)}
        onDone={async () => { setAccepting(null); setOrders(await api(`/whatsapp/chats/${cid}/orders`)) }} />}
      <footer className="wa-compose">
        <textarea rows={1} id="wa-input" placeholder={connected ? 'Type a message' : 'No internet — you can reply when WhatsApp reconnects'} value={text}
          disabled={!connected} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button className="wa-send" id="wa-send" disabled={!connected || !text.trim() || sending} onClick={send} title="Send" aria-label="Send"><Icon name="next" size={20} /></button>
      </footer>
    </div>
  )
}

// Cashier turns a confirmed WhatsApp order into a real POS order (same prices, delivery areas and kitchen ticket as the counter)
function AcceptOrder({ order, chat, notify, onClose, onDone }) {
  const pin = order.location ? `Location pin: https://maps.google.com/?q=${order.location.lat},${order.location.lng}` : ''
  const [f, setF] = useState({ type: order.fulfilment || 'delivery', customer: chat.name || '', phone: chat.phone || '', address: order.address || pin, zone_id: '' })
  const [zones, setZones] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api('/delivery-zones').then(z => {
      const active = z.filter(x => x.active)
      setZones(active)
      // Pre-select the delivery area whose name appears in the address (the cashier can change it)
      const hit = active.find(x => (order.address || '').toLowerCase().includes(x.name.toLowerCase()))
      if (hit) setF(x => ({ ...x, zone_id: x.zone_id || String(hit.id) }))
    }).catch(() => {})
  }, [order.address])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const zone = zones.find(z => z.id === +f.zone_id)
  const fee = f.type === 'delivery' && zone && !(zone.free_above && order.subtotal >= zone.free_above) ? zone.fee : 0
  const accept = async () => {
    setBusy(true)
    try {
      const r = await api(`/whatsapp/orders/${order.id}/accept`, { ...f, zone_id: +f.zone_id || null })
      notify(`Order #${r.order_id} created (${rs(r.total)}), sent to kitchen${r.message_sent ? ', customer informed' : '. WhatsApp is offline, so the customer was not told'}`, r.message_sent ? 'success' : 'info')
      onDone()
    } catch (e) { toastError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="wa-modal-bg" onClick={onClose}>
      <div className="wa-modal" onClick={e => e.stopPropagation()}>
        <h3>Accept WhatsApp order</h3>
        <div className="wa-seg">{[['delivery', 'Delivery', 'bike'], ['takeaway', 'Takeaway', 'bag']].map(([k, l, ic]) =>
          <button key={k} className={f.type === k ? 'on' : ''} onClick={() => set('type', k)}><Icon name={ic} size={16} />{l}</button>)}</div>
        <label>Name<input value={f.customer} onChange={e => set('customer', e.target.value)} /></label>
        <label>Phone<input value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
        {f.type === 'delivery' && <>
          <label>Address<textarea rows={2} value={f.address} onChange={e => set('address', e.target.value)} placeholder="Ask the customer in the chat if missing" /></label>
          {zones.length > 0 && <label>Delivery area<select value={f.zone_id} onChange={e => set('zone_id', e.target.value)}>
            <option value="">Choose…</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name} — {rs(z.fee)}{z.min_order ? ` (min ${rs(z.min_order)})` : ''}</option>)}</select></label>}
        </>}
        <ul className="wa-modal-items">{order.items.map((i, k) => <li key={k}>{i.qty}× {i.name}<span>{rs(i.total)}</span></li>)}
          {fee > 0 && <li>Delivery<span>{rs(fee)}</span></li>}</ul>
        <p className="wa-modal-note">Prices are checked again now; tax and delivery are added by the POS. The customer gets the final bill on WhatsApp.</p>
        <div className="wa-modal-foot"><button onClick={onClose}>Cancel</button>
          <button className="wa-accept" id="wa-accept-confirm" disabled={busy} onClick={accept}>{busy ? 'Creating…' : 'Accept & send to kitchen'}</button></div>
      </div>
    </div>
  )
}

// Why the assistant replied or stayed quiet, newest first
function BotLog({ chatId, onClose }) {
  const [rows, setRows] = useState([])
  useEvery(() => api(`/whatsapp/chats/${encodeURIComponent(chatId)}/log`).then(setRows).catch(() => {}), 3000, [chatId])
  return (
    <div className="wa-log">
      <div className="wa-log-head"><b>Assistant log</b><button className="wa-icon" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button></div>
      <div className="wa-log-body">
      {!rows.length && <p>Nothing yet.</p>}
      {rows.map(r => (
        <div key={r.id} className="wa-log-row">
          <span>{clock(r.at)}</span><b>{r.action}</b>
          {r.intent && <i>{r.intent}{r.ms_total ? ` · ${(r.ms_total / 1000).toFixed(1)} s` : ''}{r.cost_usd ? ` · $${r.cost_usd.toFixed(5)}` : ''}</i>}
          {r.error && <i className="err">{r.error}</i>}
          <div className="wa-log-in">“{r.in_text}”</div>
        </div>
      ))}
      </div>
    </div>
  )
}

// A customer's voice note: play it, read the transcript, rate it or correct it.
// Ratings and corrections are saved as the speech-to-text test set.
function VoiceNote({ m, notify }) {
  const [url, setUrl] = useState(null)
  const meta = m.meta || {}
  const pending = meta.transcript == null && !meta.stt_error
  const play = async () => {
    if (url) return
    try {
      const r = await fetch(`/api/whatsapp/messages/${m.id}/audio`, { headers: { Authorization: 'Bearer ' + (localStorage.getItem('pos_token') || '') } })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not load the voice note')
      setUrl(URL.createObjectURL(await r.blob()))
    } catch (e) { toastError(e.message) }
  }
  useEffect(() => () => url && URL.revokeObjectURL(url), [url])
  const send = run(async body => { await api(`/whatsapp/messages/${m.id}/transcript`, body); notify('Thanks — saved for the voice test set') })
  const correct = async () => { const t = await promptBox('Write exactly what the customer said.', { title: 'Correct the transcript', defaultValue: meta.corrected ?? meta.transcript ?? '', multiline: true, confirmLabel: 'Save correction' }); if (t != null) send({ corrected: t, rating: -1 }) }
  return (
    <div className="wa-voice">
      {url ? <audio src={url} controls autoPlay /> : <button className="wa-voice-play" onClick={play}><Icon name="next" size={14} />Voice note{meta.seconds ? ` · ${meta.seconds}s` : ''}</button>}
      <div className="wa-voice-text" dir="auto">
        {pending ? <i>Transcribing…</i> : meta.stt_error ? <i>Couldn't transcribe: {meta.stt_error}</i>
          : meta.understood || meta.transcript || <i>No speech heard</i>}
      </div>
      {meta.understood && <div className="wa-voice-raw" dir="auto" title="Exactly what the speech engine heard, before the menu-aware cleanup">
        heard: {meta.transcript}{meta.understood_confidence && meta.understood_confidence !== 'high' ? ` · clarity ${meta.understood_confidence}` : ''}</div>}
      {meta.corrected != null && <div className="wa-voice-fix" dir="auto">Corrected: {meta.corrected}</div>}
      {!pending && m.direction === 'in' && (
        <div className="wa-voice-rate">
          <span>auto-transcribed{meta.stt_ms ? ` · ${(meta.stt_ms / 1000).toFixed(1)} s` : ''}</span>
          <button className={meta.stt_rating === 1 ? 'on' : ''} title="Transcript is right" onClick={() => send({ rating: 1 })}>Right</button>
          <button className={meta.stt_rating === -1 ? 'on' : ''} title="Transcript is wrong — correct it" onClick={correct}>Correct it</button>
        </div>
      )}
    </div>
  )
}
