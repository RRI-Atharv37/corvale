---
title: Sessions and Logout
---

## How sessions work

When you sign up or sign in, Corvale issues two tokens:

| Token | Storage | Lifetime |
|-------|---------|----------|
| **Access token (JWT)** | In memory only, never stored | Short (default **15 minutes**) |
| **Refresh token** | httpOnly cookie (`corvale_refresh`) | Longer (default **7 days**) |

The access token is sent on every API request. Because it is held in memory, a page reload discards it and Corvale fetches a new one from the refresh cookie. When it expires, the frontend automatically calls `POST /auth/refresh` using that cookie to obtain a new access token without interrupting your work.

## Automatic session restore

When you open Corvale:

1. The app has no access token in memory yet, so it calls `POST /auth/refresh` using the refresh cookie.
2. If the cookie is valid, Corvale receives a new access token and calls `GET /auth/user` to fetch your profile.
3. You remain signed in and can access all features.
4. If an access token later expires mid-session, the axios interceptor attempts a silent refresh.
5. If refresh fails, Corvale clears your session and redirects you to login.

While the session is being restored, you see a loading screen with the message "Loading...".

## Token expiry and refresh

- Access tokens expire based on `JWT_EXPIRY` (default: **15m**)
- Refresh tokens expire based on `JWT_REFRESH_EXPIRY` (default: **7d**)
- Each successful refresh rotates the refresh token (the old one is revoked)

## What happens on 401 errors

If an API request returns **401 Unauthorized** on a protected route, the axios interceptor tries to refresh once. If refresh succeeds, the original request retries automatically. If refresh fails, Corvale clears your token and redirects you to login.

## Logging out

Open **Settings** from the sidebar footer (gear icon next to your name), then click **Logout**.

Logout:

- Revokes the current refresh token on the server
- Clears the refresh cookie
- Discards the in-memory access token
- Clears the data Corvale cached in your browser for offline use
- Redirects you to the login page

## Logging out of all devices

In **Settings**, click **Logout all devices** and confirm.

This action:

- Increments your account's `tokenVersion` (invalidates all access tokens immediately)
- Revokes every refresh token for your account
- Signs you out locally

Use this after a password reset or if you suspect unauthorized access.

## Related pages

- [Signing In](./signing-in.md)
- [Account Settings](./account-settings.md)
- [Resetting Your Password](./resetting-your-password.md)
- [Authentication Overview](./overview.md)
