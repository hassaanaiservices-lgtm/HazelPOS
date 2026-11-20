# Re-verify results: HazelPOS 1.0.9 + uncommitted fixes (candidate 1.0.10)

Code under test: the worktree `/tmp/claude-1000/-home-hassaan-Documents-HazelPOS-main/4a5ba7a7-c0c8-400e-b302-37cfe43a27f6/scratchpad/hotfix`
(commit 1cb67f1 "1.0.9" plus the uncommitted diff: 9 files, +91/-38). Same rig as [RIG.md](RIG.md): local cloud, local POS servers,
fake WhatsApp sockets, fake DeepSeek, Electron as Node 22. Ports 5100-5199. Nothing touched `server/pos.db`, `.env`, the live cloud or a real number.

- Scripts used for this run: [scripts-2/](scripts-2/) (copies of [scripts/](scripts/) pointed at the worktree, ports +200; originals kept).
  Changes to the copies: `fake-wa.js` gains `linked()` (new in connection.js); `wa-suite.js` reordered for 1.0.9 (Link on a
  cloud-connected POS now switches the cloud bot on, so the old "connect with bot OFF links the PC" step became the new Link test,
  plus a double-answer probe after an Admin switch-on); `pin-lic-suite.js` also records `pin_vault`. New: `v109-suite.js`
  (1.0.9 behaviour, ports 5100-5129), `admin-ui.js` (Admin app in headless Chromium, 5152-5158), `ui-shots2.js` (POS screens, 5169-5179).
- Raw evidence: `/tmp/claude-1000/hz-reverify/run/<suite>/evidence.json`, logs `/tmp/claude-1000/hz-reverify/run/*.log`, `*-wa.jsonl`.
- Screenshots: [shots/](shots/) `admin-*.png` and `v2-*.png` (the 1.0.8 shots are kept for comparison).
- Static checks on the worktree: `node --check` on the 7 changed server/cloud files OK; `oxlint` client and admin exit 0 (warnings only);
  `rag/scripts/test-guard.js` 12/12, `test-address.js` 32/32. client/dist and admin/dist were built after the
  last source change (dist 12:01/12:08 vs src 11:51/12:00) and contain the new strings.
- Note: the laptop was suspended for ~2 h in the middle of the WhatsApp suite (between +996 s and +8583 s). Only one step fell in
  that gap (WA-AUTO-5 "POS back in cloud mode" poll); see WA-AUTO-5.

## Summary (24 auto tasks)

| Status | Count | Tasks |
|---|---|---|
| PASS | 21 | SETUP-0, WA-ROOT-1, WA-ROOT-2, WA-AUTO-1, WA-AUTO-2, WA-AUTO-3, WA-AUTO-4, WA-AUTO-5, WA-AUTO-7, WA-AUTO-8, WA-AUTO-9, PIN-1, PIN-2, PIN-3, PIN-4, LIC-1, LIC-2, SETUP-1, OFF-1, SYNC-1, SEC-1 |
| PARTIAL | 3 | WA-AUTO-6, WA-AUTO-10 (both: double answers for up to ~2 min after a switch-on **from the Admin app** while the POS runs), DOC-1 |
| FAIL | 0 | |

Previously non-PASS, now: WA-ROOT-1 FAIL→PASS, WA-AUTO-6 FAIL→PARTIAL, SETUP-1 FAIL→PASS, LIC-1 FAIL→PASS, DOC-1 FAIL→PARTIAL,
WA-AUTO-7 PARTIAL→PASS, WA-AUTO-10 PARTIAL→PARTIAL (narrower), PIN-1 PARTIAL→PASS.
New 1.0.9 tests (V109-1..7): all PASS. Regressions: none found.

---

## Previously FAIL / PARTIAL

