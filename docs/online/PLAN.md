# HazelPOS online: the plan

Status: reviewed by an independent Opus reviewer (verdict: approved with changes; all 8 changes are included below). Waiting for the owner's final call. 2026-11-20, branch `product-installer`.

The goal: every restaurant uses HazelPOS in the browser. We run one service on one server, and every restaurant, its staff, riders and customers use it. There is no installer, no PC acting as the server and no activation codes.

## Decisions made (2026-11-20)

| Question | Decision |
| --- | --- |
| Hosting | **Railway** (free) for now, with a **Volume** attached so data survives deploys. After the first client, move to a **Hostinger KVM VPS** (e.g. KVM 2, about $7–13 a month). Hostinger's web or cloud hosting can't run this. |
| Who pays for hosting | We do. It's included in the monthly fee. Clients never see hosting. |
| Restaurant address | **One HazelPOS site with a "Sign in" button.** The owner's account decides which restaurant they see. A till or tablet is set up once ("Use this device as a till") and remembers its restaurant (§3). |
| Domain | We buy **one** domain for HazelPOS later. Moving from Railway to Hostinger only changes where it points. A restaurant's **own domain** is an optional paid extra later, for its customer ordering page only. |
| Clients today | None. **Online-only from the start.** No migration of existing clients. |
| New restaurants | **We create them from the admin app** and send the owner a link. Self-signup comes later. |
| Printers | Most will use thermal printers. We build **HazelPOS Bridge** (see §6). |
| Internet down | **Online-only at launch**, with a clear "No internet" banner. Restaurants keep mobile data as a backup. Offline cash orders come after launch. |
| Monthly fee | **Manual first.** An invoice goes out on WhatsApp, the restaurant pays by bank transfer, JazzCash or Easypaisa, and we press "Mark paid". A gateway (Safepay or PayFast) comes later. |
| Customers paying online | **Not at launch.** Cash or pay at the counter, as now. |

---

## 1. How the big POS companies do it

Toast, Square, Foodics, Loyverse and Petpooja all have three parts:

| Part | Who uses it | What it does |
| --- | --- | --- |
| **Control plane** (our back office, `admin/`) | Us | Restaurants, plans, invoices, suspending, support log-in, feature switches, system health |
| **Tenant app** (the POS) | Owner, cashier, kitchen, rider | Everything one restaurant does |
| **Public pages** | The restaurant's customers | QR table ordering, menu, order tracking, WhatsApp |

**Keeping restaurants apart: one SQLite file per branch.** We considered three options: shared tables with a `tenant_id` column (one forgotten filter leaks data), one schema per restaurant, and one database per restaurant. We chose the last. `server/index.js` is already written for one restaurant and one database, so all the money logic and its ~280 queries stay unchanged. Data can't leak between restaurants by accident, and backing up, exporting or deleting one restaurant means handling one file.

```
DATA_DIR/tenants/<branch-id>/pos.db    ← that branch's whole POS (today's schema)
DATA_DIR/tenants/<branch-id>/wa/       ← its WhatsApp session and media
DATA_DIR/control.db                    ← restaurants, owners, devices, invoices (grows out of today's cloud.db)
```

---

## 2. How the server finds the right restaurant

```
request ──► tenant resolver ──► control.db: which branch? is it active?
                 │                   (from the subdomain, or from the paired device's key)
                 ▼
          per-request db  ──► tenants/<id>/pos.db   (AsyncLocalStorage, cache of open files)
```

- `const db = new DatabaseSync(...)` becomes an object that returns **the current request's tenant database** through `AsyncLocalStorage`. The existing `db.prepare(...)` calls inside route handlers don't change. If no tenant is set, it **throws**, so code can never silently use the wrong restaurant.
- **Setup moves out of the file load.** Today the schema, migrations, triggers, seeds and some cached statements run when `index.js` is first loaded (index.js:16–451, e.g. `updateDetails` at :303). They move into `initTenant(db)`, which runs when a restaurant's database is opened. A cached `db.prepare` at module level would stay tied to the first restaurant, so the CI check bans them.
- **How the server knows which restaurant (every kind of request):**
  - Signed-in owner or staff: every request carries a **device or session header that names the restaurant**. The server opens that restaurant's database and checks the token inside it.
  - Public links (QR table ordering, rider links, tracking pages): the restaurant is in the link, e.g. `/t/<restaurant>/<token>`.
  - Inbound WhatsApp: each restaurant has its own bot, so it already knows.
  - Later, with a domain, the subdomain can also identify the restaurant.
