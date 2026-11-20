# HazelPOS simplification audit

Read-only audit, branch `product-installer`, 19 Nov 2026. No code was changed.
Effort: S = under half a day, M = 1-2 days, L = more. Risk = chance of breaking something that works today.

CodeRabbit: not signed in, skipped. `coderabbit auth status` says "signed out", so no review was run.

## Top 10 (best value first)

| # | Action | What | Effort | Risk |
|---|---|---|---|---|
| 1 | merge | One PIN rule file (length, weak list, message) used by POS, cloud and setup instead of 6 copies | S | low |
| 2 | remove | The "PIN vault" in the cloud (reversible PIN storage + "Show PIN" button). Keep "Set temporary PIN" only | M | med |
| 3 | merge | Three ways to set a PIN become two: drop PINs from the cloud setup Staff tab (POS creates logins, owner picks PIN at first login) | M | med |
| 4 | simplify | WhatsApp: show ONE bot setting. Today the POS (Link WhatsApp), the POS Settings tab and the admin Branch tab each control a bot, in two modes | M-L | med |
| 5 | simplify | Admin Branch page: 8 tabs become 4 (Setup, Menu, Staff and PINs, Status) | M | low |
| 6 | simplify | POS Settings: 8 tabs become 5 (fold Alerts, Updates, Cloud, Integrations into fewer places) | M | low |
| 7 | remove | Second owner dashboard in `cloud/public/index.html` + `/api/owner/*` signup/login if clients do not use it, or hide it (vendor admin is the real tool) | M | med (needs your yes) |
| 8 | remove | Dead endpoints and files (list in section 1) | S | low |
| 9 | remove | Bulky non-product files from the repo: 85 eval reports (2.7 MB), `tools/qr-scene` (392 KB), Grafana, three audit/risk files out of root | S | low |
| 10 | simplify | Activation wording and steps: one screen, one field, no "different cloud address" button on installed apps | S | low |

## 1. Unnecessary things

