---
title: Pushover Overview
---

## Month-end savings rollover

**Pushover** is Corvale's month-end rollover feature. It snapshots your current saver balance into a permanent history record and resets the saver to zero, giving you a clean start for the next period.

Like everything to do with the saver, a rollover moves no money: no transaction is created, and no account balance changes. Your bank account is untouched.

Navigate to Pushover from the sidebar or go to `/pushover`.

## Why use pushover

Pushover helps you:

- Record how much you saved during a period
- Build a history of monthly savings snapshots
- Start each new period with a zero saver balance
- Track cumulative rollover totals over time

## What pushover does

When you perform a rollover:

1. Corvale reads your current saver balance
2. Creates a pushover history record with the amount and timestamp
3. Adds the amount to your cumulative pushover total
4. Resets your saver balance to **$0.00**
5. Updates the saver's last-modified date

Your **net worth** does not change. Your **displayed spendable balance goes up** by the amount that was in the saver - resetting the earmark to zero returns that amount to spendable, exactly as a full withdrawal would. The difference from a withdrawal is that pushover also writes a permanent history snapshot and adds to your cumulative total.

## Requirements

- Your saver balance must be **greater than $0.00**
- If the saver is empty, the **Roll over now** button is disabled

## What pushover is not

Pushover does not:

- Transfer money to a bank account
- Create income or expense entries
- Modify account balances
- Automatically run on a schedule - you trigger it manually

## Related pages

- [Performing a Rollover](./performing-a-rollover.md)
- [Rollover History](./rollover-history.md)
- [Saver Overview](../saver/overview.md)
