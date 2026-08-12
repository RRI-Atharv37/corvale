---
title: Authentication Overview
---

## How authentication works in spndr

spndr uses email-and-password authentication with JSON Web Tokens (JWT). When you sign up or sign in, the server validates your credentials and returns a short-lived access token plus a refresh token stored in an httpOnly cookie. The frontend stores the access token and sends it with every protected request.

## What authentication protects

Every feature beyond login, signup, and password reset requires a valid session:

- Dashboard and all summary data
- Transactions, accounts, categories, budgets, and savings goals
- Saver deposits and withdrawals
- Pushover rollovers and history

If your session is missing or cannot be refreshed, spndr redirects you to the login page.

## Your account information

Each spndr account stores:

| Field | Description |
|-------|-------------|
| **Full name** | Displayed in the sidebar and dashboard greeting |
| **Email** | Used to sign in; must be unique across all users |
| **Password** | Stored securely using bcrypt hashing; never sent back to the client |
| **Preferred currency** | Default for new budgets, goals, accounts, and transactions |
| **Timezone** | Used for budget periods and date-boundary calculations |

Your name and email are set at registration. Change your default currency in [Account Settings](./account-settings.md). Name and email editing is not yet available in the UI.

## Password reset

If you forget your password, use the [Resetting Your Password](./resetting-your-password.md) flow. A successful reset revokes all active sessions.

## Rate limiting on auth routes

Login, registration, and password reset endpoints are rate-limited to protect against brute-force attempts. By default, you can make **10 requests per 15 minutes** per IP address on auth routes. If you exceed this limit, you receive a **429 Too Many Requests** response and must wait before trying again.

## Session persistence

spndr stores your access JWT in the browser's local storage and keeps the refresh token in an httpOnly cookie. When you reopen the app, spndr restores your session by validating or refreshing tokens with the server.

## Related pages

- [Creating an Account](./creating-an-account.md)
- [Signing In](./signing-in.md)
- [Resetting Your Password](./resetting-your-password.md)
- [Sessions and Logout](./sessions-and-logout.md)
- [Account Settings](./account-settings.md)