### WA-ROOT-1: PASS (code side)
- PC mode is now always visible on the POS: cloud-connected POS with a PC-linked number shows "WhatsApp runs on this PC: customers get no
  answers while it is off. [Move to cloud]" ([shots/v2-pos-pc-linked-move-banner.png](shots/v2-pos-pc-linked-move-banner.png), client/src/WhatsApp.jsx:101).
  POS without cloud, before linking: "This PC is not connected to HazelPOS Cloud, so WhatsApp will run on this PC: customers get no
  answers while it is off…" ([shots/v2-pos-no-cloud-warning.png](shots/v2-pos-no-cloud-warning.png), WhatsApp.jsx:45-50).
- API: POS A in PC mode `GET /api/whatsapp/status` → `cloud_bot:false, cloud_available:true, status:"connected"`; vendor view `enabled:false`.
- The incident branch itself was not re-queried (no production access in this run); it stays PC mode until the owner presses Move to cloud / Link.
- Left over (low): Admin badge still says plain "On" for PC mode (admin/src/ui.jsx:29); after linking on a POS **without** cloud, the inbox shows no
  PC-mode reminder (banner needs `cloud_available`, WhatsApp.jsx:101; [shots/v2-pos-no-cloud-inbox.png](shots/v2-pos-no-cloud-inbox.png)).

### WA-AUTO-6: PARTIAL (both 1.0.8 defects fixed; Admin switch-on window remains)
POS A local socket timeline (wa-posA-wa.jsonl):
| Case | 1.0.8 | Now |
|---|---|---|
| POS starts after the cloud was switched on while it was off | auto-connect 1.4 s, stop 14.9 s (both live 13.5 s) | `created autoConnect=false`, `stop` at 3.0 s, **no connect** |
| Restart while ON | no connect | `created autoConnect=false`, no connect |
| Switch OFF while POS runs | connect 54.6 s | connect 54.9 s (linked, no QR) |
| Switch ON (Admin) while POS runs | stop 117.0 s | stop 117.3 s, auth kept |
| Switched OFF while the POS was off | **never reconnected** | connect at **3.0 s**, `cloud_mode` meta "0", status connected |
| PC mode, cloud up, restart (v109 T5) | auto-connect 1.5 s | connect 3.3 s (after the first wa-mode answer) |
| PC mode, cloud down, restart (v109 T5) | auto-connect 1.5 s | connect 10.2 s (offline fallback) |
| Cloud mode saved, cloud down, restart (v109 T5) | no connect | no connect |

Remaining: pass_if says "at no moment are both sockets answering". Switching on **from the Admin app** while the POS runs still leaves the POS
answering until its next 120 s check: same message to both sockets 3 s after switch-on → **cloud 1 reply, local 1 reply**
(wa-suite "WA-AUTO-10 admin switch-on…"). The 1.0.9 POS path (Link / Move to cloud) is immediate (local `stop` at 0.0 s) and has no window.
Defect + fix under "Remaining defects" #1.

### SETUP-1: PASS
Cloud copy of the rider: `{"name":"Rider Bilal","role":"rider","pin":"ride7788","phone":"03001112222","delivery_fee":150}`; POS employee after
activation `phone 03001112222, delivery_fee 150`. After a restart of the set-up POS: `tables: []`, `expenses: []`, only the register the test
opened ("Owner S", 0), 3 products, name "Karachi Grill 2": **no demo data back**. Change before the first order arrived (rename + Malai Boti);
change after the first order did not (`applied_at:null`); POS-chosen owner PIN survives re-apply (login 200). Admin UI side: see V109-ADMIN.
Unchanged note: a setup change reaches the POS only at activation or the 3-hourly licence check (server/licence.js), the Admin app does not say so.

### LIC-1: PASS
Before activation `state:"activate"`, login 403 "Activate HazelPOS first"; activation 200 `ok`; reuse 502 "That activation code is wrong or was
already used…"; 15-day-old code 502 "…has expired…"; wrong code → same as reuse; second POS stays 403. Activated **without** a setup, then
restarted: `products 0, tables 0, expenses [], open_register []`, `demo_cleared_at` set: **demo stays gone** (DEMO_DONE, server/index.js:288).
Activate screen: [shots/v2-pos-activate.png](shots/v2-pos-activate.png).

