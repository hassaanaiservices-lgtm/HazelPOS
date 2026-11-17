# Security audit, 17 Nov 2026

Scope: the whole product as it is sold: the POS server on the restaurant PC, the desktop app, the vendor cloud (Railway),
the admin app, the rider and tracking pages, the public demo. Method: the source was read end to end for what a lower-trust
person can send to a higher-trust part, and every hole found was fixed and then attacked again by an automated test
(`desktop/dist/shots/e2e21.js`, 58 checks, plus the earlier suites). Nothing on the internet was probed: all tests ran
locally against throw-away databases, with a fake DeepSeek and Groq.

Who was considered an attacker: another paying restaurant; a restaurant owner trying to skip the membership or use your AI
keys; someone on the restaurant's Wi-Fi; an internet visitor of the cloud, the admin app or the demo; a member of your own
team with the lower "staff" role.

## Found and fixed

| # | Severity | Who | What was wrong | Fix | Test |
|---|---|---|---|---|---|
| SA1 | **High** | anyone on the internet | The cloud read request bodies (up to **500 MB** for backups) **before** checking the caller's key. One request could exhaust the shared server's memory and stop every restaurant's sync, AI and rider screens. | Bodies are read only after the key is known. Open pages accept 64 KB, branches 12 MB, backups 150 MB. | `e2e21` C1 |
| SA2 | **High** | your own *staff* team member | The admin app's "owners only" check for the Team page was case-sensitive, the cloud's routing was not: `/api/TEAM` skipped the check, so a staff login could create an **owner** account and then control every client. | The cloud enforces the role itself (header from the admin app), routing is case-sensitive, and the admin app only forwards plain, known-shaped addresses (no `..`, `//`, `%2f`). | `e2e21` C2 (11 address variants) |
| SA3 | **High** | a restaurant | The AI proxy forwarded the restaurant's choice of model, "thinking", size and settings. A restaurant (or anyone who got its key) could run up **your DeepSeek/Groq bill** (up to 10 MB per call, 3,000 calls a day) or use it as a free general AI. | The cloud chooses the model, switches thinking off, checks message shape, allows 300,000 characters per call, 30 M input tokens and 2 hours of voice per branch per day. | `e2e21` C3 (what the fake DeepSeek/Groq really received) |
| SA4 | Medium | someone on the restaurant's Wi-Fi before activation; a tricked owner | The activation screen accepted **any server address**: a fresh PC could be pointed at an attacker's server, which then receives its orders and backups. | An installed POS only activates on, and connects to, the cloud built into its installer. | `e2e21` licence |
| SA5 | Medium | a restaurant owner | Turning the PC clock back stretched the paid period. | The cloud's signed time is a floor for the PC clock; a clock more than 2 days behind the last cloud answer locks with a clear message ("fix the date"). One day of drift is allowed. | `e2e21` (cloud 5 days ahead = locked, 1 day = fine) |
| SA6 | Medium | a customer (WhatsApp or address text) | The desktop app passed **any link** to the system (`file:`, program links), and the POS window could navigate away. Opening such a link can start a program on the PC. | Only `https`, `http` and `tel` links leave the app; the window stays on the POS; the page is sandboxed. | `harden-test.js` on a real window |
| SA7 | Medium | any visitor of the demo; an Excel file | An `.xlsx` "zip bomb" (a 400 KB file that unpacks to 400 MB) crashed the server. The public demo accepts uploads from anyone. | Unpacked size is capped (30 MB per part, 60 MB total) with a friendly message. | `e2e21` (400 MB bomb, answered in under 5 s) |
| SA8 | Medium | someone who sees an old chat | Activation codes never expired. A code in an old WhatsApp chat could take over a branch later (and its restored backup). | Unused codes die after 14 days. | `e2e21` C4 |
| SA9 | Medium | anyone who reads your cloud database | Staff PINs you prepare in the admin app sat in plain text on the cloud and stayed valid. | They work once: every person must choose their own PIN at the first login. | `e2e21` setup PINs |
| SA10 | Low–Medium | a website the cashier visits | The POS answered cross-site browser requests (open CORS) and sent no security headers or content policy. | No CORS, `Content-Security-Policy` (scripts only from the POS itself), `nosniff`, no framing, no caching of API answers. A real browser run of 11 screens and the QR page shows 0 policy violations. | `e2e21`, `csp-check.js` |
| SA11 | Low–Medium | a customer at a table | The table-QR ordering page had no limit: anyone could flood the cashier's screen. | 5 pending orders per table, 8 per phone per 5 minutes, 40 lines per order. | `e2e21` |
| SA12 | Low–Medium | a restaurant | A branch could push unlimited orders and backups (fill your disk). | Caps per push, one backup per 2 minutes, 150 MB. | `e2e21` C5 |
| SA13 | Low | anyone | A malformed request to the cloud returned a stack trace with file paths. | JSON error without details. | `e2e21` |
| SA14 | Low | anyone | No HSTS / anti-framing / content policy on the cloud and admin app. | Added (HSTS over HTTPS). | `e2e21` |
| SA15 | Low | anyone | The POS server's web framework had two known advisories (body-parser: high, qs: moderate). Unused CORS package. | `npm audit fix` (0 left in all 5 packages), CORS package removed. | `npm audit` |

