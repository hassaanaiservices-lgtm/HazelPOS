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
| D7 | A fresh install starts with the demo restaurant: "Pizza Venu", its menu, sample expenses, an open cash drawer, and PINs 1234/1111/2222. | The client sees someone else's menu and fake expenses in their reports. If the PINs aren't changed, anyone who knows the defaults can log in. | A "start empty" first run (no demo data), and force the PINs to be changed on first login. | open |
| D8 | The installer build was leaving out `server/node_modules`. | The installed app would crash on start. | Fixed in `desktop/package.json`, and checked: the packaged server starts. | fixed |
| D9 | The installer is about 290 MB unpacked (Electron is most of it). | Slow download on weak internet. | Normal for Electron apps. The download itself is compressed, so it's smaller. | open |

## Licence / membership

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| L1 | Offline rule: if the POS can't reach your cloud, it shows a warning after 3 days and locks new orders after 7. | A restaurant with bad internet gets locked even though it paid. | Change the days, or lock only the WhatsApp assistant (never billing). | open |
| L2 | Unpaid rule: after the paid-until date, 3 days of warnings, then new orders lock. Paying open bills and reports keep working. | Too strict and the client gets angry; too soft and they don't pay. | Change the days, or make it "warning only" and switch it off by hand. | open |
| L3 | "Suspend" in your vendor page locks new orders straight away. | A mis-click stops a restaurant mid-service. | Keep it, or add a confirm step / 24-hour delay. | open |
| L4 | The licence check runs on the restaurant's PC. Someone technical could edit the local database (`pos.db`) to fake a "paid" answer. | They use it without paying. | Have the cloud sign each answer with a private key, so the POS can tell a real answer from a fake one. Turning the PC clock back is already handled. | open |
| L5 | Before activation, anyone on the restaurant's WiFi could open the activation screen and enter a key. | Low risk: they would need a valid branch key. | Leave it as it is. | open |
| L6 | Your vendor page uses one password (the `VENDOR_PASSWORD` env var). Logins are lost when the cloud restarts. | If the password leaks, someone can extend or suspend every restaurant. | A long random password. Later: proper vendor accounts with 2-step login. | open |
| L7 | A customer ordering from a table QR while the POS is locked sees "Ordering from the table is not available right now. Please ask the staff." | Customers notice something is wrong. | That's fine, or hide the QR ordering page entirely while locked. | open |

## AI through your cloud

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| A1 | Every WhatsApp reply now goes POS → your cloud → DeepSeek, an extra hop. | Replies a bit slower (depends on where Railway hosts it vs Pakistan). | Measure it. Pick a Railway region close to Pakistan (e.g. Singapore). | open |
| A2 | Your cloud is one point of failure for the WhatsApp assistant at **every** restaurant. Billing isn't affected. | If Railway is down, no restaurant's assistant replies. Messages still reach the cashier's WhatsApp inbox. | Railway uptime alerts. Optional backup: a local key per restaurant. | open |
| A3 | Your cloud's data (`cloud.db`: restaurants, paid-until dates, usage) must survive redeploys. | Without a persistent volume, a redeploy wipes all memberships: every restaurant goes to "not paid" and locks within days. | Attach a Railway volume and set `DATA_DIR` to it **before** adding real restaurants. | open |
| A4 | The daily AI limit is 3,000 calls per branch (`AI_DAILY_LIMIT`). | Too low: a busy restaurant's assistant stops in the evening. Too high: a bug can run up your DeepSeek bill. | Set it per plan. | open |
| A5 | The vendor page shows tokens and voice minutes, not rupees. | Harder to see whether a restaurant's fee covers its AI cost. | Add an estimated cost column using the prices in `rag/config/rag.config.json`. | open |

## WhatsApp

| # | Risk | What happens if it goes wrong | Options | Status |
| --- | --- | --- | --- | --- |
| W1 | WhatsApp is connected through Baileys, an unofficial WhatsApp Web client. | WhatsApp can restrict or ban a number, especially for bulk or spammy sending. Replying to customers who message first is the low-risk use. | Tell clients in writing. Longer term: the official WhatsApp Business API (paid per conversation). | open |
