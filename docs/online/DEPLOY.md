# Putting HazelPOS online (Railway), step by step

For the owner. No coding needed. You will end up with two websites:

- **The POS** (for restaurants), for example `https://pos.yourname.com`
- **The Admin panel** (only for you), for example `https://admin.yourname.com`

Keep a notepad open. You will write down a few secrets as you go. Never share them and never put them in GitHub.

## What you need first
- A GitHub account with the HazelPOS code in a repository.
- A Railway account (railway.com) with a payment card added.
- A phone with the WhatsApp number you want HazelPOS to send codes from (a spare SIM is best).
- Optional: a free Cloudflare R2 or Backblaze B2 bucket for off-site backups (step 10).

## Step 1. Make your secrets
You need one long key and one password. Open any terminal (Mac, Linux, or "Git Bash" on Windows) and run this command:

```
openssl rand -hex 32
```

It prints a long line of letters and numbers (64 characters). Write it down. This is the **VENDOR key**. It lets the Admin panel talk to the POS.

For the Admin panel password, make up a sentence of **at least 12 characters** that only you know.

No terminal? Any password manager can make a random 64-character password. Use that instead.

## Step 2. Create the POS service on Railway
1. In Railway, press **New project**, then **Deploy from GitHub repo**, and pick the HazelPOS repository.
2. Railway finds the file `railway.json` and the `Dockerfile` by itself. Wait for the first build. It will **fail to start**. That is expected: the safety checks stop it until you finish steps 3 and 4.
3. Rename the service to `pos` (Settings, then Service name).
4. Still in **Settings**, **Networking**, press **Generate domain**. You get an address like `pos-production-1234.up.railway.app`. Copy it: you need it for `BASE_URL` in step 4.

## Step 3. Add the Volume (this is where all restaurant data lives)
Without this, every new version you deploy would erase everything.
1. Open the `pos` service, press **Settings**, then **Volumes** (or right-click the service on the canvas and choose **Attach volume**).
2. Mount path: `/data`
3. Save.

The server refuses to start on Railway if its data folder is not on the Volume. That is on purpose.

## Step 4. Set the variables for the POS
Open the `pos` service, **Variables**, and add these (Railway has a "Raw editor" where you can paste several lines).

| Name | Example | What it does | Required? |
|---|---|---|---|
| `NODE_ENV` | `production` | Turns on the safety checks. The Dockerfile already sets it, so you can skip it. | Set by the image |
| `DATA_DIR` | `/data` | Where the data lives. Must be on the Volume. The Dockerfile already sets it. | Set by the image |
| `PORT` | `4000` | The port the server listens on. Railway fills this in. | No |
| `RAILWAY_RUN_UID` | `0` | Railway mounts the Volume owned by root; this lets the server write to it. | **Yes** on Railway |
| `VENDOR_API_KEY` | the VENDOR key from step 1 | Lets the Admin panel manage restaurants. At least 32 characters. Must be identical on the Admin service. | **Yes** |
| `BASE_URL` | `https://pos.yourname.com` | The public address of the POS. It is put into the links sent by WhatsApp (welcome, reset password, rider and tracking links). Must start with `https://`. No slash at the end. | **Yes** |
| `TRUST_PROXY` | `1` | Tells the server that Railway sits in front, so limits work per visitor. | **Yes** on Railway (a warning shows if missing) |
| `PAY_DETAILS` | `JazzCash 0300-1234567, Ali Khan` | Your payment details, written into the invoice message sent to restaurants. | Recommended |
| `DEEPSEEK_API_KEY` | `sk-...` | The WhatsApp assistant's brain (deepseek.com). Without it the assistant cannot answer. | Needed for the WhatsApp assistant |
| `GROQ_API_KEY` | `gsk_...` | Turns customers' voice notes into text (groq.com). | Optional |
| `WHATSAPP` | `off` | `off` = never connect any WhatsApp. Leave it unset in production. | No |
| `S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | Off-site backups, address of the bucket service. | Optional (step 10) |
| `S3_BUCKET` | `hazelpos-backups` | Bucket name. | Optional (step 10) |
| `S3_KEY` | `...` | Bucket access key id. | Optional (step 10) |
| `S3_SECRET` | `...` | Bucket secret key. | Optional (step 10) |
| `S3_REGION` | `auto` | Bucket region. `auto` is right for Cloudflare R2. | Optional |

Railway adds `RAILWAY_ENVIRONMENT` and `RAILWAY_VOLUME_MOUNT_PATH` by itself. Do not set them.

You can ignore these other settings the code reads; they are for testing or have good defaults: `FORCE_PIN_CHANGE`, `PRINT_ACK_MS` (how long the printer app has to confirm a ticket), `DEEPSEEK_BASE_URL` (a different DeepSeek address), `POS_DB` and `HAZEL_DATA_DIR` (old local-only paths).

**Never set** `OTP_OFF` or `DEMO` in production. The server refuses to start if they exist. (They exist only for testing on your own computer.)

After saving, Railway redeploys. Wait until the service shows **Active**. Open `https://<your-railway-address>/api/health`. You should see `{"ok":true,...}`.

