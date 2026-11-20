# Spec: slice C — clients can be onboarded without us touching a server

Builds on slices A and B (both must pass). Plan: [PLAN.md](PLAN.md) §3, §4. Checks: [acceptance-c.json](acceptance-c.json).

Owner decision (2026-11-20): codes and links are sent from **HazelPOS's own WhatsApp number**, linked to the server once by scanning a QR in the admin panel.

## 1. HazelPOS WhatsApp (vendor number) — `server/vendor-wa.js`
- One Baileys connection for the vendor number. It reuses `server/whatsapp/connection.js` (`waConnection`) with its own `dataDir` = `DATA_DIR/vendor-wa/` and a minimal store. **Do not** load the per-restaurant bot or assistant.
  - It is not started with `WHATSAPP=off`, but sending still works in that case through the fallback below.
- `vendorWa.sendText(phone, text)`:
  - Normalises a Pakistani number (`03xx…` → `923xx…@s.whatsapp.net`).
  - If not connected, it logs `VENDOR-WA (not connected) to <phone>: <text>` and returns `{sent:false}`. Callers never crash.
- Messages go out at most 1 per second (a simple queue).
- `sendOtp` (slice A) now uses `vendorWa.sendText`, with the text: "Your HazelPOS sign-in code is 123456. It expires in 10 minutes. Don't share it with anyone." The console line stays when the number isn't connected.

## 2. Owner links: welcome, set password, forgot password
- control.db `owner_links` (token_hash, owner_id, purpose 'welcome'|'reset', expires_at, used_at).
  - Welcome links last 7 days, reset links last 1 hour, and each can be used once.
- `POST /api/auth/owner/forgot {phone}`:
  - Always answers `{ok:true}`, whether or not the phone exists.
  - If the owner exists, sends "Reset your HazelPOS password: <BASE_URL>/reset/<token>".
  - Rate limits: 3 per phone and 20 per IP per hour.
- `GET /api/auth/owner/link/:token` → `{purpose, name, phone_masked}`. Returns 410 if expired or used.
- `POST /api/auth/owner/link/:token {password}`:
  - The password needs at least 8 characters.
  - Sets `pass_hash`, marks the link used, deletes all of that owner's `owner_sessions`, trusts this `device_id`, and returns the same as a login (owner_token + restaurants).
- `BASE_URL` env (default `http://localhost:<PORT>`) is used to build the links.
- Client: `/welcome/<token>` and `/reset/<token>` show "Set your password" (password + confirm, show/hide) and then continue into the normal flow (picker or app).
  - "Forgot password?" on Sign-in asks for the phone and calls `/forgot`, then shows "If this number has a HazelPOS account, we've sent a link on WhatsApp."

## 3. Vendor API on the main server — `server/vendor.js`, mounted at `/api/vendor/*`
- Auth: `Authorization: Bearer <VENDOR_API_KEY>` (env, 32+ characters). Compare with `crypto.timingSafeEqual`.
  - If `VENDOR_API_KEY` isn't set, every vendor route returns 503.
  - This sits outside the tenant resolver, so it needs no tenant header.
