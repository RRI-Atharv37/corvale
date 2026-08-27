---
title: Signing In
---

## Sign in to your account

If you already registered, use the login page to access your data.

## Step-by-step sign in

1. Open Corvale and navigate to `/login`.
2. Enter your **Email address** and **Password**.
3. Click **Sign in**.

On success, Corvale stores your access token, sets a refresh token cookie, updates your session, shows a welcome toast notification, and redirects you to the **Dashboard**.

## Forgot password

If you cannot remember your password, click **Forgot password?** on the login page. See [Resetting Your Password](./resetting-your-password.md).

## Validation rules

Before contacting the server, the login form checks:

- The email is in a valid format
- The password field is not empty

If either check fails, Corvale shows an inline error message.

## Invalid credentials

If the email or password does not match any account, Corvale returns an error without revealing which field was wrong. This protects your account from enumeration attacks.

## Already signed in

If you visit the login page while already authenticated, Corvale redirects you to the dashboard automatically. You do not need to sign in again.

## Rate limiting

Repeated failed login attempts count toward the auth rate limit (10 requests per 15 minutes by default). If you hit the limit, wait before trying again.

## Related pages

- [Creating an Account](./creating-an-account.md)
- [Sessions and Logout](./sessions-and-logout.md)
