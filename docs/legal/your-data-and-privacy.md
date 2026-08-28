---
title: Your Data and Privacy
description: What Corvale holds about you, and how to get a copy of it, correct it, or delete it.
---

## The short version

Corvale holds your name, your email, your preferences, and the financial records you enter
yourself. It has **no bank connection**, runs **no analytics**, and sets **one cookie** - the one
that keeps you signed in.

Corvale collects very little *about* you. What you *put into* it is another matter: a transaction
history describes where you go, what you buy, and what you owe. That is sensitive whoever holds
it, and it is protected accordingly - see [How we protect it](./privacy.md#how-we-protect-it).

Everything below is something you can do yourself, right now, from inside the app. Nothing here
needs you to email anyone or wait for a reply.

This page is a plain-language guide. The [Privacy Policy](./privacy.md) is the document that
actually governs it.

## Where the controls live

Open **Settings** from the sidebar footer (the gear icon next to your name) and scroll to
**Privacy and data**. It gathers your rights in one place, links every legal document, and shows
the date you accepted the current Terms and Privacy Policy.

## Get a copy of everything

Use **Backup and restore** in Settings.

- **JSON** - every record: transactions, accounts, categories, tags, budgets, savings goals,
  recurring rules, templates, reconciliation sessions, and saver history.
- **ZIP** - the same JSON plus every receipt file you have uploaded.

**Export is never restricted.** Not when your account is inactive, not in any billing state, not
ever. You can also export transactions as CSV from the Transactions page.

See [Backup and Restore](../backup-restore/overview.md) for the full walkthrough.

## Correct something

Everything in Corvale is editable in the app - transactions, accounts, categories, budgets, goals,
and your display name.

Two things you cannot currently change in the app: your **email address** and your **password**.
For a password, use **Forgot password?** on the login page, which sends a reset link. See
[Resetting Your Password](../authentication/resetting-your-password.md).

## Delete your account

Open **Settings**, scroll to **Delete my account**, and confirm with your password.

Deletion **immediately and irreversibly removes your account from the live service**. It is a real
erase, not a hidden flag. It removes:

- Your user account, including the record of which legal documents you accepted
- Every private transaction, account, category, tag, budget, savings goal, contribution, recurring
  rule, automation rule, and quick-add template you own (records in a shared workspace are handled
  differently - see below)
- Your saver balance and rollover history, your reconciliation sessions, and your saved reports
- Every receipt file you uploaded, without exception
- Any pending workspace invitations you sent or received
- Every active session, so you are signed out everywhere

It does **not** remove records created by other people in a workspace that carries on, and it does
not reach into backup copies that have not yet been overwritten — see [Backups](#backups) below.

### If you share a workspace

Records you added to a workspace that **still has other members** are **kept, with the link to you
removed**. They stay in the workspace so everyone else's balances and history remain correct, but
they are no longer connected to your account or attributed to you. Corvale shows you what this
will affect before you confirm, and tells the remaining members afterwards that a member left -
without naming you.

If nobody else is left in a workspace, the whole workspace is deleted along with everything in it -
including anything contributed by members who had already left, which nobody could reach any more.
Receipts you uploaded are always deleted outright, wherever they were attached.

Leaving a workspace instead of deleting your account does something different: your records stay
there and **you** lose access to them.

### Export first

There is no undo and no grace period. Take an export before you delete if you want a copy.

### If you own a shared workspace

Corvale blocks the deletion if you are the sole owner of a workspace that still has other members,
so that deleting your account can never quietly destroy someone else's shared data. Transfer
ownership or delete the workspace first, then try again. See
[Creating and Inviting](../workspaces/creating-and-inviting.md).

### Backups

Your account disappears from the live database the moment you delete it. Corvale keeps operational
backups so the service can be recovered after a failure, and a deleted account can persist in one
of those for as long as that backup is retained, after which it is overwritten. The retention
period is stated in the [Privacy Policy](./privacy.md) and the [Terms of Service](./terms.md).

## What Corvale does not do

- **No bank connection.** Corvale never links to your bank, so it never sees your banking
  credentials, your real balances, or any transaction you did not enter or import yourself.
- **No analytics.** No page-view tracking, no product analytics, no session recording.
- **No advertising or third-party trackers**, and no device fingerprinting.
- **No externally hosted fonts, and no third-party scripts** — except hCaptcha on the signup page,
  and only where the signup captcha is switched on. Everything else the app loads comes from
  Corvale's own servers, so no third party learns that you visited.
- **No date of birth.** Corvale asks only whether you are 18 or older, and stores just that answer.
- **No IP address or device details kept against your account profile or your login sessions.**
  Your IP address is processed briefly as a rate-limit counter and then expires.

## Ask a human

The self-serve tools above are immediate and need no request, so try them first. If you would
rather Corvale handled something for you, or you want to make a complaint, the Grievance Officer's
details and the stated response window are on the [Contact](./contact.md) page.

## Related pages

- [Privacy Policy](./privacy.md)
- [Cookie Policy](./cookies.md)
- [Terms of Service](./terms.md)
- [Contact](./contact.md)
- [Backup and Restore](../backup-restore/overview.md)
- [Account Settings](../authentication/account-settings.md)
