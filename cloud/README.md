Deprecated: replaced by the online server (docs/online/PLAN.md). Kept for reference until launch.

# HazelPOS Cloud

The owner's view of every branch. Each branch keeps running the normal POS on its own PC and LAN (billing works with no internet). When the branch is online, it pushes data here every minute and uploads a database backup once a day.

What the owner sees (phone or laptop):

- Revenue, orders, expenses, net, and cash short/over for all branches, by day / 7 days / month
- Per branch: payment methods, order types, staff sales, top items, expenses by category, every closed cash-drawer shift with its difference, low stock, and backups to download

## Run it

```bash
cd cloud
npm install
PORT=4200 node index.js        # or from the project root: npm run cloud
```

Settings (environment variables):

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4200` | HTTP port |
| `DATA_DIR` | `cloud/data` | Where `cloud.db` and the `backups/` folder live. Back this folder up. |
| `ALLOW_SIGNUP` | on (off when `VENDOR_API_KEY` is set) | Set to `0` after you have created your owner accounts, so strangers can't sign up. On the vendor cloud, `1` turns it back on |
| `VENDOR_API_KEY` | not set | Makes this **your** HazelPOS Cloud: memberships are enforced, the AI proxy works, and your admin app (`admin/`) can manage it. A long random secret (32+ characters), the same one the admin app uses. Make one with `openssl rand -hex 32` |
| `METRICS_TOKEN` | not set | Turns on `/metrics` for your Grafana dashboard and alerts (see [grafana/README.md](../grafana/README.md)). 24+ characters |
| `DEEPSEEK_API_KEY`, `GROQ_API_KEY` | not set | Your AI keys, used for every restaurant's WhatsApp assistant and voice notes (`/api/ai/chat`, `/api/ai/transcribe`). They never leave this server |
| `AI_DAILY_LIMIT` | `3000` | AI calls per branch per day |

Put it behind HTTPS (for example Caddy or Nginx with Let's Encrypt). Branch keys and owner passwords travel in requests, so plain HTTP is only acceptable on a private network.

## Connect a branch

1. Open the cloud in a browser, create the owner account, then **Add a branch**. The branch key is shown once, so copy it.
2. On that branch's POS: **Settings → Cloud**, enter the cloud address and the key, then press **Connect**.
3. The branch uploads its full history, then keeps syncing every minute. **Sync now** and **Backup now** run it straight away.

If a key leaks, open the branch in the dashboard and press **New branch key**. The old key stops working right away.

## What is synced

| Data | When | Notes |
| --- | --- | --- |
| Orders + items | once paid or cancelled | Paid orders never change, so each is sent once |
| Expenses | when added, edited or deleted | Compared by hash |
| Ingredient stock | when any stock level changes | Full snapshot |
| Cash-drawer shifts | when closed | Expected vs counted cash |
| Database backup | daily | The last 14 are kept per branch |

Customers, menus and settings stay on the branch. Re-sending is safe because the cloud upserts by branch and local id.

## Vendor mode (selling HazelPOS monthly)

With `VENDOR_API_KEY` set, this cloud enforces memberships and runs the AI proxy. You manage clients from the separate
**HazelPOS Admin** app (`admin/`, see [admin/README.md](../admin/README.md)), which talks to this cloud with that key.
The installed POS checks its membership every 3 hours and remembers the last answer, so a dropped internet connection
doesn't stop billing. The rules (offline days, grace days) are in `server/licence.js` and listed in [`docs/RISKS.md`](../docs/RISKS.md) (L1–L3).

## Deploy on Railway (your vendor cloud)

1. In the Railway project: **New → GitHub repo → HazelPOS**, as a new service next to the demo. Leave the root directory as the repo root (the menu upload uses `server/menu-import.js`). Build command `npm --prefix cloud ci && npm --prefix server ci --omit=dev` (the second part is for the WhatsApp bot hosted on the cloud, `cloud/wa-host.js`; without it the cloud runs fine and the cloud bot is simply not available), start command `node cloud/index.js`.
2. **Add a volume** to this service, mounted at `/data`. Do this before adding any restaurant: without it, every redeploy wipes `cloud.db` (memberships, keys, backups). See docs/RISKS.md A3.
3. Variables: `DATA_DIR=/data`, `VENDOR_API_KEY=<openssl rand -hex 32>`, `DEEPSEEK_API_KEY=…`, `GROQ_API_KEY=…`. Railway sets `PORT` itself.
4. Settings → Networking → **Generate domain** (HTTPS comes with it). Pick a region close to Pakistan (docs/RISKS.md A1).
5. Deploy the admin app as a second service (admin/README.md) with the same `VENDOR_API_KEY`.
6. Put the domain and the licence public key in `desktop/package.json` → `"hazel": { "cloudUrl": "https://<domain>", "licencePublicKey": "<the text from https://<domain>/api/licence/public-key>" }` and build the installers. Restaurants then only type their activation code, and the POS checks every licence answer is really from your cloud. The private key is in `DATA_DIR/licence-key.pem` (or set `LICENCE_PRIVATE_KEY`): keep it on the volume, never share it.

## Onboarding a restaurant

Done in the admin app: see [admin/README.md](../admin/README.md).

## Riders (phones and tracking links)

The POS pushes its riders and today's delivery board to `POST /api/sync/riders` every few seconds while deliveries are on (`server/rider-sync.js`) and takes back what riders pressed on their phones and where they are. Pages served here:

| Page | Who | What |
|---|---|---|
| `/r/<token>` | a rider's phone | Accept ready orders, navigate, call, mark delivered, share location while "On duty". The token is the secret the owner gets from Riders → Phone link in the POS. |
| `/track/<token>` | the customer | The order's status and, while on the way, the rider on a map. Sent by WhatsApp when the order leaves. Expires with the next day's board. |

Rider positions and the day's trail live in `c_riders` / `rider_trail` (24 h). No customer phone numbers reach these pages: the rider sees the phone of an order only after accepting it; the tracking page never shows one. Map tiles come from OpenStreetMap (docs/RISKS.md R2).
