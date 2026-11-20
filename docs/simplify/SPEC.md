# Simplifying HazelPOS: the spec

Written for Hassaan (the vendor). Simple English. Nothing here is built yet: this is the plan the implementer follows and
the verifier checks (`acceptance.json` next to this file).

## Khulasa (Roman Urdu)

- HazelPOS ke sirf **4 hissay** hain: (1) restaurant ke PC par **POS**, (2) internet par aap ka **Cloud**, (3) aap ke laptop par
  **Admin app**, (4) **WhatsApp bot**. Baqi sab inhi ke andar hai.
- Billing hamesha internet ke baghair chalti hai. Internet sirf WhatsApp, backup, rider tracking aur updates ke liye chahiye.
- Client ka safar 8 qadam hai: becho → admin mein setup → code + installer bhejo → install → code daalo → apna PIN → WhatsApp scan → rozana kaam / har mahine payment.
- Sab se zyada uljhan yahan hai: Branch page ke 8 tabs, staff PINs ki do alag lists, WhatsApp ke do mode (PC wala aur Cloud wala),
  Activate screen par "doosra cloud address" ka button, aur POS Settings ke 8 tabs.
- Hamari tajweez: WhatsApp ka **ek hi tareeqa** (Cloud, client ko sirf ek dafa POS se QR scan karna hai); naya client banate hi
  branch aur activation code khud ban jaye aur **"Client ko message copy karo"** ka button ho; Branch page par numbered steps;
  PINs ki ek hi table; POS Settings 8 se 6 tabs.
- Paisay ka hisaab, security aur offline billing bilkul nahi badlenge. Zyada tar kaam cheezein hatana aur jorna hai, naya kam.

---

## 1. The whole product on one page

| Piece | What it is | Where it runs | Who uses it |
|---|---|---|---|
| **POS** (`server/` + `client/`, packed by `desktop/`) | The billing program: orders, kitchen screen, tables, cash drawer, stock, reports, WhatsApp inbox | On **one Windows PC at the restaurant**. Tablets, the kitchen screen and phones open it in a browser over the restaurant Wi-Fi | Owner, cashier, kitchen, riders |
| **Installer** (`desktop/`) | `HazelPOS-Setup-<version>.exe`. Installs the POS, starts it with Windows, keeps it running in the tray, updates itself | Built by GitHub when you push a version tag; downloaded from the public `-HazelPOS-releases` page | The restaurant (once), you (via AnyDesk) |
| **Cloud** (`cloud/`) | Your server: memberships, activation codes, prepared setups, sales copies, daily backups, AI for the bot, rider and tracking pages, the WhatsApp bot | Railway, `https://pos2.up.railway.app` | Every POS talks to it; owners can open it on their phone for sales; riders and customers open its links |
| **Admin app** (`admin/`) | Your control panel: clients, payments, setup before install, activation codes, WhatsApp switch, health, updates | Your laptop (or Railway as a second service). Talks only to the Cloud | You and your team |
| **WhatsApp bot** (`server/whatsapp/`, `cloud/wa-host.js`, `rag/`) | Answers customers on the restaurant's own WhatsApp number, takes orders, sends the menu photos | Today: either on the restaurant PC **or** on the Cloud (you switch it in the admin app) | Customers; the cashier sees chats and accepts orders in the POS |

```
                        INTERNET                                   RESTAURANT (Wi-Fi / LAN)
 ┌──────────────┐                     ┌───────────────────────┐            ┌──────────────────────────┐
 │  ADMIN APP   │  VENDOR_API_KEY     │        CLOUD          │  branch    │   RESTAURANT PC (POS)    │
 │ (your laptop)├────────────────────►│ pos2.up.railway.app   │◄──key─────►│  billing, kitchen, stock │
 │ clients,     │                     │ memberships, codes,   │  every     │  works with NO internet  │
 │ setup, codes │                     │ setups, backups, AI,  │  1 min–3 h │                          │
 └──────────────┘                     │ WhatsApp bot (cloud), │            └─────┬───────────┬────────┘
                                      │ rider/track pages     │                  │ LAN       │ LAN
 Customers' WhatsApp ◄───────────────►│                       │            tablets, kitchen screen,
 Riders' phones, tracking links ◄────►│                       │            cashier phone (browser)
 Owner's phone (sales dashboard) ◄───►│                       │
                                      └───────────────────────┘
 GitHub releases ──(installer + updates)──────────────────────────────────────► Restaurant PC
```

