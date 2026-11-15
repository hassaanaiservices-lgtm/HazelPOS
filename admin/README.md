# HazelPOS Admin

Your own dashboard for running HazelPOS as a business: clients, onboarding, memberships, health and AI usage. It's a
separate app with its own address and login. It never touches a database: it passes your requests to HazelPOS Cloud's
vendor API, holding the cloud's secret key (`VENDOR_API_KEY`) on its server so it never reaches a browser.

```
Restaurant PCs (installed POS) ──► HazelPOS Cloud (cloud/) ◄── HazelPOS Admin (admin/) ◄── you, in a browser
```

## Screens

- **Clients**: everyone at a glance. Membership (paid / due in N days / ended / suspended), each branch's stage
  (New → Setup in progress → Activated → Running / Offline / Setup failed), last seen, errors in the last 24 h, AI
  replies. A **Needs attention** filter shows who's unpaid, due soon, offline or has errors.
- **Client**: payments (**Paid: +1 month**, +3 months, set date, suspend/resume), details, branches, **Add branch**
  (gives the activation code).
- **Branch**: the setup you prepare before they install: details, menu (upload their Excel), menu pictures, tables,
  delivery areas, staff and PINs. Then the activation code, and **Health & errors**: app version, WhatsApp status,
  cloud sync, orders today, and the error log from their POS.
- **AI usage**: per month, replies, voice notes, tokens and an estimated cost per branch, so you can see whether each
  fee covers its AI use.

## Onboarding a restaurant

1. **Clients → New client**: name, phone, plan, paid-until.
2. **Add branch**: you get its activation code (`HZ-XXXX-XXXX`, shown once; you can always make a new one).
3. Open the branch and fill every tab: details, menu, pictures, tables, delivery areas, staff. The **Overview** tab
   ticks each one off.
4. Send them the installer and the code. They install, type the code, and their POS downloads the setup, replacing
   the demo restaurant. Overview then shows **Activated** and **Setup on their PC**.
5. From then on the branch reports every few hours. Check **Needs attention** daily.

The code works once. For a new PC or a reinstall, make a new code: when it's used, the old PC stops working. The setup
only goes to a POS with no orders yet, so it never overwrites real work.

## Run it

```bash
npm --prefix admin install
npm --prefix admin run build
ADMIN_PASSWORD='a long password' CLOUD_URL=http://localhost:4200 VENDOR_API_KEY=<same as the cloud> npm run admin
# → http://localhost:4400
```

While changing the screens: run the line above, plus `npm run admin:dev` (http://localhost:5174, reloads on save).

| Variable | Meaning |
| --- | --- |
| `ADMIN_PASSWORD` | Your login here, 12+ characters. 5 wrong tries lock that address out for 15 minutes |
| `CLOUD_URL` | Your HazelPOS Cloud, e.g. `https://cloud.example.com` |
| `VENDOR_API_KEY` | The same 32+ character secret set on the cloud (`openssl rand -hex 32`) |
| `PORT` | Default `4400` |

## Deploy on Railway

A second service in the same Railway project as the cloud:

1. **New → GitHub repo → HazelPOS**. Build command `npm --prefix admin ci && npm --prefix admin run build`, start
   command `node admin/server.js`.
2. Variables: `ADMIN_PASSWORD`, `CLOUD_URL` (the cloud's Railway domain), `VENDOR_API_KEY` (same as the cloud).
3. **Generate domain**. Only you need this address: don't link it from the site.

Logins live in memory, so a redeploy means logging in again. The cookie is HttpOnly and SameSite=Strict, and writes
also need a header only this app's pages send.
