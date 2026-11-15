# Suggestions and open questions

Ideas and questions from building HazelPOS, saved here so they don't get lost in chat. Read them when you have time,
then we decide together. Risks have their own file: [RISKS.md](RISKS.md).

Status: **open** = waiting for you, **done**, or **dropped**.

## Waiting on you

| # | What | Why it matters | Status |
| --- | --- | --- | --- |
| Q1 | **QR codes**: you said you'd tell me what to change there. | — | open |
| Q2 | **Test the WhatsApp bot with real DeepSeek** after the menu-pictures change (prompt rule 10). Run `node rag/scripts/run-eval.js` once (a few cents), or send a test WhatsApp message "menu bhejo" and "kya kya milta hai?". | The new instructions were only tested with a fake AI. | open |
| Q3 | **Put it online**: push the `product-installer` branch, deploy the cloud and the admin app on Railway (steps in `cloud/README.md` and `admin/README.md`), put the cloud address in `desktop/package.json` → `hazel.cloudUrl`, then build the installers. | Nothing is online yet; everything so far runs only on your PC. | open |
| Q4 | **Licence rules** (RISKS.md L1–L3): how many days offline before new orders lock (now 7), grace after an unpaid month (now 3 days), and whether Suspend acts straight away. | These decide how strict you are with clients. | open |

## Feature ideas

| # | Idea | Why | Status |
| --- | --- | --- | --- |
| S1 | **Admin app → Menu tab: add and edit items one by one** (now only by Excel upload). | Small fixes without re-uploading the whole Excel. | open |
| S2 | **WhatsApp alert to the owner when an ingredient runs low** ("Burger buns: 28 left, alert at 30"). | The owner knows even when away from the POS. | open |
| S3 | **Stock back on a refund**, optional per refund ("food was not made"). Today a refund never returns stock, on purpose. | Some refunds happen before cooking. | open |
| S4 | **Restore from the cloud backup when activating on a new PC** (RISKS.md O1). | Today a reinstall brings the menu back but not orders, history or staff PINs. | open |
| S5 | **Force a PIN change on first login** when the default PINs (1234/1111/2222) are still in use (RISKS.md D7). | Anyone who knows the defaults can log in. | open |
| S6 | **"Push menu update" button** in the admin app, for a restaurant that already has orders (RISKS.md O7). | Today your setup changes reach the POS only before its first order. | open |
| S7 | **Menu photo → menu items with AI** (Groq vision or Claude), as a draft Excel you check. | Saves typing a client's menu by hand. You chose Excel first, photo later. | open |
| S8 | **Real combo deals** (fixed items + choices, kitchen sees each item, stock per item). You chose a simple "Deals" category for now. | Kitchen tickets and stock would be exact for deals. | open |
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
