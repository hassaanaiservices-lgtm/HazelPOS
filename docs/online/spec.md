# Spec: phase 1a, slice A — many restaurants on one server, with sign-in

Approved plan: [PLAN.md](PLAN.md). This slice covers plan §8 phase 1a items 1–6. The Bridge (item 7) is slice B, which comes next.
Pass checks: [acceptance.json](acceptance.json). Every check must pass.

## Roles in the build loop
- **Planner** wrote this file and acceptance.json. Change them only when the owner changes the plan.
- **Builder** implements and keeps `docs/online/progress.md` up to date: what's done, how to start the server, known gaps.
- **Evaluator** starts the real server and checks each acceptance item with the API (curl) and a browser (Playwright). It reports defects with the steps to reproduce, what was expected, what actually happened and the evidence.

## Environment
- Node: `export PATH=/home/hassaan/.local/lib/nodejs/node-v22.17.1-linux-x64/bin:$PATH` (Node 22.17).
- **Never read or write `server/pos.db`** or the real `cloud/data`. Every run uses `DATA_DIR=<scratch folder>`.
- Run with `WHATSAPP=off`. WhatsApp per restaurant comes in phase 1b.

## What to build

### 1. Folders and the control database
- `DATA_DIR` (default `server/data/`, which goes in .gitignore) holds `control.db` and `tenants/<id>/pos.db`.
- `control.db` tables:
  - `tenants` (id INTEGER PK, slug TEXT UNIQUE, name, status TEXT DEFAULT 'active', plan TEXT, features TEXT JSON, created_at)
  - `owners` (id, phone UNIQUE, email, name, pass_hash (scrypt), created_at)
  - `owner_tenants` (owner_id, tenant_id, user_id — the owner's `admin` row in that tenant's `users`), PK (owner_id, tenant_id)
  - `owner_sessions` (token PK, owner_id, created_at, last_seen)
  - `owner_devices` (owner_id, device_hash, trusted_at): devices that have passed the one-time code
  - `otps` (phone, code_hash, purpose, expires_at, tries)
- Slugs are lowercase `a-z0-9-`, 3–40 characters.

### 2. Tenant context (new `server/tenancy.js`)
- An `AsyncLocalStorage` holds `{ tenant, db }`.
- `tenancy.db` is a Proxy. Each property is looked up on the current context's `DatabaseSync`, with functions bound. **With no context it throws `Error('No restaurant selected')`.**
- `tenancy.run(tenantId, fn)` runs `fn` inside that restaurant's context.
- `tenancy.open(id)` opens the database file once per restaurant and keeps it open. A reference-counted cache with eviction is allowed, but for now keeping every database open is fine; leave a `shortcut:` comment saying so. Opening sets `busy_timeout` and then runs `initTenant(db)`.
- `tenancy.forEach(fn)` runs `fn` once per active restaurant, each inside its own context. Every server-wide timer uses this.

### 3. `initTenant(db)`
Everything in `server/index.js` that runs against the database when the file loads moves into `initTenant(db)`, which runs once per database when it's opened:
- `CREATE TABLE`s, the `ALTER` migration list, triggers, seeds, and cached statements such as `updateDetails` (:303).
- No `db.prepare` or `db.exec` may run at module level after this.
- New restaurants get today's seed data, except that **no default users are created**. Users come from the owner and the steps below.
- Add a `devices` table to the tenant database: (id, name, key_hash UNIQUE, created_at, last_seen, revoked_at).

### 4. Remove wiring that makes no sense online
In `server/index.js`, remove the wiring and routes for `cloud-sync`, `rider-sync`, `setup`, `restore`, `licence`, `pinOutbox`/`pushPins`/`vaultPin`, the pin-reset poll, the `waCloudMode` loops and the app-update and `/internal` routes. Leave the module files on disk; phase 1b deletes them.
- `lic.locked()` becomes **the tenant's `status` in control.db is `suspended`**. The response is the same 402 with the message "This restaurant's HazelPOS account is suspended. Please contact HazelPOS."
- `fiscal`, `stock-alert` and `menu-import` must not run database work at module load. Either create them per restaurant on first use (cached in the tenant context), or pass them `tenancy.db`, but only if their factory doesn't touch the database. Their `setInterval`s run through `tenancy.forEach`.
- The WhatsApp module is not loaded in this slice. Routes that reach it return 503 `{error:'WhatsApp is coming back soon'}`.

### 5. Finding the restaurant for each request
Middleware on `/api`, placed **before** the existing auth middleware:
- `X-Device: <key>` header: look the key up across restaurants (a `device_index` table in control.db maps sha256(key) → tenant_id), then check the hash in that tenant's `devices` table, which must not be revoked. The restaurant comes from the device.
- Otherwise `X-Tenant: <slug>` header: the restaurant comes from the slug.
- Neither header: only `/api/auth/*` and `GET /api/health` are allowed. Anything else returns 400 `{error:'Choose a restaurant first', code:'no_tenant'}`.
- Unknown slug or revoked device: 404 `{error:'Restaurant not found'}`, or 401 with code `device_revoked`.
- After that, `next()` runs inside `tenancy.run(...)`. The existing bearer-session code then works unchanged, because sessions live in the tenant's database. **A token from restaurant A sent with `X-Tenant: B` returns 401.**
- Set `app.set('trust proxy', 1)`.

