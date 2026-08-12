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
| `/income` | Income CRUD and queries | Yes |
| `/expense` | Expense CRUD and queries | Yes |
| `/accounts` | Account management | Yes |
| `/saver` | Saver deposits and withdrawals | Yes |
| `/pushover` | Rollover and history | Yes |

## HTTP methods

spndr uses standard REST conventions:

| Method | Usage |
|--------|-------|
| `GET` | Read data |
| `POST` | Create resources or trigger actions |
| `PUT` | Update resources |
| `DELETE` | Delete or archive resources |

## Ownership and security

- All resource queries filter by the authenticated user's `userId`
- Cross-user access attempts return **403 Forbidden**
- Missing resources return **404 Not Found**
- Validation errors return **400 Bad Request**

## CORS

The backend allows requests from the origin specified in `CLIENT_URL` with credentials support. Allowed methods: GET, POST, PUT, DELETE.

## Pagination

List endpoints for income and expense support pagination query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `page` | `1` | Page number (1-indexed) |
| `limit` | `10` | Items per page |

Paginated responses include a `meta` object with page number, total pages, and total count.

## Related pages

- [Authentication API](./authentication-api.md)
- [Income API](./income-api.md)
- [Expense API](./expense-api.md)
- [Accounts API](./accounts-api.md)
- [Saver API](./saver-api.md)
- [Pushover API](./pushover-api.md)
