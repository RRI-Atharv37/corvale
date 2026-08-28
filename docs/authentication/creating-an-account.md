---
title: Creating an Account
---

## Sign up for Corvale

You need an account before you can track finances. Registration is free and takes less than a minute.

## Step-by-step registration

1. Open Corvale in your browser.
2. On the login page, click **Sign up** (or navigate directly to `/signup`).
3. Fill in the registration form:
   - **Full Name** - your display name (required)
   - **Email address** - a valid email you can access (required)
   - **Password** - at least **12 characters** (required). Corvale sets no other composition rule: no forced symbol, no forced digit. Length is what matters, so a memorable passphrase works well
4. Tick **I am 18 years of age or older** (required).
5. Click **Sign up**. Creating an account means you agree to the
   [Terms of Service](../legal/terms.md) and acknowledge the
   [Privacy Policy](../legal/privacy.md), both linked below the button.

If registration succeeds, Corvale:

- Creates your user account in the database
- Hashes your password securely before storing it
- Records which version of the Terms and Privacy Policy you accepted, and that you confirmed you are 18 or older
- Sends a verification link to your email address
- Signs you in and takes you to the **verify your email** screen

## Verifying your email

Corvale emails you a verification link as soon as you sign up, and you have to click it before you can use the app - the dashboard and every other page stay locked until your address is confirmed. This matters because your email is where a password reset is sent.

The link is short-lived - 10 minutes by default. If it expires or the email never arrives, use **Resend verification email** on the verify screen (or open `/verify-email` and enter your address), then check your spam folder.

If you close the tab before verifying and come back later, signing in takes you straight back to the verify screen - you will not be signed all the way in until the address is confirmed.

## Validation rules

Corvale validates your input before creating an account:

- All three fields must be filled in
- The password must be at least 12 characters, and no longer than 72 bytes
- The email must be in a valid email format
- The email must not already belong to an existing user
- You must confirm that you are 18 or older
- If the deployment has the signup captcha switched on, you must complete it

If any validation fails, Corvale shows an error message on the form and does not create the account.

### Why Corvale asks your age

You must be 18 or older to use the hosted Corvale service. India's Digital Personal Data
Protection Act treats anyone under 18 as a child and requires verified parental consent before
their data can be processed, which Corvale cannot reliably do. Corvale stores only your answer to
that question - never your date of birth. See the [Privacy Policy](../legal/privacy.md).

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
