---
title: Account Settings
---

## Preferences and session controls

Corvale exposes a **Settings** modal from the sidebar footer. Use it to change your preferences, manage your data, and control your sessions.

## Open settings

1. Look at the bottom of the sidebar (desktop) or mobile menu.
2. Next to your name and email, click the **gear** icon.

The Settings modal opens with a **Profile** section, followed by these, in order:

- **Preferences** - default currency, date format, cards per page, and bill reminders
- **Quick-add templates** - saved transaction shortcuts, see [Templates Overview](../templates/overview.md)
- **Exchange rates** - the rates used for converted balances, see [Multi-Currency Balances](../accounts/multi-currency-balances.md)
- **Backup and restore** - export and import your data, see [Backup and Restore](../backup-restore/overview.md)
- **Account** - the desktop app link, replaying the onboarding tour, and the two sign-out actions
- **Privacy and data** - your data rights and the legal documents, see [Your Data and Privacy](../legal/your-data-and-privacy.md)
- **Delete my account** - permanent deletion, at the very bottom

On builds with offline support switched on, two more sections appear before **Account**: local sync controls and your app PIN.

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
- Discards the in-memory access token
- Clears the data Corvale cached in your browser for offline use
- Redirects you to the login page

Use this when you finish on a shared or public computer.

## Logout all devices

**Logout all devices** revokes every active session for your account:

- Increments your account's token version (invalidates all access tokens)
- Revokes all stored refresh tokens
- Signs you out locally and redirects to login

Corvale asks for confirmation before proceeding. Use this if you suspect unauthorized access or want to reset sessions after a password change.

## Privacy and data

The **Privacy and data** section gathers your rights over your own records in one place: exporting a copy, correcting it, and deleting it. It also links every legal document and shows the date you accepted the current Terms and Privacy Policy.

See [Your Data and Privacy](../legal/your-data-and-privacy.md) for what each of those does and what deleting your account actually erases.

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
