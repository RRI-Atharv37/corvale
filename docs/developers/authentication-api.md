---
title: Authentication API
---

## Endpoints

All auth routes are mounted at `/api/v1/auth`.

## POST /auth/register

Create a new user account. **Rate-limited.**

### Request body

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "password": "securepassword"
}
```

### Success response (201)

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "_id": "...",
      "fullName": "Jane Doe",
      "email": "jane@example.com"
    }
  }
}
```

### Errors

| Status | Condition |
|--------|-----------|
| 400 | Missing fields or duplicate email |
| 429 | Rate limit exceeded |

## POST /auth/login

Authenticate an existing user. **Rate-limited.**

### Request body

```json
{
  "email": "jane@example.com",
  "password": "securepassword"
}
```

### Success response (200)

Same shape as register — returns `token` and `user`.

### Errors

| Status | Condition |
|--------|-----------|
| 400 | Missing fields or invalid credentials |
| 429 | Rate limit exceeded |

## GET /auth/user

Return the current authenticated user. **Requires auth.**

### Headers

```
Authorization: Bearer <token>
```

### Success response (200)

```json
{
  "success": true,
  "data": {
    "_id": "...",
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Password is never included in the response.

### Errors

| Status | Condition |
|--------|-----------|
| 401 | Missing or invalid token |
| 404 | User not found |

## JWT details

- Signed with `JWT_SECRET` from environment
- Expiry set by `JWT_EXPIRY` (e.g., `7d`)
- Payload contains `{ id: userId }`

## Password hashing

Passwords are hashed with bcrypt (10 salt rounds) via a Mongoose pre-save hook on the User model. Plain-text passwords are never stored.

## Rate limiting

Register and login share a rate limiter:

- Default: **10 requests per 15 minutes** per IP
- Configurable via `AUTH_RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_WINDOW_MS`

## Related pages

- [API Overview](./api-overview.md)
- [Creating an Account](../authentication/creating-an-account.md)
