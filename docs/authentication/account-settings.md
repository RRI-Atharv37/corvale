---
title: Account Settings
---

## Preferences and session controls

Corvale exposes a **Settings** modal from the sidebar footer. Use it to change your default currency and manage sign-out actions.

## Open settings

1. Look at the bottom of the sidebar (desktop) or mobile menu.
2. Next to your name and email, click the **gear** icon.

The Settings modal opens with a **Profile** section followed by **Preferences** and **Account**.

## Profile

The **Profile** section shows your name and timezone.

- **Full name** is editable. Change it and click **Save profile**; Corvale saves it via `PATCH /auth/user` and a success toast confirms the update.
- **Timezone** is read-only. Corvale detects it from your device when you sign up, and re-checks it once per browser session, updating your profile automatically whenever your device's timezone changes. This keeps date filters, recurring due dates, budget periods, and reminders aligned with where you actually are. There is no timezone picker - the displayed value always reflects your current device.

## Default currency

Your **Default currency** preference pre-fills currency fields when you create budgets, savings goals, accounts, and transactions.

1. Open **Settings**.
2. Under **Preferences**, use the **Default currency** dropdown.
3. Select a supported currency (for example, USD, EUR, GBP).

Corvale saves the choice immediately via `PATCH /auth/user`. A success toast confirms the update. Existing records keep their original currency - only new forms default to the updated value.

## Logout

**Logout** ends your current browser session:

- Revokes the refresh token cookie on the server
- Clears the access token from local storage
- Redirects you to the login page

Use this when you finish on a shared or public computer.

## Logout all devices

**Logout all devices** revokes every active session for your account:

- Increments your account's token version (invalidates all access tokens)
- Revokes all stored refresh tokens
- Signs you out locally and redirects to login

Corvale asks for confirmation before proceeding. Use this if you suspect unauthorized access or want to reset sessions after a password change.

## What you cannot change in settings

The Settings modal does not currently let you edit:

- Email address
- Password (use [Resetting Your Password](./resetting-your-password.md) instead)

Timezone is managed automatically from your device and cannot be set by hand (see [Profile](#profile) above).

Your name and email remain visible in the sidebar footer for reference.

## Related pages

- [Sessions and Logout](./sessions-and-logout.md)
- [Authentication Overview](./overview.md)
- [Resetting Your Password](./resetting-your-password.md)
