---
title: How Balances Are Calculated
---

## The balance engine

Corvale computes your balances server-side using a central balance engine. Every time you view the dashboard, saver page, or perform a saver/pushover action, the server recalculates your numbers from live data.

## Data sources

The engine aggregates four data sources:

1. **Income totals** - sum of recorded income activity
2. **Expense totals** - sum of recorded expense activity
3. **Saver document** - your current saver pool balance
4. **Active accounts** - all non-archived accounts and their current balances

When you use the unified Transactions page, creating or deleting income and expense entries updates the linked account balance. Transfer entries move money between accounts without changing net worth.

## Legacy mode calculation

Legacy mode applies when you have **zero active accounts**.

### Net worth

```
net worth = total income − total expenses
```

Example: if you logged $5,000.00 in income and $3,200.00 in expenses:

```
net worth = 5000 − 3200 = 1800.00
```

### Spendable balance

```
spendable balance = max(0, net worth − saver balance)
```

Example: with a net worth of $1,800.00 and $500.00 in the saver:

```
spendable balance = max(0, 1800 − 500) = 1300.00
```

## Accounts mode calculation

Accounts mode applies when you have **one or more active accounts**.

### Account totals

For each active account, Corvale classifies the balance:

| Account type | Treatment |
|--------------|-----------|
| checking, cash, savings | Added to asset total |
| credit | Added to credit total (debt) |
| checking, cash | Added to liquid total |

Then:

```
total account balance (net worth) = asset total − credit total
liquid balance = checking total + cash total
```

Account balances reflect opening balances plus all transaction and transfer activity on each account.

### Spendable balance

```
spendable balance = max(0, liquid balance − saver balance)
```

Savings account balances count toward net worth but **not** toward liquid/spendable balance.

### Income and expense in accounts mode

Total income and total expenses are still calculated and displayed on the dashboard. They serve as activity tracking metrics - a record of what you have logged - but they do not drive net worth or spendable balance. Net worth and spendable derive from account balances.

## Saver impact

The saver balance always reduces spendable balance in both modes. Money in the saver pool is treated as set aside and not available to spend.

## Related pages

- [Balances Overview](./overview.md)
- [Spendable Balance and Net Worth](./spendable-balance-and-net-worth.md)
- [Account Types](../accounts/account-types.md)
- [Transactions Overview](../transactions/overview.md)