## Step 5. Check the address
1. Open `https://<the address from step 2>/api/health`. You should see `{"ok":true,...}`.
2. When you have your own domain later, add it in **Settings**, **Networking** (Custom domain) and update `BASE_URL`. See the last section.

## Step 6. Create the Admin service
1. In the same Railway project press **New**, then **GitHub repo**, and pick the same repository again.
2. Rename the service to `admin`. In **Settings**, set **Config file path** to `admin/railway.json` (this makes it use `admin/Dockerfile`).
3. **Variables** for `admin`:

| Name | Example | What it does | Required? |
|---|---|---|---|
| `SERVER_URL` | `https://pos.yourname.com` | Where the POS is. You may use Railway's private address instead, for example `http://pos.railway.internal:4000`. The older name `CLOUD_URL` also works. | **Yes** |
| `ADMIN_PASSWORD` | your sentence, 12+ characters | The password for the Admin panel login. | **Yes** |
| `VENDOR_API_KEY` | the same VENDOR key as on `pos` | Proves to the POS that the request is yours. Paste exactly the same value. | **Yes** |
| `PORT` | `4400` | Port. Railway fills this in. | No |

4. **Settings**, **Networking**, **Generate domain**. Open it and sign in with `ADMIN_PASSWORD`.

The Admin panel keeps the VENDOR key on its server. It never reaches anyone's browser.

## Step 7. Link the HazelPOS WhatsApp number
This number sends sign-in codes, welcome links and invoices to restaurant owners.
1. In the Admin panel open **Settings**.
2. Press **Link number**. A QR code appears.
3. On the phone: WhatsApp, **Linked devices**, **Link a device**, scan the code.
4. The status turns to connected. Until you do this, codes are only written in the server log (Railway, `pos`, **Deployments**, **Logs**), so no owner can sign in by phone code.

## Step 8. Create the first restaurant
1. In the Admin panel open **Restaurants**, then add a restaurant: its name, a short code (letters, numbers and dashes), the owner's name and phone number.
2. HazelPOS sends the owner a welcome message on WhatsApp with a link to choose a password.
3. The owner opens the link, sets a password, signs in with a phone code, and opens the restaurant. Their first till PIN is shown in the Admin panel and sent to them.

No Admin panel yet or a problem? You can also use the server's command line. In Railway open the `pos` service, **Settings**, and use the "Run command" tool, or from your own computer:

```
node server/tenant-cli.js create --slug my-restaurant --name "My Restaurant" --owner-phone 03001234567 --owner-name Ali --password <a-password>
```

(Set `DATA_DIR` to the same folder the server uses.)

## Step 9. Install the printer app at the restaurant
Print jobs never go from the internet to a printer directly. A small Windows app on one PC in the shop fetches them.
1. Download **HazelPOS-Printer-Setup** (the installer from your releases page) on the shop PC and install it.
2. In HazelPOS (any browser), sign in as the owner. Open **Settings**, **Printers**, and press **Set up printer helper**. A **6-digit code** appears, valid for 10 minutes and for one use.
3. On the shop PC, open **HazelPOS Printer** and type the code.
4. Press **Find printers**, choose the receipt and kitchen printer (or type their addresses), and press **Print test page**.
5. The tray icon turns green when connected. In HazelPOS the Printers page says "Online".

If the code expired, press the button again for a new one. "Show key instead" is only for technical use.

