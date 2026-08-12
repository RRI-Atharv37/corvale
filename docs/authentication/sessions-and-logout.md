---
title: Sessions and Logout
---

## How sessions work

When you sign up or sign in, spndr issues two tokens:

| Token | Storage | Lifetime |
|-------|---------|----------|
| **Access token (JWT)** | Browser local storage | Short (default **15 minutes**) |
| **Refresh token** | httpOnly cookie (`spndr_refresh`) | Longer (default **7 days**) |

The access token is sent on every API request. When it expires, the frontend automatically calls `POST /auth/refresh` using the refresh cookie to obtain a new access token without interrupting your work.

## Automatic session restore

When you open spndr:

1. The app checks local storage for a saved access token.
2. If a token exists, spndr calls `GET /auth/user` to fetch your profile.
3. If the token is valid, you remain signed in and can access all features.
4. If the token is expired, the axios interceptor attempts a silent refresh.
5. If refresh fails, spndr clears your session and redirects you to login.

While the session is being restored, you see a loading screen with the message "Loading...".

## Token expiry and refresh

- Access tokens expire based on `JWT_EXPIRY` (default: **15m**)
- Refresh tokens expire based on `JWT_REFRESH_EXPIRY` (default: **7d**)
- Each successful refresh rotates the refresh token (the old one is revoked)

## What happens on 401 errors

If an API request returns **401 Unauthorized** on a protected route, the axios interceptor tries to refresh once. If refresh succeeds, the original request retries automatically. If refresh fails, spndr clears your token and redirects you to login.

## Logging out

Open **Settings** from the sidebar footer (gear icon next to your name), then click **Logout**.

Logout:

- Revokes the current refresh token on the server
- Clears the refresh cookie
- Removes the access token from local storage
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
