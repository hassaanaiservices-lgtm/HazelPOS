# Spec: phase 1a, slice B — the printer Bridge (minimal)

This builds on slice A ([spec.md](spec.md)), which must pass first. Plan: [PLAN.md](PLAN.md) §6 and §8 item 7.
Pass checks: [acceptance-b.json](acceptance-b.json).

## Why
A cloud server can't reach a printer on the shop's Wi-Fi. Today the server also calls `printer.send()`, which can connect to any address or write to any file path the settings name. On a shared server that's a hole between restaurants. From now on **the server only builds the print bytes and queues them. A small Bridge program in the shop fetches them and prints.**

## Server
1. **The server never calls `printer.send()`.** `receipt()`, `kitchenTicket()` and `testPage()` stay on the server because they only build bytes. Every place that printed (index.js ~599, ~731, ~1048, ~1054, ~1058) calls `queuePrint(kind, bytes, label)` instead, where `kind` is `receipt`, `kitchen` or `test`. Add a CI-style check: `grep -n "printer.send" server/index.js` must find nothing.
2. Tenant table `print_jobs`:
   - Columns: id, kind, label (e.g. "Order #12 kitchen"), data (base64), status ('queued'|'sent'|'done'|'failed'), error, created_at, sent_at, done_at, tries.
   - `target` is **not** stored. The Bridge decides where each kind prints.
3. Devices get a `kind` column ('till' | 'bridge', default 'till').
   - `POST /api/devices {name, kind:'bridge'}` creates a Bridge device.
   - **A Bridge key can't be used for PIN login, `/api/till` or any other route.** It's only allowed on `/api/bridge/*`. A till key is refused on `/api/bridge/*`.
4. Bridge routes (need `X-Device` of a Bridge device):
   - `GET /api/bridge/jobs?wait=25` is a long poll. It answers as soon as there are queued jobs, or with `[]` after `wait` seconds (max 30). It returns up to 10 jobs `{id, kind, label, data}` and marks them `sent` (with `sent_at`, `tries+1`).
   - `POST /api/bridge/jobs/:id/done {ok:true}` or `{ok:false, error}` sets the job to `done` or `failed`.
   - A job left in `sent` with no answer for 60 s goes back to `queued` (at most 3 tries, then `failed` with error "Printer helper did not confirm").
   - **Stale tickets don't print:** a job queued more than 30 minutes ago is marked `failed` with error "Too old: not printed (reprint if needed)" and is never handed out.
   - Each poll updates the device's `last_seen`.
5. Staff routes:
   - `GET /api/print/status` (STAFF) → `{bridge_online: bool (any Bridge seen in the last 60 s), waiting: n, failed_today: [{id,label,error,created_at}]}`.
   - `POST /api/print/jobs/:id/retry` (STAFF) → puts a failed job back in the queue as a new job created now.
6. Print routes answer `{ok:true, queued:true}`. Receipt and kitchen printing after payment and sending to the kitchen work as before, but they queue the job.
7. Settings: `receipt_printer` and `kitchen_printer` (addresses) **move to the Bridge's own config file** and are removed from the POS settings screen. The POS Settings → Printers screen shows Bridge status and a **"Set up printer helper"** button. That button creates the Bridge device and shows the key once, with a copy button, plus the one-line command to start the Bridge.

## Bridge (`bridge/`, a plain Node program; the Electron tray app comes in phase 2)
- `bridge/index.js` reads `bridge/config.json`, or the path in `--config`:
  ```json
  {"server":"https://…","key":"…","receipt":"192.168.1.50:9100","kitchen":"192.168.1.51:9100"}
  ```
  `test` jobs go to the `receipt` printer.
- Loop: long-poll `GET /api/bridge/jobs`, then for each job `printer.send(target, Buffer.from(data,'base64'))` using `server/printer.js`'s `send` (require it, don't copy it), then `POST …/done`.
  - On a network error it waits and retries, with backoff from 2 s up to 30 s, and never crashes.
  - It logs one line per job.
- A printer target must be `host:port` or a local device path (`/dev/usb/lp*`, `COM\d+`, `\\.\…`). Anything else fails the job with "Not a printer address".
- `node bridge/index.js --check` prints whether it can reach the server and each printer, then exits.
- `bridge/README.md`: how to start it on the shop PC.

## Client
- A banner in the app for staff when `bridge_online` is false and `waiting > 0`: "Printer helper is offline — N tickets waiting". It is checked every 30 s. Use the existing warning token colours.
- Failed jobs show in Settings → Printers with a **Reprint** button.
- After printing, the toast says "Sent to printer", not "Printed".

## Out of scope
The Electron tray app, cash drawer as its own job (the drawer kick is already part of the receipt bytes), several printers per kind, and browser printing.
