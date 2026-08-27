---
title: Performing a Rollover
---

## Roll your saver balance into history

Follow these steps to perform a pushover rollover.

## Step-by-step

1. Navigate to the **Pushover** page from the sidebar.
2. Verify your saver balance is greater than $0.00. If it is zero, deposit to the saver first.
3. Click the **Roll over now** button in the page header.
4. Review the confirmation dialog. It shows your current saver balance and explains that the saver will reset to zero.
5. Click **Roll over** to confirm.

On success, Corvale:

- Creates a history record with the rolled-over amount
- Resets your saver balance to $0.00
- Raises your **displayed** spendable balance by that amount (the earmark is gone)
- Shows a success notification with the amount rolled over
- Refreshes the history list

No money moves and no transaction is created - your bank account and net worth are unchanged.

## Confirmation dialog

The dialog message reads:

> This will snapshot your verified saver balance of $X.XX and reset it to zero. Continue?

Review the amount carefully before confirming. The rollover cannot be undone.

## When to roll over

Pushover is designed for period-end savings snapshots - typically at the end of a month. You choose when to trigger it; Corvale does not enforce a schedule.

A common workflow:

1. Throughout the month, deposit to the saver as you earn or receive money.
2. At month-end, review your saver balance on the Saver page.
3. Perform a pushover rollover to record the snapshot.
4. Start the new month with a zero saver balance and repeat.

## Error: zero balance

If you attempt a rollover with a zero saver balance, the server returns an error. The **Roll over now** button is disabled in the UI when the balance is zero.

## Related pages

- [Pushover Overview](./overview.md)
- [Rollover History](./rollover-history.md)
- [Depositing to Saver](../saver/depositing-to-saver.md)
