# Spec: slice D — WhatsApp bot per restaurant, rider and tracking links, old code deleted

Builds on slices A–C. Plan: [PLAN.md](PLAN.md) §2, §7, §8 phase 1b. Checks: [acceptance-d.json](acceptance-d.json).

## 1. WhatsApp bot per restaurant
- One instance per **active** restaurant (status not `suspended`/`cancelled`) whose plan features allow WhatsApp. The default is on. Each instance is created lazily:
  - when the owner presses Connect;
  - at server start, for restaurants that already have saved credentials (`DATA_DIR/tenants/<id>/wa/auth/creds.json`). These start staggered, 2 s apart.
- Each instance gets:
  - `waStore(tenantDb)`, `waConnection(store, { dataDir: DATA_DIR/tenants/<id>/wa, ... })` and `createAssistant(...)`;
  - **the real `DatabaseSync` of that restaurant**, never the proxy and never `AsyncLocalStorage`;
  - POS hooks (`createOrder`, `getOrder`, `printKitchen`/queuePrint, `getSettings`, `deliveryStatus`) wrapped so that each call runs inside `tenancy.run(id, …)`.
- **Never read the old shared database:** `rag/src/pipeline` `ask()` and `voice-cleanup` must be given `pos` explicitly, built from `readPosDb(tenantDb, config.data)` and cached for 60 s or until the menu changes.
  - Change `readPos`'s fallback to the global `posDb` path so that it **throws** when called without `pos` in server mode (`TENANCY=1`, set by `tenancy.js`).
  - The rag CLI scripts keep working with `POS_DB`.
- **Routes are registered once.** `server/whatsapp/index.js` stops calling `app.get/post` per instance. It exports a router that looks up the current restaurant's instance from the request context (`tenancy.current()`). With no instance it returns `{state:'off'}` for status (as slice B does) and 409 "Connect WhatsApp first" for the rest.
- Remove the cloud-bot code paths: `CLOUD_ROUTES` forwarding, `cloud_mode`, `cloudCall`, `cloudRaw` and `importCloudOrder` use.
- Suspending a restaurant (slice C) stops its bot (disconnect, keep its credentials). Activating it starts the bot again.
- `WHATSAPP=off` still disables all restaurant bots (and keeps the vendor sender off).
- Memory: log each instance's start and stop. `GET /api/vendor/tenants` gains `wa_state`.

## 2. Rider links and customer tracking, served by the main server
- Rider page: `/r/<slug>/<token>`. Customer tracking page: `/track/<slug>/<token>`.
  - Move `cloud/public/rider.html` and `cloud/public/track.html` to `server/public/`, or rebuild them as small client screens; reuse their look and logic.
  - They call the main server's API with `X-Tenant: <slug>`.
- The rider token (already `rider_token`) authorises the rider routes for that rider only: board, accept, delivered, location, duty. Mirror the existing `/api/rider/*` logic and **don't duplicate the money logic**: call `dispatchOrder` and `deliverOrder`.
  - Add `ACCESS` entries.
  - The rider token must not work in another restaurant.
- The track token shows that one order's status, the rider's name and the last rider position, and nothing else. **No phone numbers, address or other orders.**
- `cloudBase()` → `BASE_URL`. `riderLink()` and `trackUrl()` now return real links. The "On the way" WhatsApp message includes the tracking link again.
- Delete `server/rider-sync.js` and the `riderSync` stand-in.

## 3. Delete the old offline/cloud code
- Delete `server/licence.js`, `server/cloud-sync.js`, `server/setup.js`, `server/restore.js`, `server/rider-sync.js` and `client/src/Activate.jsx`. Before deleting each one, grep for and remove every import and route of it.
- **Keep** `cloud/` and `desktop/` in this slice. `desktop/` becomes the Bridge app in slice E. Add a line at the top of `cloud/README.md`: "Deprecated: replaced by the online server (docs/online/PLAN.md). Kept for reference until launch."
- `demo/`: make `node demo/seed.js` and `npm run demo` work with tenancy. The demo uses the auto-created `demo` restaurant in its own `DATA_DIR`, and seed drives the API with `X-Tenant: demo`.
- Update **CLAUDE.md** so the commands and architecture sections describe the online server: DATA_DIR, control.db, tenancy, `tenant-cli`, vendor API, Bridge, the env vars and slice-era test commands. Keep it short and in the same style. **Don't remove the "Never commit" and UI rules sections.** Add `server/data/` to the never-commit list.

## Out of scope
Bridge Windows app and Railway (slice E).
