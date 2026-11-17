# Risks to review

Things found while building the installer, licence and AI proxy. We finish the steps first, then go through this list
together and decide each one.

Status: **open** = not decided yet, **decided** = we chose what to do (the choice is written next to it), **fixed** = no longer a risk.

## Desktop app (installer)

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| D1 | The server uses Node's built-in SQLite (`node:sqlite`). Does Electron's Node include it? | The app would open and the server would stop straight away. | Tested: Electron 38.8.6 (Node 22.22) runs SQLite, and the packaged server starts and serves the POS. | fixed |
| D2 | The code repo may be private, so installed apps can't read its releases. | Auto-update would never find updates. | **Done:** installers are published to a separate PUBLIC repo `-HazelPOS-releases` (code stays private). One-time setup in `desktop/README.md` (create the repo, a token, a secret). Until you do that, the GitHub build can't publish. | decided: needs your one-time setup |
| D3 | The installer isn't code-signed. | Windows shows "unknown publisher" (SmartScreen). | **Decided 16 Nov:** for the first 5–10 clients you install it yourself (AnyDesk) and click More info → Run anyway. Buy a certificate when you have about 10 paying clients. | decided: later |
| D4 | The WhatsApp assistant's FAQ was in files inside the install folder: the same for every restaurant, and an update overwrote edits. | A wrong address or opening hours from the bot. | **Fixed:** the FAQ lives in the database, edited in Settings → WhatsApp bot → Questions and answers (with the 7 usual questions to fill in; total capped at 8,000 characters because the bot reads it with every message). Backups and restores carry it. A restaurant prepared in the admin app doesn't get FAQ answers yet (SUGGESTIONS F1). | fixed |
| D5 | Port 4000 is fixed. | If another program uses 4000, HazelPOS wouldn't start. | **Fixed:** the app uses 4000 when free, else the next free port (4001…), remembers it (so tablets' bookmarks keep working), and tells the owner the new address once. Tested. | fixed |
| D6 | Mac builds aren't signed with an Apple developer account. | macOS blocks the app. | **Decided 16 Nov:** Windows only. Mac and Linux were removed from the build. | fixed |
| D7 | A fresh install started with the demo restaurant ("Pizza Venu", sample data) and PINs 1234/1111/2222. | A real restaurant with guessable PINs. | **Fixed:** (1) activation without a prepared setup clears the demo data (menu, tables, expenses, bank details, name); (2) before activation nobody can log in; (3) logging in with a starting PIN (1234, 1111, 2222, 3333) only works for the owner, who must choose their own PIN before anything else works; the cashier, kitchen and riders wait until the owner gives them PINs; (4) the owner can't give anyone a starting PIN (or 0000, 4321). Enforced by the server on installed apps only (`HAZEL_LICENCE=1`, or `FORCE_PIN_CHANGE=1`); the demo and the dev server are unchanged. | fixed |
| D8 | The installer build was leaving out `server/node_modules`. | The installed app would crash on start. | Fixed in `desktop/package.json`, and checked: the packaged server starts (again checked 16 Nov after the size trim). | fixed |
| D9 | The installer was large (118 MB, about 290 MB installed). | Slow download on weak internet. | **Done 16 Nov:** 94 MB now (-20%): English-only Electron languages, maximum compression, no type files / source maps / READMEs in the server, no other-system sharp files. Updates download only the changed parts (differential, `.blockmap`). Most of the rest is Electron itself and can't shrink. | fixed |
| D10 | An installer built on Linux carries Linux image libraries (`sharp`). **This matters more than first thought:** the bot sends the menu pictures through sharp, so with the wrong one, menu pictures fail. | Menu pictures to customers don't send. | **Fixed:** `npm run dist:win` refuses to build off Windows (a test build needs `ALLOW_CROSS_BUILD=1`); the GitHub build runs only on a Windows machine and checks that sharp really works there before packaging; foreign sharp files are never packed. | fixed |

## App updates

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| U1 | The real install step (electron-updater swapping the app) is untested: it needs a published GitHub release. Everything around it is tested (status, Update now, test clients, release to everyone, backup before update). | An update could fail to install on some PC. | Before the first real client: publish 1.0.1, install it on your own PC as a test client, check it updates and keeps data. | open |
| U2 | There's no one-click "go back to the old version". | A bad update stays until the next one. | Test clients first (built in), the local copy in data folder → backups, and the old installer on GitHub releases to reinstall. | open |

