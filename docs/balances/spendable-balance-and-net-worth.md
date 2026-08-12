---
title: Spendable Balance and Net Worth
---

## Two numbers that guide your decisions

**Net worth** and **spendable balance** are the two most important derived metrics in spndr. Understanding the difference helps you make better saving and spending choices.

## Net worth

Net worth represents your overall financial position - everything you own minus everything you owe.

### In legacy mode

Net worth equals your logged income minus your logged expenses. It answers: "Based on what I have tracked, am I ahead or behind?"

### In accounts mode

Net worth equals the sum of your asset account balances minus your credit account balances. It answers: "What is the total value across all my accounts?"

**Example (accounts mode):**

| Account | Type | Balance |
|---------|------|---------|
| Main checking | checking | $2,500.00 |
| Cash wallet | cash | $150.00 |
| Emergency fund | savings | $5,000.00 |
| Credit card | credit | $800.00 |

```
net worth = (2500 + 150 + 5000) − 800 = 6850.00
```

## Spendable balance

Spendable balance represents money you can use right now - either to spend or to allocate to your saver pool.

### In legacy mode

```
spendable balance = max(0, net worth − saver balance)
```

### In accounts mode

```
spendable balance = max(0, (checking + cash balances) − saver balance)
```

Savings accounts are intentionally excluded from spendable balance. Money in savings is part of your net worth but not immediately available.

**Example (accounts mode, continuing above):**

With $0.00 in the saver:

```
spendable balance = max(0, (2500 + 150) − 0) = 2650.00
```

With $500.00 in the saver:

```
spendable balance = max(0, 2650 − 500) = 2150.00
```

## Where these numbers appear

| Location | Net worth | Spendable balance |
|----------|-----------|-------------------|
| Dashboard summary cards | Yes | Yes |
| Saver page stat cards | Yes | Yes |
| Pushover page | Indirectly (via saver balance) | No |

## Practical guidance

- Use **spendable balance** to decide how much you can move to the saver or spend this month.
- Use **net worth** to understand your overall financial health over time.
- Remember that income and expense totals on the dashboard are activity logs - in accounts mode, they do not change net worth.

## Related pages

- [How Balances Are Calculated](./how-balances-are-calculated.md)
- [Depositing to Saver](../saver/depositing-to-saver.md)
- [Summary Cards](../dashboard/summary-cards.md)