### WA-AUTO-7: PASS
- Bot ON, cloud unlinked: POS logout + connect forwarded; `qr: FAKEQR-wa-cloud-1` = the cloud's; vendor view `status:"qr"` same QR.
- PC-linked POS connected to the cloud, press Link: response `cloud_bot:true, status:"qr", qr: FAKEQR-wa-cloud-1`; vendor `enabled:true`;
  POS local socket `stop` at 0.0 s. Browser: Move to cloud → confirm → Link → cloud QR ([v2-pos-move-confirm.png](shots/v2-pos-move-confirm.png),
  [v2-pos-after-move-link-screen.png](shots/v2-pos-after-move-link-screen.png), [v2-pos-cloud-qr.png](shots/v2-pos-cloud-qr.png)).
- POS without cloud: Link gives the **local** QR (`FAKEQR-ui2-nocloud-local`) and the screen says WhatsApp stops when the PC is off.
- A real Baileys QR from the cloud (no fake socket on the cloud, v109 T7): POS Link → `connecting`, then POS status `qr`, `data:image/png;base64,iVBORw0K…` (7250 chars).

### WA-AUTO-10: PARTIAL
- Forced local socket while ON (stop() race), same inbound to both: cloud **1**, local **0**, POS orders **0** (wa-suite and v109 T2 after Move to cloud).
- Start-up window of 1.0.8 is closed (see WA-AUTO-6).
- Still open: Admin switch-on while the POS runs → **1 + 1 replies** (measured, up to ~117 s). Remaining defect #1.
- Log text on the POS while quiet in cloud mode is still "quiet: HazelPOS membership not paid: assistant paused" (POS side not given a
  reason; server/whatsapp/index.js:21). Remaining defect #3.

### PIN-1: PASS
- Admin app (headless Chromium, built from the worktree): Set PIN dialog has the checkbox "Ask them to choose their own PIN at next login",
  **ticked by default** ([shots/admin-setpin-dialog.png](shots/admin-setpin-dialog.png)). Submitting → cloud `pin_resets.force_change = 1`;
  applied on the POS after 22.4 s; login → `must_change_pin:true`; `GET /api/orders` → `{"code":"change_pin"}`; choosing a PIN → 200.
- Unticked ([shots/admin-setpin-unticked.png](shots/admin-setpin-unticked.png)) → `force_change = 0`.
- Raw API run (pin-lic-suite): applied after 54.9 s, `must_change_pin:true`, old session 401, row `pin NULL, result ok, force_change 1`.

### DOC-1: PARTIAL
1.0.9 changed the steps: on a cloud-connected POS, **Link WhatsApp switches the cloud bot on, pushes the menu and shows the cloud QR** (steps 1-3 in one
button). Still needed: start the assistant (off by default, rag.config.json:55 `enabled_by_default:false`; POS inbox "Auto-reply off" button or
Admin "Start the bot").

| Surface | Now | Gap |
|---|---|---|
| POS link screen (WhatsApp.jsx:45-50) | cloud note / no-cloud warning | doesn't say to turn on Auto-reply after scanning |
| POS inbox (WhatsApp.jsx:101) | PC-mode banner + Move to cloud | none when the POS has no cloud |
| Admin WhatsApp bot tab (Branch.jsx:487-499) | answers when PC off, menu status, Link/Start buttons | doesn't say the POS Link button does all this; confirm text (Branch.jsx:480) promises "customers never get two answers", false for ~2 min (defect #1) |
| Tour (client/src/Tour.jsx:28) | "The assistant answers and takes orders" | no cloud/PC mode, no Auto-reply step |
| cloud/README.md, desktop/README.md, admin/README.md | build/deploy only | no WhatsApp setup steps or PC-mode limit |
| site/index.html, site/llms.txt:30 | "WhatsApp catches up when the internet returns" | no PC-off behaviour |
| Admin badge (admin/src/ui.jsx:29) | "On" / "On (cloud)" | PC mode not named |