## Licence / membership

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| L1 | (Was: no contact with the cloud for 3 days = warning, 7 = lock.) | — | **Changed 15 Nov:** internet never matters now. Only an unpaid membership stops anything: the bot after 3 days, the POS after 7 (days adjustable per client, Unpaid page). | fixed |
| L2 | Unpaid rule: after the paid-until date the WhatsApp bot stops after 3 days and new orders after 7. Paying open bills and reports keep working. | Too strict and the client gets angry; too soft and they don't pay. | The days are set per client in the admin app (Unpaid page: +7 days, Stop now, Cancel). | decided |
| L3 | "Suspend" in the admin app locks new orders at the POS's next check (within 3 hours) and stops the WhatsApp assistant straight away. | A mis-click stops a restaurant. The admin app now asks to confirm first. | Keep it, or add a 24-hour delay. | open |
| L4 | (Was: someone technical edits `pos.db` to fake "paid".) Now: answers are signed by the cloud and checked by the POS (S10). Editing or copying them locks new orders; orders made while locked are flagged in the admin app. **Two gaps left:** (1) if the installer has no `hazel.licencePublicKey`, the POS trusts the key shown at activation, and a technical person could swap it in `pos.db`; (2) someone could patch the HazelPOS program itself. | (1) Fixed by putting the cloud's public key in `desktop/package.json` before building. (2) Needs real effort; the cloud cross-check (orders made while locked) still shows it. | Before building installers: copy `https://<cloud>/api/licence/public-key` into `hazel.licencePublicKey`. Keep `DATA_DIR/licence-key.pem` on the cloud volume (losing it = every POS needs the new public key). | open |
| L5 | Before activation, anyone on the restaurant's WiFi could open the activation screen and enter a key; and could log in with the starting PINs through the API. | Low risk: they need a valid branch key. | **Fixed:** nobody can log in until the install is activated (server side). The activation screen itself stays open: it needs a valid code. | fixed |
| L6 | The admin app has one password (`ADMIN_PASSWORD`, 12+ characters, 5 wrong tries = 15-minute lockout). The cloud's `VENDOR_API_KEY` stays on the admin server and never reaches a browser. Logins are lost when the admin app restarts. | If the admin password leaks, someone can extend or suspend every restaurant and read their setups. | A long random password. Later: separate accounts per team member with 2-step login, and a log of who did what. | open |
| L7 | A customer ordering from a table QR while the POS is locked sees "Ordering from the table is not available right now. Please ask the staff." | Customers notice something is wrong. | That's fine, or hide the QR ordering page entirely while locked. | open |

## AI through your cloud

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| A1 | Every WhatsApp reply now goes POS → your cloud → DeepSeek, an extra hop. | Replies a bit slower (depends on where Railway hosts it vs Pakistan). | Measure it. Pick a Railway region close to Pakistan (e.g. Singapore). | open |
| A2 | Your cloud is one point of failure for the WhatsApp assistant at **every** restaurant. Billing isn't affected. | If Railway is down, no restaurant's assistant replies. Messages still reach the cashier's WhatsApp inbox. | Railway uptime alerts. Optional backup: a local key per restaurant. | open |
| A3 | Your cloud's data (`cloud.db`: restaurants, paid-until dates, usage) must survive redeploys. | Without a persistent volume, a redeploy wipes all memberships: every restaurant goes to "not paid" and locks within days. | Attach a Railway volume and set `DATA_DIR` to it **before** adding real restaurants. | open |
| A4 | The daily AI limit is 3,000 calls per branch (`AI_DAILY_LIMIT`). | Too low: a busy restaurant's assistant stops in the evening. Too high: a bug can run up your DeepSeek bill. | Set it per plan. | open |
| A5 | The AI usage page shows an estimated cost in US dollars at DeepSeek's peak prices, not the exact bill. | The estimate can differ from DeepSeek's real invoice (off-peak discounts, price changes). | Check it against the DeepSeek invoice monthly. Prices can be changed with `AI_PRICES` on the cloud. | open |

