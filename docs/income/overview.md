---
title: Income Overview
---

> **This page describes the legacy Income section.** spndr now uses a unified [Transactions](../transactions/overview.md) page. The `/income` route redirects to `/transactions?type=income`.

## Track money coming in

The **Income** page is where you record every source of money you receive - salary, freelance payments, gifts, refunds, and more.

Navigate to Income from the sidebar or go to `/income`.

## What you can do

On the Income page, you can:

- View a paginated list of all your income entries (10 per page)
- Add new income entries
- Edit existing entries
- Delete entries with confirmation

## Income entry fields

Each income entry supports the following fields:

| Field | Required | Description |
|-------|----------|-------------|
| **Title** | Yes | A short name (e.g., "Monthly salary") |
| **Amount** | Yes | The dollar amount received |
| **Date** | Yes | When the income was received |
| **Source** | No | Where the money came from (e.g., employer name) |
| **Category** | No | A free-text category (e.g., "Salary", "Freelance") |
| **Description** | No | Optional notes about the entry |

Categories are free-text - spndr does not enforce a predefined list.

## How income affects your balances

Income entries contribute to your **Total Income** activity metric on the dashboard. When you have no active accounts, income also affects your **net worth** and **spendable balance** through the legacy calculation mode.

When you have active accounts, income totals remain activity metrics only. Net worth and spendable balance derive from your account balances instead.

## Pagination

Income entries display 10 per page, sorted by most recent date. Use the pagination controls at the bottom to navigate between pages.

## Related pages

- [Adding Income](./adding-income.md)
- [Managing Income Entries](./managing-income-entries.md)
