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
| `ALLOW_SIGNUP` | on | Set to `0` after you have created your owner accounts, so strangers can't sign up |

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
