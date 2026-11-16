# Suggestions and open questions

Ideas and questions from building HazelPOS, saved here so they don't get lost in chat. Read them when you have time,
then we decide together. Risks have their own file: [RISKS.md](RISKS.md).

Status: **open** = waiting for you, **done**, or **dropped**.

## Waiting on you

| # | What | Why it matters | Status |
| --- | --- | --- | --- |
| Q1 | **QR codes**: what to do with that section. | Decided: QR1 + QR2 built (out of the sidebar, per-table QR button in Tables & delivery). QR3–QR7 still open. | open |
| Q2 | **Test the WhatsApp bot with real DeepSeek** after the menu-pictures change (prompt rule 10). Run `node rag/scripts/run-eval.js` once (a few cents), or send a test WhatsApp message "menu bhejo" and "kya kya milta hai?". | The new instructions were only tested with a fake AI. | open |
| Q3 | **Put it online**: push the `product-installer` branch, deploy the cloud and the admin app on Railway (steps in `cloud/README.md` and `admin/README.md`), put the cloud address in `desktop/package.json` → `hazel.cloudUrl`, then build the installers. | Nothing is online yet; everything so far runs only on your PC. | open |
| Q4 | **Licence rules.** | Decided and built: internet never locks anything; unpaid → bot stops after 3 days, POS after 7; days changeable per client; Unpaid page with +7 days / Stop now / Cancel. | done |

## QR codes: what to do with that section (you asked)

**What it is today.** Each table has its own QR code. A customer scans it, sees the menu on their phone, orders, and
the order pops up on the cashier's screen to accept. The **QR codes** item in the sidebar (owner *and* cashier) only
shows the codes so you can print them once and stick one on each table.

**How professional POS systems handle it** (Toast, Square, Foodics, Petpooja, Lightspeed work roughly like this):
- **Printing the codes is a one-time setup job**, done by the owner or manager in the back office, next to the tables
  (Tables / Floor plan → "Print QR codes"). It's not a daily screen, so cashiers don't have it in their menu.
- **The daily part is the incoming orders**: they arrive in the normal order queue (and the kitchen), sometimes with a
  sound, and the cashier accepts or rejects them. Some restaurants switch on **auto-accept** so QR orders go straight
  to the kitchen.
