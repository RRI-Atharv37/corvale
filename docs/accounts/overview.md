---
title: Accounts Overview
---

## Organize where your money lives

The **Accounts** page lets you create and manage financial accounts - checking, cash, credit, and savings. Accounts give Corvale a clearer picture of your net worth and spendable balance.

Navigate to Accounts from the sidebar or go to `/accounts`.

## What you can do

On the Accounts page, you can:

- Create new accounts with an opening balance
- View all active accounts with their current balances
- Edit account name and type
- Set one account as your default
- Archive accounts you no longer need
- [Reconcile](./reconciling-an-account.md) an account against a bank statement
- View [converted balances](./multi-currency-balances.md) if you hold accounts in more than one currency

## How accounts affect your dashboard

When you create at least one active account, Corvale switches to **accounts mode** for balance calculations:

- **Net worth** derives from the sum of your account balances
- **Spendable balance** derives from checking and cash account balances minus your saver allocation
- An additional **In Accounts** card appears on the dashboard

When you have no active accounts, Corvale uses **legacy mode** where net worth equals total income minus total expenses.

See [How Balances Are Calculated](../balances/how-balances-are-calculated.md) for details.

## Transactions update account balances

Every transaction links to an account. When you create, edit, or delete an income, expense, or transfer entry, Corvale updates the linked account balance automatically. Opening balances set the starting point; transactions keep balances current.

## Archived accounts

Archiving an account hides it from your account list and removes it from balance calculations. Archived accounts are not permanently deleted - they remain in the database with `isArchived: true`.

## Related pages

- [Account Types](./account-types.md)
- [Creating an Account](./creating-an-account.md)
- [Editing and Archiving Accounts](./editing-and-archiving-accounts.md)
- [Default Accounts](./default-accounts.md)
- [Reconciling an Account](./reconciling-an-account.md)
- [Multi-Currency Balances](./multi-currency-balances.md)
- [Transactions Overview](../transactions/overview.md)
