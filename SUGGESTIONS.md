# Suggestions and open questions

Ideas and questions from building HazelPOS, saved here so they don't get lost in chat. Read them when you have time,
then we decide together. Risks have their own file: [RISKS.md](RISKS.md).

Status: **open** = waiting for you, **done**, or **dropped**.

## Waiting on you

| # | What | Why it matters | Status |
| --- | --- | --- | --- |
| Q1 | **QR codes**: what to do with that section. | My recommendation is in the next section (QR1–QR7). Your call. | open |
| Q2 | **Test the WhatsApp bot with real DeepSeek** after the menu-pictures change (prompt rule 10). Run `node rag/scripts/run-eval.js` once (a few cents), or send a test WhatsApp message "menu bhejo" and "kya kya milta hai?". | The new instructions were only tested with a fake AI. | open |
| Q3 | **Put it online**: push the `product-installer` branch, deploy the cloud and the admin app on Railway (steps in `cloud/README.md` and `admin/README.md`), put the cloud address in `desktop/package.json` → `hazel.cloudUrl`, then build the installers. | Nothing is online yet; everything so far runs only on your PC. | open |
| Q4 | **Licence rules** (RISKS.md L1–L3): how many days offline before new orders lock (now 7), grace after an unpaid month (now 3 days), and whether Suspend acts straight away. | These decide how strict you are with clients. | open |

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
| QR1 | **Remove "QR codes" from the sidebar** (owner and cashier). | It's a one-time printing job, not a daily screen; it just adds clutter. | open |
| QR2 | **Move printing to the owner: Tables & delivery → Tables → "Print QR codes"** (one code per table, or one floor at a time). Also in the admin app's Tables tab, so you can print them for a client before installing. | That's where pros put it: next to the tables they belong to. | open |
| QR3 | **QR orders show in Orders as their own tab ("QR requests")**, besides the popup the cashier already gets. | Nothing gets missed if the popup is closed. | open |
| QR4 | **Owner settings: QR ordering on / off, "menu only" mode, and auto-accept to kitchen.** | Each restaurant works differently. | open |
| QR5 | **Big one: QR codes today point to the POS PC's local address (e.g. `http://192.168.1.5:4000/…`).** A customer must be on the restaurant's WiFi for the page to open; on mobile data it fails. Pros serve the QR menu from the cloud. Fix: HazelPOS Cloud hosts the menu page and passes orders to the POS. | Most customers won't join the WiFi, so today the feature barely works in real life. | open |
| QR6 | **One general QR** (not tied to a table) for the counter, window, flyers and Instagram: menu + takeaway/delivery order, or a WhatsApp link to your assistant. | Brings orders from outside the restaurant too. | open |
| QR7 | **"New QR code" for one table** (if a code is copied or misused, the old one stops working). | Abuse protection. | open |

## Cash drawer

| # | What | Why | Status |
| --- | --- | --- | --- |
| C1 | In your screenshot, expected drawer cash was **Rs. -87**: refund #127 (Rs. 7,888) was taken out of *this* shift's drawer, but this shift only took Rs. 4,001 in cash. The order was probably paid in an earlier shift. Options: warn before a refund that would make the drawer negative, or let the cashier choose "refund from drawer" vs "refund by bank transfer". | A negative drawer confuses the shift close. | open |
| C2 | Cash drawer sync, for the record: inside the POS it's always in sync (owner and cashier read the same shift). On the cloud, each **closed** shift (Z-report) goes up with expected cash, counted cash and difference; cash-in/cash-out lines don't go up one by one. | You asked; works as intended. Option: also send each cash in/out line. | open |

## Feature ideas

| # | Idea | Why | Status |
| --- | --- | --- | --- |
| S1 | **Admin app → Menu tab: add and edit items one by one** (now only by Excel upload). | Small fixes without re-uploading the whole Excel. | open |
| S2 | **WhatsApp alert to the owner when an ingredient runs low** ("Burger buns: 28 left, alert at 30"). | The owner knows even when away from the POS. | open |
| S3 | **Stock back on a refund**, optional per refund ("food was not made"). Today a refund never returns stock, on purpose. | Some refunds happen before cooking. | open |
| S4 | **Restore from the cloud backup when activating on a new PC** (RISKS.md O1). | Today a reinstall brings the menu back but not orders, history or staff PINs. | open |
| S5 | **Force a PIN change on first login** when the default PINs (1234/1111/2222) are still in use (RISKS.md D7). | Anyone who knows the defaults can log in. | open |
| S6 | **"Push menu update" button** in the admin app, for a restaurant that already has orders (RISKS.md O7). | Today your setup changes reach the POS only before its first order. | open |
| S7 | **Menu photo → menu items with AI** (Groq vision or Claude), as a draft Excel you check. | Built: admin app → Branch → Menu → "Read the menu from photos". | done |
| S8 | **Real combo deals** (fixed items + choices, kitchen sees each item, stock per item). Built on 2026-11-15: deals and combos in the POS, the admin app and Excel. | Kitchen tickets and stock are exact for deals. | done |
| S9 | **Separate admin logins per team member**, with a log of who did what (RISKS.md L6). | One shared password today. | open |
| S10 | **Signed licence answers** from the cloud (RISKS.md L4). | Stops someone technical from faking "paid" in the local database. | open |
| S11 | **"Download for Windows" button on the site**, once there's a public release. | You said leave it for now. | dropped (for now) |

## From earlier answers in chat (how professionals run a POS business)

| # | Idea | Why | Status |
| --- | --- | --- | --- |
| P1 | **Charge a one-time setup fee** plus the monthly fee. | Pays for your visit, menu entry and training; a client who paid for setup stays longer. | open |
| P2 | **Install AnyDesk on every client PC** (or a similar remote-desktop tool). | Fix problems without visiting. Most Pakistani POS vendors support clients this way. | open |
| P3 | **A one-page Urdu guide** stuck near the counter: take an order, take payment, close the shift, change a PIN. | Staff change often; this cuts support calls. | open |
| P4 | **A simple client agreement**: monthly fee, what support you give and when, who owns the data, and that WhatsApp can restrict a number (RISKS.md W1). | Avoids arguments later. | open |
| P5 | **Stay for the first evening rush** at each new restaurant. | That's when problems show up. | open |
| P6 | **A WhatsApp group per client** for support. | The usual support channel in Pakistan. | open |
| P7 | **Sell a hardware bundle** (touch PC, thermal printer, cash drawer, kitchen screen), already set up in your office. | You control the machine; it works on day one. | open |
| P8 | **Updates to a few clients first, then everyone.** | A bad update doesn't hit every restaurant at once. | open |
| P9 | **Run commands in the system Terminal, not VS Code's** (VS Code here is a Flatpak and has no node/npm), or prefix with `flatpak-spawn --host`. | Why localhost "didn't work". | done (tip) |
