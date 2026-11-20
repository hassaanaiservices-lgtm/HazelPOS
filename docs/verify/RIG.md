# Verify rig (SETUP-0)

Tests run against the released code (git HEAD of `product-installer`, v1.0.8), not the working tree.

```bash
# 1. Export HEAD and reuse the repo's installed packages
mkdir -p /tmp/claude-1000/hz-verify/head /tmp/claude-1000/hz-verify/bin
git -C /home/hassaan/Documents/HazelPOS-main archive HEAD | tar -x -C /tmp/claude-1000/hz-verify/head
for d in server cloud client admin; do ln -sfn /home/hassaan/Documents/HazelPOS-main/$d/node_modules /tmp/claude-1000/hz-verify/head/$d/node_modules; done

# 2. Node 22 (no system node here): Electron in node mode
printf '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec /home/hassaan/Documents/HazelPOS-main/desktop/node_modules/electron/dist/electron "$@"\n' > /tmp/claude-1000/hz-verify/bin/node
chmod +x /tmp/claude-1000/hz-verify/bin/node
export PATH=/tmp/claude-1000/hz-verify/bin:$PATH

# 3. Client build (only for the screenshots)
(cd /tmp/claude-1000/hz-verify/head/client && node node_modules/vite/bin/vite.js build)

# 4. Scripts (each starts its own cloud + POS servers, fake WhatsApp, fake DeepSeek; logs in /tmp/claude-1000/hz-verify/run/)
cd /home/hassaan/Documents/HazelPOS-main
node docs/verify/scripts/setup0.js        # SETUP-0             ~5 s,  ports 4900-4921
node docs/verify/scripts/wa-suite.js      # WA-ROOT-1/2, WA-AUTO-1..10  ~25 min, ports 4930-4951
node docs/verify/scripts/pin-lic-suite.js # PIN-1..4, LIC-1/2, SETUP-1  ~4 min, ports 4960-4969
node docs/verify/scripts/sync-off-suite.js# SYNC-1, OFF-1        ~3 min, ports 4980-4987
node docs/verify/scripts/sec-suite.js     # SEC-1                ~5 s,  ports 4990-4997
node docs/verify/scripts/lowstock.js      # WA-AUTO-8 low-stock  ~30 s, ports 4970-4975
node docs/verify/scripts/ui-shots.js      # screenshots -> docs/verify/shots/, ports 4970-4979
```

What the scripts do (see `scripts/lib.js`):

- **Cloud:** `node -r scripts/fake-wa.js cloud/index.js` with `DATA_DIR=<scratch>`, `VENDOR_API_KEY=<40 chars>` (32+ needed,
  shorter = vendor mode off), `PORT`, `DEEPSEEK_API_KEY=fake`, `DEEPSEEK_BASE_URL=http://127.0.0.1:<fake>`.
- **Clients and codes:** `POST /api/vendor/owners {name, phone}` then `POST /api/vendor/owners/:id/branches {name}` → `{id, code}`.
  There is no `GET /api/vendor/branches` (404); branches are listed inside `GET /api/vendor/owners`.
- **POS:** `node -r scripts/fake-wa.js server/index.js` with `POS_DB=<fresh file>`, `PORT`, `HAZEL_DATA_DIR`. Connected with
  `POST /api/cloud/connect {url, key: "HZ-…"}` as the owner, or, for installed-app tests (`HAZEL_LICENCE=1`),
  `POST /api/licence/activate {url, code}`.
- **Fake WhatsApp** (`scripts/fake-wa.js`): replaces `server/whatsapp/connection.js` in both processes. A control port per process
  (`/scan`, `/inbound`, `/force`, `/events`); every connect/stop/send is logged to `<name>-wa.jsonl`.
- **Fake DeepSeek:** answers price questions from the menu lines in the prompt and turns "… chahiye takeaway" into an order.
- Nothing touches `server/pos.db`, `.env`, the live cloud or a real WhatsApp number.
