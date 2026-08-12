---
title: Expense Overview
---

## Track money going out

The **Expense** page is where you record everything you spend - groceries, rent, subscriptions, transportation, and more.

Navigate to Expense from the sidebar or go to `/expense`.

## What you can do

On the Expense page, you can:

- View a paginated list of all your expense entries (10 per page)
- Add new expense entries
- Edit existing entries
- Delete entries with confirmation

## Expense entry fields

Each expense entry supports the following fields:

| Field | Required | Description |
|-------|----------|-------------|
| **Title** | Yes | A short name (e.g., "Weekly groceries") |
| **Amount** | Yes | The dollar amount spent |
| **Category** | Yes | A free-text category (e.g., "Food", "Transport") |
| **Date** | Yes | When the expense occurred |
| **Payment method** | No | How you paid (e.g., "Cash", "Card", "UPI") |
| **Recurring** | No | Recurrence note (e.g., "Monthly", "Weekly") |
| **Tags** | No | Comma-separated labels for filtering |
| **Description** | No | Optional notes about the entry |

Unlike income, **category is required** for expenses. All category, payment method, and recurring values are free-text.

## How expenses affect your balances

Expense entries contribute to your **Total Expenses** activity metric on the dashboard. When you have no active accounts, expenses also reduce your **net worth** and **spendable balance** through the legacy calculation mode.

When you have active accounts, expense totals remain activity metrics only.

## Pagination

Expense entries display 10 per page. Use the pagination controls at the bottom to navigate between pages.

## Related pages

- [Adding Expenses](./adding-expenses.md)
- [Managing Expense Entries](./managing-expense-entries.md)