- Every write goes to control.db `vendor_audit` (at, who, action, detail). `who` comes from the `X-Admin-User` header the admin server sends.
- Tenant `status` values: `trial`, `active`, `past_due`, `suspended`, `cancelled`.
  - New orders are blocked for `suspended` and `cancelled` (slice A's 402).
  - `past_due` shows the owner a banner in the POS: "Your HazelPOS payment is overdue. Please pay by <date> to avoid interruption."
- Routes:
  - `GET /tenants` → list with: id, slug, name, status, plan, created_at, trial_ends, paid_until, owner (name, phone), last_active (max session `last_seen`), orders_today, bridge_online, open_invoice.
  - `POST /tenants {name, slug?, owner_name, owner_phone, plan?, monthly_fee}`:
    - The slug is generated from the name when it's missing, and made unique.
    - Creates the tenant (status `trial`, `trial_ends` = +14 days).
    - Creates the owner if new, plus the owner's admin user in the tenant with a random PIN.
    - Sends the welcome WhatsApp: "Welcome to HazelPOS, <name>! Set your password: <BASE_URL>/welcome/<token>. Your till PIN is <pin>."
    - Returns `{tenant, welcome_sent, welcome_link}`. The link is returned so we can paste it by hand if WhatsApp isn't linked.
  - `POST /tenants/:id {name?, status?, plan?, monthly_fee?, features?}`.
  - `POST /tenants/:id/resend-welcome` and `POST /tenants/:id/owner-reset`: send a new link and return it.
  - Invoices, in control.db `invoices` (id, tenant_id, month 'YYYY-MM', amount, due_date, status 'open'|'paid'|'void', paid_at, method, ref, marked_by):
    - `GET /invoices?status=` → list.
    - `POST /invoices/generate {month}` → one invoice per non-cancelled tenant with `monthly_fee` > 0, skipping duplicates. Due on the 10th. Each tenant gets the WhatsApp "Your HazelPOS invoice for <month>: Rs <amount>, due <date>. Pay by JazzCash/Easypaisa/bank transfer to <PAY_DETAILS env> and send the receipt here."
    - `POST /invoices/:id/paid {method, ref}`.
    - `POST /invoices/:id/void`.
  - Daily lifecycle job (also `POST /lifecycle/run` for tests):
    - `trial` past `trial_ends` with no paid invoice → `past_due`.
    - An open invoice more than 7 days past `due_date` → `suspended`.
    - Marking an invoice paid returns `past_due`/`suspended` to `active` when nothing else is overdue.
    - Each change is audited and the owner gets a WhatsApp message.
  - `GET /wa` → vendor number status `{state, phone?, qr?}`, where `qr` is a data-URL PNG. `POST /wa/link` starts linking, and `POST /wa/logout` unlinks.
  - `GET /audit?limit=`.
- Remove the vendor API from `cloud/`? **No.** Leave `cloud/` untouched in this slice.

## 4. Add staff in the POS — Settings → Staff & PINs (admin only)
- List the staff (name, role, last login). Owners can add, edit (name, role, PIN) and remove staff, with roles cashier, kitchen and admin.
- PINs must be unique inside the restaurant (they're checked with the existing hashing). Use `pin-rules.js` for the rules.
  - A clash → 400 "Someone here already uses that PIN".
- An owner can't remove their own login or the last admin.
- Removing someone deletes their sessions.
- `promptBox`/`confirmBox` from `notify.jsx`, 44px targets, sentence case.
- The till lock screen shows the new staff at once (`/api/till`).

## 5. Admin panel (`admin/`) points at the main server
- `CLOUD_URL` → rename it `SERVER_URL` (keep reading `CLOUD_URL` as a fallback). It calls the new `/api/vendor/*` above.
- `ADMIN_PASSWORD` login stays. The Team page is hidden for now (`shortcut:` comment).
- Pages:
  - **Restaurants** (replaces Clients): table of the `GET /tenants` fields with a status chip. **"+ New restaurant"** has 4 visible fields (Restaurant name, Owner name, Owner phone, Monthly fee). After creating it, it shows a success card with the welcome link and a **"Copy message"** button containing the link and the PIN, for when WhatsApp isn't linked.
  - **Restaurant detail**: status and plan editing; Suspend, Activate and Cancel buttons with a confirm step; Resend welcome; Reset owner password; invoices with **Mark paid** (method + reference).
  - **Unpaid**: open invoices past due, with Mark paid.
  - **Settings → HazelPOS WhatsApp**: status; a "Link number" button that shows the QR, refreshed every 3 s; "Unlink".
  - **Activity**: `vendor_audit`.
- Remove these from the nav: installer, activation codes, setups, PINs reveal, updates, usage. Delete their files only if nothing imports them.

## 6. Browser print shows a proper bill
- When there's no printer helper, browser printing (the receipt button and the delivery "Print bill") prints **only a bill**: restaurant name, order number, date, items, totals, payment and, for deliveries, the customer, phone and address.
- Use a print-only bill view with `@media print` that hides the rest of the app. One shared component serves both buttons.
- Check C-12: in the evaluator, stub `window.print` and compare the printed DOM with the order.

## Out of scope
Per-restaurant WhatsApp bot and riders (slice D), Bridge as a Windows app (slice E), payment gateway, self-signup.
