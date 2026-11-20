# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HazelPOS is an online restaurant POS for Pakistani restaurants: one server hosts many restaurants (tenants). Each restaurant opens it in a browser on its tills, kitchen screen and riders' phones; a small Bridge app on a PC at the restaurant prints to the thermal printer. Plan and slice notes: `docs/online/` (PLAN.md, progress.md, spec-*.md, acceptance-*.json).

## Commands

Node >= 22.13 is required because the server uses the built-in `node:sqlite`. Install dependencies with `npm --prefix server install && npm --prefix client install`.

```bash
npm --prefix client run build   # production build -> client/dist (the server serves it)
npm --prefix admin run build    # vendor admin app -> admin/dist
npm --prefix client run lint    # oxlint (react/rules-of-hooks is an error)
DATA_DIR=/tmp/hz OTP_OFF=1 WHATSAPP=off PORT=4600 node server/index.js
DATA_DIR=/tmp/hz node server/tenant-cli.js create --slug my-grill --name "My Grill" --owner-phone 0300... --owner-name Ali --password <pw>
                                # also: link, add-staff, list, suspend <slug>, activate <slug>
SERVER_URL=http://localhost:4600 ADMIN_PASSWORD=<12+ chars> VENDOR_API_KEY=<same key> PORT=4601 node admin/server.js
node bridge/index.js --config <config.json> [--check]   # the printer helper
node demo/seed.js               # build demo/template/ (a DATA_DIR with the 'demo' restaurant) by driving the real API
npm run demo                    # public demo on :4300 (needs client build + demo/template/)
```

There is no test framework: checks are scripted against a scratch server (never `server/pos.db`, never a real `DATA_DIR`). Sign-in codes and links are printed on the server console. Acceptance checks live in `docs/online/acceptance-*.json`; `rag/scripts/test-guard.js` and `test-address.js` run without API calls.

### Server env vars
- `DATA_DIR`: holds `control.db` and `tenants/<id>/pos.db` (default `server/data/`). Use a scratch folder for experiments.
- `VENDOR_API_KEY` (32+ chars; unset means every `/api/vendor/*` answers 503), `BASE_URL` (welcome, reset, rider and tracking links), `PAY_DETAILS` (text in the invoice message), `TRUST_PROXY=<hops>` (Railway: 1), `OTP_OFF=1` (dev: no sign-in code), `PRINT_ACK_MS`, `PORT`, `NODE_ENV=production`.
- `WHATSAPP=off`: no restaurant bots and no vendor sender auto-connect.
- `DEMO=1`: auto-created `demo` restaurant, role picker with no PINs; printer, fiscal and secret writes blocked.
- Admin app: `SERVER_URL` (main server), `ADMIN_PASSWORD`, `VENDOR_API_KEY`. `DEEPSEEK_API_KEY` and `GROQ_API_KEY` live in the root `.env` (see `.env.example`).

## Architecture