### 6. Sign-in API (`/api/auth/*`, needs no tenant header)
- `POST /api/auth/owner/login {phone, password, device_id}` → checks `pass_hash`.
  - If this `device_id` (a random id the browser keeps) isn't trusted for this owner, it sends a 6-digit code and returns `{otp_required:true}`.
  - Otherwise it returns `{owner_token, restaurants:[{slug,name}]}`.
- `POST /api/auth/owner/otp {phone, code, device_id}` → on success, trusts the device and returns the same as login.
  - Codes expire after 10 minutes, and a code is invalid after 5 wrong tries.
  - **Sending:** `sendOtp(phone, code)` prints `OTP for <phone>: <code>` on the server console. Leave a `shortcut:` comment saying WhatsApp delivery comes in phase 2.
  - `OTP_OFF=1` skips the code step (for development only).
- `POST /api/auth/owner/enter {owner_token, slug}` → if the owner belongs to that restaurant, creates a normal session in the tenant's `sessions` table for `owner_tenants.user_id` and returns `{token, user, restaurant:{slug,name}}`.
- `POST /api/auth/owner/logout {owner_token}`.
- Rate limits are counted per phone and per IP:
  - 10 password tries in 15 minutes, then 429.
  - Codes: at most 3 sent per 15 minutes.
- `POST /api/devices {name}` (tenant route, role `admin`) → returns `{device_key}` once. Only its sha256 is stored, in the tenant's `devices` table and in control.db's `device_index`.
- `GET /api/devices` and `POST /api/devices/:id/revoke` (admin).
- `GET /api/till` (needs `X-Device`) → `{restaurant:{slug,name}, device:{name}, staff:[{id,name,role}]}`. Staff are the users with roles admin, cashier and kitchen. No PINs are returned.
- `POST /api/login {user_id, pin}` now **requires a valid `X-Device`**. Without one it returns 403 `{error:'This device is not set up as a till', code:'no_device'}`. `DEMO=1` keeps its current behaviour.
  - The `pin` must belong to that `user_id`.
  - Lockout: 5 wrong PINs per **tenant+device** gives a 5-minute lock. The lockout `Map` is keyed `${tenant}:${deviceId}`.

### 7. Creating a restaurant (until the admin panel does it in phase 2)
`node server/tenant-cli.js create --slug karachi-grill --name "Karachi Grill" --owner-phone 03001234567 --owner-name Ali --password <pw>`:
- Creates the tenant row and the database (seeded).
- Creates an `admin` user in that tenant with a random PIN, which it prints. That PIN is the owner's PIN on tills.
- Creates the owner if the phone is new and links the two in `owner_tenants`.

Also: `tenant-cli.js list`, `tenant-cli.js suspend <slug>` and `tenant-cli.js activate <slug>`.

### 8. Client (React, follow DESIGN.md and the UI rules in CLAUDE.md)
- `lib.js` `api()` sends `X-Device` from `localStorage.hz_device` when it's set, otherwise `X-Tenant` from `localStorage.hz_tenant`. Every storage read and write is wrapped in try/catch.
- **Startup screen choice in `main.jsx`:**
  - Path `/t/<slug>/<token>` → `CustomerOrder`, which sends `X-Tenant: <slug>`.
  - A device key is stored → the **Till lock screen**.
  - A tenant and a token are stored → `App`.
  - Otherwise → the **Sign-in** screen.
- **Sign-in screen:** phone, password, a "Sign in" button, and "Forgot password?" (shows "Ask HazelPOS support to reset it" for now). Next comes the code step when required, then **"Choose a restaurant"** when there's more than one (skipped when there's one), and then the app opens.
- **In the app, admin only:** Settings gets a **Devices** section: "Use this device as a till" (asks for a name, e.g. "Till 1", using `promptBox`), a device list, and Revoke. Using this device as a till stores the key, signs the owner out on this browser and shows the Till lock screen.
- **Till lock screen:** the restaurant name and device name at the top, staff name buttons (44px touch targets), and after tapping a name, the PIN pad. It reuses `Login.jsx`'s PIN pad where possible. A small "Owner sign-in" link shows the Sign-in screen without removing the device key.
- `Activate.jsx` is no longer shown anywhere.
- QR links that the app shows and prints become `/t/<slug>/<token>`.

### 9. Running it
- `npm run dev` works. With an empty `DATA_DIR` and `NODE_ENV` not `production`, the server prints how to create the first restaurant with `tenant-cli.js`. It does not crash.
- The server serves `client/dist`, and `/t/:slug/:token` serves the client page.
- `server/data/` is in .gitignore.

### Out of scope for slice A
Bridge and printing changes (slice B), WhatsApp per restaurant (1b), deleting module files (1b), the admin panel UI (phase 2), real WhatsApp OTP delivery (phase 2), Railway setup, Sentry and the backup upload. The backup **function** `tenancy.backupAll(dir)`, using `db.backup()` from node:sqlite (`sqlite.backup`), **is** in scope.
