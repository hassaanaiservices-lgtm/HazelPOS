// The table-QR story (section #qr-order, markup from tools/qr-scene/scene.py).
// The stage stays pinned while its tall track scrolls past; the scroll position becomes one number, p (0 to 1),
// and paint(p) sets everything on screen from p alone, so scrolling up rewinds the story.
// ?qr=0.55 jumps to that moment; ?qr=0.55&shot also pins the stage in place and paints exactly that frame (screenshots).
(() => {
  const root = document.querySelector('[data-qs]')
  if (!root) return
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)]
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
  const seg = (p, a, b) => clamp((p - a) / (b - a))
  const ease = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
  const easeOut = t => 1 - (1 - t) ** 3
  const lerp = (a, b, t) => a + (b - a) * t

  const track = $('.qs-track'), stage = $('.qs-stage')
  const room = $('.qs-room'), pov = $('.qs-pov'), counter = $('.qs-counter')
  const cust = $('.qs-cust'), bob = $('.qs-cust__bob'), waiter = $('.qs-waiter'), sweat = $('.qs-sweat')
  const clockH = $('.qs-clock__h'), clockM = $('.qs-clock__m')
  const bubbles = $$('.qs-bubble'), say = $('.qs-say'), pop = $('.qs-pop'), caps = $$('[data-cap]'), hint = $('.qs-hint'), end = $('.qs-end')
  const phone = $('.qs-phone'), list = $('.qs-list'), rig = $('.qs-rig'), mrig = $('.qs-mrig'), monitor = $('.qs-monitor')
  const cashier = $('.qs-counter .qs-cashier')
  const hands = {
    cust: { el: $('.qs-finger--cust'), tap: rig.querySelector('.qs-tap'), box: rig, pivot: 320 },
    cash: { el: $('.qs-finger--cash'), tap: mrig.querySelector('.qs-tap'), box: mrig, pivot: 600 },
  }
  const T = name => root.querySelector(`[data-t="${name}"]`)

  // ---------- the phone: what the customer taps, in order ----------
  const TAPS = [
    { p: 0.470, t: 'karahi-add' }, { p: 0.490, t: 'half' }, { p: 0.505, t: 'medium' }, { p: 0.520, t: 'opt-add' },
    { p: 0.575, t: 'naan-add' }, { p: 0.590, t: 'naan-plus' }, { p: 0.605, t: 'raita-add' },
    { p: 0.620, t: 'cart' }, { p: 0.645, t: 'place' },
  ]
  const SCROLL = [0.533, 0.558] // the menu list scrolls between these (finger drags it up)
  const CART = { 4: ['1', 'Rs. 1,400'], 5: ['2', 'Rs. 1,520'], 6: ['3', 'Rs. 1,640'], 7: ['4', 'Rs. 1,740'] }
  let scrollBy = 260 // list travel in phone pixels; measured
  const item = k => root.querySelector(`[data-item="${k}"]`)

  // s = how many taps have happened; scrollT = 0-1 through the list scroll
  const phoneState = (s, scrollT, screen) => {
    phone.dataset.screen = screen
    phone.classList.toggle('opt', s >= 1 && s < 4)
    phone.classList.toggle('half', s >= 2)
    phone.classList.toggle('medium', s >= 3)
    phone.classList.toggle('order', s === 8)
    item('karahi').classList.toggle('in', s >= 4)
    T('karahi-add').textContent = s >= 4 ? 'Add more (1)' : 'Choose'
    item('naan').classList.toggle('in', s >= 5)
    item('naan').querySelector('.qs-qty b').textContent = s >= 6 ? '2' : '1'
    item('raita').classList.toggle('in', s >= 7)
    const c = CART[Math.min(s, 7)]
    phone.classList.toggle('cart', !!c)
    if (c) { T('cart').querySelector('.qs-badge').textContent = c[0]; T('cart').querySelector('b').textContent = c[1] }
    list.style.transform = `translateY(${-scrollBy * ease(scrollT)}px)`
  }

  // where each tap target sits, in the rig's own units (independent of screen size)
  const centre = (el, box) => {
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), k = b.width / box.offsetWidth
    return { x: (r.left + r.width / 2 - b.left) / k, y: (r.top + r.height / 2 - b.top) / k }
  }
  let custKeys = [], cashKeys = []
  const measure = () => {
    const wrap = $('.qs-list-wrap'), naan = item('naan')
    scrollBy = Math.max(0, naan.offsetTop - wrap.offsetHeight * 0.3)
    const rest = { x: 600, y: 900 }
    const keys = [{ p: 0.44, ...rest, press: 0 }]
    TAPS.forEach((tap, i) => {
      phoneState(i, i >= 4 ? 1 : 0, 'menu')
      const at = centre(T(tap.t), rig)
      if (i === 4) { // the drag that scrolls the list, before the fifth tap
        const from = { x: 300, y: 560 }, to = { x: 300, y: 560 - scrollBy }
        keys.push({ p: SCROLL[0] - 0.004, ...from, press: 0 }, { p: SCROLL[0], ...from, press: 1 }, { p: SCROLL[1], ...to, press: 1 }, { p: SCROLL[1] + 0.004, ...to, press: 0 })
      }
      keys.push({ p: tap.p - 0.007, ...at, press: 0 }, { p: tap.p - 0.002, ...at, press: 1 }, { p: tap.p + 0.003, ...at, press: 1 }, { p: tap.p + 0.007, ...at, press: 0 })
    })
    keys.push({ p: 0.668, ...rest, press: 0 })
    custKeys = keys
    monitor.classList.add('modal')
    const acc = centre(T('accept'), mrig), off = { x: 900, y: 700 }
    cashKeys = [{ p: 0.765, ...off, press: 0 }, { p: 0.788, ...acc, press: 0 }, { p: 0.793, ...acc, press: 1 }, { p: 0.798, ...acc, press: 1 }, { p: 0.803, ...acc, press: 0 }, { p: 0.83, ...off, press: 0 }]
    const m = $('.qs-modal'), scr = $('.qs-mscreen') // the pop-up is centred on the screen, inside a 16-unit bezel
    modalBox = { x: 380, y: 16 + scr.offsetHeight / 2, w: m.offsetWidth, h: m.offsetHeight }
  }
  let modalBox = { x: 380, y: 240, w: 400, h: 330 }

  // The tapping hand: it travels between targets a little closer to the camera (bigger), presses down (smaller),
  // and tilts from the wrist as it moves sideways. The holding hand dips the phone a touch on every press.
  const moveHand = (h, keys, p) => {
    let x = keys[0].x, y = keys[0].y, press = 0, lift = 0
    if (p >= keys[keys.length - 1].p) ({ x, y } = keys[keys.length - 1])
    else for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1]
      if (p >= a.p && p < b.p) {
        const t = ease(seg(p, a.p, b.p))
        x = lerp(a.x, b.x, t); y = lerp(a.y, b.y, t); press = a.press && b.press
        if (!a.press && !b.press && Math.hypot(b.x - a.x, b.y - a.y) > 4) lift = Math.sin(Math.PI * t)
        break
      }
    }
    const scale = press ? 0.74 : 0.8 + 0.07 * lift
    const tilt = clamp((x - h.pivot) * 0.035, -9, 9)
    h.el.style.transform = `translate(${x - 120}px, ${y - 20}px) rotate(${tilt}deg) scale(${scale})` // the tip (120, 20) stays on target
    h.tap.style.transform = `translate(${x}px, ${y}px)`
    h.tap.classList.toggle('on', !!press)
    if (h.box === rig) rig.style.setProperty('--hold', `translateY(${press ? 4 : 0}px) rotate(${Math.sin(p * 90) * 0.6}deg)`)
  }

  // ---------- layout: everything placed from the stage's real size ----------
  let W = 0, H = 0, S = 1, OX = 0, OY = 0
  const svgPx = (x, y) => ({ x: OX + x * S, y: OY + y * S }) // a point of the 1200 x 900 drawings, in stage pixels
  let zoomMax = 1, zoomShift = { x: 0, y: 0 }
  const layout = () => {
    W = stage.clientWidth; H = stage.clientHeight
    S = Math.max(W / 1200, H / 900); OX = (W - 1200 * S) / 2; OY = (H - 900 * S) / 2
    const think = svgPx(760, 300), head = svgPx(600, 262), tent = svgPx(752, 614)
    room.style.setProperty('--ax', think.x + 'px'); room.style.setProperty('--ay', think.y + 'px')
    room.style.setProperty('--hx', head.x + 'px'); room.style.setProperty('--hy', head.y + 'px')
    room.style.transformOrigin = `${tent.x}px ${tent.y}px`
    // the phone rig: 640 x 860, phone in the middle; on narrow screens the hands may run off the sides
    const k = Math.min(W * 0.98 / 360, H * 0.97 / 860)
    rig.style.setProperty('--k', k)
    // the cashier's screen: under her chin, as big as fits
    const chin = svgPx(600, 482), top = Math.min(chin.y + 6, H * 0.62)
    const k2 = Math.min(W * 0.92 / 760, (H - top - 10) / 500)
    mrig.style.setProperty('--k', k2); mrig.style.top = top + 'px'
    // then the camera pushes in until the pop-up reads at a comfortable size
    // (never taller than the stage), and moves it to the middle of the stage while it does
    zoomMax = Math.max(1, Math.min(2.6, Math.min(W * 0.92, 470) / (modalBox.w * k2), (H - 72) / (modalBox.h * k2)))
    const mx = W / 2 + (modalBox.x - 380) * k2, my = top + modalBox.y * k2
    counter.style.transformOrigin = `${mx}px ${my}px`
    zoomShift = { x: W / 2 - mx, y: (H + 40) / 2 - my } // + 40: clear of the caption at the top
    // bubble beside the waiter follows him (set in paint)
    last = -1
  }

  // ---------- one frame ----------
  const FACE = [[0.165, 'calm'], [0.205, 'serious'], [0.245, 'concerned'], [0.29, 'tired'], [0.33, 'solemn'], [0.86, 'awe'], [0.9, 'smile'], [2, 'smileBig']]
  const BUBBLES = [[0.165, 0.205], [0.205, 0.245], [0.245, 0.29], [0.29, 0.33], [0.335, 0.4]]
  const CAPS = [0.16, 0.33, 0.405, 0.685, 0.855, 2]
  const shotStyle = (el, opacity, transform) => {
    el.style.opacity = opacity; el.style.transform = transform
    el.style.visibility = opacity <= 0.001 ? 'hidden' : 'visible'
  }
  let last = -1
  const paint = p => {
    if (p === last) return
    last = p
    // shots: room -> (push into the QR stand) -> phone -> (whip to the counter) -> counter -> room
    const zin = ease(seg(p, 0.365, 0.43)), back = seg(p, 0.85, 0.88)
    if (p < 0.6) shotStyle(room, 1 - seg(p, 0.405, 0.43), `scale(${1 + 2.2 * zin})`)
    else shotStyle(room, back, `scale(${1.06 - 0.06 * ease(back)})`)
    const pin = seg(p, 0.405, 0.435), whip = ease(seg(p, 0.675, 0.71))
    shotStyle(pov, Math.min(pin, 1 - seg(p, 0.7, 0.71)), `translateX(${-60 * whip}%) scale(${1.12 - 0.12 * ease(pin)})`)
    const zt = ease(seg(p, 0.728, 0.748)) - ease(seg(p, 0.805, 0.825))
    shotStyle(counter, p < 0.8 ? clamp(whip * 3) : 1 - back,
      `translateX(${(1 - whip) * 60}%) translate(${zoomShift.x * zt}px, ${zoomShift.y * zt}px) scale(${lerp(1, zoomMax, zt)})`)

    // room: he walks in, sits, waits, notices the QR
    const walk = seg(p, 0.03, 0.12), sit = ease(seg(p, 0.12, 0.155))
    cust.setAttribute('transform', `translate(${lerp(1300, 424, easeOut(walk))} ${lerp(140, 236, sit)})`)
    bob.setAttribute('transform', `translate(0 ${walk > 0 && walk < 1 ? -Math.abs(Math.sin(walk * Math.PI * 7)) * 12 : 0})`)
    cust.dataset.face = FACE.find(([until]) => p < until)[1]
    bubbles.forEach((b, i) => b.classList.toggle('on', p >= BUBBLES[i][0] && p < BUBBLES[i][1]))
    sweat.style.opacity = p >= 0.245 && p < 0.335 ? 1 : 0
    const wx = 790 + 110 * Math.sin(p * Math.PI * 2 * 6)
    waiter.setAttribute('transform', `translate(${wx} ${-Math.abs(Math.sin(p * Math.PI * 60)) * 6})`)
    const wh = svgPx(wx + 112, 280)
    say.style.left = clamp(wh.x, 90, W - 90) + 'px'; say.style.top = wh.y + 'px'
    say.classList.toggle('on', p >= 0.215 && p < 0.25)
    const mins = 330 * seg(p, 0.16, 0.34)
    clockM.setAttribute('transform', `rotate(${mins * 6 % 360} 1060 210)`)
    clockH.setAttribute('transform', `rotate(${225 + mins / 2} 1060 210)`)
    root.classList.toggle('qs-glow', p >= 0.33 && p < 0.43)
    pop.classList.toggle('on', p >= 0.885)

    // the phone
    const screen = p < 0.447 ? 'cam' : p < 0.645 ? 'menu' : 'sent'
    phone.classList.toggle('found', p >= 0.435)
    const s = TAPS.filter(t => p >= t.p).length
    phoneState(s, seg(p, SCROLL[0], SCROLL[1]), screen)
    moveHand(hands.cust, custKeys, p)

    // the counter
    monitor.classList.toggle('modal', p >= 0.725 && p < 0.796)
    monitor.classList.toggle('toast', p >= 0.796)
    cashier.dataset.face = p < 0.725 ? 'calm' : p < 0.75 ? 'awe' : p < 0.796 ? 'smile' : 'smileBig'
    moveHand(hands.cash, cashKeys, p)

    caps.forEach((c, i) => c.classList.toggle('on', p < 0.92 && i === CAPS.findIndex(until => p < until))) // the closing card takes over at the end
    hint.classList.toggle('on', p < 0.025)
    end.classList.toggle('on', p >= 0.92)
  }

  // ---------- scroll -> p ----------
  const q = new URLSearchParams(location.search)
  const forced = q.has('qr') ? clamp(parseFloat(q.get('qr')) || 0) : null
  const still = forced !== null && q.has('shot')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) root.classList.add('qs-static')
  if (still) root.classList.add('qs-still')
  const progress = () => {
    if (reduced) return 1
    if (still) return forced
    const total = track.offsetHeight - stage.offsetHeight
    const top = parseFloat(getComputedStyle(stage).top) || 0
    return clamp((top - track.getBoundingClientRect().top) / total)
  }
  let queued = false
  const frame = () => { queued = false; paint(progress()) }
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(frame) } }
  const init = () => { measure(); layout(); last = -1; paint(progress()) }
  addEventListener('scroll', request, { passive: true })
  addEventListener('resize', () => { layout(); request() })
  init()
  if (document.fonts) document.fonts.ready.then(init)
  if (forced !== null && !still) {
    const total = track.offsetHeight - stage.offsetHeight
    const y = track.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(stage).top) || 0) + forced * total
    scrollTo({ top: y, behavior: 'instant' })
  }
})()