---

## Previous PASSes (regression check)

| Task | Result now | Key evidence |
|---|---|---|
| SETUP-0 | PASS | cloud :5100, A/B connected 200, `/api/vendor/owners` lists both with `code_used_at`, `last_sync` |
| WA-ROOT-2 | PASS (+ fix 5 verified) | switch-on with POS off: 0 replies, log **"quiet: waiting for the menu from the POS"** (was "membership not paid"); menu 4.0 s after POS start (was 16 s), 17 items = 17 POS products |
| WA-AUTO-1 | PASS | reply "Zinger Burger: Single … Rs 650 …"; price → 777 re-pushed after 62.1 s, reply "… Rs 777 …" |
| WA-AUTO-2 | PASS | cloud order on POS after 10.0 s (`cloud_id 1, pending_cashier`), queue `[]` after ack; offline order visible 20.0 s after POS start; re-offer → still 1 row |
| WA-AUTO-3 | PASS | one system message each: confirm #1, ready #1, reject, confirm #2, dispatch (Rider Ali); POS local sends 0 |
| WA-AUTO-4 | PASS | ON: status/chats/messages/log/read/handled/bot/send/assistant/audio/transcript forwarded, cloud-only chat visible, send+markRead on the cloud socket; OFF: all local, sends on the local socket. Unchanged quirk: transcript 404 from the cloud shows as 503 |
| WA-AUTO-5 | PASS | 4 stages match `statusMessage()` exactly; after cloud restart: generic answer, status back after 82 s (1.0.8: 83 s). The "POS back in cloud mode" poll read `false` because the laptop slept through its 150 s window; the following status answer came from the POS push, which needs cloud mode, and WA-AUTO-6 measures the same switch (117 s) |
| WA-AUTO-8 | PASS | ON: rider link 1 cloud send, 0 local; OFF: 1 local send, 0 cloud; lowstock.js: OFF → POS `923009998877`, ON → cloud `1 -> 923009998877` |
| WA-AUTO-9 | PASS | B key: A's order 404, wa-send 400 "Unknown chat", chats only B's, A's messages/log `[]`, send/read 404, vendor 401, no key 401; folders `1`,`2` |
| PIN-2 | PASS (+ fix 6 verified) | newer reset replaces older; cloud down: old PIN 200; 25 h back-date → `expired`, temp 401, old 200. `pin_vault` now `set_at NULL` for the expired (cashier) and refused (kitchen) users, Admin list `pending:false` for all |
| PIN-3 | PASS | raw API without `force_change` → `force_change 0`, `must_change_pin:false`, orders 200 (the Admin app now always sends the flag) |
| PIN-4 | PASS | identical matrix to 1.0.8 on all three surfaces (6 easy PINs, `abc`, `ab_12`, 13 chars rejected; `123456`, `abcd`, `Ab12Cd` accepted; case-insensitive login; starting PIN 1111 → 403) |
| LIC-2 | PASS | unpaid → `locked`, new order 402 (admin + cashier), open order payable, reports 200; forged `lic_signed` → locked; paid again → ok, order 200 |
| OFF-1 | PASS | cloud refused and black-holed: all actions 4-8 ms (print 26-201 ms, 502 no printer); back online: POS 7 / Rs 11,426 = cloud; expenses 6 = 6; shifts 2 = 2; duplicate keys none |
| SYNC-1 | PASS | A 5 / Rs 7,714 = cloud, B 3 / Rs 4,002 = cloud; restart and full re-push unchanged; one backup per branch |
| SEC-1 | PASS | all SA checks as in 1.0.8 (60 MB without key 401 in 79-87 ms, 413s, forced model/max_tokens, no ACAO, 429s, nosniff/DENY). New `POST /api/sync/wa-mode`: no key 401, wrong key 401 (v109 T4) |