### What still works when…

| Situation | Still works | Stops (until it's back) |
|---|---|---|
| **No internet at the restaurant** (PC on) | Billing, payments, kitchen screen, tablets, printing, cash drawer, reports, stock. Tax (PRA/FBR) bills are kept and sent later. The membership keeps its last answer (no internet never locks anything). | WhatsApp at the POS (local mode: nothing; cloud mode: the bot still answers, but confirmed orders wait on the cloud), rider phones and tracking, sync to the owner's dashboard, backups, PIN changes from the admin app, updates |
| **Restaurant PC off** | Cloud-mode WhatsApp bot keeps answering; its orders wait on the cloud and reach the cashier when the PC is back. The owner's dashboard shows sales up to the last sync. | Everything at the restaurant: tablets and the kitchen screen open the PC, so they stop too. Local-mode WhatsApp bot stops. |
| **Cloud down** | Billing and everything inside the restaurant | Bot answers (both modes need the cloud's AI), sync, backups, rider pages, activation of new PCs, admin app |
| **Membership unpaid** | Default: bot stops 3 days after the paid-until date, new orders stop after 7 (days can be changed per client). Paying open bills and reading reports always work. | — |
| **You press "Stop now" (suspend)** | Open bills can be paid; reports readable | Bot at once; new orders at the POS's next check (within 3 hours) |

---

## 2. The client journey, step by step (with today's friction)

Friction was found by reading the actual screens and code. File references are where it lives.

| # | Step | What happens today | Friction found |
|---|---|---|---|
| 1 | **Sell** | You agree a monthly fee + installation fee. | Nothing to give the client in writing (agreement P4 still open). No one-pager about what they get. |
| 2 | **Create the client** (admin → Clients → + New client) | A 10-field form (`admin/src/Clients.jsx` `NewClient`): name, phone, email, dashboard password, monthly fee, install fee, install paid, plan, paid-until, notes. Then you land on the client page and must press **+ Add branch**, type a name in a dialog, and **only then** see the activation code ("shown once"). | Two separate steps for every single-branch client. The form mixes the sales-dashboard login (email/password) with billing fields; most of it is optional but looks required. |
| 3 | **Prepare the setup** (admin → Branch) | 8 tabs (`admin/src/Branch.jsx` `TABS`): Overview, Details, Menu, Tables, Delivery areas, Staff, WhatsApp bot, Health & errors. Menu tab alone has three cards (pictures + AI reading, Excel upload, deals). | No order is shown: you don't know which tab comes first. **"New activation code"** is the biggest button on the page even after activation, and it kills the running PC when used. The Staff tab has **two cards about PINs** (`PinReset` "Logins and PINs" and `Staff` "Staff and PINs") that mean different things (synced real PINs vs. first-time PINs). Tables and delivery areas are typed as comma lines. |
| 4 | **Send installer + code** | You copy the code from the screen and type your own WhatsApp message with the download link. | Nowhere in the admin app is the download link. The code is shown once; if you close the card you must make a new one. Nothing tells the client what PIN to use first. |
| 5 | **Install** | `setup.exe` is not signed: Windows shows "unknown publisher" → More info → Run anyway (RISKS D3). The app starts with Windows and lives in the tray. | SmartScreen scares clients. "Connect other screens" (QR for tablets) exists **only in the tray menu** (`desktop/main.js` `showConnect`), so nobody finds it. |
| 6 | **Activate** | Screen "Activate HazelPOS" (`client/src/Activate.jsx`): code field + a **"Use a different cloud address"** button. On success: restores a backup (new PC), or applies your setup, or clears the demo. | The "different cloud address" button is useless: the server refuses any address other than the built-in one (`server/licence.js` `activate`, SA4). The success toast doesn't say who logs in next or with which PIN. |
| 7 | **First login / change PINs** | Two different paths: (a) you prepared staff → each person logs in with the PIN you typed and must choose their own (`setup.js` sets `must_change_pin=1`); (b) no staff prepared → the owner uses **1234**, must choose their own, and cashier/kitchen can't log in until the owner gives them PINs (`server/index.js` `FORCE_PIN`). | You must remember which path each client is on. After a restore, a third path: "use your usual PIN". In the POS the sidebar item **"Staff"** is salaries (Payroll), while PINs are in **Settings → Staff & PINs**: same word, two places. |
| 8 | **Link WhatsApp** | Two modes. **Local:** POS → WhatsApp → Link → scan. **Cloud:** you first switch it on in admin → Branch → WhatsApp bot; then the QR can be scanned in the admin app *or* in the POS WhatsApp screen (proxied). Switching modes later needs a **second scan** (each mode is its own linked device). The bot's auto-reply starts **off** (`rag/config/rag.config.json` `enabled_by_default: false`), so a freshly linked number stays silent until someone presses "Auto-reply off/on". | The client must understand two modes, which one they're on, and that "linked" ≠ "replying". The admin tab has 4 state-dependent buttons (Switch on, Link, Start/Pause, Unlink). Words differ: "WhatsApp bot", "assistant", "Auto-reply". |
| 9 | **Daily use** | Owner: 11 sidebar items + Settings with 8 tabs (`client/src/Admin.jsx` `TABS`: Restaurant, Staff & PINs, Alerts, Updates, WhatsApp bot, Integrations, Cloud, Activity Log). | Settings → **Cloud** on an installed PC still shows a "Connect: paste address and key" form (if ever disconnected) and a **Disconnect** button the server always refuses (`/api/cloud/disconnect` → 400 when licensed). The client never sees "paid until …" except as a warning banner. |
| 10 | **Monthly payment** | Admin → client → **Paid: +1 month** (also on the Unpaid page). Counts from the later of today and the paid-until date. | Two places for the same job (Clients and Unpaid). The membership card has 5 buttons + a grace-days editor. |
| 11 | **Unpaid / suspend / cancel** | Unpaid: banner, bot stops after 3 days, new orders after 7. "Stop now" (suspended) and "Cancel membership" (cancelled) both stop bot + POS. | "Stop now", "Stopped", "paused", "suspended", "Cancel", "Cancelled" all appear for two states. The POS message says "HazelPOS has paused your membership", the admin pill says "Stopped". |
| 12 | **Updates** | Apps download in the background, install 3–5 AM with no open orders or on "Update now". Test clients first, then "Release to everyone" (admin → Updates). | Fine as a mechanism; the screen explains it well. Only wording ("behind", "early") could be plainer. |

---

## 3. What to tell the client (one page, plain words)

> Print this or send it as one WhatsApp message. Roman Urdu version below the English one.

**HazelPOS: what you get**

1. **A billing program on your shop's computer.** It works even when the internet is off. Tablets, the kitchen screen and
   your phone open it over your shop's Wi-Fi.
2. **A WhatsApp helper on your own number.** It answers customers, sends your menu photos and takes orders. You accept each
   order on the computer. It keeps answering even when your computer is off; the orders wait and appear when you switch it on.
3. **Your sales on your phone, and a daily backup.** If the computer breaks, a new one gets everything back with one code.
4. **Updates come by themselves**, at night, when there are no open bills.

**What you do**

1. Install the file we send you. If Windows says "unknown publisher", press **More info → Run anyway**.
2. Type the **activation code** we send you (it works once, for 14 days).
3. Log in with the PIN we give you, then choose **your own PIN**. Give your cashier and kitchen their own PINs in
   **Settings → Staff & PINs**.
4. Open **WhatsApp** in HazelPOS and scan the code with the shop's phone (WhatsApp → Linked devices → Link a device). Once.
5. Keep the computer on during working hours. Keep the shop Wi-Fi for staff screens; give customers a separate guest Wi-Fi.

**Payment.** Pay the monthly fee by the date we agreed. If it is late, WhatsApp answers stop after 3 days and new orders stop
after 7 days. Old bills and reports always stay open. No internet never stops anything.

**Help.** Message Hassaan on WhatsApp. We may connect with AnyDesk to help.

*WhatsApp note:* HazelPOS links your number like WhatsApp Web. It only replies to people who message you first. WhatsApp can
still restrict numbers it thinks are spam, so we suggest a separate SIM for the shop.

**Roman Urdu:**
HazelPOS aap ki dukaan ke computer par billing program hai, jo internet ke baghair bhi chalta hai. Tablet, kitchen screen aur
aap ka phone dukaan ke Wi-Fi se isay kholte hain. Aap ke WhatsApp number par ek helper customers ko jawab deta hai, menu ki
tasveerein bhejta hai aur order leta hai; har order aap computer par accept karte hain. Computer band ho tab bhi jawab deta
hai, order computer on hone par aa jata hai. Aap ki sale phone par nazar aati hai aur roz backup hota hai.
Aap ka kaam: (1) file install karein ("unknown publisher" aaye to More info → Run anyway), (2) activation code daalein,
(3) humara diya PIN daal kar apna PIN banayein, cashier aur kitchen ko Settings → Staff & PINs mein PIN dein, (4) HazelPOS mein
WhatsApp khol kar dukaan ke phone se QR scan karein. Payment late ho to 3 din baad WhatsApp jawab band, 7 din baad naye order
band; purane bill aur reports hamesha khuli rehti hain. Internet na hona kabhi kuch band nahi karta.

---

## 4. Simplification proposals, ranked by value / effort

Rules for every proposal: **money logic** (`priceItem`, `recalc`, `promoAmount`, `deliveryFee`, `settle`, `payOrder`),
**security** (activation, signed licence, PIN rules, access table, cross-restaurant isolation, vendor roles) and **offline
billing** do not change. No existing column, table or API route is removed. Prefer hiding, merging and renaming over adding.

Legend: Value H/M/L · Effort S (< half a day) / M (1–2 days) / L (more).

### Ranking

| Rank | ID | Proposal | Value | Effort |
|---|---|---|---|---|
| 1 | WA1 | One WhatsApp setup for clients: cloud mode by default, scanned once in the POS | H | M |
| 2 | AD1 | "New client" also makes the Main branch and shows the activation code + a ready "message for the client" | H | S |
| 3 | AD2 | Branch page as numbered steps with a checklist on top; "New activation code" moved into the Install step | H | M |
| 4 | AD3 | One "Logins & PINs" table in the admin app instead of two cards | H | M |
| 5 | IN1 | Activate screen: code only; after activation, say who logs in and with which PIN | H | S |
| 6 | PS1 | POS Settings 8 → 6 tabs, with a "HazelPOS account" tab (membership, updates, backup); hide the dead Connect/Disconnect | M | M |
| 7 | AD4 | Unpaid page becomes a filter on Clients; membership card with one main button | M | S |
| 8 | GL1 | One word per idea across the admin app, POS and messages (glossary below) | M | S |
| 9 | WA2 | Auto-reply on by default when the cloud bot is switched on | M | S |
| 10 | IN2 | "Connect a tablet" inside the POS (not only in the tray) | M | S |
| 11 | AD5 | New-client form: 4 fields, the rest under "More" | M | S |
| 12 | PS2 | Rename sidebar "Staff" (salaries) to "Salaries" | M | S |
| 13 | AD6 | Clients page: 3 numbers instead of 6 | L | S |
| 14 | DO1 | One vendor doc ("How HazelPOS works") + one client page; trim the READMEs | M | S |
| 15 | WA3 | Admin WhatsApp tab: one status line, one main button | M | S |
| 16 | AD7 | Tables & delivery areas in one tab | L | S |

---

### WA1. One WhatsApp setup for clients (cloud mode by default) — H / M

**Should there be only one mode?** For the client: **yes, one**. For you: keep the local mode as a hidden fallback for now.

Why cloud should be the one:
- It answers when the PC is off, which is the main thing a client notices.
- Local mode is not more "offline" than cloud mode: the local bot also needs internet and your cloud (the AI goes through
  the cloud, A2). So local mode only adds a second dependency (the PC must be on).
- The POS inbox, order accept/reject, menu photos and "where is my order" already work in cloud mode (phases 1–4).
- Today switching mode means scanning **twice** (each mode is a separate linked device). Deciding at branch creation removes that.

Why not delete local mode yet: all numbers on one Railway server (one IP) may raise WhatsApp's ban risk for every client at
once (W1); each linked number costs memory on the cloud; chats and voice notes now sit on your volume (privacy line in the
agreement, X4). Run 5–10 clients on cloud mode for a month, then decide whether to remove local mode.

What changes:
- **Cloud:** a new branch gets `wa_cloud.enabled = 1` when it is created (`POST /api/vendor/owners/:id/branches` in
  `cloud/index.js` inserts the `wa_cloud` row; `wa-host.js` exports a small `enableFor(branchId)`). Starting it only opens the
  per-branch store; it does not connect to WhatsApp until a QR is requested (verify in `server/whatsapp/connection.js`; if it
  does connect, start lazily on the first `/api/sync/wa/connect`).
- **Admin app** (`Branch.jsx` `CloudBot`): the on/off switch moves under "Advanced: run the bot on the restaurant PC instead"
  with the warning "the restaurant must scan the QR again".
- **POS** (`client/src/WhatsApp.jsx` `LinkScreen`): one text for both modes: "Scan once. Customers get answers even when this
  computer is off." Local-mode text only when `cloud_bot` is false.
- **Docs:** the client is told one way to link: POS → WhatsApp → scan.

Impact: UI (admin, POS text). API: none new; existing branches keep their current mode (no migration of `wa_cloud` rows).
Persisted state: new `wa_cloud` rows for new branches only. Risk: medium (W1 concentration on one IP; cloud memory). Rollback:
set `enabled=0` per branch in the admin app; the POS reconnects locally by itself (`syncWaCloud`).

### AD1. New client → Main branch + code + "message for the client" — H / S

What changes (`admin/src/Clients.jsx`, `admin/src/Client.jsx`, `admin/server.js`):
- After `POST /owners` succeeds, the admin app calls `POST /owners/:id/branches {name:'Main branch'}` and opens the client page
  with the activation-code card already showing (same card as today).
- The code card gets **"Copy message for the client"** (`data-testid="copy-install-message"`), which copies:
  download link, the code, the 4 steps from section 3, and "first PIN: the one we give you, or 1234 if we didn't".
- The download link comes from a new optional admin env `INSTALLER_URL`, default
  `https://github.com/hassaanaiservices-lgtm/-HazelPOS-releases/releases/latest`, returned by `GET /api/me` as `installer_url`.
- The card says when the code expires (14 days) instead of only "shown once".

Impact: UI + one extra field in `/api/me`. Cloud API unchanged. Persisted: a branch row is created at client creation (same
as pressing "+ Add branch"). Risk: low. A multi-branch client still uses "+ Add branch".

### AD2. Branch page as numbered steps — H / M

What changes (`admin/src/Branch.jsx`):
- Tabs become: **1 Details · 2 Menu · 3 Tables & delivery · 4 Staff & PINs · 5 Install** and then **WhatsApp · Health**.
  "Overview" stops being a tab: its checklist becomes a strip above the tabs (`data-testid="branch-steps"`), each tick
  clickable, always visible.
- **"New activation code" leaves the page header** and lives only in step 5 (Install), with today's confirm when the branch
  is already activated. Step 5 shows: activation state, the code card, "Copy message for the client" (AD1), and "Setup on
  their PC: applied / waiting / failed: reason".
- Menu step order on the page: pictures (AI reading) first, then "Or upload an Excel file", then deals (as today).

Impact: UI only; same API calls. Risk: low (tests that click tab names "Overview", "Tables", "Delivery areas", "Staff" must be
updated). `#/branch/<id>` addresses stay.

### AD3. One "Logins & PINs" table — H / M

Today the Staff tab shows "Logins and PINs" (the synced real PINs, after activation) above "Staff and PINs" (first-time PINs
typed before activation). Both use the word PIN, with different meaning.

What changes (`admin/src/Branch.jsx` `PinReset` + `Staff`):
- **Before activation** (`branch.code_used_at` empty): only the editable list (name, role, first PIN). Empty PIN boxes are
  filled with a random first PIN (`tempPin()`, already in the file) that you can overwrite. Help text: "Each person types this
  PIN once, then chooses their own."
- **After activation**: only the synced table (Show / Set PIN). The first-PIN editor is hidden behind "Send first PINs again
  (for a new PC)".
- Role names everywhere: Owner, Cashier, Kitchen, Rider (value stays `admin`).

Impact: UI only. API unchanged: `POST /branches/:id/setup {staff}`, `GET /branches/:id/pins`, `POST /branches/:id/pin-reset`,
reveal stays owner-only and logged. Risk: low. PIN rules unchanged (4–12 letters/numbers, all different, no starting PINs).

### IN1. Activate screen: code only + who logs in next — H / S

What changes:
- `client/src/Activate.jsx`: when `settings.licence.default_url` is set, **no** "Use a different cloud address" button and no
  address field. (The address field stays for a POS run by hand without a built-in cloud.)
- The code box accepts `hz xxxx xxxx`, spaces and dashes (the cloud already strips them).
- `server/licence.js` `activate()` adds `first_login` to its answer: `"restored"` (use your usual PIN), `"setup_pins"`
  (use the PIN HazelPOS gave you) or `"starting_pin"` (owner: 1234). `Login.jsx` shows that hint once
  (`data-testid="first-login-hint"`) until the first successful login.

Impact: UI + an additive field in `POST /api/licence/activate`. Persisted: one setting `first_login_hint` cleared after the
first login. Risk: low. Security unchanged: the server still refuses other cloud addresses (SA4), starting PINs still only
work for the owner and only to choose a new PIN.

### PS1. POS Settings 8 → 6 tabs, with "HazelPOS account" — M / M

New tabs (`client/src/Admin.jsx` `TABS`):

| New tab | Contains (from today) |
|---|---|
| Restaurant | Restaurant (unchanged) |
| Staff & PINs | Staff & PINs (unchanged) |
| WhatsApp | WhatsApp bot (how the bot writes, questions and answers) + **Alerts** (low-stock messages to the owner) |
| Payments & tax | Integrations (payment QR, PRA/FBR) |
| HazelPOS account | **New card "Membership"** (paid until, when the bot / new orders would stop, from `GET /api/licence`) + **Updates** + **Cloud** (sync status, Sync now, Backup now; Restore under a "Danger zone" disclosure) |
| Activity log | Activity Log |

On an installed PC (`licence.state !== 'off'`): the Cloud "Connect" form and the **Disconnect** button are not shown (the
server already refuses them). The "Updates" attention dot moves to the "HazelPOS account" tab.

Impact: UI only. Risk: low. Tests using `#tab-Updates`, `#tab-Cloud`, `#tab-Integrations`, `#tab-Alerts` must change to
`#tab-HazelPOS account` etc.; keep `id={'tab-' + t}`.

### AD4. Unpaid becomes a Clients filter; simpler membership card — M / S

- `admin/src/App.jsx`: remove **Unpaid** from the sidebar. `#/unpaid` still works and opens Clients with the **Unpaid**
  filter chip selected. Clients gets three chips: All · Needs attention · Unpaid. In the Unpaid view each row keeps its
  buttons (Paid: +1 month, +7 days, Pause/Resume) — moved from `Unpaid.jsx`.
- `admin/src/Client.jsx` membership card: one sentence ("Paid until 18 Dec. If unpaid: bot stops 21 Dec, new orders 25 Dec.")
  + **Paid: +1 month** + **Pause / Resume**. A "More" disclosure holds +3 months, Set date, change the days, Cancel membership.

Impact: UI only; same endpoints. Risk: low.

### GL1. One word per idea (glossary) — M / S

| Use | Instead of | Where it shows |
|---|---|---|
| **Client** (the business you bill) | owner, customer | admin app |
| **Branch** (one restaurant PC/location) | restaurant (in admin), install | admin app |
| **Membership** | licence (in any screen text) | admin, POS banners |
| **Pause / Paused / Resume** | Stop now, Stopped, suspended, suspend | admin buttons + pills, POS message |
| **End membership / Ended** | Cancel membership, Cancelled (keep "Reactivate") | admin, POS message |
| **Owner** | admin, Owner (admin), Admin (owner) | POS staff list, admin roles (code value stays `admin`) |
| **WhatsApp bot** | assistant, Auto-reply | admin, POS WhatsApp header ("Bot replies: on/off") |
| **Activation code** | branch key (in client-facing text) | Activate screen, Cloud tab |

Impact: UI strings and licence messages in `server/licence.js` only; API values (`suspended`, `cancelled`, `admin`) unchanged.
Risk: low; exact-text tests must be updated.

### WA2. Bot replies on by default in cloud mode — M / S

When the cloud bot is switched on for a branch (WA1 or the admin switch), `wa-host.js` sets the assistant enabled for that
branch (`assistant.setEnabled(true)`) unless someone already turned it off. It still stays quiet until the POS has sent its
menu (existing rule) and when the membership doesn't cover the bot. Local mode keeps `enabled_by_default: false`.
Impact: cloud behaviour; no API change. Risk: medium (a bot that replies before the FAQ is filled; acceptable because prices
come from the menu and safety rules are fixed).

### IN2. "Connect a tablet" inside the POS — M / S

A button for the owner in Settings → Restaurant ("Connect a tablet or kitchen screen") showing the PC's address and a QR,
from the existing `GET /api/qr-info` (`ips`) and the current port (`location.port`). Uses the `qrcode` package the client
already has. The tray item stays. Impact: UI only. Risk: low.

### AD5. New client form: 4 fields first — M / S

Visible: Restaurant name, Owner phone, Monthly fee, Installation fee. Under "More": installation paid, plan note, paid until
(empty = 1 month), notes, sales-dashboard email + password. Same `POST /owners` body. Risk: low.

### PS2. "Staff" (salaries) → "Salaries" — M / S

`client/src/App.jsx` `NAV.admin` label `Staff` → `Salaries` (view id `staff` unchanged; Tour text updated). Risk: low.

### AD6. Clients page: 3 numbers — L / S

Keep Clients, Need attention, Unpaid. Errors and AI replies stay in the table and on the AI usage page. Risk: none.

### DO1. Docs — M / S

- `docs/HOW-IT-WORKS.md`: sections 1–2 of this spec, kept current (the one doc you read).
- `docs/CLIENT-GUIDE.md`: section 3 (English + Roman Urdu), printable.
- `admin/README.md` "Onboarding a restaurant" → a short pointer to HOW-IT-WORKS. `cloud/README.md` "Connect a branch" gets the
  line "Only for a self-run cloud without the admin app; with HazelPOS Cloud, branches are activated with a code."
- Nothing is deleted from RISKS.md / SUGGESTIONS.md; a line at the top of each points to this spec.

### WA3. Admin WhatsApp tab: one line, one button — M / S

Status sentence by state: "Not linked yet: the restaurant scans the QR in HazelPOS → WhatsApp (or scan it here)", "Linked to
+92…: bot replying", "Linked: bot paused", "Bot waiting for the menu from the POS". One main button per state (Show QR /
Pause bot / Start bot). Unlink and the on/off switch go under "Advanced". Same endpoints. Risk: low.

### AD7. Tables & delivery in one tab — L / S

Part of AD2 (step 3): the two cards on one tab. Same `save({floors, tables})` and `save({zones})`. Risk: none.

### Not proposed (on purpose)

- Removing the local WhatsApp code (see WA1: decide after a month on cloud mode).
- Changing grace days, licence rules, signed answers, the 14-day code expiry, PIN rules, the access table or the setup rule
  "only before the first order".
- A first-run checklist on the POS dashboard (SUGGESTIONS F2): useful, but it adds a screen; revisit after these.
- Code signing (D3): a purchase, not a code change.

---

## 5. Test rig for the implementer and the verifier

All local, throw-away data. Never touch `server/pos.db`, never print secrets.

```bash
# Cloud (vendor mode) on :4200
DATA_DIR=$TMP/cloud VENDOR_API_KEY=<64 hex test key> PORT=4200 node cloud/index.js
# Admin app on :4400 (build first: npm --prefix admin run build)
ADMIN_PASSWORD='test-password-123' CLOUD_URL=http://localhost:4200 VENDOR_API_KEY=<same> PORT=4400 node admin/server.js
# POS as an installed app on :4000 (build first: npm --prefix client run build)
POS_DB=$TMP/pos.db HAZEL_LICENCE=1 HAZEL_CLOUD_URL=http://localhost:4200 WHATSAPP=off PORT=4000 node server/index.js
# a second POS for isolation checks
POS_DB=$TMP/pos2.db HAZEL_LICENCE=1 HAZEL_CLOUD_URL=http://localhost:4200 WHATSAPP=off PORT=4001 node server/index.js
```

Admin API calls go through the admin server: log in with `POST http://localhost:4400/api/login {"password": "..."}` (cookie
`hz_admin`), and send header `X-Hazel-Admin: 1` on writes. Cloud vendor calls directly: `Authorization: Bearer <VENDOR_API_KEY>`
(+ `X-Vendor-Role: owner|staff`). POS calls: `Authorization: Bearer <token from POST /api/login>`.

Node is not on PATH in the sandbox; use
`ELECTRON_RUN_AS_NODE=1 desktop/node_modules/electron/dist/electron <script>`.

Criteria are in [acceptance.json](acceptance.json): `admin|installer|pos|cloud|whatsapp|docs`, each with given / when / then and
how to verify. The regression ones (activation, PIN rules, setup sync, cloud WhatsApp routes, isolation, offline billing,
money) must pass before and after every change.