**server/index.js** is a single large Express file. Every request runs inside one restaurant:
- **Tenancy:** `server/tenancy.js` owns `control.db` (restaurants, owners, sessions, device index) and opens each restaurant's own `pos.db`. `db` is a proxy for the CURRENT restaurant, chosen per request by `X-Device` (a till's key) or `X-Tenant` (the slug); outside a request use `tenancy.run(id, fn)` or `tenancy.forEach`. Timers must run through those. `tenant-init.js` holds the schema: `CREATE TABLE IF NOT EXISTS`, then `ALTER TABLE ... ADD COLUMN` statements in try/catch. To add a column, append to that list; never edit existing CREATE statements. `tenant-cli.js` creates and manages restaurants from the shell.
- **Auth:** owners sign in with phone + password (+ one-time code on a new device, `server/auth.js`), then enter a restaurant; tills use a device key plus the staff PIN (scrypt hashes). Access is the `ACCESS` regex table in index.js: the first rule that matches `"METHOD /path"` wins, and **any route not listed is admin-only**. Roles: `admin`, `cashier`, `kitchen`, `rider`. A new non-admin route needs an `ACCESS` entry. Every non-GET request is written to `audit_log`, with PINs and keys stripped.
- **Vendor API:** `server/vendor.js` (`/api/vendor/*`, bearer `VENDOR_API_KEY`, no restaurant) creates restaurants, invoices, lifecycle (trial, `past_due`, `suspended`) and the vendor WhatsApp number (`vendor-wa.js`). The `admin/` app (React + its own `server.js`) is its screen.
- **API conventions:** reads are GET; every write is a POST, including deletes (`POST /api/<thing>/:id/delete`). `crud(route, table, fields)` generates save and delete routes for simple tables. Errors return `{ error }` with status 4xx. Inside `userErrors(...)`, throw a `UserError` and it becomes a 400.
- **Money logic is server-side:** `priceItem`, `recalc`, `promoAmount`, `deliveryFee`, `settle`, `payOrder`, `dispatchOrder` and `deliverOrder` decide all amounts and states. The client's `promoPreview` only mirrors `promoAmount`. Paying deducts recipe stock. `createOrder` is shared with the WhatsApp module.
- **Printing:** the server only queues print jobs; the **Bridge** (`bridge/`, uses `server/printer.js` `send`) long-polls `/api/bridge/*` with a device key (kind `bridge`) and prints over the LAN. No Bridge means `409 no_bridge`; the client falls back to the browser print dialog (`Bill.jsx`).
- **Rider and tracking pages:** plain files in `server/public/`, served at `/r/<slug>/<token>` and `/track/<slug>/<token>` and calling `/api/r/<token>/*` and `/api/track/<token>` with `X-Tenant`. The rider token only opens that rider's routes in that restaurant; tracking shows status, rider name and position only. Rider positions are kept in memory.
- **Other modules:** `fiscal.js` (PRA/FBR) and `stock-alert.js` expose `tick`, run from timers through `tenancy.forEach`; `whatsapp/` (Baileys connection, inbox, assistant, Groq speech-to-text) runs one bot per restaurant. Secrets go in the `secrets` table and are never returned by `/api/settings`. PIN rules: `pin-rules.js`.
- **Static serving:** `client/dist`. `/t/<slug>/<token>` is the customer's table-QR ordering page; `/welcome/<token>` and `/reset/<token>` are owner links. In DEMO mode `site/` is served at `/` and the POS at `/app`.

**client/** (React 19 + Vite, no router, no state library): `main.jsx` picks the screen from the path (`CustomerOrder`, `OwnerLink`, `SignIn`, `TillLock`, else `App`). `App.jsx` holds the shell; `NAV[role]` lists views per role. `lib.js` `api(url, body)`: no body is a GET, a body is a POST; it throws on errors and fires `pos-logout` on a 401. Wrap event handlers in `run(fn)` so errors show as a toast.

**rag/** is the WhatsApp assistant's knowledge base and prompts. No vector search: each restaurant's live menu and data is read from its own `pos.db` and put in the prompt (`src/context/`); without an explicit `pos` it throws in server mode. Settings: `rag/config/rag.config.json`, prompts: `rag/prompts/`. When to reply: `server/whatsapp/assistant.js`.

**desktop/** (the Bridge installer, Electron) and **cloud/** (the old multi-branch cloud, deprecated, kept for reference until launch). **site/** is the static landing page; if the domain changes, update `robots.txt`, `sitemap.xml`, `llms.txt` and the head of `index.html`; the FAQ in the JSON-LD must match the page word for word.

## UI rules (see DESIGN.md)

- Every colour and font comes from the tokens in the `:root` block of `client/src/App.css`. Don't hard-code values in components. Dark and light themes must both pass contrast.
- Never use `alert()`, `confirm()` or `prompt()`. Use `toast`, `toastError`, `confirmBox` and `promptBox` from `client/src/notify.jsx`.
- The app is touch-first: touch targets are at least 44px, and labels are sentence case, never all-caps.

## Never commit

`.env`, `server/data/`, `server/pos.db*`, `server/whatsapp/auth/`, `server/whatsapp/media/`. These hold keys, customer data and the linked WhatsApp session.
