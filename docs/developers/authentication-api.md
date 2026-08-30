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
  "password": "securepassword",
  "timezone": "America/New_York"
}
```

`timezone` is optional. The web client auto-detects it from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and sends it here. An invalid or missing value falls back to `UTC` rather than failing the request.

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
      "preferredCurrency": "USD",
      "timezone": "America/New_York"
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
| 403 | Email address not verified - no session is issued; verify first (see below) |
| 429 | Rate limit exceeded |

## POST /auth/email-verification/confirm

Confirm an email address with the token from the verification email. **Public** (no Bearer header), rate-limited.

### Request body

```json
{
  "token": "<verification-token-from-email>"
}
```

## POST /auth/email-verification/resend

Send a fresh verification link. **Rate-limited.** Optional auth:

- **With** a Bearer token - resends for that account. Returns `EMAIL_ALREADY_VERIFIED` if it is already verified.
- **Without** a token - pass `{ "email": "jane@example.com" }` in the body. Always returns the same generic success message whether or not the account exists or is already verified (enumeration-safe). This is the path for a user blocked at login.

## POST /auth/refresh

Issue a new access token using the refresh token. **Public** (no Bearer header). Rotates the refresh token on success.

The refresh token normally travels in the httpOnly `corvale_refresh` cookie. The desktop app is an exception - it runs at a different origin from the API, so the cookie is never sent. It instead passes the token in the request body:

```json
{
  "refreshToken": "…"
}
```

The body value takes precedence over the cookie when both are present. A missing body value simply falls back to the cookie, so web clients send an empty body.

### Success response (200)

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

For a desktop-app request (identified by its `Origin`), the response also carries the rotated refresh token so the app can store it in the operating system's keychain:

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "…"
  }
}
```

`POST /auth/register` and `POST /auth/login` include the same `refreshToken` field for desktop-app requests, and omit it for web requests.

### Errors

| Status | Condition |
|--------|-----------|
| 401 | Missing, invalid, expired, or revoked refresh token |

## POST /auth/logout

Revoke the current refresh token and clear the cookie. **Requires auth.** A desktop client passes the token it holds in the body as `{ "refreshToken": "…" }` so the server can revoke the right one.

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

Both fields are optional. Supported currencies are validated server-side. An invalid `timezone` here returns `400` (unlike `POST /auth/register`, which falls back to `UTC`) - this endpoint is a deliberate client call, and the web client also uses it to re-sync the detected timezone once per session.

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

### Desktop clients

The cookie only works when the frontend and API share a registrable domain (see [Deployment topology](./environment-variables.md#deployment-topology)). The packaged desktop app does not, so it uses a non-cookie path instead: it receives the rotated refresh token in the response body and stores it in the OS keychain (Windows Credential Manager, macOS Keychain, or the Linux Secret Service), then presents it in the body of `POST /auth/refresh` and `POST /auth/logout`. The server only returns a token in the body when the request's `Origin` is the desktop app's; browsers cannot forge that header, so the web app can never receive the refresh token in a response body.

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
