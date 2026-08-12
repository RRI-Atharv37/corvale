---
title: Default Accounts
---

## What is a default account?

Each user can have exactly **one default account** at a time among active (non-archived) accounts. The default account is marked with a cyan **Default** badge in the account list.

## Automatic default assignment

When you create your first active account, spndr automatically sets it as the default. You do not need to take any extra steps.

## Changing the default account

To set a different account as default:

1. Navigate to the **Accounts** page.
2. Find the account you want to make default.
3. Click the **star outline icon** on the right side of the row.
4. spndr updates the default and shows a success notification.

The previously default account loses its default status automatically. Only one account can be default at a time.

## What default does not affect

The default account flag is a organizational marker. It does **not** currently affect:

- Where income or expense entries are posted (entries are not account-linked)
- Which account balance is used for calculations (all active accounts contribute)
- Automatic transaction routing

## Cannot unset default directly

You cannot remove the default flag from an account without setting another account as default. Attempting to set `isDefault: false` on the current default account returns an error.

## Default and archiving

When you archive an account that is the default, its default flag is cleared. If you have other active accounts, consider setting a new default before or after archiving.

## Related pages

- [Creating an Account](./creating-an-account.md)
- [Accounts Overview](./overview.md)
