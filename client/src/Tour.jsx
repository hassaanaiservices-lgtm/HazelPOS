import { useEffect, useLayoutEffect, useState } from 'react'

// First-run guided tour: the first time each role logs in on a screen, it walks through the main parts one by one
// (Next / Back / Skip). "Help" in the sidebar plays it again. Remembered per screen (localStorage), so a new PC or
// tablet shows it once too. A step whose part isn't on screen (e.g. a phone with the menu closed) shows in the middle.
const STEPS = {
  admin: [
    [null, 'Welcome to HazelPOS', 'A quick tour of what you, the owner, can do. It takes a minute. You can skip it and play it again any time from Help.'],
    ['#nav-dashboard', 'Dashboard', "Today's sales, expenses and profit, best-selling items, tax invoices, and Excel downloads for any day or month."],
    ['#nav-orders', 'Orders', 'Every order: open, paid, refunded and cancelled. Reprint a receipt or refund a paid order (with a reason).'],
    ['#nav-kitchen', 'Kitchen', 'The kitchen screen: New → Cooking → Ready. Open it on a screen in the kitchen.'],
    ['#nav-riders', 'Riders', 'The delivery board, your riders and the link for their phone screen (they accept orders and share their location), a map of where they are, and their monthly accounts: deliveries, fees, cash collected and handed in.'],
    ['#nav-menu', 'Menu', 'Your items, sizes and prices, categories, deals and combos, and the menu pictures the WhatsApp bot sends. You can also import the whole menu from Excel.'],
    ['#nav-places', 'Tables & delivery', 'Floors and tables (and each table\'s QR code to print), plus your delivery areas with fees and minimum orders.'],
    ['#nav-register_session', 'Cash drawer', 'The cash in the drawer for this shift. Close the shift at night to get the Z-report.'],
    ['#nav-inventory', 'Inventory', 'Ingredients, recipes and suppliers. Stock goes down by itself when orders are paid; a red number means something is running low.'],
    ['#nav-customers', 'Customers', 'Your regular customers, their orders and loyalty points.'],
    ['#nav-staff', 'Staff', 'Your staff, their salaries and advances. Anyone whose job is "Rider" shows on the Delivery screen.'],
    ['#nav-admin', 'Settings', 'Restaurant details and logo, staff PINs (change or reset anyone\'s PIN), the WhatsApp bot, low-stock alerts, cloud backup and app updates.'],
    ['#tour-help', 'Need this again?', 'Press Help any time to see this tour again. That\'s it!'],
  ],
  cashier: [
    [null, 'Welcome to HazelPOS', 'A quick tour of the cashier screens. It takes a minute. You can skip it and play it again from Help.'],
    ['#nav-home', 'Billing', 'Start every new order here: dine-in (pick a table), takeaway or delivery. Tap items to add them, then send to the kitchen or take payment.'],
    ['#nav-orders', 'Orders', 'Open orders to continue, paid orders to reprint a receipt or refund.'],
    ['#nav-kitchen', 'Kitchen', 'What the kitchen is making right now.'],
    ['#nav-delivery', 'Delivery', 'Send riders with ready orders, mark them delivered, and take the cash when the rider returns.'],
    ['#nav-whatsapp', 'WhatsApp', 'Customers\' WhatsApp chats. The assistant answers and takes orders; you accept them here. You can reply yourself too.'],
    ['#nav-register_session', 'Cash drawer', 'Open the shift in the morning with the cash in the drawer, record cash in/out, and close it at night.'],
    ['#tour-help', 'Need this again?', 'Press Help any time to see this tour again.'],
  ],
  rider: [
    [null, 'Your rider screen', 'Press "On duty" when you start, so the restaurant and customers can see where you are. Orders appear under "Ready to pick up": press Accept to take one. Navigate and Call help you find the customer; press Delivered twice when you hand it over. Your earnings and the cash you must hand in are at the top. You can see this again from Help.'],
  ],
  kitchen: [
    [null, 'Kitchen screen', 'Your only job is cooking. New orders appear on the left with a beep. Press "Start cooking", then "Ready" when the food is done. That\'s it: the order goes to the counter (dine-in, takeaway) or to the riders (delivery) by itself. Pressed Ready by mistake? Undo it in the "Ready, waiting" list. You can see this again from Help.'],
  ],
}
const doneKey = role => `pos_tour_done_${role}`
export const tourDone = role => { try { return localStorage.getItem(doneKey(role)) === '1' } catch { return true } }

export default function Tour({ role, onClose }) {
  const steps = STEPS[role] || STEPS.cashier
  const [i, setI] = useState(0)
  const [box, setBox] = useState(null)
  const [sel, title, text] = steps[i]
  const finish = () => { try { localStorage.setItem(doneKey(role), '1') } catch { /* private window */ } onClose() }

  useLayoutEffect(() => {
    const place = () => {
      const el = sel && document.querySelector(sel)
      const r = el?.getBoundingClientRect()
      setBox(r && r.width && r.height ? { top: r.top, left: r.left, width: r.width, height: r.height } : null)
      el?.scrollIntoView?.({ block: 'nearest' })
    }
    place()
    window.addEventListener('resize', place); return () => window.removeEventListener('resize', place)
  }, [sel])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') finish(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') setI(n => Math.max(0, n - 1)) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  })
  const next = () => i + 1 < steps.length ? setI(i + 1) : finish()

  // The card sits beside the highlighted part (right of the sidebar), or in the middle
  const card = box
    ? { top: Math.min(Math.max(12, box.top - 8), window.innerHeight - 260), left: Math.min(box.left + box.width + 16, window.innerWidth - 360) }
    : null
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box ? <div className="tour-spot" style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }} /> : <div className="tour-dim" />}
      <div className={'tour-card' + (card ? '' : ' center')} style={card || undefined}>
        <div className="tour-count">{i + 1} / {steps.length}</div>
        <h3 id="tour-title">{title}</h3>
        <p>{text}</p>
        <div className="tour-actions">
          <button className="ghost" onClick={finish}>Skip tour</button>
          <span style={{ flex: 1 }} />
          {i > 0 && <button className="ghost" onClick={() => setI(i - 1)}>Back</button>}
          <button className="primary" onClick={next} autoFocus>{i + 1 < steps.length ? 'Next' : 'Done'}</button>
        </div>
      </div>
    </div>
  )
}
