---
title: Creating an Account
---

## Sign up for spndr

You need an account before you can track finances. Registration is free and takes less than a minute.

## Step-by-step registration

1. Open spndr in your browser.
2. On the login page, click **Sign up** (or navigate directly to `/signup`).
3. Fill in the registration form:
   - **Full Name** - your display name (required)
   - **Email address** - a valid email you can access (required)
   - **Password** - your chosen password (required)
4. Click **Sign up**.

If registration succeeds, spndr:

- Creates your user account in the database
- Hashes your password securely before storing it
- Issues a JWT token
- Signs you in automatically
- Redirects you to the **Dashboard**

## Validation rules

spndr validates your input before creating an account:

- All three fields must be filled in
- The email must be in a valid email format
- The email must not already belong to an existing user

If any validation fails, spndr shows an error message on the form and does not create the account.

## After registration

Once your account is created, you can immediately:

- View your (empty) dashboard summary
- Add income and expense entries
- Create financial accounts
- Use the saver and pushover features

## Switch to sign in

If you already have an account, click **Sign in** at the bottom of the registration form to go to the login page.

## Related pages

- [Signing In](./signing-in.md)
- [Authentication Overview](./overview.md)
