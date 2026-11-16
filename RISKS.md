# Risks to review

Things found while building the installer, licence and AI proxy. We finish the steps first, then go through this list
together and decide each one.

Status: **open** = not decided yet, **decided** = we chose what to do (the choice is written next to it), **fixed** = no longer a risk.

## Desktop app (installer)

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| D1 | The server uses Node's built-in SQLite (`node:sqlite`). Does Electron's Node include it? | The app would open and the server would stop straight away. | Tested: Electron 38.8.6 (Node 22.22) runs SQLite, and the packaged server starts and serves the POS. | fixed |
| D2 | The GitHub repo may be private. | Auto-update can't read the releases, so restaurants never get updates. | A separate public repo just for the installers, or host the files on your own server. | open |
| D3 | The installer isn't code-signed. | Windows shows "unknown publisher" (SmartScreen). Some clients will think it's a virus. | Buy a code-signing certificate (yearly cost), or tell clients to click More info → Run anyway. | open |
| D4 | The WhatsApp assistant's FAQ files (`rag/data/raw/faq/`) are inside the install folder. | Every restaurant gets the same FAQ, and an update overwrites any edits. | Move the FAQ into the database, editable from Settings. | open |
| D5 | Port 4000 is fixed. | If another program on the restaurant PC uses port 4000, HazelPOS won't start. | Make the port a setting, or try the next free port. | open |
| D6 | Mac builds aren't signed with an Apple developer account. | macOS blocks the app (right-click → Open works). Auto-update on Mac needs signing. | Apple developer account ($99/year), or support Windows only at first. | open |
| D7 | A fresh install starts with the demo restaurant ("Pizza Venu", sample expenses, PINs 1234/1111/2222). | Partly fixed: when you prepare a setup in the admin app, activation replaces all of it. An install activated **without** a setup (or whose setup has no staff) still has the demo data and default PINs. | Always prepare a setup before giving the code, and force a PIN change on first login. | open |
| D8 | The installer build was leaving out `server/node_modules`. | The installed app would crash on start. | Fixed in `desktop/package.json`, and checked: the packaged server starts. | fixed |
| D9 | The installer is about 290 MB unpacked (Electron is most of it). | Slow download on weak internet. | Normal for Electron apps. The download itself is compressed, so it's smaller. | open |
| D10 | A Windows installer built on Linux (like the test one in `desktop/dist/`) carries Linux image libraries (`sharp`). The POS still starts (checked under Wine), but WhatsApp image thumbnails may not work. | Small: only thumbnails. | Use the GitHub Actions build (each OS built on its own runner) for installers you give to clients. | open |

## App updates

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| U1 | The real install step (electron-updater swapping the app) is untested: it needs a published GitHub release. Everything around it is tested (status, Update now, test clients, release to everyone, backup before update). | An update could fail to install on some PC. | Before the first real client: publish 1.0.1, install it on your own PC as a test client, check it updates and keeps data. | open |
| U2 | There's no one-click "go back to the old version". | A bad update stays until the next one. | Test clients first (built in), the local copy in data folder → backups, and the old installer on GitHub releases to reinstall. | open |

## Licence / membership

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| L1 | Offline rule: if the POS can't reach your cloud, it shows a warning after 3 days and locks new orders after 7. | A restaurant with bad internet gets locked even though it paid. | Change the days, or lock only the WhatsApp assistant (never billing). | open |
| L2 | Unpaid rule: after the paid-until date, 3 days of warnings, then new orders lock. Paying open bills and reports keep working. | Too strict and the client gets angry; too soft and they don't pay. | Change the days, or make it "warning only" and switch it off by hand. | open |
| L3 | "Suspend" in the admin app locks new orders at the POS's next check (within 3 hours) and stops the WhatsApp assistant straight away. | A mis-click stops a restaurant. The admin app now asks to confirm first. | Keep it, or add a 24-hour delay. | open |
| L4 | (Was: someone technical edits `pos.db` to fake "paid".) Now: answers are signed by the cloud and checked by the POS (S10). Editing or copying them locks new orders; orders made while locked are flagged in the admin app. **Two gaps left:** (1) if the installer has no `hazel.licencePublicKey`, the POS trusts the key shown at activation, and a technical person could swap it in `pos.db`; (2) someone could patch the HazelPOS program itself. | (1) Fixed by putting the cloud's public key in `desktop/package.json` before building. (2) Needs real effort; the cloud cross-check (orders made while locked) still shows it. | Before building installers: copy `https://<cloud>/api/licence/public-key` into `hazel.licencePublicKey`. Keep `DATA_DIR/licence-key.pem` on the cloud volume (losing it = every POS needs the new public key). | open |
| L5 | Before activation, anyone on the restaurant's WiFi could open the activation screen and enter a key. | Low risk: they would need a valid branch key. | Leave it as it is. | open |
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
| O1 | Reinstalling on a new PC (new code) brings back the menu, tables and pictures, but **not** the staff PINs (they're deleted from the cloud once the first PC has them) and **not** the orders and history. | The new PC has the default PINs 1234/1111/2222 and empty reports. | A "restore from cloud backup" step during activation (the daily backup is already on the cloud). Until then: re-enter PINs in the admin app before making the new code. | open |
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
