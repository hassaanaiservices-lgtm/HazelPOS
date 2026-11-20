# Verify results: HazelPOS v1.0.8 (git HEAD ddf1a49, branch product-installer)

Tested: an export of git HEAD (not the working tree), on Linux, with a local cloud, local POS servers, fake WhatsApp sockets
and a fake DeepSeek. Rig and commands: [RIG.md](RIG.md). Scripts: [scripts/](scripts/). Raw evidence of each run:
`/tmp/claude-1000/hz-verify/run/<suite>/evidence.json` and `<process>.log` / `<process>-wa.jsonl` (rerun the scripts to regenerate).
Screenshots: [shots/](shots/).

TASKS.json has **24** tasks with `"mode": "auto"` (10 are `real`, not run here: WA-REAL-1..6, DESK-1..3, HUMAN-CHECKLIST).

| Status | Count | Tasks |
|---|---|---|
| PASS | 16 | SETUP-0, WA-ROOT-2, WA-AUTO-1, WA-AUTO-2, WA-AUTO-3, WA-AUTO-4, WA-AUTO-5, WA-AUTO-8, WA-AUTO-9, PIN-2, PIN-3, PIN-4, LIC-2, OFF-1, SYNC-1, SEC-1 |
| FAIL | 5 | WA-ROOT-1 (finding), WA-AUTO-6, SETUP-1, LIC-1 (demo comes back), DOC-1 |
| PARTIAL | 3 | WA-AUTO-7, WA-AUTO-10, PIN-1 |
| COULD NOT TEST | 0 | |

---

## SETUP-0: PASS
`node docs/verify/scripts/setup0.js`: cloud on :4900, clients A and B via `POST /api/vendor/owners` + `/owners/:id/branches`,
POS A :4910 and POS B :4920 connected with their `HZ-` codes through `POST /api/cloud/connect` → 200, `GET /api/cloud/status`
`connected: true` for both; `GET /api/vendor/owners` lists branch 1 "Client A main" and branch 2 "Client B main", each with
`code_used_at` and `last_sync` set. Note: `GET /api/vendor/branches` does not exist (404); the branch list is inside `/api/vendor/owners`.
`VENDOR_API_KEY` must be 32+ characters, else vendor mode is silently off (cloud/index.js:582). Commands in RIG.md.

## WA-ROOT-1: FAIL (as a finding: PC mode gives no warning)
- Incident branch (production, not called by me): the main session already confirmed branch 1 "apna wehra" has the cloud bot
  **enabled=false**, POS health shows WhatsApp status from the PC, POS version 1.0.8. So the restaurant runs in **PC mode**:
  the bot lives on the POS PC and dies with it. That explains the incident.
- Rig: `GET /api/vendor/branches/1/whatsapp` before switch-on → `{"enabled":false,"status":"off","menu_at":null}`;
  POS A `GET /api/whatsapp/status` → `cloud_bot:false, status:"connected"` (linked on the POS).
- POS link screen, PC mode ([shots/pos-link-pc-mode.png](shots/pos-link-pc-mode.png)): text is only "Customers' chats will then show
  here. The POS keeps working without internet; messages sent while it was offline appear when it reconnects…". **Nothing says
  answers stop when the PC is off.** Cloud mode ([shots/pos-link-cloud-mode.png](shots/pos-link-cloud-mode.png)) shows "Your WhatsApp
  runs on HazelPOS Cloud: customers get answers even when this PC is off." (client/src/WhatsApp.jsx:45-49).
- Where the mode is shown: admin/src/Branch.jsx:465-494 (WhatsApp bot tab: "Switched off" vs status); admin/src/ui.jsx:29 the
  WhatsApp badge adds " (cloud)" in cloud mode, plain "On" in PC mode (used in Client.jsx:112, Branch.jsx:67, :448). Nowhere in
  client/src or admin/src says "PC mode" or that PC-mode answers stop with the PC.
- **Fix:** in client/src/WhatsApp.jsx:48 (PC-mode branch) and in the Inbox header, add: "This number is linked to this PC: the
  assistant answers only while this PC is on and online. To answer when it is off, ask HazelPOS to switch on the cloud bot."
  In admin/src/ui.jsx:29 show "On (PC)" instead of "On".

