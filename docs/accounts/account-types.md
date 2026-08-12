---
title: Account Types
---

## The four account types in spndr

When you create an account, you choose one of four types. Each type affects how spndr includes the account in balance calculations.

## Available types

| Type | Label | Role in calculations |
|------|-------|----------------------|
| **checking** | Checking | Counted as an asset; included in liquid (spendable) balance |
| **cash** | Cash | Counted as an asset; included in liquid (spendable) balance |
| **savings** | Savings | Counted as an asset; **not** included in liquid (spendable) balance |
| **credit** | Credit | Subtracted from net worth (represents debt) |

## How each type affects net worth

spndr calculates net worth from account balances as:

```
net worth = (checking + cash + savings balances) − (credit balance)
```

Credit accounts represent money you owe. Their balance reduces your net worth.

## How each type affects spendable balance

Spendable balance uses only **liquid** accounts:

```
liquid balance = checking balance + cash balance
spendable balance = max(0, liquid balance − saver balance)
```

Savings accounts contribute to net worth but not to spendable balance. This reflects the idea that savings are set aside and not immediately available to spend or allocate to the saver.

## Choosing the right type

- Use **Checking** for bank checking accounts you spend from regularly.
- Use **Cash** for physical cash on hand.
- Use **Savings** for money stored in savings accounts or long-term holdings.
- Use **Credit** for credit cards or other debt accounts. Enter the amount you owe as the balance.

## Related pages

- [Creating an Account](./creating-an-account.md)
- [Accounts Overview](./overview.md)
- [Spendable Balance and Net Worth](../balances/spendable-balance-and-net-worth.md)
