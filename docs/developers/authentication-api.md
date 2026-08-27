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
      "email": "jane@example.com",
      "preferredCurrency": "USD"
    }
  }
}
```

Also sets an httpOnly refresh token cookie.

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

Same shape as register - returns access `token`, `user`, and refresh cookie.

### Errors

| Status | Condition |
|--------|-----------|
| 400 | Missing fields or invalid credentials |
| 429 | Rate limit exceeded |

## POST /auth/refresh

Issue a new access token using the refresh token cookie. **Public** (no Bearer header). Rotates the refresh token on success.

### Success response (200)

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### Errors

| Status | Condition |
|--------|-----------|
| 401 | Missing, invalid, expired, or revoked refresh token |

## POST /auth/logout

Revoke the current refresh token and clear the cookie. **Requires auth.**

## POST /auth/logout-all

Revoke all refresh tokens and increment `tokenVersion` (invalidates all access tokens). **Requires auth.**

## POST /auth/password-reset/request

Request a password reset link. **Rate-limited.** Always returns the same success message regardless of whether the email exists.

### Request body

```json
{
  "email": "jane@example.com"
}
```

In development, the reset URL is logged to the server console.

## POST /auth/password-reset/confirm

Set a new password using a reset token. **Rate-limited.** Revokes all sessions on success.

### Request body

```json
{
  "token": "<reset-token-from-email>",
  "password": "newsecurepassword"
}
```

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
    "preferredCurrency": "USD",
    "timezone": "America/New_York",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Password is never included in the response.

### Errors

| Status | Condition |
|--------|-----------|
| 401 | Missing, expired, invalid, or revoked access token |
| 404 | User not found |

## PATCH /auth/user

Update user preferences. **Requires auth.**

### Request body

```json
{
  "preferredCurrency": "EUR",
  "timezone": "Europe/London"
}
```

Both fields are optional. Supported currencies are validated server-side.

## JWT details

- Access tokens signed with `JWT_SECRET`
- Access expiry: `JWT_EXPIRY` (default: `15m`)
- Payload includes `{ id: userId, tokenVersion }`
- Auth middleware rejects tokens when `tokenVersion` does not match the user record

## Refresh token cookie

- Cookie name: `corvale_refresh` (override with `REFRESH_TOKEN_COOKIE_NAME`)
- httpOnly, secure in production, sameSite `lax`
- Expiry: `JWT_REFRESH_EXPIRY` (default: `7d`)
- Stored hashed in the `RefreshToken` collection with rotation on each refresh

## Password hashing

Passwords are hashed with bcrypt (10 salt rounds) via a Mongoose pre-save hook. Plain-text passwords are never stored.

Reset tokens are hashed (SHA-256) before storage on the User document.

## Rate limiting

Register, login, and password reset share a rate limiter:

- Default: **10 requests per 15 minutes** per IP
- Configurable via `AUTH_RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_WINDOW_MS`

## Related pages

- [API Overview](./api-overview.md)
- [Environment Variables](./environment-variables.md)
- [Sessions and Logout](../authentication/sessions-and-logout.md)