| Item | Evidence | Action | Effort | Risk |
|---|---|---|---|---|
| `POST /api/riders/sync` never called | server/index.js:1258; no caller in client, desktop, cloud, demo | remove | S | low |
| `POST /api/licence/check` never called by any screen (the licence code runs its own check) | server/index.js:1975 | remove | S | low |
| `GET /api/fiscal/preview/:id` never called | server/index.js:2004 | remove (or wire a button) | S | low |
| `POST /api/users` has "create" blocked, only edits: the `if (id)` and `id ||` branches are half dead | server/index.js:702-727 (error text "three fixed logins") | simplify | S | low |
| Real-looking sample data shipped as defaults (name "Pizza Venu", NTN, Meezan bank account, phone) | server/index.js:350-363; wiped again in setup.js `apply`/`clearDemo` | simplify: ship blank, demo seed fills them | S | low |
| `clearDemo()` and `apply()` both wipe the same table list and settings | server/setup.js (two near-identical lists) | merge | S | low |
| `start.js` (dev launcher) duplicates `npm run dev` wording, spawns with `shell:true`, no one else uses it | start.js, package.json "dev"/"start" | keep, but drop the duplicate "start" script | S | none |
| `tools/qr-scene` (python generator + vendored open-peeps lib) only makes one landing page section | tools/qr-scene, site/README.md:48 | remove from this repo (move to site repo) | S | low |
| `grafana/` and `/metrics` | grafana/README.md, cloud/index.js:1124-1136; opt-in by env var METRICS_TOKEN | remove unless you actually use Grafana | S | low |
| 85 committed eval run reports | rag/eval/reports/* (2.7 MB, git ls-files) | remove, add to .gitignore, keep `latest.md` | S | none |
| Three root notes files plus audit | RISKS.md, SUGGESTIONS.md, SECURITY-AUDIT.md at repo root | move to `docs/` | S | none |
| CLAUDE.md does not mention `desktop/`, `admin/`, licence, cloud WhatsApp host, so it misleads | CLAUDE.md (68 lines) | simplify: add one paragraph each | S | none |
| `cloud/README.md` first line still describes only the multi-branch owner view | cloud/README.md:3-8 | simplify | S | none |
| POS "Cloud" tab "Connect" form (address + branch key, accepts HZ- code) is for hand-run POS only; installed app can never use it (disconnect blocked, address locked) | client/src/Admin.jsx:636-700, server/index.js:1887-1915 | remove the connect form from installed builds; keep for dev | S | low |
| Update policy "early testers / release version / ask all" is a staged-rollout system for a vendor with few clients | admin/src/Updates.jsx, server/index.js:~1850 `updateAllowed`, `update_policy` | keep only if you really stage releases; otherwise remove | M | med |

## 2. Duplicates

| Same thing in many places | Evidence | Fix | Effort | Risk |
|---|---|---|---|---|
| Weak PIN list `['1234','1111','2222','3333','0000','4321']` typed 3 times, plus regex `^[a-z0-9]{4,12}$` typed 5 times, plus messages in 3 wordings | server/index.js:399-402, 421; cloud/index.js:822, 985, 963-ish (`/^[a-z0-9]{4,12}$/i`), cloud/index.js:530 (`/api/sync/pins`); server/setup.js:`ROLES` and staff regex; client Admin.jsx:569 text | one `shared/pin.js` required by server, cloud, setup (cloud already requires `../server/...` in wa-host.js, so this is allowed) | S | low |
| Role list `['admin','cashier','kitchen','rider']` repeated | server/setup.js, cloud/index.js:~820, server/index.js ROLES | same shared file | S | low |
| PIN reset two ways: POS Settings "Staff & PINs" (owner) and admin "Set PIN" (vendor, via cloud queue polled every 60 s, ack, 24 h expiry, vault) | client/src/Admin.jsx:558; admin/src/Branch.jsx:386; cloud/index.js:515-1015; server/index.js:1850-1880 | keep POS reset (owner can do it). In admin keep one "Send temporary PIN" action only; delete the vault, reveal, "fresh/pending/in sync" states | M | med |
| PINs set three ways at setup: setup Staff tab, first-login `/api/me/pin`, POS `/api/users` | cloud/index.js:815-826, server/index.js:731, 702 | cloud setup lists names and roles only; POS makes the 3 starting logins; owner picks PIN at first login | M | med |
| WhatsApp bot: local (Baileys on the PC) and cloud (wa-host) share store/assistant code but every route is mirrored | server/whatsapp/index.js:26-55 (`CLOUD_ROUTES` proxy of 13 routes), cloud/wa-host.js:81-262 (18 routes), server/index.js:1811-1880 (3 timers), admin/src/Branch.jsx:468 | pick ONE default (cloud) for clients; keep local as a hidden fallback. Single status shape `{status, me, assistant, qr}` | L | med |
| WhatsApp link in two places: POS "Link WhatsApp" button (client/src/WhatsApp.jsx:40-60) and admin "Link WhatsApp" (Branch.jsx:468-494) | both show a QR for the same number | show the link button only where the bot runs; if cloud, POS just shows "Linked as X, managed by HazelPOS" | M | low |
| Setup apply vs admin edit: cloud `/setup` validation (cloud/index.js:790-830) re-validates what server/setup.js:apply validates again | both check staff, PIN, floors | validate in one place (the POS), return the error to the admin | M | med |
| Health/status shapes: `health()` (server/index.js:1925), cloud `/api/sync/health` stores raw JSON (cloud/index.js:332), `withCloudWa` merges a second whatsapp shape (cloud/index.js:1107), admin `Health` and `WhatsApp` components read both | five readers of one loose object | define the shape once in the doc; cloud validates keys | S | low |
| Menu import: POS client MenuImport (Admin.jsx:744), admin Menu tab (Excel, photo, rows, 4 endpoints cloud/index.js:831-925), `server/menu-import.js` used by both, plus demo/seed | same parser, 3 front ends | keep Excel + photo in admin only; POS keeps a plain "Import Excel" | M | low |
| Image shrink function twice | client/src/Admin.jsx:688 vs admin/src/lib.js:31 | one copy per app is fine, but the POS file could import from ui | S | none |
| notify/ui/lib copied between client and admin apps (159 differing lines of 120) | client/src/notify.jsx, admin/src/notify.jsx | leave; tell a new reader they are siblings | S | none |
| Second multi-branch dashboard for owners | cloud/public/index.html (181 lines), cloud/index.js:142-265 `/api/owner/*`, `/api/dashboard`, `/api/branches*` | see top-10 #7 | M | med |
| Membership expiry as 3 dates (paid, ai_until, pos_until) with two grace settings per client | cloud/index.js:585-601 | one date, one rule: "everything stops N days after unpaid" (N global) | M | med |

## 3. Over-complication

POS (client/src/Admin.jsx:9): Settings has **8 tabs**: Restaurant, Staff & PINs, Alerts, Updates, WhatsApp bot, Integrations, Cloud, Activity Log. Restaurant tab has ~33 labelled fields (grep `<label`). Suggest:
- Business: Restaurant + Integrations (payment QR, PRA/FBR) merged, fiscal fields hidden unless "tax authority" is on.
- Staff & PINs stays. Activity Log stays.
- WhatsApp: Bot behaviour + FAQ + stock alert number in one tab (BotBehaviour, BotFaq, StockAlerts all about WhatsApp text).
- System: Updates + Cloud (one "About this POS": version, update, backup, last sync). Result: 5 tabs. (S/M, low)
- Menu has its own 3 tabs and Places has 3 tabs (Admin.jsx:32, 88) on top. Fold "Floors" into "Tables" (S, low).

Admin app (admin/src/App.jsx:36): 6 sidebar pages (Clients, Unpaid, Updates, AI usage, Activity, Team) and three levels (Clients > Client > Branch). Branch page has **8 tabs** (Branch.jsx:6). Suggest:
- Merge Unpaid into Clients (a filter). Merge Activity into Team. 6 pages become 4. (S, low)
- A restaurant has one branch for almost every client: skip the Client level when it has one branch, go straight to Branch (S, low).
- Branch tabs to 4: Setup (Details + Tables + Delivery areas), Menu (pictures + items + deals), Staff & PINs, Status (overview, WhatsApp, health). (M, low)
- Overview "Onboarding" checklist has 9 items; good idea, but make it the first thing and the only thing to read before "Give code".

Activation (client/src/Activate.jsx, desktop/main.js): installer, activation code, setup download, forced PIN change on first login, tour (App.jsx:93). Suggest:
- Hide "Use a different cloud address" on installed apps (address is built in; server already refuses others, index.js:1892). (S, low)
- The three failure toasts (restored / setup error / applied) become one status line on the PIN screen. (S, low)
- Tour (client/src/Tour.jsx) plus FORCE_PIN (index.js:402) plus ChoosePin all run in the first 2 minutes: show Tour after PIN is chosen only (S, low).
- Wording: "membership", "licence", "activation", "setup", "branch", "client", "owner" are all used for overlapping things. Pick: *restaurant* (customer), *activation code*, *plan*. Rename "Branch key", "Cloud address", "Logins and PINs vs Staff & PINs" (S, none).

Cloud WhatsApp: "Switch on", "Link WhatsApp", "Pause the bot", "Unlink" (admin) vs "Assistant on/off", "Link", "Logout" (POS) vs per-chat "bot paused" flag. Three off-switches. Keep: one per-restaurant on/off, one per-chat pause (M, low).

## 4. Other risks noticed (not simplification, but worth a line)

- Reversible PIN storage (AES-GCM, key derived from VENDOR_API_KEY, cloud/index.js:518-520) means a cloud leak exposes every PIN. Removing the vault (top-10 #2) removes this.
- Cloud setup keeps staff PINs in plain text until applied (comment in server/setup.js "the cloud held this one in plain text"). Fixed by top-10 #3.
- Large single files: server/index.js 2185 lines, cloud/index.js 1200, client/src/Admin.jsx 811, admin/src/Branch.jsx 494. Splitting is optional; do the merges above first.

## 5. Suggested order for the implementer

1. #8, #9, docs cleanup (no behaviour change).
2. #1 shared PIN file.
3. #10 and Activation wording.
4. #5 and #6 tab merges (UI only).
5. #3 then #2 (PIN flow, needs acceptance tests for forced change, reset, setup).
6. #4 WhatsApp single control.
7. #7 only after the owner confirms nobody uses the owner login at the cloud.

Not found / kept as is: licence signing (server/licence.js), updater (desktop/main.js), setup apply guard (no orders), AI proxy. They are complex but each one earns its place.

## Verification notes

- Route scan: compared every `app.get/post` in server/index.js and server/whatsapp/index.js against calls in client, desktop, cloud, admin, demo. Most "unmatched" hits were template-string ids (false positives); only the three listed under section 1 are truly unused.
- Line numbers are from the working tree at audit time; some single-line items may drift by a few lines.
