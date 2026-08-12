<div align="center">

# spndr

**Personal finance, simplified**
**Track income, expenses, accounts, and savings in one place.**

Built for students and young adults who want clarity over complexity.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE) [![Release](https://img.shields.io/badge/release-v0.1.0-green.svg)](https://github.com/RRI-Atharv37/spndr/releases) [![GitHub stars](https://img.shields.io/github/stars/RRI-Atharv37/spndr?style=social)](https://github.com/RRI-Atharv37/spndr/stargazers)


<!-- Hero banner - replace src with your screenshot or GIF -->
<img src="docs/public/screenshots/hero-dashboard.png" alt="spndr dashboard preview" width="900" />
<br />

[Quick Start](#-quick-start-3-minute-setup) · [Features](#-key-features) · [Documentation](#-documentation) · [Roadmap](#-roadmap)

</div>

---

## ✨ Key Features

<table>
<tr>
<td width="50%" valign="top">

### Spendable Balance & Net Worth

Dual metrics with smart **Saver pool** math - legacy mode (income - expenses) or **accounts mode** (checking, cash, credit, savings). Spendable balance excludes savings and reflects what you can actually use today.

### Income & Expense Management

Full CRUD in the dashboard with paginated lists, create/edit modals, and delete confirmations. Real-time summary metrics on the home dashboard.

### Multi-Account Tracking

Create checking, cash, credit, and savings accounts with opening balances. Set a default account, archive inactive ones, and let balances drive net worth automatically.

</td>
<td width="50%" valign="top">

### Pushover Month-End Rollover

Automated rollover engine snapshots your Saver balance at month-end, resets the pool, and keeps a browsable history - so every month starts clean.

### Battle-Tested Backend

Isolated **Vitest + Supertest** suite with **in-memory MongoDB**. Critical paths covered: auth, saver, pushover, ownership, aggregation, and route ordering.

### Modern Dark UI

Responsive dashboard shell - sidebar, mobile slide-out nav, loading/error/empty states, and toast feedback. Built with **React 19**, **Vite 6**, and **Tailwind CSS 4**.

</td>
</tr>
</table>

<details>
<summary><strong>Also included in v0.1.0</strong></summary>

- JWT authentication with session restore, bcrypt password hashing, and auth rate limiting
- Saver deposits by percentage or custom amount, with withdrawal guards
- Expense API extras - search, date filters, group-by-category, group-by-payment-method, CSV download, and reports
- Compound database indexes and production-safe error handling
- Typed frontend API layer with reusable hooks and form components

</details>

---

## Screenshots

<!-- Replace placeholder paths when assets are ready -->

### Dashboard

<p align="center">
  <img src="docs/public/screenshots/dashboard-overview.png" alt="Dashboard overview" width="720" />
  <br />
  <em>Summary cards & quick links</em>
</p>

### Income

<p align="center">
  <img src="docs/public/screenshots/income.png" alt="Income page" width="720" />
  <br />
  <em>Paginated list, create/edit modals, and delete confirmations</em>
</p>

### Expense

<p align="center">
  <img src="docs/public/screenshots/expense.png" alt="Expense page" width="720" />
  <br />
  <em>Track spending with categories, payment methods, and tags</em>
</p>

### Accounts

<p align="center">
  <img src="docs/public/screenshots/accounts.png" alt="Accounts page" width="720" />
  <br />
  <em>Multi-account balances - checking, cash, credit, and savings</em>
</p>

### Saver

<p align="center">
  <img src="docs/public/screenshots/saver.png" alt="Saver page" width="720" />
  <br />
  <em>Allocate from spendable balance by percentage or custom amount</em>
</p>

### Pushover

<p align="center">
  <img src="docs/public/screenshots/pushover.png" alt="Pushover page" width="720" />
  <br />
  <em>Month-end rollover with snapshot history</em>
</p>

---

## 🛠 Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend** | ![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white) ![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white) ![Mongoose](https://img.shields.io/badge/Mongoose-880000?logo=mongodb&logoColor=white) ![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white) |
| **Frontend** | ![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black) ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) ![Axios](https://img.shields.io/badge/Axios-5A29E4?logo=axios&logoColor=white) |

---

## Quick Start (3-Minute Setup)

### Prerequisites

| Tool | Version |
| :--- | :--- |
| [Node.js](https://nodejs.org/) | 18+ |
| [MongoDB](https://www.mongodb.com/) | 6+ |
| npm | Included with Node.js |

### 1 · Clone & install

```bash
git clone https://github.com/RRI-Atharv37/spndr.git
cd spndr

# Backend
cd backend && npm install

# Frontend (new terminal)
cd frontend/spndr && npm install
```

### 2 · Configure environment

**Backend** - create `backend/.env`:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/spndr
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRY=7d
CLIENT_URL=http://localhost:5173
```

**Frontend** - copy the example file:

```bash
cp frontend/spndr/.env.example frontend/spndr/.env
```

Default `VITE_API_URL` points to `http://localhost:5000/api/v1`.

### 3 · Run everything

```bash
# Terminal 1 - API (from backend/)
npm run dev

# Terminal 2 - App (from frontend/spndr/)
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** → sign up → explore the dashboard.

<details>
<summary><strong>Optional: docs site & tests</strong></summary>

```bash
# Documentation (from docs/) - http://localhost:5174
cd docs && npm install && npm run dev

# Backend tests (from backend/)
npm test
```

</details>

---

## 📖 Documentation

> **Full guides, architecture notes, and API specs live in the docs site - not in this README.**

<table>
<tr>
<td>

### [Browse the Docs Site](http://localhost:5174)

Run locally with `npm run dev` inside [`./docs`](./docs). Covers:

- Getting started & installation
- Dashboard, Income, Expense, Accounts, Saver, Pushover
- Balance calculation deep-dives
- Complete REST API reference (`/api/v1`)

</td>
<td align="center" width="120">

<br />

[Get Started →](http://localhost:5174/getting-started/introduction)

</td>
</tr>
</table>

Source lives in [`./docs`](./docs) (VitePress). Build for production with `npm run build` inside that folder.

---

## Roadmap

| Phase | Focus | Status |
| :--- | :--- | :--- |
| **Phase 0** | Foundation - auth, CRUD, Saver, Pushover, test infra, dark UI | ✅ **Complete** · `v0.1.0` |
| **Phase 1** | Accounts & Unified Transactions | 🔜 **Up next** |

Phase 0 delivered a production-ready core: secure API, income/expense/saver/pushover flows, Vitest coverage, and a polished dark dashboard. Phase 1 builds on that with hierarchical categories and a unified transaction model.

---

## 📄 License & Author

Copyright © 2026 **[Atharv Dewangan](https://github.com/RRI-Atharv37)**

Licensed under the [Apache License 2.0](LICENSE).

---

<div align="center">

**[⭐ Star this repo](https://github.com/RRI-Atharv37/spndr)** if spndr helps you stay on top of your money.

</div>

## Repo Activity
![Alt](https://repobeats.axiom.co/api/embed/a35a45d469d53d0e2e33c47a53cea9e1af404253.svg "Repobeats analytics image")