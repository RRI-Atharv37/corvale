---
title: Transactions Overview
---

## One place for income, expenses, and transfers

The **Transactions** page is Corvale's unified ledger. Instead of separate Income and Expense pages, you record every money movement here - income you receive, expenses you pay, and transfers between your own accounts.

Navigate to Transactions from the sidebar or go to `/transactions`.

## What you can do

On the Transactions page, you can:

- View all transactions in a paginated list
- Filter by type: **All**, **Income**, **Expense**, or **Transfer**
- Search by title, description, or other text fields
- Filter by date range
- Sort by date, amount, or category
- Create, edit, and delete income and expense entries
- Move money between accounts with transfers
- Split an expense across multiple categories
- Attach receipt files to transactions
- Select multiple transactions for bulk delete or bulk category change
- Attach [tags](../tags/overview.md) for cross-cutting labels beyond category
- [Import](../import/overview.md) transactions from a bank CSV/OFX file
- Apply a [quick-add template](../templates/overview.md) for a transaction you log often

## How transactions connect to accounts and categories

Every transaction links to:

| Field | Purpose |
|-------|---------|
| **Account** | Which account the money enters or leaves |
| **Category** | How you classify the transaction (from your category list) |
| **Type** | `income`, `expense`, or `transfer` |
| **Amount** | Dollar value of the entry |
| **Date** | When the transaction occurred |

When you create, edit, or delete a transaction, Corvale updates the linked account balance automatically. This keeps your account totals in sync with your activity.

## Type tabs

Use the tabs at the top of the list to narrow what you see:

| Tab | Shows |
|-----|-------|
| **All** | Every listable transaction |
| **Income** | Money received |
| **Expense** | Money spent |
| **Transfer** | Moves between your accounts |

You can also open a pre-filtered view from the dashboard - for example, `/transactions?type=income`.

## Legacy income and expense pages

Older versions of Corvale used separate `/income` and `/expense` routes. Those URLs now redirect to the Transactions page. All new entries should be created on **Transactions**.

## Related pages

- [Adding Transactions](./adding-transactions.md)
- [Managing Transactions](./managing-transactions.md)
- [Transfers and Splits](./transfers-and-splits.md)
- [Receipts and Bulk Actions](./receipts-and-bulk-actions.md)
- [Categories Overview](../categories/overview.md)
- [Accounts Overview](../accounts/overview.md)
- [Tags Overview](../tags/overview.md)
- [Recurring Overview](../recurring/overview.md)
- [Import Overview](../import/overview.md)