Regressions: **none found.**

---

## New 1.0.9 behaviour (v109-suite.js, admin-ui.js, ui-shots2.js)

| ID | Test | Result | Evidence |
|---|---|---|---|
| V109-1 | Link on a cloud-connected POS that never had WhatsApp | PASS | `POST /whatsapp/connect` 200 in 38 ms → `cloud_bot:true, status:"qr", qr: FAKEQR-v9-cloud-1`; vendor `enabled:true`, `menu_at` set, `menu_items 17` = POS 17; meta `cloud_mode 1`; scan → POS status `connected, cloud_bot:true`; restart → cloud_bot seen after 3.4 s, local `autoConnect=false`, no connect |
| V109-2 | Move to cloud on a POS whose own number is linked | PASS | baseline PC mode 1 local reply; `POST /whatsapp/cloud {enabled:true}` 200 in 15 ms → `cloud_bot:true`; local `stop` at 0.0 s, auth kept; menu pushed (17); Link → cloud QR; assistant switched on through the POS (forwarded); same message to both sockets with the local one **forced** connected: cloud 1, local 0, orders 0; restart → local never connects |
| V109-3 | POS not connected to the cloud | PASS | status `cloud_available:false, cloud_bot:false`; `POST /whatsapp/cloud` 400 "This PC is not connected to HazelPOS Cloud (internet?)"; Link → local QR `FAKEQR-v9-p3-local`, local `connect` |
| V109-4 | Membership not active → 402 | PASS | owner `paid_until 2026-01-01` (`ai_active:false`): `POST /api/sync/wa-mode {enabled:true}` → **402** "The HazelPOS membership is not active, so the WhatsApp bot cannot be switched on"; `{enabled:false}` 200; no/wrong key 401/401; POS Link → 400 with the same text, no local link, vendor `enabled:false` |
| V109-5 | Start-up gating / offline fallback (fix 2) | PASS | see WA-AUTO-6 table (3.3 s / 10.2 s / none / 3.0 s) |
| V109-6 | Cloud bot AI usage counted and capped (fix 7), `AI_DAILY_LIMIT=3` | PASS | 5 messages → replies `[1,1,1,0,0]`; `ai_usage` 3 rows `chat ok tokens_in 1000 tokens_out 50`; bot log "quiet: Daily AI limit reached (3 calls). It resets tomorrow: assistant paused until tomorrow"; the branch's own `/api/ai/chat` then 403 (shared budget) |
| V109-7 | Real Baileys QR from the cloud | PASS | cloud without the fake socket: POS Link → `connecting`, POS status `qr` `data:image/png;base64,iVBORw0K…` (7250 chars). No phone scan possible |
| V109-ADMIN | Admin app from the worktree (admin/server.js, CLOUD_URL = local cloud, generated VENDOR_API_KEY and ADMIN_PASSWORD) | PASS | Set PIN checkbox present, ticked by default, sends `force_change` 1/0 (PIN-1); Staff tab: role Rider shows "Rider's phone (for the tracking link)" and "Fee per delivery (Rs)" (fee keeps digits only: `150abc` → `150`); Save → cloud setup staff `{"name":"Rider Bilal","role":"rider","pin":"ride7788","phone":"03001112222","delivery_fee":150}`; WhatsApp bot tab before: "Switched off / No menu from the POS yet…", after Link on the POS: "Scan the QR code / Menu from the POS: 17 items…" |

Admin screenshots: [admin-setpin-dialog.png](shots/admin-setpin-dialog.png), [admin-setpin-unticked.png](shots/admin-setpin-unticked.png),
[admin-staff-pins.png](shots/admin-staff-pins.png), [admin-staff-rider.png](shots/admin-staff-rider.png), [admin-wa-tab-off.png](shots/admin-wa-tab-off.png),
[admin-wa-tab-on.png](shots/admin-wa-tab-on.png).

