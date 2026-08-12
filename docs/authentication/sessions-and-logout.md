---
title: Sessions and Logout
---

## How sessions work

When you sign up or sign in, spndr receives a JWT token from the server and saves it in your browser's local storage. On every subsequent page load, spndr sends this token to the server to confirm your identity before showing protected pages.

## Automatic session restore

When you open spndr:

1. The app checks local storage for a saved token.
2. If a token exists, spndr calls the `/auth/user` endpoint to fetch your profile.
3. If the token is valid, you remain signed in and can access all features.
4. If the token is invalid or expired, spndr clears it and redirects you to login.

While the session is being restored, you see a loading screen with the message "Loading...".

## Token expiry

JWT tokens expire based on the `JWT_EXPIRY` setting configured on the server (default: **7 days**). After expiry, you must sign in again.

## What happens on 401 errors

If any API request returns a **401 Unauthorized** response (except on auth routes), the axios interceptor clears your token. You are effectively signed out and must log in again on your next navigation.

## Logging out

To sign out:

1. Open the sidebar (desktop) or mobile menu.
2. Scroll to the bottom where your name and email appear.
3. Click **Logout**.

Logout is client-side only - spndr clears your token and user state from memory and local storage, shows a success notification, and redirects you to the login page. There is no server-side token revocation.

## Related pages

- [Signing In](./signing-in.md)
- [Authentication Overview](./overview.md)