- **Side modules are built once per restaurant, not once for the server.** WhatsApp (connection, store, assistant), fiscal, stock alerts and menu import keep state and timers in closures (e.g. whatsapp/connection.js:50–53, whatsapp/assistant.js:39–42, fiscal.js:54, stock-alert.js:51). Each restaurant gets its own instance and is handed **its real database**, not the proxy. That way WhatsApp socket events never rely on `AsyncLocalStorage`.
- **In-memory state becomes per restaurant:** `loginFails`, `recentErrors`, `waCloudMode`, `pinOutbox`, `lastWaStatus` and any other module-level `Map`, `Set` or `let`. Server-wide timers loop over the restaurants and run each one inside `tenant.run(id, fn)`. A CI grep check fails the build on new module-level `Map`, `Set`, `let` or `db.prepare` in `server/`, unless a comment says why it may be shared.
- **Cache of open databases:** a handle is only closed when nothing is using it (reference count). A restaurant with WhatsApp or timers running is never closed.

---

## 3. Who logs in, and how

This follows the Square, Toast and Foodics pattern: **the owner signs in once on each device, and after that staff only enter their PIN.**

1. **We create the restaurant** in the admin panel (name and owner phone). The owner gets a WhatsApp message: "Welcome to HazelPOS. Set your password: [link]".
2. **Owner sign-in** on the HazelPOS site uses phone number and password. On a new device the owner also enters a 6-digit WhatsApp code. "Forgot password?" sends a reset code on WhatsApp. An owner with several branches gets **"Choose a restaurant"** and can switch at any time.
3. **Setting up a till:** the owner signs in on the shop tablet and presses **"Use this device as a till"**. The tablet gets a long-lived device key tied to that restaurant, and the owner's session on it ends.
4. **Staff each day:** the till shows "Karachi Grill · Till 1" with staff names. Staff tap their name and enter their PIN. **PINs only work on that restaurant's tills**, so nobody on the internet can try PINs. The owner can remove a lost tablet in one click.
5. **Riders:** a link on WhatsApp, as today. **Customers:** QR, menu and tracking links, with no sign-in.
6. **Us (admin panel):** email, password and a 2FA code. **"Open as support"** is time-limited and written to that restaurant's history.

Security details:
- Set Express `trust proxy`. Behind Railway every request otherwise looks like it came from one IP, and one attacker could lock out everyone.
- PIN lockouts are keyed by **restaurant and device**, never by IP alone.
- Password and WhatsApp-code attempts are rate-limited per phone number and per IP.

---

## 4. Our admin app (control plane)

Restaurant lifecycle:

```
created by us → trial (14 days) → active ⇄ past_due (7-day grace) → suspended → cancelled → data deleted after 90 days
```

- **Create restaurant:** name, code, owner phone. The new `pos.db` is created from a template with a starter menu, and the owner gets a WhatsApp message with their link and first-login steps.
- **Suspended:** works like today's licence lock. Open bills can be paid and reports still work, but **new orders are blocked**.
- **Plans and features:** each restaurant stores a `plan` and a `features` JSON (WhatsApp bot, riders, AI limit, number of branches).
- **Invoices:** generated monthly and sent on WhatsApp. A **Mark paid** button records the method and reference and who pressed it.
- **Restaurant list:** status, last active, orders today, errors, WhatsApp connected or not, invoice status.
- **Export:** the owner can download their own data (`pos.db` plus CSVs) at any time.

---

## 5. Payments

- **Restaurants paying us:** manual at launch (§ decisions). Later, a Safepay or PayFast link on each invoice, with a **signed webhook** that marks it paid and processes each payment ID only once.
- **Customers paying restaurants:** later. Each restaurant connects **its own** merchant account and the money goes straight to it. **We never hold customers' money.** If we collected it and paid it out, we'd be a payment aggregator, which needs State Bank of Pakistan approval.

---

## 6. Printers, internet and running the server

