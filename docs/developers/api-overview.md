---
title: API Overview
---

## Base URL

All API routes are prefixed with:

```
/api/v1
```

In local development, the full base URL is typically:

```
http://localhost:5000/api/v1
```

## Authentication

Most routes require a valid JWT token. Include it in the request header:

```
Authorization: Bearer <token>
```

Obtain a token from the auth endpoints documented in [Authentication API](./authentication-api.md).

Auth routes (`/auth/register`, `/auth/login`) are public but rate-limited.

## Response format

### Success

```json
{
  "success": true,
  "data": <payload>
}
```

The `data` field shape varies by endpoint.

### Error

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Error description"
}
```

## Route map

| Prefix | Domain | Auth required |
|--------|--------|---------------|
| `/auth` | Authentication | Partial (see auth docs) |
| `/transactions` | Unified transaction ledger | Yes |
| `/categories` | Category management | Yes |
| `/receipts` | Receipt upload and download | Yes |
| `/accounts` | Account management | Yes |
| `/budgets` | Budget CRUD and progress | Yes |
| `/savings-goals` | Savings goal CRUD, contributions, lifecycle | Yes |
| `/saver` | Saver deposits and withdrawals | Yes |
| `/pushover` | Rollover and history | Yes |
| `/income` | Legacy income CRUD (deprecated) | Yes |
| `/expense` | Legacy expense CRUD (deprecated) | Yes |

Legacy `/income` and `/expense` routes return `Deprecation` and `Link` headers pointing to `/transactions`. Prefer the [Transactions API](./transactions-api.md) for all new integrations.

## HTTP methods

spndr uses standard REST conventions:

| Method | Usage |
|--------|-------|
| `GET` | Read data |
| `POST` | Create resources or trigger actions |
| `PUT` | Update resources |
| `PATCH` | Partial bulk updates |
| `DELETE` | Delete or archive resources |

## Ownership and security

- All resource queries filter by the authenticated user's `userId`
- Cross-user access attempts return **403 Forbidden**
- Missing resources return **404 Not Found**
- Validation errors return **400 Bad Request**

## CORS

The backend allows requests from the origin specified in `CLIENT_URL` with credentials support. Allowed methods: GET, POST, PUT, PATCH, DELETE.

## Pagination

List endpoints for transactions support pagination query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | Page number (1-indexed) |
| `limit` | `10` | Items per page |

Paginated responses include a `meta` object with page number, total pages, and total count.

## Money format

Transaction amounts are stored as integer minor units (cents) in the database. API request and response bodies use major-unit decimals (for example, `42.99`) for client ergonomics.

## Related pages

- [Authentication API](./authentication-api.md)
- [Transactions API](./transactions-api.md)
- [Categories API](./categories-api.md)
- [Receipts API](./receipts-api.md)
- [Accounts API](./accounts-api.md)
- [Budgets API](./budgets-api.md)
- [Savings Goals API](./savings-goals-api.md)
- [Data Migration](./data-migration.md)
- [Saver API](./saver-api.md)
- [Pushover API](./pushover-api.md)
