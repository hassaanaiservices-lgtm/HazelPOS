# Progress: slice A (many restaurants on one server, with sign-in)

Builder notes. Spec: [spec.md](spec.md), checks: [acceptance.json](acceptance.json).

## Start it
```bash
export PATH=/home/hassaan/.local/lib/nodejs/node-v22.17.1-linux-x64/bin:$PATH
npm --prefix client run build                       # the server serves client/dist
export DATA_DIR=/path/to/scratch                     # default is server/data/ (in .gitignore)
WHATSAPP=off PORT=4600 node server/index.js          # add OTP_OFF=1 to skip the sign-in code (development only)
```
Empty `DATA_DIR` and not `NODE_ENV=production`: the server prints the command that creates the first restaurant.
The sign-in code is printed on the server console as `OTP for <phone>: <code>`.

## Create test restaurants (same DATA_DIR; can run while the server runs)
```bash
node server/tenant-cli.js create --slug karachi-grill --name "Karachi Grill" --owner-phone 03001111111 --owner-name Ali --password grill-pass-1
node server/tenant-cli.js create --slug lahore-bbq --name "Lahore BBQ" --owner-phone 03002222222 --owner-name Bilal --password bbq-pass-2
node server/tenant-cli.js link --slug lahore-bbq --owner-phone 03001111111      # second restaurant for one owner (picker)
node server/tenant-cli.js add-staff --slug karachi-grill --name Sara --role cashier --pin 4821
node server/tenant-cli.js list | suspend <slug> | activate <slug>
```
`create` prints the owner's random PIN (the owner's PIN on tills). Remember to set `DATA_DIR` for the CLI too, or it makes `server/data/`.

