---
title: Summary Cards
---

## Understanding your dashboard metrics

The dashboard displays a row of summary cards. Each card shows a label, a formatted dollar amount, and an optional subtitle with additional context.

## Total Income

Shows the sum of all income activity recorded in your ledger.

- **Color accent:** Cyan
- **Source:** Aggregated income totals from the balance engine

This number reflects activity tracking - how much income you have logged - not necessarily cash currently in your accounts when you use accounts mode.

## Total Expenses

Shows the sum of all expense activity recorded in your ledger.

- **Color accent:** Rose
- **Source:** Aggregated expense totals from the balance engine

Like total income, this is an activity metric showing how much you have logged as spent.

## Spendable Balance

Shows how much money you can allocate to the saver or treat as available to spend.

- **Color accent:** Violet
- **Calculation:** Depends on your balance mode (see below)

**Subtitle when you have accounts:**

> From checking & cash · Saver: $X.XX

**Subtitle when you have no accounts:**

> Saver: $X.XX

## Net Worth

Shows your overall financial position.

- **Color accent:** Slate
- **Calculation:** Depends on your balance mode (see below)

**Subtitle when you have accounts:**

> Across N account(s)

**Subtitle when you have no accounts:**

> N transactions

## In Accounts (accounts mode only)

When you have at least one active account, a fifth card appears:

- **Label:** In Accounts
- **Value:** Sum of asset account balances minus credit account balances
- **Subtitle:** "Sum of all account balances"

This card is hidden when you have no active accounts.

## Balance modes

spndr calculates spendable balance and net worth differently depending on whether you have accounts:

| Mode | Condition | Net worth source | Spendable source |
|------|-----------|------------------|------------------|
| **Legacy** | No active accounts | Total income − total expenses | Net worth − saver balance |
| **Accounts** | One or more active accounts | Sum of account balances | Checking + cash balances − saver balance |

In accounts mode, transaction activity updates account balances directly. Income and expense totals on the dashboard remain activity metrics.

See [How Balances Are Calculated](../balances/how-balances-are-calculated.md) for the full breakdown.

## Related pages

- [Dashboard Overview](./overview.md)
- [Spendable Balance and Net Worth](../balances/spendable-balance-and-net-worth.md)
