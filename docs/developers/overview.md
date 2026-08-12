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
- JWT authentication with bcryptjs password hashing
- express-rate-limit for auth route protection
- Multer for receipt uploads
- Vitest + Supertest for testing (87 backend tests)

### Frontend

- React 19, Vite 6, TypeScript
- Tailwind CSS 4
- React Router 7
- Axios for HTTP requests
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
  utils/              Shared helpers, balance engine, transaction logic
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

Protected routes require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <jwt-token>
```

Obtain a token via `POST /api/v1/auth/register` or `POST /api/v1/auth/login`.

## Phase 1 highlights

Phase 1 delivered accounts, categories, and a unified transaction model:

- **Accounts** - multi-account tracking with server-derived balances
- **Categories** - master seed plus user sub-categories with icons and colors
- **Transactions** - income, expense, and transfer types with search, filter, sort, CSV export, splits, receipts, and bulk operations
- **Migration** - CLI script to copy legacy Income/Expense data into Transaction records

See [Transactions API](./transactions-api.md), [Categories API](./categories-api.md), and [Data Migration](./data-migration.md) for integration details.

## Related pages

- [Project Structure](./project-structure.md)
- [Environment Variables](./environment-variables.md)
- [API Overview](./api-overview.md)
