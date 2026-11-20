const $ = id => document.getElementById(id);
const api = window.printerApp;
const say = (id, text, kind) => { const m = $(id); m.textContent = text || ''; m.className = 'msg ' + (kind || ''); };
const busy = async (btn, fn) => { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } };

function showStatus(s) { $('status').className = 'pill ' + (s.colour || 'off'); $('statusText').textContent = s.text || ''; }
function showState(st) {
  showStatus(st.status);
  $('server').value = st.server || '';
  $('pairForm').hidden = st.paired;
  $('pairedInfo').hidden = !st.paired;
  $('rname').textContent = st.restaurant?.name || st.restaurant?.slug || 'HazelPOS';
  for (const id of ['s2', 's3']) $(id).classList.toggle('off', !st.paired);
  $('receipt').value = st.receipt || ''; $('kitchen').value = st.kitchen || '';
  $('autostart').checked = st.autostart;
}

$('pair').onclick = e => busy(e.target, async () => {
  say('msg1', 'Connecting…');
  const r = await api.pair($('code').value, $('server').value);
  if (!r.ok) return say('msg1', r.error, 'bad');
  say('msg1', ''); $('code').value = ''; showState(await api.state());
});
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('pair').click(); });
$('useKey').onclick = e => busy(e.target, async () => {
  say('msg1', 'Checking the key…');
  const r = await api.useKey($('key').value, $('server').value);
  if (!r.ok) return say('msg1', r.error, 'bad');
  say('msg1', ''); $('key').value = ''; showState(await api.state());
});
$('unpair').onclick = async () => { await api.unpair(); showState(await api.state()); };

$('find').onclick = e => busy(e.target, async () => {
  say('found', 'Looking on your network…');
  const { found } = await api.find();
  $('foundList').replaceChildren(...found.map(f => Object.assign(document.createElement('option'), { value: f })));
  $('chips').replaceChildren(...found.flatMap(f => ['receipt', 'kitchen'].map(k => {
    const b = Object.assign(document.createElement('button'), { className: 'ghost', textContent: `${f} → ${k}`, type: 'button' });
    b.onclick = () => { $(k).value = f; };
    return b;
  })));
  say('found', found.length ? `Found ${found.length}. Tap one to use it as the receipt or kitchen printer.` : 'No printer found. Check that it is on and on the same network, or type its address below.');
  $('found').className = 'hint';
});
$('save').onclick = e => busy(e.target, async () => {
  const r = await api.save({ receipt: $('receipt').value, kitchen: $('kitchen').value });
  say('msg2', r.ok ? 'Saved.' : r.error, r.ok ? 'good' : 'bad');
});
for (const k of ['receipt', 'kitchen']) $('test' + k[0].toUpperCase() + k.slice(1)).onclick = e => busy(e.target, async () => {
  const saved = await api.save({ receipt: $('receipt').value, kitchen: $('kitchen').value });
  if (!saved.ok) return say('msg3', saved.error, 'bad');
  say('msg3', 'Sending…');
  const r = await api.testPage(k);
  say('msg3', r.ok ? 'Sent. Check the printer.' : r.error, r.ok ? 'good' : 'bad');
});
$('autostart').onchange = e => api.setAutostart(e.target.checked);
api.onStatus(showStatus);
api.state().then(showState);