## Onboarding (admin app, activation code, setup)

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| O1 | (Was: a new PC brought back the menu but not orders or PINs.) | — | **Fixed 15 Nov:** activating a new PC restores the newest cloud backup (orders, menu, staff and PINs, settings); Settings → Cloud → Restore does it by hand. | fixed |
| O2 | Staff PINs sit on your cloud in plain text until the restaurant activates. | If your cloud database leaks before activation, those PINs are exposed. | Short window and removed after activation. Could hash them, but then the POS can't receive them. | open |
| O3 | The activation code is 8 characters and works once. Wrong guesses are limited to 10 per 15 minutes per address. | Guessing a valid code is practically impossible. | Fine as it is. | open |
| O4 | The health report sends the POS's error messages to your cloud. An error message can sometimes contain an order detail or phone number. | A little customer data on your server. | Fine for support. Mention it in the client agreement. | open |
| O5 | The cloud needs the **whole repo** on Railway (the menu upload uses `server/menu-import.js`). The admin app is a second Railway service. | Deploying only the `cloud/` folder turns menu upload off (the admin app says so). | Follow the Railway steps in `cloud/README.md` and `admin/README.md`. | open |
| O6 | (Was: login token in picture addresses.) The admin app now uses a cookie only it can read, so nothing secret is in any address. | — | — | fixed |
| O7 | Changes you save in the admin app reach the POS only while it has **no orders**. | After the first order, menu changes have to be made in the POS (Menu → Items, or Import from Excel). | That's on purpose, so you never overwrite the restaurant's own changes. A "push menu update" button could come later. | open |
| A6 | Menu from photos (S7) is tested with a stand-in, not the real Groq vision model. The model name (`VISION_MODEL`, default `qwen/qwen3.8-27b`, since Llama 4 Scout was removed from Groq in Nov 2026) may change at Groq again. | The photo reader fails ("photo reader failed") or reads badly; you'd type the menu by hand as before. | Tried on a real menu (TPC) on 15 Nov 2026 with Qwen. If it fails again, set `VISION_MODEL` to Groq's current vision model. Prices it can't read are left empty and must be filled before saving. | watch |

## WhatsApp

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| W1 | WhatsApp is connected through Baileys, an unofficial WhatsApp Web client. | WhatsApp can restrict or ban a number, especially for bulk or spammy sending. Replying to customers who message first is the low-risk use. | Tell clients in writing. Longer term: the official WhatsApp Business API (paid per conversation). | open |

## Riders (R*)

| # | Risk | What happens | What to do | Status |
|---|---|---|---|---|
| R1 | A rider's phone shares its location only while the rider page is open on the screen. Android pauses a browser page's GPS about a minute after the phone is locked or another app is in front. The page keeps the screen awake while "On duty" (Wake Lock), which helps but drains the battery. | Gaps in the map and on the customer's tracking page: "Rider's location is N min old". | Tell riders to keep the page open (the page says so). A real installed app (see SUGGESTIONS R-a) tracks in the background. | open |
| R2 | The map tiles come from OpenStreetMap's free servers. Their policy allows light use with attribution, not heavy commercial use. | If HazelPOS grows to hundreds of restaurants looking at the map all day, OSM could block the tile requests and the maps go blank. The rest of the POS is unaffected. | Before that scale, switch the tile URL (client/src/RiderMap.jsx and cloud/public/track.html) to a paid tile provider (MapTiler, Mapbox, Stadia; a few dollars a month). | watch |
| R3 | Rider links and tracking links are long secrets in a URL. Anyone with a rider's link can act as that rider; anyone with a tracking link sees that one order's status and the rider's position while it is on the way. | A rider who forwards their link lets someone else accept orders in their name. | Links are shown to the owner only; "New link" kills the old one; a rider marked "not working here" loses it at once. Tracking links stop at the next day's board. | accepted |
| R4 | The rider screen and live tracking need internet on the rider's phone and at the restaurant PC, plus the cloud. Billing still works offline; dispatching from the Delivery board still works offline. | No internet = the cashier dispatches by hand, no map, no tracking link. | Nothing to fix; it is the design (CLAUDE.md: billing never needs internet). | accepted |
| R5 | Rider accounts count COD cash by "paid after dispatch". An order paid online before dispatch is not counted as cash with the rider. An order a cashier marks paid by hand while it is still out would count as "handed in" early. | A rare wrong line in Accounts → Cash collected. Fees and deliveries are unaffected. | Cashiers should use "Cash received" / "Collect" on the Delivery board, not Pay on the order. | accepted |

