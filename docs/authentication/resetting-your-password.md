---
title: Resetting Your Password
---

## Recover access to your account

If you forget your password, Corvale provides a password reset flow. You request a reset link by email, then set a new password on a dedicated page.

## Request a reset link

1. Open the login page at `/login`.
2. Click **Forgot password?** (or navigate directly to `/forgot-password`).
3. Enter the **email address** associated with your Corvale account.
4. Click **Send reset link**.

Corvale always shows the same success message whether or not the email exists. This prevents attackers from discovering which emails have accounts.

### Rate limiting

Password reset requests share the same auth rate limit as login and registration (10 requests per 15 minutes per IP by default). Wait before retrying if you hit the limit.

### Email delivery

In local development, Corvale logs the reset link to the server console instead of sending email. Check the backend terminal output for a line like:

```
[password-reset] you@example.com: http://localhost:5173/reset-password?token=...
```

Production deployments need an SMTP or email provider wired to the reset flow (not yet included in the default setup).

## Set a new password

1. Open the reset link from your email or dev console. It points to `/reset-password?token=...`.
2. Enter a **New password** and **Confirm password**.
3. Click **Reset password**.

On success, Corvale:

- Updates your password (stored as a bcrypt hash)
- Revokes all existing refresh tokens and sessions
- Redirects you to the login page

You must sign in again on every device after a password reset.

## Invalid or expired tokens

Reset tokens expire after the duration configured on the server (`PASSWORD_RESET_EXPIRY_MS`, typically 1 hour). If the token is invalid or expired, Corvale shows an error and asks you to request a new link.

## Related pages

- [Signing In](./signing-in.md)
- [Sessions and Logout](./sessions-and-logout.md)
- [Authentication Overview](./overview.md)