| Problem | Our approach |
| --- | --- |
| **Printers and the cash drawer are on the shop's Wi-Fi.** A cloud server can't reach them. | **HazelPOS Bridge:** `desktop/` shrinks to a tray app on one PC or laptop in the shop. It is set up like a till, keeps one **outbound** connection to our server (so the shop's router needs no setup) and sends print jobs to the existing `printer.js`. It also opens the cash drawer. Jobs wait in a queue on the server and print when the Bridge reconnects. A browser **Print** button remains as a fallback when there's no Bridge. **The server itself never prints.** Today `printer.js` (~line 118) can write to a file path or connect to any address set in settings. On a shared server, one restaurant could use that to overwrite another's data or reach internal addresses. Online, **only the Bridge** runs `printer.js`. |
| **Internet drops** | At launch: a clear "No internet — orders can't be saved" banner, with mobile data as the backup. After launch: offline cash orders, queued on the device and synced later. |
| **Server location** | Railway now. Then a Hostinger VPS in the region closest to Pakistan that they offer. Cloudflare in front once we have a domain. |
| **Data on Railway** | We **must attach a Volume** and set `DATA_DIR` to it. Without one, every deploy deletes all restaurants' data. |
| **Backups** | Every hour, each `pos.db` is copied with node:sqlite's **async `backup()`** (not `VACUUM INTO`, which would freeze the server for every restaurant while it runs). The jobs are spread across the hour, and copies are uploaded to object storage (Backblaze B2 or Cloudflare R2, a few dollars a month) and kept 30 days. A restore test every month. |
| **Deploys cause a short outage** | A server with a Volume runs as **one copy**, so each deploy means about 30–60 seconds of downtime, and every restaurant's WhatsApp reconnects. We deploy outside lunch and dinner hours (avoid 12–3 pm and 7–11 pm PKT), use a staging service, keep a one-command rollback and send errors to Sentry tagged with the restaurant. |
| **One slow report slows everyone** | SQLite calls block the single Node process. Heavy reports get limits and indexes. If a report gets slow, it moves to a worker thread. |
| **FBR / PRA** | `fiscal.js` already calls their APIs and runs as-is from the server, using each restaurant's own credentials. |
| **One restaurant overloading the server** | Rate limits per restaurant, plus the existing AI limits. **Capacity must be measured, not assumed:** each WhatsApp connection uses tens of MB, so before choosing the Hostinger plan we load-test 20 restaurants with WhatsApp on. |

---

## 7. What we delete

There are no clients on the offline version, so we can delete these without keeping a fallback:

- `server/licence.js`, activation codes and `client/src/Activate.jsx`. Replaced by the restaurant's status in `control.db`.
- `server/cloud-sync.js`, `server/restore.js`'s cloud path, and the `c_*` copy tables. The owner dashboard reads the tenant databases directly.
- `server/rider-sync.js` and the rider relay through the cloud.
- WhatsApp switching between the PC and the cloud (`waCloudMode`, `CLOUD_ROUTES`, the 20-second order pickup, the wa-status push). There is one bot host per restaurant on the server, reusing `cloud/wa-host.js`'s folder-per-branch design.
- `pin_vault` / `pin_resets` relay. Owners reset PINs directly.
- The Electron installer and auto-update. Only the Bridge remains.
- `DEMO=1` mode becomes a demo restaurant that is reset every night.

---

## 8. Phases

**Phase 1a: many restaurants, safely apart, with sign-in (≈2–3 weeks)**
1. `control.db`: `tenants`, `owners`, `owner_tenants`, `devices`.
2. Move setup into `initTenant(db)`. Add the tenant resolver, the per-request `db` (which throws with no tenant) and the reference-counted cache of open files.
3. Move in-memory state to per restaurant, make timers loop over restaurants, add the CI grep check, and set `trust proxy`.
4. Sign-in: owner phone and password with a WhatsApp code, the restaurant picker, "Use this device as a till", and staff PIN on the till.
5. Public links carry the restaurant (`/t/<restaurant>/<token>`, rider and tracking links).
6. Railway: Volume, `DATA_DIR`, staging, hourly async backups, Sentry.
7. **Minimal Bridge:** a print queue on the server, and the Bridge prints receipts and kitchen tickets. Server-side printing is turned off.

**Acceptance for 1a:** two restaurants run on one server. A token, device key or PIN from one never works on the other, and each sees only its own orders, menu and reports. Kitchen tickets print through the Bridge. A redeploy keeps all data.

**Phase 1b: WhatsApp and cleanup (≈1–2 weeks)**
1. WhatsApp bot, store and assistant: one instance per restaurant, each with its own database.
2. Fiscal and stock alerts: one instance per restaurant.
3. Delete the code listed in §7.
4. Load test: 20 restaurants with WhatsApp on. This decides the Hostinger plan.

**Phase 2: running it as a business (≈2–3 weeks)**
1. Admin panel: create restaurant (sends the WhatsApp welcome), lifecycle states, plans and features, "Open as support", export.
2. Monthly invoices on WhatsApp, Mark paid, grace period, then suspend.
3. The full Bridge: cash drawer, several printers, status shown in the POS.
4. Buy the domain and put Cloudflare in front. Move to the Hostinger VPS when the first client signs.

**Phase 3: later**
Payment gateway links on invoices, customer online payments, offline cash orders, self-signup with a trial, shared menu across a chain's branches, custom domains for customer ordering pages.