Also done: nobody can log in on a new install until it is activated; starting PINs (1234…) are replaced by the owner at the
first login (RISKS D7).

## Checked and fine

- **Tenants cannot see each other:** two restaurants with the same PINs, rider numbers and order numbers on one cloud (`e2e17`, 29 checks).
- **SQL injection:** every query with outside input is parameterised; the few built from code constants were reviewed.
- **Cross-site scripting:** the React screens escape; the plain pages (rider, tracking, owner dashboard) escape every outside value.
- **Secrets:** none in the git history; `.env`, databases and WhatsApp logins are ignored by git.
- **Licence answers:** signed (Ed25519), bound to the branch key, checked by the POS; editing them locks the POS.
- **Branch keys and rider links:** 192-bit and 128-bit random; wrong guesses are limited.

## What cannot be fixed in the app (decide and live with it)

| # | Risk | Why | What to do |
|---|---|---|---|
| X1 | **A stolen `RELEASES_TOKEN` or a hacked GitHub account = a malicious update on every restaurant's PC.** The biggest risk of the whole business. | Updates are checked only against the same GitHub release. Without a signing certificate the PC cannot tell a fake from a real one. | Protect the GitHub account (2-step login, one person). Keep the token limited to the releases repo. Release to test clients first (built in). Next steps: a code-signing certificate and a signed update list (SUGGESTIONS U3). |
| X2 | A technical restaurant can crack the licence on its own PC (change the program, run the server without the licence switch, freeze the clock offline). | The program sits on their disk. No offline licence is unbreakable. | The real hold is what only your cloud can give: the WhatsApp assistant's AI, cloud backup, the owner's dashboard, rider tracking and updates. An optional offline "lease" (e.g. 45 days) is in SUGGESTIONS L-a. |
| X3 | "Suspend" reaches a PC only when it can reach the cloud. A PC that blocks the cloud keeps working until its saved paid-until date + grace. | By your own rule: internet never stops billing. | Same lease option as X2. |
| X4 | Backups on your Railway volume hold each restaurant's customer data, hashed PINs and keys, not encrypted at rest. | You must be able to restore them. | Treat Railway access like a bank vault (2-step login). A privacy line in the client agreement. Encrypting backups with a key only you hold is in SUGGESTIONS. |
| X5 | Anyone on the restaurant's Wi-Fi can open the POS login page. | It has to be reachable by tablets and the kitchen. | PIN lock-out (5 tries, 5 minutes), longer PINs now allowed. Advise a separate guest Wi-Fi. |

## Not checked

The Railway and GitHub settings themselves (nothing is deployed yet), the real DeepSeek, Groq and WhatsApp services, a real
Windows install and an actual update. Re-run this audit after the first deployment and the first update.