## Security check, 16 Nov 2026 (S*)

Found and fixed in this check (tested in two-restaurant runs: same PINs, same rider and order numbers, one cloud):

| # | What was wrong | Fix | Status |
|---|---|---|---|
| S1 | On Railway the cloud saw every visitor as one address (the proxy), so 8 wrong owner passwords or 10 wrong activation codes from anyone locked out everyone. | `trust proxy` on the cloud: limits count per real visitor. | fixed |
| S2 | In the public demo any visitor could change the Owner / Cashier / Kitchen / Rider PINs and break the demo for everyone until a restart. | PIN changes are ignored in demo mode. | fixed |
| S3 | A customer's tracking link kept giving the rider's position after the order was delivered (until the next day). | Position is given only while that order is on the way. | fixed |
| S4 | The secret in a rider or tracking link was sent to the map-tile servers as the page's referrer, and the page could be cached or framed. | `Referrer-Policy: no-referrer`, `no-store`, no framing on both pages. | fixed |
| S5 | The cloud rewrote each branch's delivery board every 8 seconds even when nothing changed, and never deleted old rider actions. Slow with hundreds of branches. | Unchanged boards are skipped; old actions are pruned; the cloud database runs in WAL mode. | fixed |
| S6 | No limit on trying wrong rider / tracking links. (Guessing a 128-bit link is hopeless, but a script could hammer the database.) | 30 wrong links in 10 minutes from one visitor = blocked for the rest of the 10 minutes. | fixed |
| S7 | A rider name with HTML in it was shown unescaped in the map tooltip (only the owner can set names). | Escaped. | fixed |

Still open, by design or for later:

| # | Risk | What to do | Status |
|---|---|---|---|
| S8 | A short number-only PIN (like 1234) can be guessed by someone on the restaurant's Wi-Fi: 5 wrong tries lock that device out for 5 minutes, so it takes days, but it is not impossible. | Since 16 Nov 2026 a PIN can be 4 to 12 letters or numbers (typed on the phone's or PC's own keyboard). Tell owners to use a longer PIN with letters for the Owner login, e.g. `ali2026`. A rider PIN only opens the rider screen. | reduced |
| S9 | The cloud is one SQLite file on one Railway volume. Fine for hundreds of branches; at thousands of busy branches it needs Postgres or several cloud instances. | Watch the Grafana dashboard (response times); plan the move when you pass ~300 active branches. | watch |
| S10 | The first-activation public key is trusted on first use unless the installer carries it (RISKS L4). | Put `hazel.licencePublicKey` in `desktop/package.json` before building installers. The GitHub build now **refuses** to build without it (and without `hazel.cloudUrl`). | open: needs your cloud address and key |
| S11 | The older test scripts (licence, onboarding, updates: e2e–e2e13) lived in a temp folder that the PC's restart wiped, so they were not re-run after this check. The rider, metrics and isolation suites (e2e14–e2e17, 115 checks, in `desktop/dist/shots/`) pass. | Rewrite the lost suites into the repo (`tests/`) so they survive and can run before every release. | open |

## Security audit, 17 Nov 2026

The full list (15 holes found and fixed, tested; 5 risks that can only be accepted) is in [SECURITY-AUDIT.md](SECURITY-AUDIT.md).
The accepted ones:

| # | Risk | What to do | Status |
|---|---|---|---|
| X1 | A stolen `RELEASES_TOKEN` or hacked GitHub account = a malicious update on every PC | 2-step login on GitHub, token only for the releases repo, test clients first; later a signing certificate and a signed update list | open |
| X2 | A technical restaurant can crack the licence on its own PC | The real hold is the cloud-only services; optional offline lease | accepted |
| X3 | Suspend only reaches a PC that can reach the cloud | Same lease option | accepted |
| X4 | Backups on your volume are not encrypted at rest | Protect Railway access; privacy line in the agreement; later encrypt | open |
| X5 | Anyone on the restaurant Wi-Fi can open the login page | PIN lock-out; advise a guest Wi-Fi | accepted |
