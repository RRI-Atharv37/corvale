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
- Vitest + Supertest for testing

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
  middleware/         Auth, errors, rate limiting
  utils/              Shared helpers and balance engine
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

## Related pages

- [Project Structure](./project-structure.md)
- [Environment Variables](./environment-variables.md)
- [API Overview](./api-overview.md)
