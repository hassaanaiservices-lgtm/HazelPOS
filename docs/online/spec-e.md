# Spec: slice E — printer app for Windows, and going live on Railway

Builds on slices A–D. Plan: [PLAN.md](PLAN.md) §6, §8 phase 2. Checks: [acceptance-e.json](acceptance-e.json).

## 1. Pairing the printer helper with a short code (server)
- In Settings → Printers, **"Set up printer helper"** now shows a **6-digit pairing code**, valid for 10 minutes and usable once, instead of a long key. A "Show key instead" link keeps the old key flow for the Node script.
- control.db `bridge_pairings` (code_hash, tenant_id, created_by, expires_at, used_at).
- `POST /api/bridge/pair {code, name}` needs no tenant header. A correct code creates a Bridge device in that restaurant and returns `{device_key, restaurant:{slug,name}}`.
  - Rate limit: 10 tries per IP per 15 minutes.
  - A wrong code returns 400, the same response whether the code is unknown or expired.

## 2. "HazelPOS Printer" Windows app (`desktop/` becomes the Bridge)
- An Electron tray app that **no longer starts the POS server**. Its main process runs the Bridge loop from `bridge/` (refactor `bridge/index.js` into a `createBridge(config, log)` module used by both the CLI and the app).
- **First-run window** (simple, 44px targets, sentence case, the app's colours):
  1. "Enter the code from HazelPOS → Settings → Printers" (6 digits). The server URL is built in through `package.json` `hazel.serverUrl`, with an "Advanced" field to change it.
  2. Printers: receipt and kitchen fields, plus a **"Find printers"** button. It scans the PC's local /24 subnet for TCP port 9100 (with a short timeout, in parallel, finishing in under 10 s) and lists what it finds to choose from. Typing an address by hand is also allowed.
  3. A **"Print test page"** button for each printer.
- Config is saved in the user's app-data folder.
- The tray icon is green when connected, amber while printing or retrying, and red when it can't reach the server. Tray menu: "Open", "Print test page", "Start with Windows" (on by default), "Quit".
- Auto-update stays (electron-updater from the public releases repo). Remove the server, licence, activation, port picking, the WhatsApp folders and the `extraResources` for server, client and rag. Package only the bridge code and `server/printer.js` (copied via `extraResources` or `files`).
- Rename the product: `productName` "HazelPOS Printer", `appId` `com.hazelpos.printer`. Update `.github/workflows/desktop.yml` and `desktop/README.md`.
- It must run on Windows. Here, check it with `npm --prefix desktop start` under Linux (Electron dev mode) for the first-run window and the tray logic. The Windows installer is built by the GitHub workflow.

## 3. Ready for Railway
- `Dockerfile` at the repo root:
  - Uses `node:22.17-bookworm-slim` (or newer 22.x).
  - Installs server deps with `npm ci --omit=dev` and builds the client.
  - Runs `node server/index.js`.
  - Sets `ENV NODE_ENV=production DATA_DIR=/data`.
  - Uses a non-root user and `HEALTHCHECK` on `/api/health`.
  - `.dockerignore` excludes `*.db`, `server/data`, `node_modules`, `.env`, the whatsapp auth and media folders, and `desktop/dist`.
- `railway.json`: Dockerfile builder, healthcheck `/api/health`, restart on failure.
- **Production safety checks at boot** (`NODE_ENV=production`). The server refuses to start, with a clear message, if any of these is true:
  - `VENDOR_API_KEY` is missing or under 32 characters;
  - `BASE_URL` is missing or not `https://`;
  - `OTP_OFF` is set;
  - `DEMO` is set;
  - `DATA_DIR` isn't writable;
  - on Railway (`RAILWAY_ENVIRONMENT` set), `DATA_DIR` isn't inside `RAILWAY_VOLUME_MOUNT_PATH`. That last one protects against data loss on deploy.
  - It also warns if `TRUST_PROXY` isn't set while on Railway.
- **Backups:**
  - Every hour, `tenancy.backupAll` writes to `DATA_DIR/backups/<YYYY-MM-DD-HH>/` and keeps 48 hourly folders plus 14 daily ones.
  - With `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY` and `S3_SECRET` set (Cloudflare R2 or Backblaze B2), each run is also uploaded, with `@aws-sdk/client-s3` added as a dependency.
  - `node server/tenant-cli.js restore <slug> <backup-file>` restores one restaurant, after stopping its handle and its WhatsApp bot.
- Admin panel as a second Railway service from the same repo: `admin/Dockerfile` or a start command, using `SERVER_URL` (Railway private networking) plus `ADMIN_PASSWORD` and `VENDOR_API_KEY`.
- `docs/online/DEPLOY.md` is a **step-by-step guide for the owner**, in plain words. It covers:
  - create the Railway project from GitHub;
  - add a Volume mounted at `/data`;
  - set the env vars (a table: name, example, what it does, required or optional);
  - deploy the admin service;
  - generate keys with `openssl rand -hex 32`;
  - link the HazelPOS WhatsApp number;
  - create the first restaurant;
  - install the printer app at the restaurant;
  - check that backups work;
  - later, move to the Hostinger VPS (Docker + Caddy, with an example Caddyfile) and point a domain.

## Out of scope
Payment gateway, self-signup, offline mode, custom domains.
