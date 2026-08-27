---
title: Editing and Archiving Accounts
---

## Update or remove accounts

You can edit account details or archive accounts you no longer use.

## Editing an account

1. Find the account in the list on the **Accounts** page.
2. Click the **pencil icon** on the right side of the row.
3. In the edit modal, update:
   - **Name** - the display name
   - **Type** - checking, cash, credit, or savings
4. Click **Save changes**.

You cannot edit the currency or balance through the edit form. Currency is set at creation time only.

## Archiving an account

Archiving hides an account without permanently deleting it.

1. Find the account in the list.
2. Click the **trash icon** on the right side of the row.
3. Confirm archiving in the dialog.

When you archive an account:

- It disappears from your active account list
- Its default flag is cleared
- It is excluded from balance calculations
- It cannot be edited while archived

## Restrictions

- You cannot edit an archived account.
- You cannot update `openingBalance` or `currentBalance` through the API or UI - balance fields are server-managed.
- Archiving is a soft delete - the account record remains in the database.

## Empty state

If you have no accounts, Corvale shows:

- **Title:** No accounts yet
- **Description:** Create your first account to start tracking balances.

## Related pages

- [Creating an Account](./creating-an-account.md)
- [Default Accounts](./default-accounts.md)
- [Accounts Overview](./overview.md)
