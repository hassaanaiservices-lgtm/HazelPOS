# 🍕 Pizza Venu - Modern Restaurant POS System

A fast, touch-friendly, dark-mode Restaurant Point of Sale (POS) system built with React, Node.js Express, and SQLite. Inspired by Odoo Restaurant POS with a cleaner, simplified workflow designed for speed.

---

## ✨ Features

- **🍽️ Floor Plan & Table Management**:
  - Multi-floor dining spaces (Main Dining, Family Section, Patio & Outdoor, Rooftop Terrace).
  - Dynamic table shapes (square, round, rectangular) with chair indicators.
  - Floor color themes and live occupancy badges.
  - In-place floor renaming and custom color palettes.
- **📱 Table QR Code Ordering (Self-Order)**:
  - Each dining table has its own unique, tamper-proof QR code.
  - Customers scan with their phone camera to browse the live menu, customize items, and place orders.
  - Orders pop up instantly on staff screens with audio alerts for approval before reaching the kitchen.
  - Printable table QR card sheets with WiFi instructions.
- **⚡ Fast POS Register**:
  - Dine-in, Takeaway, and Delivery order types.
  - Category filters, real-time search, item modifiers & kitchen notes.
  - Discounts, taxes (PKR / Rs.), quick cash denomination buttons, card, and digital payment methods.
  - Thermal receipt printing support.
- **👨‍🍳 Kitchen Display System (KDS)**:
  - Live kitchen tickets with status transitions (`New` ➔ `Preparing` ➔ `Ready` ➔ `Done`).
  - Timer indicators showing wait times for tables and takeout orders.
- **💵 Cash Drawer & Shift Sessions (Z-Report)**:
  - Open/Close cash register sessions.
  - Track opening cash, cash sales, cash in / cash out movements.
  - Automated reconciliation and difference calculation.
- **📊 Invoicing & Expense Tracking**:
  - Detailed daily/weekly reports with sales by hour, payment method, and top products.
  - Expense logger with categories (Ingredients, Packaging, Utilities, etc.) and net profit tracking.
- **🔒 PIN-Based Role Access**:
  - Admin/Owner: Full access (Settings, Reports, Invoicing, Floors, Menu).
  - Cashier: Register, Orders, Tables, and Cash Drawer.
  - Kitchen: Dedicated touch-screen KDS view.

---

## 🚀 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v20+ recommended)

### 2. Installation
Clone the repository and install dependencies:

```bash
# Clone the repository
git clone <your-repo-url>
cd POS

# Install client dependencies
cd client
npm install

# Install server dependencies
cd ../server
npm install
```

### 3. Running Locally
From the root project directory:

```bash
npm run dev
```

This launches both:
- **Backend API**: `http://localhost:4000`
- **Frontend POS Client**: `http://localhost:5173`

---

## 🔑 Default PINs

| Role | PIN |
|---|---|
| **Owner / Admin** | `1234` |
| **Cashier** | `1111` |
| **Kitchen Display** | `2222` |

---

## 🛠️ Tech Stack
- **Frontend**: React 19, Vite, Vanilla CSS design tokens.
- **Backend**: Node.js, Express, SQLite (`node:sqlite`).
- **Tools**: `qrcode` generator, cross-device LAN networking.
