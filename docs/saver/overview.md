---
title: Saver Overview
---

## Your dedicated savings pool

The **Saver** is a separate pool of money you allocate from your spendable balance. It helps you set aside funds intentionally rather than treating all available money as spendable.

Navigate to Saver from the sidebar or go to `/saver`.

## What the saver is

The saver is not a bank account. It is a label Corvale keeps on top of your existing balances - an amount you have decided to treat as off-limits.

Adding to the saver:

- Creates **no transaction**
- Changes **no account balance**
- Moves **no money** - nothing leaves or enters your real bank account

The only thing that changes is the number Corvale shows you: your saver balance goes up, and your **displayed** spendable balance goes down by the same amount, because spendable balance is calculated as your liquid money minus your saver earmark. Withdrawing from the saver reverses that display change.

Each user has exactly one saver document. If you have never deposited, your saver balance is $0.00.

## What you can do on the Saver page

- View your current saver balance, spendable balance, and net worth
- Deposit to the saver by percentage or custom amount
- Withdraw from the saver back to spendable balance

## How the saver affects other metrics

| Action | Saver balance | Spendable balance | Net worth |
|--------|---------------|-------------------|-----------|
| Deposit to saver | Increases | Decreases (displayed) | Unchanged |
| Withdraw from saver | Decreases | Increases (displayed) | Unchanged |
| Pushover rollover | Resets to $0.00 | Increases (displayed) | Unchanged |

Every one of these actions is a bookkeeping change inside Corvale. None of them move money, create a transaction, or touch an account balance - so net worth never changes, and "spendable balance" moves only because it is *derived* as liquid money minus your saver earmark. A pushover rollover raises displayed spendable for exactly the same reason a withdrawal does: the earmark drops to zero.

## Last updated date

If you have deposited or withdrawn, the saver card shows when the balance was last updated (formatted as "MMM D, YYYY").

## Related pages

- [Depositing to Saver](./depositing-to-saver.md)
- [Withdrawing from Saver](./withdrawing-from-saver.md)
- [Spendable Balance and Net Worth](../balances/spendable-balance-and-net-worth.md)