## Step 10. Check that backups work
- Every hour the server saves a copy of every restaurant (plus the owner accounts) in `/data/backups/<date-hour>/`. It keeps the last 48 hours and one copy a day for 14 days.
- Wait for the first hour. Then, in the Railway logs of `pos`, look for a line like `Backup 2026-11-20-14: 3 files`.
- **Off-site copy (recommended).** Create a bucket (Cloudflare R2 is free to start), create an access key, and set `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY` and `S3_SECRET` on `pos`. Each backup then also goes to the bucket under `hazelpos-backups/`. The bucket keeps files forever, so add a rule in the bucket settings to delete files older than 30 days.
- **Restoring one restaurant (no downtime for the others).** In the Admin panel open **Restaurants**, the restaurant, then **Backups**, pick the hour and press **Restore**. Only that restaurant goes back in time; the server and every other restaurant keep running. The data it replaced is kept on the server next to it as `pos.db.before-restore-...`.
  From a terminal (only when the server is not running): `node server/tenant-cli.js restore <restaurant-code> /data/backups/<folder>/<restaurant-code>.db`.
- Try a restore once on a test restaurant, before you need it for real.

## Troubleshooting
- **Service keeps restarting, logs say "HazelPOS cannot start in production":** the message lists exactly which variable is wrong. Fix it and it starts.
- **Owner does not get the WhatsApp code:** step 7 is not done, or the phone lost its link. Link again.
- **Admin says it cannot reach the server:** `SERVER_URL` is wrong, or `VENDOR_API_KEY` differs between the two services.

---

# Later: moving to a Hostinger KVM VPS (Docker + Caddy)

Do this when Railway gets expensive. The data is just a folder, so moving is a copy.

1. **Buy** a Hostinger KVM VPS with Ubuntu. Note its IP address (for example `203.0.113.10`).
2. **Point your domain.** At your domain's DNS settings add two **A records**, both to the VPS IP: `pos` and `admin` (so `pos.yourname.com` and `admin.yourname.com`). Wait a few minutes.
3. **Install Docker** on the VPS (log in with SSH): `curl -fsSL https://get.docker.com | sh`
4. **Get the code:** `git clone <your repo> hazelpos && cd hazelpos`
5. **Make a file `.env`** next to `docker-compose.yml` (below) with the same variables as Railway:
   ```
   VENDOR_API_KEY=<same key>
   BASE_URL=https://pos.yourname.com
   ADMIN_PASSWORD=<12+ characters>
   PAY_DETAILS=JazzCash 0300-1234567
   DEEPSEEK_API_KEY=sk-...
   ```
6. **Create `docker-compose.yml`:**
   ```yaml
   services:
     pos:
       build: .
       restart: unless-stopped
       env_file: .env
       environment: { TRUST_PROXY: "1", PORT: "4000" }
       volumes: ["./data:/data"]
     admin:
       build: { context: ., dockerfile: admin/Dockerfile }
       restart: unless-stopped
       env_file: .env
       environment: { SERVER_URL: "http://pos:4000", PORT: "4400" }
     caddy:
       image: caddy:2
       restart: unless-stopped
       ports: ["80:80", "443:443"]
       volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddy_data:/data"]
   volumes: { caddy_data: {} }
   ```
7. **Create `Caddyfile`.** Caddy gets the https certificates by itself:
   ```
   pos.yourname.com {
       reverse_proxy pos:4000
   }
   admin.yourname.com {
       reverse_proxy admin:4400
   }
   ```
8. **Start:** `docker compose up -d --build`. Check `https://pos.yourname.com/api/health`.
9. **Move your data** (do this before restaurants start the day):
   - On Railway, stop `pos`, and download `/data` (or take the newest backup folder from the bucket).
   - Copy the folder contents into `./data` on the VPS (`control.db` and the `tenants/` folder), then `docker compose restart pos`.
   - The VPS data folder must be owned by user id 1000: `sudo chown -R 1000:1000 data`.
10. **Update the places that know the address:** nothing else changes if you keep the same domain. If you moved to a new domain, change `BASE_URL`, and the server address in the printer app (Advanced) at each restaurant.
11. **Backups on the VPS:** the same hourly backups appear in `./data/backups`. Keep the `S3_*` variables for an off-site copy. Also use Hostinger's weekly VPS snapshot.
12. **Updating later:** `git pull && docker compose up -d --build`.

## Using your own domain on Railway (without moving)
In `pos` (and `admin`), **Settings**, **Networking**, **Custom domain**. Railway shows a CNAME record. Add it at your domain provider, wait, then set `BASE_URL` to `https://pos.yourname.com` and redeploy.