## Done, by spec section
1. **Folders and control.db**: `server/tenancy.js` (tenants, owners, owner_tenants, owner_sessions, owner_devices, otps, plus `device_index`).
2. **Tenant context**: `tenancy.db` Proxy (throws `No restaurant selected`), `run`, `open`, `forEach`, `createTenant`, `backupAll(dir)` (uses `sqlite.backup`).
3. **initTenant**: moved to `server/tenant-init.js` (schema, ALTERs, triggers, seeds, `devices` table, fiscal columns, menu_images, QR tokens). No default users (only with `DEMO=1`). No `db.prepare/exec` at module level in index.js.
4. **Removed wiring**: cloud-sync, rider-sync, setup, restore, licence, pin outbox, pin-reset poll, waCloudMode loops, updates and `/internal`. Suspended = `tenants.status` (402 with the spec message). `fiscal.js` and `stock-alert.js` no longer start timers (they expose `tick`); `index.js` runs them through `tenancy.forEach`. WhatsApp is not loaded: `/api/whatsapp/*` returns 503.
5. **Resolver**: `X-Device` then `X-Tenant`; `no_tenant` 400, 404 unknown slug, 401 `device_revoked`; `trust proxy`; runs `next()` inside `tenancy.run`. The audit `finish` callback re-enters the context.
6. **Sign-in API**: `server/auth.js` (`/api/auth/owner/login|otp|enter|logout`, rate limits per phone and IP, OTP expiry 10 min / 5 tries). `/api/devices` (+ revoke), `GET /api/till`, `POST /api/login {user_id, pin}` needing a device, lockout keyed `${tenant}:${device}`.
7. **tenant-cli.js**: create, list, suspend, activate (plus link, add-staff).
8. **Client**: `lib.js` headers + guarded storage; `main.jsx` screen choice; `SignIn.jsx`; `TillLock.jsx` (reuses `Login.jsx`'s PIN box); Settings -> Devices (replaces the "HazelPOS account" tab); `/t/<slug>/<token>`; QR sheet links carry the slug.
9. `/t/:slug/:token` serves the client page; `server/data/` in .gitignore.

## Smoke tests I ran (curl, DATA_DIR in scratch, port 4600)
T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-11, T-12 (API side), T-18 (restart + `backupAll`) pass. Client builds, lint has 0 errors (warnings only). The sign-in screen renders in headless Chromium. Browser flows (T-13 to T-16) not run by me.

## Known gaps and shortcuts
- `shortcut:` every restaurant database stays open (no eviction) (tenancy.js); OTP only printed to the console (auth.js); `riderSync` is an empty stand-in and `cloudBase()` returns null, so rider phone links and tracking links are gone until phase 1b.
- `printer.js` still runs on the server (writes to file paths / connects to addresses from settings). That is unsafe on a shared server; slice B (Bridge) must remove it.
- `POST /api/users` can now create staff (needed so a restaurant gets cashier/kitchen logins); there is no "Add staff" button in the Staff screen yet, use `tenant-cli add-staff`. Deleting users is still refused.
- DEMO=1 uses an auto-created tenant `demo` and the old PIN-only login. `demo/seed.js`, `demo/start.js` and `POS_DB` were not adapted.
- Unused files left on disk as the spec says: cloud-sync.js, rider-sync.js, setup.js, restore.js, licence.js, whatsapp/. `Activate.jsx` is no longer shown.
- Staff list on the lock screen shows admin, cashier and kitchen only; riders cannot log in on a till yet.
- Forgot password shows "Ask HazelPOS support to reset it." No password change screen.

## Repair round 1
- Every button in `.login-card` is at least `--touch` (44px) tall (App.css, new `--touch` token).
- No tenant routes before a restaurant is known: main.jsx asks `GET /api/health` (now returns `demo`) instead of `/api/settings`. The `/api/update` poll was removed from App.jsx.
- Sign-in and lock screens follow the device's colour scheme when no theme is saved (`data-theme="auto"` set in main.jsx).
- The sign-in code is bound to the device that asked for it (`otps.device_hash`).
- `TRUST_PROXY` env (hops, default 0 = off). **Railway sets `TRUST_PROXY=1`.** Without it X-Forwarded-For is ignored by the rate limits.
- Code sends: 3 per phone and 20 per IP per 15 minutes.

## Slice B: printer Bridge
Run the server as before; for tests `PRINT_ACK_MS=1000` shortens the 60 s unconfirmed-job wait.
- **Server** (`server/index.js`, `server/tenant-init.js`): `print_jobs` table, `devices.kind` ('till'|'bridge'), `queuePrint`/`maintainJobs` (re-queue after `PRINT_ACK_MS`, 3 tries, 30-minute staleness), `/api/bridge/ping|jobs|jobs/:id/done`, `/api/print/status`, `/api/print/jobs/:id/retry`. `grep -n "printer.send" server/index.js` finds nothing. A Bridge key is refused everywhere except `/api/bridge/*`, a till key is refused there (403 `wrong_device_kind`). `receipt_printer`/`kitchen_printer` settings are gone.
- Receipts after payment and kitchen tickets are queued only when the restaurant has a Bridge device (`settings.printing`); otherwise the browser Print button is used.
- **Bridge**: `bridge/index.js` (`--config`, `--check`), `bridge/README.md`. Reuses `server/printer.js` `send`; target must be `host:port` or a local device path, else "Not a printer address". Backoff 2 s to 30 s.
- **Client**: offline banner (30 s check), Settings -> Printers (status, Set up printer helper with key shown once + copy, failed tickets with Reprint), toast "Sent to printer". Theme now defaults to `auto` (Auto/Dark/Light); sidebar buttons use `--touch`.
- Smoke tests run: B-01, B-02, B-03, B-04, B-05, B-07, B-08 (fake TCP printers, curl). Not run: B-06 wait of 60 s, B-09, B-10.
- Shortcut: a retried job keeps its failed row (hidden via `retried=1`); no cleanup of old jobs yet.

## Repair round (slice B)
- D-1: a long poll that was abandoned claims nothing (`closed` is checked before claiming); `last_seen` moves only while a poll is open (every 10 s).
- D-2: retry is atomic (`retried=0` in the UPDATE); the second call answers 409 "Already reprinted".
- D-3: `GET /api/whatsapp/status` answers 200 `{state:'off'}`; the WhatsApp nav item is hidden when off. Other WhatsApp routes stay 503.
- D-4: tabs, sidebar theme switch, Help and Sign out are at least `--touch`; `capitalize` removed from tabs.
- `/api/print/receipt|kitchen|test` answer 409 `no_bridge` when the restaurant has no Bridge device (not re-tested on a bridge-less restaurant: both test restaurants had one).

## Final repair round (slice B) and CURRENT STATE for the next builder
- Delivery "Print bill" checks `settings.printing` first and uses the browser print dialog when there is no printer helper (no failing request). The other print call sites: Receipt button (already checks `s.printing`), Settings -> Printers (needs a Bridge by design), the status poll (no error).
- App.css: every button, including `.sm` variants, has `min-height: var(--touch)` (44px) at the end of the file. Orders tabs use a label map (Open, Paid, Refunded, Cancelled).

### Files
- Server: `server/index.js` (routes, resolver, print queue, bridge routes, devices), `tenancy.js` (control.db, db Proxy, run/forEach/createTenant/backupAll), `tenant-init.js` (schema, migrations, seeds), `auth.js` (owner sign-in, OTP, limits), `tenant-cli.js`, `fiscal.js`/`stock-alert.js` (expose `tick`, timers run in index.js through `tenancy.forEach`), `printer.js` (byte builders plus `send`, used only by the Bridge).
- Bridge: `bridge/index.js`, `bridge/README.md`. Client: `main.jsx` (screen choice), `SignIn.jsx`, `TillLock.jsx`, `lib.js` (headers, `lsGet/lsSet/lsDel`), `Admin.jsx` (Printers and Devices tabs), `App.jsx` (offline banner).
- Old modules left on disk, unused: cloud-sync.js, rider-sync.js, setup.js, restore.js, licence.js, whatsapp/, client Activate.jsx.

### Environment variables
`DATA_DIR` (control.db + tenants/<id>/pos.db), `PORT`, `WHATSAPP=off`, `OTP_OFF=1` (dev: no sign-in code), `TRUST_PROXY=<hops>` (Railway: 1), `PRINT_ACK_MS` (default 60000), `DEMO=1` (auto-created `demo` restaurant, PIN-only login), `NODE_ENV=production` (hides the "create first restaurant" hint).

### Start and test helpers
```
export PATH=/home/hassaan/.local/lib/nodejs/node-v22.17.1-linux-x64/bin:$PATH
npm --prefix client run build
DATA_DIR=<scratch> OTP_OFF=1 WHATSAPP=off PORT=4600 node server/index.js
DATA_DIR=<scratch> node server/tenant-cli.js create|link|add-staff|list|suspend|activate   (see "Create test restaurants")
node bridge/index.js --config <config.json> [--check]
```
Test printers: a TCP server on 127.0.0.1:9101/9102 that appends received bytes to a file. Sign-in codes are printed on the server console. Never use server/pos.db.

### Known gaps
WhatsApp per restaurant (routes answer 503, status route answers `{state:'off'}`); rider phone pages and tracking links; DEMO assets (`demo/seed.js`, `POS_DB`) not adapted; no "Add staff" screen (use `add-staff` CLI or `POST /api/users`); no job cleanup for old print jobs; OTP only printed to console; all tenant DBs kept open; B-06, B-09 not run by the builder; riders cannot log in on a till; browser Print of the Delivery list prints the whole page (no bill view there).

## Slice C: onboarding without touching a server (spec-c.md)
### Start server + admin together
```
export PATH=/home/hassaan/.local/lib/nodejs/node-v22.17.1-linux-x64/bin:$PATH
npm --prefix client run build && npm --prefix admin run build
export DATA_DIR=<scratch> VENDOR_API_KEY=<32+ chars> BASE_URL=http://localhost:4600 PAY_DETAILS="JazzCash 0300-0000000"
WHATSAPP=off PORT=4600 node server/index.js &
SERVER_URL=http://localhost:4600 ADMIN_PASSWORD=<12+ chars> VENDOR_API_KEY=<same key> PORT=4601 node admin/server.js &
```
### New environment variables
`VENDOR_API_KEY` (server and admin: 32+ chars; unset or shorter -> every `/api/vendor/*` answers 503), `BASE_URL` (builds welcome/reset links, default `http://localhost:<PORT>`), `PAY_DETAILS` (text in the invoice message), `SERVER_URL` (admin: main server address; `CLOUD_URL` still read as a fallback), `ADMIN_PASSWORD` (admin login, 12+ chars).
### What was built
- `server/vendor-wa.js`: HazelPOS's own WhatsApp number (`DATA_DIR/vendor-wa/`, reuses `whatsapp/connection.js`; `hooks.allowWhenOff` lets an explicit "Link number" work under `WHATSAPP=off`, but it never auto-connects then). `sendText(phone, text)` logs `VENDOR-WA (not connected) to 03xx: ...` when not linked. 1 message per second when linked. `sendOtp` uses it.
- `server/auth.js`: `owner_links` (welcome 7 days, reset 1 hour, single use, hashed), `POST /api/auth/owner/forgot` (always `{ok:true}`; 3 per phone and 20 per IP per hour), `GET|POST /api/auth/owner/link/:token`. Client: `OwnerLink.jsx` (`/welcome/<token>`, `/reset/<token>`), Forgot password in `SignIn.jsx`.
- `server/vendor.js` mounted before the tenant resolver: tenants (create/update/resend-welcome/owner-reset; extra editable `trial_ends`, `paid_until`), invoices (`generate {month, due_date?}`, `paid`, `void`), `lifecycle/run {today?}` (also every 6 h), `wa`, `wa/link`, `wa/logout`, `audit`. Control.db: `tenants.trial_ends/paid_until/monthly_fee`, `invoices`, `vendor_audit`, `owner_links`. Lifecycle: trial ended without a paid invoice or an overdue open invoice -> `past_due`; open invoice more than 7 days overdue -> `suspended`; marking paid -> `active` when nothing else is overdue. `GET /api/billing` (owner) feeds the past_due banner in `App.jsx`.
- Staff & PINs (Settings): add, edit, remove (`POST /api/users/:id/delete`: not yourself, not an owner login, not the last admin; sessions deleted). `GET /api/users` has `last_login`. Duplicate PIN -> "Someone here already uses that PIN".
- `admin/`: points at `SERVER_URL`; password-only login (Team page hidden, `shortcut:` in App.jsx); pages Restaurants, Restaurant detail, Unpaid (also "Create invoices"), Settings (HazelPOS WhatsApp QR), Activity. Branch/Client/Clients/Usage/Updates deleted; `Team.jsx` stays but is not imported.
- `client/src/Bill.jsx`: one bill component. `printOrder(order, settings)` renders `#print-bill` (hidden on screen; `@media print` hides everything else; cleared on `afterprint`). Used by the receipt Print button and the delivery "Print bill" when there is no printer helper.
- CSS: `.sm` no longer forces 44px on non-buttons (pills keep their size); sidebar tightened to fit 1280x800 (scrollHeight 800, Sign out ends at y 788).
### Test helpers
Create a restaurant: `curl -H "Authorization: Bearer $VENDOR_API_KEY" -H 'content-type: application/json' -d '{"name":"X","owner_name":"A","owner_phone":"0300...","monthly_fee":5000}' :4600/api/vendor/tenants` (returns `welcome_link`, `till_pin`). To age a restaurant: `POST /api/vendor/tenants/:id {trial_ends:"2026-11-01"}`, `POST /invoices/generate {month, due_date}`, `POST /lifecycle/run`. Sign-in codes and links appear in the server log as `VENDOR-WA (not connected) ...`. A phone that already has a password gets no welcome link (use `owner-reset`).
### Known gaps
Printing a bill needs a real browser dialog (tested only by reading the DOM); lifecycle messages are sent once per change; no export, no "open as support"; vendor-wa chat history is not kept; the admin session list is in memory.

### Slice C fixes
Owner's till login (owner_tenants.user_id) can't have its role or PIN changed or be removed by anyone but the owner (own PIN change allowed; 400 "The owner's login can only be changed by the owner"). Welcome/reset use also deletes tenant `sessions` for the owner's user in every restaurant. `/owner/login` runs a dummy scrypt for unknown phones. One `payBy()` for the POS banner and lifecycle messages. Lifecycle: fee 0 trial end -> active; past_due/suspended recomputed every run (nothing overdue -> active, <=7 days -> past_due, more -> suspended; cancelled untouched); invoice generate skips tenants whose trial ends after the month. `POST /api/vendor/tenants` for an existing owner phone: 409 `owner_exists` unless `confirm_existing_owner:true` (admin UI confirms). Bill title "Bill" when unpaid, "Total" in sentence case. `GET /api/auth/owner/link/:token` answers 200 `{valid:false, reason}`. Admin breadcrumb link is 44px tall.

### Slice C fix: manual vs automatic suspension
`tenants.status_reason` ('manual' | 'billing' | 'trial'), migrated in server/vendor.js. A status set by hand in the admin panel is 'manual' and the lifecycle job never changes it. Billing and trial changes are automatic and recomputed every run. Activating by hand clears the reason. The admin detail page shows "Suspended by HazelPOS" or "Suspended: payment overdue".

## Slice D1: WhatsApp bot per restaurant (spec-d §1)
- `server/whatsapp/index.js` is now a manager: `require('./whatsapp')({ tenancy, pos })` returns `{ router, current, start, stop, startAll, invalidate, ... }`. One instance per restaurant (real `DatabaseSync` from `tenancy.open(id)`, folder `DATA_DIR/tenants/<id>/wa/`), POS hooks wrapped in `tenancy.run(id, ...)`. Routes registered once (`app.use('/api/whatsapp', waMgr.router)`): status `{state:'off'}` with no bot, 409 "Connect WhatsApp first" for the rest.
- `ask()` and voice cleanup always get `pos` from `readPosDb(tenantDb)`, cached 60 s and dropped after any staff change outside orders/whatsapp. `readPos` throws when `TENANCY=1` (set by tenancy.js).
- Suspended/cancelled or `features.whatsapp:false` -> stopped (login kept) and paused; activate restarts it (a 5 s sweep plus `tenancy.notifyStatus(id)` / `onStatusChange`). `startAll()` at boot: only restaurants with saved creds, 2 s apart. `WHATSAPP=off`: nothing starts, Connect answers 400.
- Removed: CLOUD_ROUTES, cloud_mode, cloudCall/cloudRaw, `importCloudOrder`. `GET /api/vendor/tenants` has `wa_state` (one line in vendor.js via `tenancy.hooks.waState`).
- Tested: D-01 (stubbed ask saw only own menu), D-02, D-03, D-04 (suspend -> off, activate -> QR again). QR never scanned; creds removed.
- Known: a bot stopped by suspension that was never linked returns to the QR state on activate.

## Slice D2: rider and tracking links, old code deleted, demo (spec-d.md sections 2 and 3)
- Pages: `server/public/rider.html|js`, `track.html|js` (looks and logic from `cloud/public/`, no build; Leaflet copied to `server/public/vendor/`, served under `/p/`). Routes `/r/:slug/:token`, `/track/:slug/:token` in index.js; the pages send `X-Tenant`.
- API in index.js (before "Board"): `GET /api/r/:token`, `POST /api/r/:token/accept|delivered|location|duty` (call `dispatchOrder`/`deliverOrder`, rider looked up by `rider_token` in the X-Tenant restaurant only), `GET /api/track/:token` (order id, status, rider name, last position, times; nothing else). Both have public `ACCESS` entries; wrong tokens answer 404 and are slowed after 30 tries per 10 min per IP.
- `riderLink`/`trackUrl` use `BASE_URL` (`/r/<slug>/<token>`); the On-the-way WhatsApp message gets the tracking link again. `riderPos` (memory, by restaurant and rider) replaces `riderSync`.
- Deleted: `licence.js`, `cloud-sync.js`, `setup.js`, `restore.js`, `rider-sync.js`, `client/src/Activate.jsx`, `demo/template.db`, `demo/run.db`.
- Demo: `node demo/seed.js` builds `demo/template/` (DATA_DIR with the demo restaurant, X-Tenant: demo); `npm run demo` copies it to `demo/run-data` (`DEMO_DATA_DIR`, `DEMO_PORT` override). Seed riders have no phone link (made through /employees); create riders from the Riders screen to get links.
- Tested (curl, port 4660, two restaurants): board, accept, delivered, other rider refused, other slug 404, track fields, wrong track token 404, pages served. Demo seeded and served (/, /app, PIN login). Not done: Playwright browser run of D-05/D-06/D-08 (no client build rebuild; browser pages untested visually).
- Leftovers: `server/whatsapp/assistant.js` comment mentions `licence.js` (other builder). Client `App.jsx` still reads `settings.licence` banner and `updateReady` (harmless). `RiderMap.jsx` comment mentions rider-sync.

## Slice E2: pairing code and going live (spec-e §1, §3)
- **Pairing**: control.db `bridge_pairings` (sha256 of the code, 10 minutes, single use). `POST /api/print/pairing` (admin) makes a 6-digit code; `POST /api/bridge/pair {code, name}` (no tenant header, defined before the resolver in index.js) returns `{device_key, restaurant:{slug,name}}`; wrong, expired and used codes all give the same 400; 10 tries per IP per 15 minutes then 429. Settings -> Printers shows the code with a countdown and "Show key instead" (the old key flow).
- **Boot checks**: `server/boot-checks.js` (called first in index.js) refuses to start in production for: VENDOR_API_KEY < 32, BASE_URL not https, OTP_OFF, DEMO, DATA_DIR not writable, Railway DATA_DIR outside RAILWAY_VOLUME_MOUNT_PATH; warns when TRUST_PROXY is missing on Railway.
- **Backups**: `server/backup.js` (hourly, first run 1 minute after start): `DATA_DIR/backups/<YYYY-MM-DD-HH>/` (UTC) with every `<slug>.db` plus `control.db`; keeps newest 48 plus the last folder of each of 14 days; optional S3 upload (`S3_ENDPOINT|BUCKET|KEY|SECRET`, `S3_REGION`, `@aws-sdk/client-s3` in server/package.json; no remote retention, use a bucket lifecycle rule). `node server/tenant-cli.js restore <slug> <file>` (`tenancy.restoreTenant`; keeps the old file as `pos.db.before-restore-*`; stop the server first, as a running server keeps its own open handle).
- **Deploy files**: `Dockerfile`, `.dockerignore`, `railway.json`, `admin/Dockerfile`, `admin/railway.json`, `docs/online/DEPLOY.md` (Railway steps, env tables, Hostinger + Caddy).
- **Tests (curl, port 4670)**: E-01 pair, reuse 400, expired 400, 429 from the 11th try, key works on /api/bridge/jobs and ping; E-06 each unsafe config refused, a correct one starts; E-07 480 faked hourly runs leave 60 folders (48 + 12 older daily, 14 days), restore of one restaurant changed only that one. E-05 SKIPPED: no docker or podman on this machine (Dockerfiles untested). Not browser-tested: the Printers screen (lint passes).
- **Live restore (no restart)**: `tenancy.close(id)`, `restoreTenant` is synchronous (no request runs mid-swap; the `db` proxy now looks the handle up per call so in-flight requests use the reopened file), stops/restarts that restaurant's WhatsApp bot through `tenancy.hooks.waStop/waStart` (set in index.js), keeps `pos.db.before-restore-*`. `GET /api/vendor/tenants/:id/backups`, `POST /api/vendor/tenants/:id/restore {backup}` (audited `tenant.restore`), Admin restaurant page has a Backups section with Restore (confirm). Curl-tested with the server running: other restaurant unchanged, bad folder name 400. CLI restore still works when the server is stopped.
- **Dockerfile review**: only builtins in rag/, no git deps, node:sqlite is in 22.17, sharp ships linux-x64 prebuilds; Railway Volumes are root-owned so `RAILWAY_RUN_UID=0` is documented (VPS: chown 1000). Still unbuilt here.

## Final fixes
- Lifecycle: a past_due restaurant with `status_reason='trial'` (fee > 0, trial ended, no paid invoice) stays past_due on every run until an invoice is paid or the vendor activates by hand; fee 0 or a paid invoice -> active. Billing/manual rules unchanged.
- Rider and tracking pages: light and dark tokens via `prefers-color-scheme`, 44px address link and map controls, empty count pills hidden, invalid link shows only "This link does not work any more..." (non-hex tokens get 401 from ACCESS, shown the same).
- Admin: `GET /api/vendor/owners/lookup?phone=` -> `{exists, name}`; New restaurant calls it first, so no 409 request is made.
- Leftovers: ai-route.js comment, `updateReady` banner removed from App.jsx, site/index.html points at the existing .webp images.