---

## Remaining defects (file:line in the worktree)

1. **Medium: double answers for up to ~2 min after "Switch on" in the Admin app while the POS runs.** Measured cloud 1 + local 1 reply 3 s
   after the switch; the POS lets go only at its next check, `setInterval(() => syncWaCloud(), 120_000)` (server/index.js:1854); the cloud bot
   starts answering at once (cloud/wa-host.js:115 `setEnabled` → `start(id)`). The Admin confirm text promises the opposite: "Its POS stops answering by
   itself within 2 minutes, so customers never get two answers" (admin/src/Branch.jsx:480). Not a regression (same in 1.0.8) and not hit by the
   1.0.9 POS buttons. Fix: keep the cloud assistant quiet after an Admin switch-on until the POS has fetched `/api/sync/wa-mode` since `changed_at`
   (or 150 s passed / POS offline), in `allowed()` cloud/wa-host.js:71; or check `wa-mode` in the 20 s `pushWaStatus` loop. At least fix the confirm text.
2. **Low: DOC gaps** (table in DOC-1): Auto-reply must still be switched on after linking (assistant off by default); Admin tab doesn't mention the POS
   Link button; Tour/READMEs/site silent on PC vs cloud.
3. **Low: POS log reason in cloud mode** still "quiet: HazelPOS membership not paid: assistant paused" (server/whatsapp/index.js:21 passes no
   `notAllowedReason`; aiAllowed is false because of `waCloudMode`, server/index.js:2046). Fix: pass `notAllowedReason: () => waCloudMode ? 'the bot runs on HazelPOS Cloud' : …`.
4. **Low: PIN list forgets a still-valid PIN.** `unpendVault` (cloud/index.js:540) sets `pin_enc=NULL` when a reset expires or is refused, so the
   person's previous, still-working PIN (e.g. cashier `setpin7788`) can no longer be shown in Admin ("not known yet"). Fix: keep the previous
   `pin_enc` when the pending one is dropped (store it before overwriting at cloud/index.js:1005).
5. **Low: no PC-mode reminder in the inbox on a POS without cloud** (WhatsApp.jsx:101 requires `cloud_available`). Shown only on the link screen before linking.
6. **Cosmetic:** limit log text doubles up ("…It resets tomorrow: assistant paused until tomorrow", cloud/wa-host.js `notAllowedReason`);
   the "Move to cloud" button wraps to three lines in the inbox header ([v2-pos-pc-linked-move-banner.png](shots/v2-pos-pc-linked-move-banner.png)).
7. **Unchanged from 1.0.8 (not in this fix set):** cloud "where is my order" status is memory-only (cloud/wa-host.js:32), back 82 s after a cloud
   restart for minute-bearing texts, up to 10 min for cooking/ready; `wa-send-phone` can text any number (cloud/wa-host.js:211); a setup change
   reaches the POS only at the 3-hourly licence check; a POS whose cloud is down and whose saved mode is cloud answers locally if its socket were
   connected (it is not connected in practice; v109 T5 forced it: 1 reply "fallback (LLM error)").

## Release call

**GO for 1.0.10.** Every fix in the diff works as described (demo never returns, start-up gating and switch-back reconnect, rider phone/fee,
Set PIN force-change, quiet reason, vault "pending", cloud-bot AI budget), the 1.0.9 Link / Move to cloud / no-cloud / 402 paths behave, and all
previously passing tasks still pass. The one open medium item (#1) predates these fixes and only occurs when the vendor uses the Admin "Switch on"
button while the restaurant's POS is running; the POS's own buttons have no window. Recommended before or right after release: change the Admin
confirm text (Branch.jsx:480) so it no longer promises "never two answers".