- **QR ordering is a switch** the owner turns on or off (some only use the QR to *show the menu*, no ordering).
- **The QR menu is served from the internet (the vendor's cloud)**, so customers open it on mobile data. They don't
  need to join the restaurant's WiFi.

**My recommendation: keep the feature, remove the section.**

| # | Change | Why | Status |
| --- | --- | --- | --- |
| QR1 | **Remove "QR codes" from the sidebar** (owner and cashier). | It's a one-time printing job, not a daily screen; it just adds clutter. | done |
| QR2 | **Move printing to the owner: Tables & delivery → Tables → "Print QR codes"** (one code per table, or one floor at a time). Also in the admin app's Tables tab, so you can print them for a client before installing. | That's where pros put it: next to the tables they belong to. | done (POS); admin app part open |
| QR3 | **QR orders show in Orders as their own tab ("QR requests")**, besides the popup the cashier already gets. | Nothing gets missed if the popup is closed. | open |
| QR4 | **Owner settings: QR ordering on / off, "menu only" mode, and auto-accept to kitchen.** | Each restaurant works differently. | open |
| QR5 | **Big one: QR codes today point to the POS PC's local address (e.g. `http://192.168.1.5:4000/…`).** A customer must be on the restaurant's WiFi for the page to open; on mobile data it fails. Pros serve the QR menu from the cloud. Fix: HazelPOS Cloud hosts the menu page and passes orders to the POS. | Most customers won't join the WiFi, so today the feature barely works in real life. | open |
| QR6 | **One general QR** (not tied to a table) for the counter, window, flyers and Instagram: menu + takeaway/delivery order, or a WhatsApp link to your assistant. | Brings orders from outside the restaurant too. | open |
| QR7 | **"New QR code" for one table** (if a code is copied or misused, the old one stops working). | Abuse protection. | open |

## Cash drawer

| # | What | Why | Status |
| --- | --- | --- | --- |
| C1 | In your screenshot, expected drawer cash was **Rs. -87**: refund #127 (Rs. 7,888) was taken out of *this* shift's drawer, but this shift only took Rs. 4,001 in cash. The order was probably paid in an earlier shift. Options: warn before a refund that would make the drawer negative, or let the cashier choose "refund from drawer" vs "refund by bank transfer". | Decided: minus is allowed and the screen now explains why. | done |
| C2 | Cash drawer sync, for the record: inside the POS it's always in sync (owner and cashier read the same shift). On the cloud, each **closed** shift (Z-report) goes up with expected cash, counted cash and difference; cash-in/cash-out lines don't go up one by one. | You asked; works as intended. Option: also send each cash in/out line. | open |

## Feature ideas

| # | Idea | Why | Status |
| --- | --- | --- | --- |
| S1 | **Admin app → Menu tab: add and edit items one by one.** Note: the POS already has this (Menu → + Add item / Edit); this is only about the admin app, where the menu comes from Excel or photos. | Small fixes without re-uploading the whole Excel. | open |
| S2 | **WhatsApp alert to the owner when an ingredient runs low**. | Built: Settings → Alerts (end of day, numbers, how low counts). | done |
| S3 | **Stock back on a refund**, optional per refund ("food was not made"). Today a refund never returns stock, on purpose. | Some refunds happen before cooking. | open |
| S4 | **Restore from the cloud backup when activating on a new PC** (RISKS.md O1). | Built: automatic on a new PC + Settings → Cloud → Restore. | done |
| S5 | **Force a PIN change on first login** when the default PINs (1234/1111/2222) are still in use (RISKS.md D7). | Anyone who knows the defaults can log in. | open |
| S6 | **"Push menu update" button** in the admin app, for a restaurant that already has orders (RISKS.md O7). | Today your setup changes reach the POS only before its first order. | open |
| S7 | **Menu photo → menu items with AI** (Groq vision or Claude), as a draft Excel you check. | Built: admin app → Branch → Menu → "Read the menu from photos". | done |
| S8 | **Real combo deals** (fixed items + choices, kitchen sees each item, stock per item). Built on 2026-11-15: deals and combos in the POS, the admin app and Excel. | Kitchen tickets and stock are exact for deals. | done |
| S9 | **Separate admin logins per team member**, with a log of who did what (RISKS.md L6). | Built: admin app → Team (owner) and Activity. | done |
| S10 | **Signed licence answers** from the cloud (RISKS.md L4). | Built in 4 phases: signing, checking on the POS, bound to the branch key, cloud flags orders made while locked. One step left for you: put the public key in the installer (RISKS.md L4). | done |
| S11 | **"Download for Windows" button on the site**, once there's a public release. | You said leave it for now. | dropped (for now) |

## From earlier answers in chat (how professionals run a POS business)

| # | Idea | Why | Status |
| --- | --- | --- | --- |
| P1 | **Monthly fee + one-time installation fee.** | Decided. Admin app: monthly fee, installation fee and "installation paid" per client. | done |
| P2 | **AnyDesk on every client PC.** | You'll handle it yourself. | dropped |
| P3 | **Staff guide.** | Replaced by the first-run guided tour inside the app (Help plays it again). | done |
| P4 | **A simple client agreement**: monthly fee, what support you give and when, who owns the data, and that WhatsApp can restrict a number (RISKS.md W1). | Avoids arguments later. | open |
| P5 | **Stay for the first evening rush** at each new restaurant. | That's when problems show up. | open |
| P6 | **A WhatsApp group per client.** | Not needed: clients message you directly. | dropped |
| P7 | **Sell a hardware bundle** (touch PC, thermal printer, cash drawer, kitchen screen), already set up in your office. | You control the machine; it works on day one. | open |
| P8 | **Updates to a few clients first, then everyone.** | Built: admin app → Updates (test clients, Release to everyone). | done |
| P9 | **Run commands in the system Terminal, not VS Code's** (VS Code here is a Flatpak and has no node/npm), or prefix with `flatpak-spawn --host`. | Why localhost "didn't work". | done (tip) |

## WhatsApp: what to do about Baileys (you asked)

**The situation.** HazelPOS links WhatsApp through Baileys, an unofficial WhatsApp Web client. It's free and works with
the restaurant's normal number, but it's against WhatsApp's terms. WhatsApp can restrict or ban a number, mostly for
spam-like behaviour (messaging many people who didn't write first, many new chats per day, links). Replying to
customers who message first, which is what HazelPOS does, is the low-risk use. Thousands of small businesses run like
this, but the risk never goes to zero, and if WhatsApp changes its web protocol, Baileys can break until it's updated.

**The official way** is the **WhatsApp Business Platform (Cloud API)** from Meta, directly or through a provider
(360dialog, Twilio, Gupshup, WATI…). No ban risk for normal use, but: the number moves to the API (it can't be used in
the phone's WhatsApp app at the same time), Meta checks the business (verification), and Meta charges per conversation
(customer-started service chats are currently free or very cheap in many countries; check Pakistan's current prices).

| # | Option | Status |
| --- | --- | --- |
| W1a | **Keep Baileys for now, with safety rules built in:** only reply, never message people first; slow, human-like replies (already); no bulk sends; a cap on new chats per day; tell each client in the agreement (P4) that WhatsApp may restrict the number. **Recommended to start**, since it costs nothing and clients keep using their number on the phone. | open |
| W1b | **Advise clients to use a separate number** (a cheap SIM) for the restaurant's WhatsApp, not the owner's personal one. If it's ever restricted, nothing personal is lost. | open |
| W1c | **Add the official Cloud API as a second option** in the WhatsApp screen ("Link with QR" or "Official API"), so bigger clients or anyone worried can switch without changing anything else. The assistant, inbox and orders stay the same; only the connection part changes. A good next project once you have paying clients. | open |

## Menu from pictures (Groq limits), 15 Nov 2026
- **G1.** Groq removed the Llama 4 Scout picture model; the cloud now uses `qwen/qwen3.8-27b` (reads the TPC menu well: all prices, Deals sorted). If Groq changes it again, set `VISION_MODEL` on the cloud.
- **G2.** Your Groq key is on the free plan: about 1,000 output tokens a minute, which is about one menu picture a minute (often 2–3 minutes with retries). The admin app now waits and carries on by itself, but 6 pictures can take 10+ minutes. Groq's paid "Dev tier" (pay per use, a few rupees per menu) removes the wait, and it also matters for the WhatsApp bot's voice notes once you have many restaurants. Suggest upgrading before onboarding many clients.

## Riders, 16 Nov 2026
- **R-a. Rider app (background GPS).** The rider page is a web page, so location stops when the phone is locked (RISKS R1). A small Android app (the same page wrapped with a background location service, or a Capacitor build) would track all the time and could get push notifications for new orders. About a week of work plus a Play Store listing. Worth it once a few clients run many riders.
- **R-b. Restaurant pin on the map.** The map shows riders but not the restaurant or the customer's address (an address is text; only WhatsApp "location pin" orders have coordinates). Adding the restaurant's location in Settings → Restaurant (pick on a map) would show the shop and let the customer page say "N km away" for every order, not only pinned ones.
- **R-c. Ask WhatsApp customers for a pin.** When the bot takes a delivery order with a typed address, it could ask "Share your location pin for faster delivery". Then every tracking page shows distance and minutes.
- **R-d. Rider in the demo.** The public demo has no cloud, so the rider phone page can't be shown there. Option: the demo server could host a fake rider page with a moving dot, for the sales pitch.
- **R-e. Rider performance report.** Accounts already shows average minutes and late deliveries per rider per month. A per-day chart (deliveries per hour, average time) would help owners plan rider shifts.
- **R-f. Rider "I'm back at the shop" / cash hand-in from the phone.** Today the cashier records cash hand-ins on the Delivery board. The rider phone could show "Hand in Rs X" and the cashier confirms with one tap.

## Kitchen workflow, 16 Nov 2026
- **K1. One screen, one job, one button.** DONE 16 Nov (dine-in keeps a Served button at the counter, since dine-in bills are paid after the meal): the kitchen never chooses where an order goes; the order type (picked at billing) decides. Kitchen screen = two columns, New → Cooking, buttons "Start cooking" and "Ready". On Ready the ticket leaves the kitchen: dine-in and takeaway pop up on the counter's Food-ready strip and clear by themselves when the bill is paid; delivery goes to the riders' phones. A read-only "Ready, waiting" list stays on the kitchen screen's side. Mistakes in order type are fixed by the cashier on Orders, not by the kitchen.

## After the desktop-risk fixes, 16 Nov 2026
- **F1. FAQ answers prepared in the admin app.** A new restaurant's bot answers (hours, delivery, halal…) are written by the owner in Settings → WhatsApp bot. For restaurants you set up remotely, a "Questions and answers" box in the admin app (Branch → Details), sent with the rest of the setup, would let you have it ready on day one.
- **F2. Auto-check at the first login.** After the owner chooses a PIN, a short checklist ("Add your menu", "Add tables", "Connect WhatsApp", "Give the cashier a PIN") on the Dashboard until each is done.
- **F3. Windows signing later.** Certificates for Windows apps are sold as normal ones (a few hundred dollars a year) or as a cloud signing service billed monthly; check what is available in Pakistan when you reach about 10 clients (RISKS D3).
