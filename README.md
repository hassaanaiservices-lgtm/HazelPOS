# HazelPOS — Restaurant Point of Sale

A touch-friendly restaurant POS for Pakistani restaurants: counter billing, tables, kitchen screen, delivery, cash drawer,
inventory, staff salaries, and a WhatsApp assistant that takes orders (including voice notes). It runs on one PC on the
restaurant's network; other screens (kitchen, tablets, customers' phones) open it in a browser. Billing keeps working
without internet.

Built with React 19 + Vite (client), Node.js + Express (server) and SQLite (`node:sqlite`, no database server to install).

## Features

**Cashier**
- New order: dine-in, takeaway or delivery; sizes, add-ons and kitchen notes per item
- Floor plan with live occupancy, timers and several bills per table; move, merge and split bills
- Discounts (above a set % needs an admin PIN typed on the spot), promo codes, loyalty points by phone number
- Pay by cash (change shown), card, or online with your bank / Raast QR on screen
- Orders list with receipt reprint and refunds (cash refunds come out of the current shift; points and stock stay as they are)
- Cash drawer shifts: opening float, cash in/out, close with counted cash and a Z-report
- Delivery board: ready to send, on the way, delivered; take the cash-on-delivery per order (or all of a rider's delivered orders at once) once it is delivered
- Table QR codes: customers order from their phone, the order pops up for the cashier to accept
- WhatsApp inbox: reply to customers; accept or reject orders the assistant took

**Kitchen**
- Ticket board New → Preparing → Ready → Served, with timers and a beep on new orders

**Admin (owner)**
- Menu with sizes and option groups, categories, floors, tables, staff PINs, delivery areas, printers, restaurant details
- Inventory: ingredients, recipes per item and size (stock is deducted when an order is paid), stock counts and waste,
  low-stock alerts, suppliers with a khata (credit ledger)
- Staff: salaries and advances (each payment is added to Expenses automatically)
- Accounts: expenses, tax invoices (A4)
- Reports by day and hour, top items, Excel (CSV) exports
- Activity log of every change, with who made it
- Optional: thermal printers (network or USB), PRA / FBR fiscal reporting, HazelPOS Cloud (owner dashboard for all branches + daily backups)

**WhatsApp assistant** (optional)
- Answers menu and price questions in English, Roman Urdu or Urdu, takes orders, asks for the address, and hands the
  confirmed order to the cashier
- Voice notes are transcribed (Groq Whisper) and checked against the menu
- Details: [rag/README.md](rag/README.md)

## Install

You need [Node.js](https://nodejs.org/) 22.5 or newer.

```bash
git clone <repo-url> hazelpos
cd hazelpos
npm --prefix server install
npm --prefix client install
```

For the WhatsApp assistant, copy `.env.example` to `.env` and fill in the keys (DeepSeek for replies, Groq for voice notes).

## Run

**While developing** (auto-reload):

```bash
npm run dev
```

Open http://localhost:5173. The server runs on port 4000.

**At the restaurant** (one port, faster):

```bash
npm --prefix client run build
npm run server
```

Open http://localhost:4000 on the POS PC, or `http://<the PC's network address>:4000` from other devices on the same WiFi.

The database is created on first run at `server/pos.db` with a demo menu and tables. Back this file up: it holds
everything. (Settings → Cloud uploads a backup every day if you use HazelPOS Cloud.)

## First login

| Role | Default PIN | Sees |
| --- | --- | --- |
| Admin / owner | `1234` | Everything except taking orders |
| Cashier | `1111` | Orders, tables, kitchen, delivery, QR codes, WhatsApp, cash drawer |
| Kitchen | `2222` | Kitchen board only |

**Change all three PINs on day one** (Settings → Restaurant → Login PINs). Anyone who has read this README knows the defaults.

## First-day setup

1. Settings → Restaurant: name, address, NTN, tax rate (leave blank for no tax), printers, and what happens if someone
   takes cash while the cash drawer is closed (open a shift automatically, or refuse).
2. Settings → Menu, Categories, Floors, Tables, Delivery Zones.
3. Inventory → Stock: add the ingredients you buy, then Inventory → Recipes to say what goes into each item.
   Until you do, stock is not tracked (supplier bills can still be recorded as an amount).
4. Staff: add your staff with their monthly salary. Anyone whose job contains "Rider" appears on the Delivery board.
5. Cashier: Cash Drawer → open the first shift.

## Project layout

| Folder | What |
| --- | --- |
| `client/` | The POS screens (React) |
| `server/` | API, database, printing, fiscal, cloud sync, WhatsApp |
| `rag/` | The WhatsApp assistant's knowledge, prompts and tests |
| `cloud/` | HazelPOS Cloud: the owner's multi-branch dashboard ([cloud/README.md](cloud/README.md)) |

Never commit `.env`, `server/pos.db` (or its backups), `server/whatsapp/auth/` or `server/whatsapp/media/`; they hold
keys, customer data and the linked WhatsApp session. `.gitignore` already excludes them.