## WA-ROOT-2: PASS
Rig: cloud bot switched on for A1 with POS A stopped (`/whatsapp/enable` → `menu_at:null, menu_items:0`). A fake inbound
"zinger burger kitna ka hai?" got **0 replies**; bot log: `quiet: HazelPOS membership not paid: assistant paused`.
POS A started 9.4 s after switch-on; `menu_at` set **16.0 s after POS start** (`menu_items:17` = POS's 17 products, `menu_pictures:0`, no demo pictures).
Code: syncWaCloud server/index.js:1824-1840 returns before `waKnowledge()` unless `mode.cloud`; first run 15 s, then 120 s.
Side finding: the quiet reason shown in the Admin log is **wrong**: "membership not paid" while the real cause is "no menu yet"
(cloud/wa-host.js:61 folds both into `allowed()`, assistant.js:54 prints one text). Fix: pass a separate `ready()` hook or make
`allowed()` return the reason, and log "no menu from the POS yet".

## WA-AUTO-1: PASS
Reply 1: `Zinger Burger: Single (Regular patty) Rs 650 | Double … Rs 950 | Combo … Rs 1,100`; the prompt the cloud sent DeepSeek
contains `- Zinger Burger [#6]: Single (Regular patty) Rs 650 | …` (the POS's menu). Price changed on POS A (Single → 777 via
`POST /api/products`); the cloud's `menu_at` changed **60.1 s** later and reply 2 was `Zinger Burger: Single (Regular patty) Rs 777 | …`. `menu_items` 17 = POS active products 17. Fake DeepSeek: the check is that the **prompt context**
carries the current POS price, not that a real model phrases it well.

## WA-AUTO-2: PASS
Three cloud orders (takeaway, confirmed with "yes"): cloud `wa_orders.confirmed_at` → `pos_received_at` = **3.4 s, 2.3 s, 1.3 s**
(cloud wa.db). POS row: `cloud_id:1, status:pending_cashier, items:[Coke 500ml], fulfilment:takeaway, phone:03001110003`.
Cloud `GET /api/sync/wa-orders` after ack → `[]`. Offline case: POS A stopped, order placed (customer got "Shukriya…"),
POS restarted after 60 s → order visible **20.0 s** after POS start. Lost-ack simulation (cloud `pos_received_at` reset to NULL,
POS fetched it again) → still **1** row on the POS for that `cloud_id` (store.js importCloudOrder dedupes by `cloud_id`).

## WA-AUTO-3: PASS
Cloud fake socket captured exactly one `system` message per action, each to the right chat:
accept #1 "✅ *Aapka order #1 confirm ho gaya hai!*", ready #1 "🛍️ Aapka order #1 tayyar hai!…", reject "Maazrat, hum abhi yeh
order nahi le sakte. (Kitchen band hai)…", accept delivery #2, dispatch "🛵 Aapka order #2 rider Rider Ali ke saath nikal gaya hai!".
POS responses `message_sent:true`. POS A local socket sends during that time: **0** (it was stopped). Path: server/whatsapp/index.js
cloudResult → `/api/sync/wa-orders/:id/result`; server/index.js:1371-1375 waNotify → `/api/sync/wa-send`.

## WA-AUTO-4: PASS
With the bot ON, POS A routes (`GET status, chats, chats/:id/messages, chats/:id/log`, `POST read, handled, bot, send, assistant`,
`GET messages/:id/audio`, `POST messages/:id/transcript`) all answered from the cloud: `/chats` and `/messages` show the chat that
exists only on the cloud, `/status` has `cloud_bot:true`, the staff reply "Ji, main cashier hoon" was sent **once by the cloud
socket** (sender staff), markRead went to the cloud socket. audio → 404 forwarded ("Voice note not available"), as no voice note.
`GET /chats/:id/orders` is local by design (not in CLOUD_ROUTES). Bot OFF: the same routes hit the local store (`/chats` no longer
shows the cloud-only chat, `/messages` → `[]`, send/markRead went out on the POS's local socket). Full table: wa/evidence.json "WA-AUTO-4".
`POST /connect` and `/logout` are covered in WA-AUTO-7.

## WA-AUTO-5: PASS (restart behaviour documented)
Delivery order accepted from the cloud; "mera order kahan hai?" asked 45 s after each POS change (pushWaStatus runs every 20 s).
All four replies matched `statusMessage()` exactly: cooking "👨‍🍳 Aapka order #2 kitchen mein ban raha hai…", ready "…tayyar hai,
rider abhi nikalne wala hai.", out "🛵 Aapka order #2 raste mein hai, rider Rider Ali 1 min pehle…", delivered "✅ … deliver ho gaya hai".
Cloud restart: before → "✅ Aapka order #2 13 min pehle deliver ho gaya hai…"; right after → "Ji, farmaiye. Kya chahiye?" (status map
empty, the AI answered); status answered again **83 s** after the restart. That was quick only because "out"/"delivered" texts
contain minutes, so they change every minute and are re-sent; for "cooking"/"ready" (no minutes) the POS re-sends only every
10 min (server/index.js:1843-1853), so after a cloud redeploy those customers get a generic AI answer for up to 10 min.
Status is memory-only on the cloud (cloud/wa-host.js:31, :262-268). Suggested fix: save `statusTexts` in the branch folder like
knowledge.json, or re-send when the cloud reports a new start id.

## WA-AUTO-6: FAIL
Measured (POS A local fake socket timeline, wa-posA-wa.jsonl):
- Switch OFF while POS runs → local `connect()` (linked, no QR) after **54.6 s**. PASS.
- Switch ON while POS runs → local `stop()` after **117.0 s**; auth folder kept (connection.js `stop()` only ends the socket). PASS.
- Restart while ON → `created autoConnect=false`, no connect. PASS.
- **Defect 1 (both sockets live):** POS started after the cloud was switched on while it was off: local socket `auto-connect` at
  1.4 s, `stop` at 14.9 s → **~13.5 s with both sockets connected and the POS assistant allowed** (waCloudMode is false until the first
  check, server/index.js:1814, 1840; autoConnect reads the old `cloud_mode` meta, server/whatsapp/index.js:19). In that window a
  customer gets two answers. The same happens for up to 120 s if the switch-on happens while the POS runs (it keeps answering until
  its next check).
- **Defect 2 (dead bot):** cloud switched OFF while the POS was off → POS starts with `autoConnect=false` (meta still '1'), first
  check sets `waCloudMode=false` but `was` is false, so `connect()` is never called (server/index.js:1834). After 140 s:
  `status:"disconnected", cloud_bot:false, cloud_mode meta "0"` → **no bot at all** until the next POS restart.
  **Fix:** in syncWaCloud use the stored meta as `was` (`const was = store.meta.get('cloud_mode') === '1'`), and on startup do not
  auto-connect until the first `/wa-mode` answer (or answer from the cloud only while `cloud_mode` is unknown).

## WA-AUTO-7: PARTIAL
Bot ON: POS `POST /api/whatsapp/logout` and `/connect` are forwarded; connect returned `qr:"data:image/png;base64,FAKEQR-wa-cloud-1"`
(the **cloud's** socket) and vendor `/whatsapp` showed `status:"qr"` with the same QR. In the browser, clicking "Link WhatsApp" in cloud
mode showed the cloud QR ([shots/pos-link-cloud-mode-qr.png](shots/pos-link-cloud-mode-qr.png)). PASS for cloud mode.
Bot OFF: connect links the **local** socket (`FAKEQR-ui-pos-local` in the UI run) and the screen does not say the PC must stay on
([shots/pos-link-pc-mode.png](shots/pos-link-pc-mode.png)) → FAIL as UX finding; fix as in WA-ROOT-1.

## WA-AUTO-8: PASS
Bot ON: rider link (`POST /api/riders/:id/send-link`) → one send on the **cloud** socket to `923005556677@s.whatsapp.net`, 0 local sends;
low-stock alert (`scripts/lowstock.js`, ingredient Chicken 0/10 kg) → one cloud send to `923009998877@s.whatsapp.net`, 0 local.
Bot OFF: rider link and low-stock alert each sent once on the **local** socket, 0 cloud sends. Note: the alert was triggered with the
"Send a test now" route (`/api/low-stock-alert/test`), not by paying an order: the scheduled alert only fires at the set time (22:00)
via the same `waOut.send` (server/index.js:2034-2037).

## WA-AUTO-9: PASS
With B1's key against A1's chats/orders: `wa-orders` → B's own list `[]`; `wa-orders/<A id>/result` → 404; `wa-send` to A's chat →
400 "Unknown chat"; `wa/chats` → only B's chat; `wa/chats/<A chat>/messages|log` → `[]`; `/send`,`/read` → 404; A's message audio/
transcript → 404. Vendor routes with a branch key → 401; branch routes with no key → 401. Cloud folders `wa/1`, `wa/2` separate;
vendor logs per branch show only their own chats. Nothing of A was sent. Note (not a leak): `/api/sync/wa-send-phone` lets any branch
send any text to **any** number from its own WhatsApp (30/min), e.g. B → A's customer number was sent. Fine for own number, but a
stolen branch key can spam from the restaurant's number (cloud/wa-host.js:190-197); consider limiting to riders/owner numbers the
POS registered.

## WA-AUTO-10: PARTIAL
Local socket forced connected while ON, same inbound (same wa_id) to both: cloud replies **1**, local replies **0**, local log
`quiet: HazelPOS membership not paid: assistant paused`, orders created on POS **0**. Code path: server/index.js:2032
`aiAllowed: () => lic.aiAllowed() && !waCloudMode`. PARTIAL because of the start-up window in WA-AUTO-6 Defect 1 (up to ~15 s after a
POS start, and up to 120 s after a switch-on, the local assistant is still allowed). The log text is also misleading ("membership not paid").

## PIN-1: PARTIAL
`POST /api/vendor/branches/1/pin-reset {user_id:2, pin:"temp5678", force_change:true}` → applied on the POS after **55.3 s**;
login → `must_change_pin:true`; `GET /api/orders` with that session → 403 `{"code":"change_pin"}`; the cashier's old session → 401;
new PIN set → 200; cloud row: `pin NULL, applied_at set, result ok, force_change 1`.
**But the Admin app never sends `force_change`**: admin/src/Branch.jsx:397-399 posts only `{user_id, pin}`, so a PIN set in Admin is
**not** forced to change (see PIN-3). The claim holds only for the raw API. **Fix:** send `force_change: true` from Branch.jsx:399
(or default it to 1 in cloud/index.js:990), and say so in the dialog text.

## PIN-2: PASS
Two resets while POS off: older row `result 'replaced by a newer reset', pin NULL`. Cloud stopped, POS restarted: old PIN login
200, licence state `ok`. `created_at` back-dated 25 h, cloud back, after 75 s: row `result 'expired', pin NULL`; temp PIN → 401,
old PIN → 200. Side finding: expired/rejected resets leave the cloud's PIN list (`pin_vault`) showing the never-applied PIN as
"pending" (cashier vault = `offl1234` pending; kitchen vault = a PIN the POS refused as a duplicate). Admin "Show" would reveal a PIN that
does not work. Fix: in cloud/index.js:540-547, when a reset ends with a result other than 'ok', restore/clear that user's vault entry.

## PIN-3: PASS (behaviour confirmed)
Set PIN as the Admin app sends it (`{user_id, pin}`) → applied after 59 s; `force_change 0`; login → `must_change_pin:false`;
`GET /api/orders` → 200. Admin dialog text: "New PIN for X. It reaches their POS within a minute (their POS must be online)."
(Branch.jsx:397): no promise of a forced change, consistent. But server/index.js:1864-1865 comment and cloud/index.js:86 comment say
the person "must choose a new one", which is not what happens.

## PIN-4: PASS
Matrix (HAZEL_LICENCE=1 POS `/api/me/pin`, Admin setup `POST /branches/:id/setup`, Admin Set PIN `/pin-reset`) is identical:
reject `1234 1111 2222 3333 0000 4321` (too easy), reject `abc`, `ab_12`, `1234567890123` (format); accept `123456`, `abcd`, `Ab12Cd`.
After setting `Ab12Cd`, login with `ab12cd` → 200. Login with starting PIN `1111` (cashier) → 403 "This is a starting PIN…".
Note: `server/pin-rules.js` is not in HEAD (untracked); in 1.0.8 the rules are duplicated in server/index.js:395-402 and
cloud/index.js:820-823, :984-985. "Easy PINs" means only those 6: `123456`, `5555`, `1212` are accepted.

## LIC-1: FAIL
Activation part passes: before activation `GET /api/licence` → `state:"activate"`, login → 403 "Activate HazelPOS first"; activate
with code → 200 `ok`; same code on a second fresh POS → 502 "That activation code is wrong or was already used…"; 15-day-old code →
"That activation code has expired…"; wrong code → same message as reuse; second POS stays blocked (403). Screens:
[shots/pos-activate.png](shots/pos-activate.png), [shots/pos-activate-wrong-code.png](shots/pos-activate-wrong-code.png).
**Defect:** activation without a prepared setup clears the demo (`demo_cleared_at` set, name "My Restaurant"), but **after the next
restart the demo comes back**: 17 demo products (Margherita, Pepperoni…), 18 demo tables, the 4 demo expenses (Rs 18,000 dated
today, which then sync to the owner dashboard) and a register opened by "Owner" with Rs 5,000. Cause: clearDemo
(server/setup.js:89) empties categories/tables_/floors/expenses/register_sessions, and the seeds at server/index.js:286, 336,
341, 436, 448 refill any empty table on every start. **Fix:** guard all seeds with `!getSetting('demo_cleared_at') &&
!getSetting('setup_applied_at')` (or a single `seeded` flag set on first run).

## LIC-2: PASS
Open order created; owner marked unpaid (`paid_until 2026-01-01`) → `POST /api/licence/check` → `locked`. New order → 402 with the
membership message (admin and cashier); paying the open order → 200 `paid`; `/api/reports` → 200. Forged `lic_signed` (paid until
2099) in the POS DB → `state:"locked"`, "couldn't confirm your membership… were changed", new order 402. Paid again (`/extend`) →
check `ok` → new order 200. Not tested: tampering in transit (no proxy); the same `verified()` check (server/licence.js:55-63) applies.

## SETUP-1: FAIL
Prepared setup (name, 2 items, zone, admin/cashier/rider). After activation: name "Karachi Grill", products Tikka 500 / Seekh Kabab
400, users with `must_change_pin:1`, zone 1, no demo customers/promos/faq/expenses. Re-save (rename + "Malai Boti") + licence check →
arrived; staff kept; the owner's POS-chosen PIN still works. After the first order a further change did **not** arrive (cloud summary
`applied_at:null`). Defects:
1. **Rider phone and fee are lost:** cloud copy `{"name":"Rider Bilal","role":"rider","pin":"ride7788"}`; POS employee
   `phone:"", delivery_fee:0`. cloud/index.js:818 keeps only `name, role, pin`, while server/setup.js:68-69 expects `u.phone`,
   `u.delivery_fee`. Fix: keep `phone` and `delivery_fee` for riders in the cloud's staff mapping.
2. **Demo comes back after a restart:** 18 demo tables (T1…R4) and the 4 demo expenses reappear (setup had no tables; apply
   deleted expenses). Same cause and fix as LIC-1.
3. Changes reach the POS only at a licence check (every 3 h, server/licence.js:16) or activation; not "within minutes". The Admin
   app does not tell this.

## OFF-1: PASS
Cloud process killed, then cloud address black-holed (`10.255.255.1`): create, modify, pay, table-QR order (public) + accept,
expense, reports, WhatsApp/cloud/licence status, close and open shift each took **1-8 ms** (print with no printer 26-117 ms, 502
"No printer set up"). Pending orders 2, `last_error "Cloud not reachable"`. Back online after 70 s: POS paid 7 / Rs 11,426 = cloud 7 /
Rs 11,426; expenses 6 = 6; shifts 2 = 2; duplicate `(branch, local_id)` rows: none. Note: "Sync now" while a background sync hangs
returns 200 `{skipped:"already running"}`; the screen may read that as success.

## SYNC-1: PASS
5 paid orders on A, 3 on B, after 70 s: A POS 5 / Rs 7,714 = cloud 5 / Rs 7,714; B 3 / Rs 4,002 = 3 / Rs 4,002; expenses 4 / 18,000
both; one backup per branch. Plain restart: unchanged. Full re-push (POS `sync_log` cleared): cloud still 5 / 7,714, 5 item rows.
Daily backup: only the first backup was observed (24 h interval, cloud-sync.js:11).

## SEC-1: PASS
`node docs/verify/scripts/sec-suite.js`: SA1 60 MB to `/api/sync/backup`, `/api/vendor/owners`, `/api/ai/chat`, `/api/sync/wa-knowledge`
without key → 401 in 94-203 ms; public `/api/activate` 200 KB → 413. SA2 `/api/vendor/TEAM` → 404, `/team` as staff → 403.
SA3 upstream got `model deepseek-flash, thinking disabled, max_tokens 1000` although the branch asked for reasoner/enabled/100000;
>300k chars → 413. SA4 activation to another URL with a built-in cloud → refused. SA10 no `Access-Control-Allow-Origin`.
SA11 QR orders 200×5 then 429. SA12 second backup 429, non-SQLite 400. SA13 bad JSON → `{"error":"The request was not valid JSON"}`.
SA14 `nosniff`, `X-Frame-Options: DENY`, no `x-powered-by`. SA5/SA8 via LIC-1/LIC-2. All 26 routes added since 5696496
(`/api/sync/wa*`, `/api/vendor/branches/:id/whatsapp*`) → 401 with no key and wrong key; vendor ones 401 with a branch key; all are
under `knownBranch` + 12 MB (`/api/sync`) or `vendorKeyOnly` + 12 MB (`/api/vendor`); wa-knowledge photos > 8 MB → 413; branch scoping
via `live.get(req.branch.id)` (WA-AUTO-9). Remarks: the cloud bot calls DeepSeek directly (rag deepseek.js with the cloud's key), not
through `/api/ai/chat`, so `ai_usage`, `AI_DAILY_LIMIT` and token caps do **not** count cloud-bot traffic (only the per-store
`daily_cost_cap_usd` of 2 USD applies); `wa-send-phone` can text any number (WA-AUTO-9).

## DOC-1: FAIL
Steps needed: (1) switch on in Admin, (2) wait for "Menu from the POS", (3) link (Admin or POS), (4) start the bot (assistant is off by
default, rag.config.json:55), (5) PC mode stops when the PC is off.

| Surface | What it says | Gaps |
|---|---|---|
| Admin WhatsApp bot tab (admin/src/Branch.jsx:479-494) | answers when PC off; menu status line ("No menu… stays quiet until the POS… sends it"); Link button only after switch-on; "Start the bot" button | no numbered order; doesn't say linking can also be done on the POS; doesn't say "Start the bot" is required (assistant off by default); nothing about PC mode |
| Admin switch-on confirm (Branch.jsx:473) | "Its POS stops answering by itself within 2 minutes" | fine |
| POS link screen (client/src/WhatsApp.jsx:45-49) | cloud note in cloud mode | PC mode: no warning (5); never mentions Admin switch-on (1,2) |
| POS tour (client/src/Tour.jsx:28) | "The assistant answers and takes orders" | (1)-(5) all missing |
| cloud/README.md:61 | build command needed for the cloud bot | no setup steps, no PC-mode limit |
| desktop/README.md:66 | AI goes through the cloud | no WhatsApp steps |
| admin/README.md | nothing about the cloud bot | all |
| site/index.html:182, site/llms.txt:30 | "Billing… run on your own PC… WhatsApp catches up when the internet returns" | implies PC mode; no cloud option; no limitation |
| Admin badge (admin/src/ui.jsx:29) | "On" vs "On (cloud)" | PC mode not named |

---

## Claims that were wrong or overstated

1. **"A temporary PIN set in Admin must be changed at login" (PIN-1)**: false via the Admin app; it never sends `force_change`.
   Comments at server/index.js:1864-1865 and cloud/index.js:86-87 repeat the wrong claim.
2. **"Switching OFF reconnects by itself, with no new QR" (WA-AUTO-6)**: false if the switch happens while the PC is off: the
   POS's WhatsApp stays disconnected until a second restart.
3. **"While the cloud bot is on, the POS's own bot stays quiet" (WA-AUTO-10)**: not during the first ~15 s after a POS start
   (when the POS missed a switch-on) or up to 120 s after a switch-on while it runs; both sockets can answer.
4. **"Demo name/logo never stay on a real install" (SETUP-1, LIC-1)**: the demo menu (no setup), tables and expenses (Rs 18,000) come
   back on the next restart; the demo expenses then sync to the owner's dashboard.
5. **"Riders included" in prepared setups (SETUP-1)**: rider login and staff record yes, phone and delivery fee no.
6. **"A setup reaches the POS until its first order"**: only at activation or the 3-hourly licence check, not promptly.
7. **"Bot stays quiet until the POS has pushed its menu"**: true, but the Admin log calls it "HazelPOS membership not paid".
8. **"Where is my order?" answered from the POS status**: true while the cloud runs; after a cloud restart/redeploy it is lost until the POS re-sends (83 s measured for a delivered order; up to 10 min for cooking/ready).
9. **"Easy PINs are refused"**: only six fixed PINs; `123456` etc. are accepted. The three surfaces do agree.
10. **"Every cloud AI call is counted per branch and capped" (cloud README / SA3)**: the cloud bot's own DeepSeek calls bypass
    `/api/ai/chat`, so they are not in `ai_usage` and not under `AI_DAILY_LIMIT`.
11. **TASKS.json counts 25 auto tasks**: it has 24.
