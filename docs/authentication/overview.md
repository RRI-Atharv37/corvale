---
title: Authentication Overview
---

## How authentication works in spndr

spndr uses email-and-password authentication with JSON Web Tokens (JWT). When you sign up or sign in, the server validates your credentials and returns a token. The frontend stores this token and sends it with every protected request.

## What authentication protects

Every feature beyond login and signup requires a valid session:

- Dashboard and all summary data
- Income and expense entries
- Accounts
- Saver deposits and withdrawals
- Pushover rollovers and history

If your token is missing or expired, spndr redirects you to the login page.

## Your account information

Each spndr account stores:

| Field | Description |
|-------|-------------|
| **Full name** | Displayed in the sidebar and dashboard greeting |
| **Email** | Used to sign in; must be unique across all users |
| **Password** | Stored securely using bcrypt hashing; never sent back to the client |

spndr does not expose a profile-editing page. Your name and email are set at registration and displayed in the sidebar footer.

## Rate limiting on auth routes

Login and registration endpoints are rate-limited to protect against brute-force attempts. By default, you can make **10 requests per 15 minutes** per IP address on auth routes. If you exceed this limit, you receive a **429 Too Many Requests** response and must wait before trying again.

## Session persistence

spndr stores your JWT in the browser's local storage. When you reopen the app, spndr automatically restores your session by validating the token with the server. If the token is invalid, you are signed out and redirected to login.

## Related pages

- [Creating an Account](./creating-an-account.md)
- [Signing In](./signing-in.md)
- [Sessions and Logout](./sessions-and-logout.md)
