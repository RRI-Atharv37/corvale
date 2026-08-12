---
title: Balances Overview
---

## Understanding your numbers

spndr tracks several balance metrics that appear on the dashboard, saver page, and pushover page. This section explains what each number means and how they relate to each other.

## Key balance metrics

| Metric | Where it appears | What it represents |
|--------|------------------|--------------------|
| **Total Income** | Dashboard | Sum of all logged income entries |
| **Total Expenses** | Dashboard | Sum of all logged expense entries |
| **Net Worth** | Dashboard, Saver | Overall financial position |
| **Spendable Balance** | Dashboard, Saver | Money available to spend or allocate to saver |
| **Saver Balance** | Dashboard, Saver | Amount currently in your saver pool |
| **In Accounts** | Dashboard (accounts mode) | Sum of asset balances minus credit balances |

## Two calculation modes

spndr uses one of two modes depending on whether you have active accounts:

### Legacy mode (no active accounts)

When you have zero active accounts:

- **Net worth** = total income − total expenses
- **Spendable balance** = max(0, net worth − saver balance)

Income and expense entries directly drive your financial picture.

### Accounts mode (one or more active accounts)

When you have at least one active account:

- **Net worth** = sum of asset account balances − sum of credit account balances
- **Spendable balance** = max(0, liquid balance − saver balance)
- **Liquid balance** = checking balance + cash balance

Income and expense totals remain visible as activity metrics but do not drive net worth or spendable balance.

## Money rounding

All monetary values round to two decimal places using standard banker's rounding.

## Related pages

- [How Balances Are Calculated](./how-balances-are-calculated.md)
- [Spendable Balance and Net Worth](./spendable-balance-and-net-worth.md)
- [Summary Cards](../dashboard/summary-cards.md)
