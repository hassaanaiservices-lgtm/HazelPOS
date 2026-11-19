# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HazelPOS is a restaurant POS for Pakistani restaurants. One PC on the restaurant LAN runs the server. Other devices (kitchen screen, tablets, customers' phones) open it in a browser. Billing must keep working with no internet.

## Commands

Node >= 22.13 is required because the server uses the built-in `node:sqlite`. Install dependencies with `npm --prefix server install && npm --prefix client install`.

```bash
npm run dev                     # server on :4000 + Vite client on :5173 (proxies /api to :4000)
npm run server                  # server only; serves client/dist if built
npm --prefix client run build   # production build -> client/dist
npm --prefix client run lint    # oxlint (react/rules-of-hooks is an error)
npm run cloud                   # multi-branch owner dashboard on :4200 (cloud/)
node demo/seed.js               # build demo/template.db by driving the real API
npm run demo                    # public demo on :4300 (needs client build + template.db)
```

There is no test framework. Checks are standalone scripts that set the exit code:

```bash
node rag/scripts/test-guard.js      # money-amount guard, no API calls
node rag/scripts/test-address.js    # delivery-address checks, no API calls
node rag/scripts/run-eval.js        # DeepSeek eval over rag/eval/datasets/questions.jsonl (--only order-); needs .env keys
```

See [rag/README.md](rag/README.md) for the other rag scripts (export-pos, validate-data, build-chunks, show-context, check-deepseek).

### Useful server env vars
- `POS_DB=<path>`: use a different SQLite file. Use this for experiments instead of touching `server/pos.db`.
- `DEMO=1`: role picker with no PINs. Printer, fiscal, cloud and secret writes are blocked.
- `WHATSAPP=off`: never connect to WhatsApp. Set this on any second server, because two servers on one login push each other off.
- `FORCE_PIN_CHANGE=1`: behave like an installed app on first login (starting PINs 1234/1111/2222/3333 must be replaced; the installed app sets `HAZEL_LICENCE=1`, which does the same).
- `PORT`.
- `DEEPSEEK_API_KEY` and `GROQ_API_KEY` live in the root `.env` (see `.env.example`).

## Architecture

**server/index.js** is a single large Express file and owns everything:
- **Schema and migrations:** `CREATE TABLE IF NOT EXISTS` at the top, then a list of `ALTER TABLE ... ADD COLUMN` statements wrapped in try/catch. To add a column, append to that list; never edit the existing CREATE statements. Seed data (demo menu, users, expenses, an open register) is inserted only when the tables are empty.
- **Auth:** a PIN login creates a session token, sent as `Authorization: Bearer`. PINs are stored as scrypt hashes. Access is controlled by the `ACCESS` regex table in index.js: the first rule that matches `"METHOD /path"` wins, and **any route not listed is admin-only**. Roles are `admin`, `cashier` and `kitchen`. A new cashier or kitchen route needs an `ACCESS` entry. Every non-GET request is written to `audit_log`, with PINs and keys stripped.
- **API conventions:** reads are GET; every write is a POST, including deletes (`POST /api/<thing>/:id/delete`). `crud(route, table, fields)` generates save and delete routes for simple tables. Errors return `{ error }` with status 4xx. Inside a handler wrapped in `userErrors(...)`, throw a `UserError` and it becomes a 400 response.
- **Money logic is server-side:** `priceItem`, `recalc`, `promoAmount`, `deliveryFee`, `settle` and `payOrder` decide all amounts. The client's `promoPreview` only mirrors `promoAmount` for the live preview. Paying an order deducts recipe stock and may auto-open the cash drawer (`ensureDrawer`). `createOrder` is shared with the WhatsApp module.
- **Side modules:** each is wired in by passing `db` and helper functions: `printer.js` (thermal printing over network or USB), `fiscal.js` (PRA/FBR), `cloud-sync.js` (pushes data to `cloud/` every minute, plus a daily backup), `rider-sync.js` (riders' phones talk to the POS through the cloud: the rider page is `cloud/public/rider.html`, the customer's tracking page `cloud/public/track.html`) and `whatsapp/` (Baileys connection, inbox, assistant, Groq speech-to-text). Secrets go in the `secrets` table and are never returned by `/api/settings`.
- **Static serving:** the server serves `client/dist`. `/t/:token` is the customer's table-QR ordering page. In DEMO mode, `site/` is served at `/` and the POS at `/app`.

**client/** (React 19 + Vite, no router, no state library):
- `main.jsx` renders `CustomerOrder` when the path is `/t/<token>`, and `App` otherwise.
- `App.jsx` holds the shell and the order-taking screens. `NAV[role]` lists the views for each role, and the current view is just a `useState`. The other screens each live in their own `*.jsx` file.
- `lib.js` `api(url, body)`: with no body it sends a GET, with a body a POST. It throws on errors and fires `pos-logout` on a 401. Wrap event handlers in `run(fn)` so errors show as a toast.

**rag/** is the WhatsApp assistant's knowledge base and prompts. There is no vector search: live menu and restaurant data is read from `pos.db` and put into the prompt for every message (`src/context/`). All settings are in `rag/config/rag.config.json`, and all prompts in `rag/prompts/`. The code that decides when to reply lives in `server/whatsapp/assistant.js`.

**cloud/** is a separate Express app with its own `cloud.db`. Branches push paid orders, expenses, stock, closed shifts and backups to it, and it upserts by branch and local id. `cloud/wa-host.js` can also run a restaurant's WhatsApp bot on the cloud (switched on per branch in the admin app), reusing `server/whatsapp/*` with one folder per branch under `DATA_DIR/wa/<id>/` and the menu the POS pushes (`/api/sync/wa-knowledge`); while it is on, the POS's own bot stays quiet, takes the cloud's confirmed orders every 20 s (`wa_orders.cloud_id`) and sends the cashier's answer and later order messages back through `/api/sync/wa-orders/:id/result` and `/api/sync/wa-send`.

**site/** is the static landing page. Its images are screenshots of the demo. If the domain changes, update it in `robots.txt`, `sitemap.xml`, `llms.txt` and the head of `index.html`. The FAQ in the JSON-LD must match the FAQ on the page word for word.

## UI rules (see DESIGN.md)

- Every colour and font comes from the tokens in the `:root` block of `client/src/App.css`. Don't hard-code values in components. Dark and light themes must both pass contrast.
- Never use `alert()`, `confirm()` or `prompt()`. Use `toast`, `toastError`, `confirmBox` and `promptBox` from `client/src/notify.jsx`.
- The app is touch-first: touch targets are at least 44px, and labels are sentence case, never all-caps.

## Never commit

`.env`, `server/pos.db*`, `server/whatsapp/auth/`, `server/whatsapp/media/`. These hold keys, customer data and the linked WhatsApp session.
