---
title: Dashboard Overview
---

## Your financial home base

The **Dashboard** is the first page you see after signing in. It gives you a high-level snapshot of your finances without digging into individual entries.

Navigate to the dashboard from the sidebar by clicking **Dashboard**, or go directly to `/dashboard`.

## What the dashboard shows

The dashboard displays two main areas:

1. **Summary cards** - key financial metrics at a glance
2. **Quick links** - shortcuts to Transactions, Budgets, Savings Goals, Income filter, and Accounts

The summary cards adapt based on whether you have active accounts. See [Summary Cards](./summary-cards.md) for details on each metric.

## How dashboard data loads

When you open the dashboard, Corvale fetches data in parallel:

- Transaction counts for income and expense types
- Your saver balance details (which includes computed totals for net worth and spendable balance)

If any request fails, Corvale shows an error state with a **Retry** button.

## Empty state

If you have no data yet, the summary cards still render with zero values. The empty-state message encourages you to start by adding transactions.

## Page header

The dashboard header shows:

- **Title:** Dashboard
- **Description:** "Overview for [your full name]"

## Beyond the dashboard

For deeper charts and custom analysis, see the [Reports](../reports/overview.md) page. For alerts about budgets, bills, and goals, see [Notifications](../notifications/overview.md).

## Related pages

- [Summary Cards](./summary-cards.md)
- [Quick Links](./quick-links.md)
- [Budgets Overview](../budgets/overview.md)
- [Savings Goals Overview](../savings-goals/overview.md)
- [Reports Overview](../reports/overview.md)
- [Notifications Overview](../notifications/overview.md)
- [How Balances Are Calculated](../balances/how-balances-are-calculated.md)
