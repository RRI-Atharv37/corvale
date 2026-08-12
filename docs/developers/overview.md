---
title: Developer Overview
---

## Building on spndr

This section documents the spndr codebase for developers who want to run, extend, or integrate with the application.

## Architecture summary

spndr is a full-stack TypeScript application split into two packages:

| Package | Location | Purpose |
|---------|----------|---------|
| **Backend** | `backend/` | REST API server (Express + MongoDB) |
| **Frontend** | `frontend/spndr/` | Single-page application (React + Vite) |

The frontend communicates with the backend over HTTP. All API routes live under `/api/v1`.

## Tech stack

### Backend

- TypeScript, Node.js, Express 5
- MongoDB with Mongoose ODM
- JWT access tokens with refresh token rotation (httpOnly cookie)
- bcryptjs password hashing and password reset tokens
- express-rate-limit for auth route protection
- Multer for receipt uploads; optional ClamAV virus scan
- Vitest + Supertest for testing (**159 backend tests**, 21 files)

### Frontend

- React 19, Vite 6, TypeScript
- Tailwind CSS 4
- React Router 7
- Axios for HTTP requests (auto-refresh on 401)
- react-hot-toast for notifications
- dayjs for date formatting

## Domain-oriented backend structure

```
backend/
  app.ts              Express app and route mounting
  server.ts           Database connection and server start
  config/db.ts        MongoDB connection
  controllers/        Request handlers per domain
  models/             Mongoose schemas
  routes/             Route definitions
  middleware/         Auth, errors, rate limiting, receipt upload
  utils/              Shared helpers, balance engine, budget/goal logic
  scripts/            Migration CLI
  tests/              Vitest test suites
```

## API response format

All API responses follow a consistent shape:

**Success:**

```json
{
  "success": true,
  "data": { }
}
```

**Error:**

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Human-readable error message"
}
```

## Authentication

Protected routes require a Bearer access token in the `Authorization` header:

```
Authorization: Bearer <jwt-access-token>
```

Obtain tokens via `POST /api/v1/auth/register` or `POST /api/v1/auth/login`. Refresh with `POST /api/v1/auth/refresh` (refresh token cookie required).

See [Authentication API](./authentication-api.md) for the full lifecycle including logout, logout-all, and password reset.

## Implemented features (Phases 0–4)

| Phase | Delivered |
|-------|-----------|
| **0** | Foundation fixes, dashboard shell, test infrastructure |
| **1a** | Accounts with server-derived balances |
| **1b** | Category hierarchy, master seed, CRUD |
| **1c** | Unified transactions — income, expense, transfer, splits, receipts, bulk ops |
| **2** | Refresh tokens, logout-all, password reset, ClamAV scan, production hardening |
| **3** | Budgets API and UI with progress tracking |
| **4** | Savings goals API and UI with contributions and auto-contribute |

**Not yet shipped:** recurring transactions (Phase 5), analytics dashboard (Phase 6), notifications (Phase 7), multi-user workspaces (Phase 8).

## Related pages

- [Project Structure](./project-structure.md)
- [Environment Variables](./environment-variables.md)
- [API Overview](./api-overview.md)
- [Budgets API](./budgets-api.md)
- [Savings Goals API](./savings-goals-api.md)
