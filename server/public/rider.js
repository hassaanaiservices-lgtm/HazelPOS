(() => {
  const [, , slug, token] = location.pathname.split('/'); // /r/<restaurant>/<token>
  const API = '/api/r/' + token;
  const H = { 'content-type': 'application/json', 'x-tenant': slug };
  const $ = id => document.getElementById(id);
  const rs = n => 'Rs ' + Math.round(+n || 0).toLocaleString('en-PK');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mins = iso => iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)) : 0;
  const ago = iso => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 60 ? s + ' s ago' : Math.round(s / 60) + ' min ago'; };
  let toastTimer;
  const toast = msg => { $('toast').textContent = msg; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4000); };
  const post = async (p, body) => {
    const r = await fetch(API + p, { method: 'POST', headers: H, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    return d;
  };
  const navUrl = address => { const m = /q=(-?\d+\.?\d*),(-?\d+\.?\d*)/.exec(address || ''); return 'https://www.google.com/maps/dir/?api=1&destination=' + (m ? m[1] + ',' + m[2] : encodeURIComponent(address || '')); };

  // --- Duty and location ---
  let onDuty = false, watchId = null, lastSent = 0, lastPos = null, wakeLock = null, locState = '';
  const setLoc = (text, cls) => { $('loc').textContent = text; $('loc').className = cls || ''; };
  const sendPos = async (p, force) => {
    if (!onDuty) return;
    const moved = !lastPos || Math.abs(p.coords.latitude - lastPos.lat) + Math.abs(p.coords.longitude - lastPos.lng) > 0.0002;
    if (!force && Date.now() - lastSent < (moved ? 8000 : 30000)) return;
    lastSent = Date.now(); lastPos = { lat: p.coords.latitude, lng: p.coords.longitude };
    try { await post('/location', { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setLoc('Location on · sent ' + ago(new Date(lastSent).toISOString()), 'good'); }
    catch (e) { setLoc('Location not sent: ' + e.message, 'bad'); }
  };
  const startLoc = () => {
    if (!navigator.geolocation) return setLoc('This phone has no location', 'bad');
    setLoc('Getting your location…');
    const why = e => e.code === 1 ? 'Allow location for this page (phone settings → browser → location)' : e.code === 3 ? 'Still looking for GPS… go outside or near a window' : 'Turn on Location (GPS) on the phone';
    watchId = navigator.geolocation.watchPosition(p => sendPos(p), e => setLoc(why(e), 'bad'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  };
  const stopLoc = () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; setLoc(''); };
  const keepAwake = async on => {
    try { if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch { /* not supported */ }
  };
  const setDuty = async on => {
    onDuty = on;
    $('duty').classList.toggle('on', on); $('duty').setAttribute('aria-pressed', on); $('dutyText').textContent = on ? 'On duty' : 'Off duty';
    $('note').hidden = !on;
    try { await post('/duty', { on }); } catch (e) { toast(e.message); }
    on ? (startLoc(), keepAwake(true)) : (stopLoc(), keepAwake(false));
    try { localStorage.setItem('hz_duty', on ? '1' : '0'); } catch { /* ignore */ }
  };
  $('duty').onclick = () => setDuty(!onDuty);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && onDuty) { keepAwake(true); if (lastPos) sendPos({ coords: { latitude: lastPos.lat, longitude: lastPos.lng, accuracy: 0 } }, true); } });

  // --- Orders ---
  const act = async (p, body, busyText, btn) => {
    btn.disabled = true; const t = btn.textContent; btn.textContent = busyText;
    try { await post(p, body); await load(); } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = t; }
  };
  const card = (o, mine) => {
    const el = document.createElement('div'); el.className = 'card' + (mine ? ' mine' : '');
    const money = o.cod ? `<span class="pill cod">Collect ${rs(o.total)} cash</span>` : `<span class="pill paid">Paid ${rs(o.total)}</span>`;
    el.innerHTML = `<div class="head"><b>#${o.local_id}</b>${money}</div>
      <div><b>${esc(o.customer || 'Customer')}</b> ${o.zone ? `<span class="pill">${esc(o.zone)}</span>` : ''}</div>
      ${o.address ? `<a class="addr" href="${navUrl(o.address)}" target="_blank" rel="noreferrer">📍 ${esc(o.address)}</a>` : ''}
      <div class="items">${esc(o.items)}</div>`;
    const actions = document.createElement('div'); actions.className = 'actions';
    if (mine) {
      actions.innerHTML = `<a class="btn" href="${navUrl(o.address)}" target="_blank" rel="noreferrer">🧭 Navigate</a>` + (o.phone ? `<a class="btn" href="tel:${esc(o.phone)}">📞 Call</a>` : '<span></span>')
        + `<div class="wide muted small">Out for ${mins(o.dispatched_at)} min</div>`;
      const b = document.createElement('button'); b.className = 'ok wide'; b.textContent = '✓ Delivered';
      // Tap twice: the first tap asks, the second confirms (no pop-ups; a thumb on a moving bike)
      let armed = null;
      b.onclick = () => {
        if (armed) { clearTimeout(armed); armed = null; return act('/delivered', { order: o.local_id }, 'Sending…', b); }
        b.textContent = `Tap again: delivered${o.cod ? ', ' + rs(o.total) + ' collected' : ''}`; b.classList.add('primary');
        armed = setTimeout(() => { armed = null; b.textContent = '✓ Delivered'; b.classList.remove('primary'); }, 4000);
      };
      actions.appendChild(b);
    } else {
      const b = document.createElement('button'); b.className = 'primary wide';
      if (o.status !== 'ready') { b.textContent = 'Still cooking · abhi tayyar nahi'; b.disabled = true; }
      else { b.textContent = '✋ Accept · main le jata hoon'; b.onclick = () => act('/accept', { order: o.local_id }, 'Accepting…', b); }
      actions.appendChild(b);
    }
    el.appendChild(actions); return el;
  };
  const fill = (id, list, mine, empty) => { const box = $(id); box.innerHTML = ''; if (!list.length) { box.innerHTML = `<div class="empty">${empty}</div>`; return; } list.forEach(o => box.appendChild(card(o, mine))); };
  async function load() {
    let d;
    try { const r = await fetch(API, { headers: H }); d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(r.status === 404 || r.status === 401 ? 'This link does not work any more. Ask the restaurant for a new one.' : d.error); }
    catch (e) {
      if (e instanceof TypeError) { $('pos').textContent = 'No internet: trying again…'; $('pos').className = 'bad'; return; }
      $('fatal').textContent = e.message || 'This link does not work. Ask the restaurant for a new one.'; $('fatal').hidden = false; document.body.classList.add('invalid'); return;
    }
    $('fatal').hidden = true; document.body.classList.remove('invalid');
    document.title = d.restaurant + ' · rider';
    $('restaurant').textContent = d.restaurant; $('rider').textContent = d.rider.name;
    $('pos').textContent = ''; $('pos').className = '';
    if (d.rider.on_duty !== onDuty && !watchId) setDuty(d.rider.on_duty);
    fill('mine', d.mine, true, 'Nothing with you right now'); $('mineCount').textContent = d.mine.length || '';
    fill('ready', d.ready, false, 'No order waiting. New delivery orders appear here when the kitchen marks them ready.'); $('readyCount').textContent = d.ready.length || '';
    $('doneCount').textContent = d.today.delivered; $('doneCash').textContent = rs(d.today.cash);
    $('others').textContent = d.others_out ? `${d.others_out} other delivery${d.others_out > 1 ? 'ies' : ''} out with other riders` : '';
  }
  load(); setInterval(load, 5000);
  try { if (localStorage.getItem('hz_duty') === '1') setDuty(true); } catch { /* ignore */ }
})();
