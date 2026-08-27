---
title: Depositing to Saver
---

## Move money into your saver pool

Depositing to the saver sets aside a portion of your spendable balance for savings.

Nothing actually moves. A deposit creates no transaction and changes no account balance - your bank account is untouched. Corvale simply records that you have earmarked the amount, which lowers the spendable balance it displays. See [Saver Overview](./overview.md#what-the-saver-is).

## Two deposit modes

Corvale offers two ways to calculate your deposit amount:

### Percentage mode (default)

Deposit a percentage of your current spendable balance. The default percentage is **30%**.

1. On the Saver page, ensure **Percentage** mode is selected.
2. Enter the percentage (0–100).
3. Corvale shows a preview: "Will add: $X.XX"
4. Click **Add to saver**.

The deposit amount is calculated as:

```
deposit = spendable balance × (percentage / 100)
```

Example: with a spendable balance of $1,000.00 and 30% selected:

```
deposit = 1000 × 0.30 = 300.00
```

### Custom amount mode

Deposit a specific dollar amount.

1. Click **Custom amount** to switch modes.
2. Enter the exact amount you want to deposit.
3. Corvale shows the preview amount.
4. Click **Add to saver**.

## Rules and limits

- You cannot deposit more than your current spendable balance.
- The deposit amount must be greater than zero.
- The percentage must be between 0 and 100.
- If your spendable balance is $0.00, the **Add to saver** button is disabled.

## After a successful deposit

Corvale:

- Increases your saver balance by the deposit amount
- Updates the saver's last-modified date
- Recalculates and returns your updated balances
- Shows a success notification

Your **displayed** spendable balance decreases by the same amount. No transaction is recorded and no account balance changes - the decrease is only because spendable balance is shown as your liquid money minus your saver earmark.

## Related pages

- [Saver Overview](./overview.md)
- [Withdrawing from Saver](./withdrawing-from-saver.md)
- [Performing a Rollover](../pushover/performing-a-rollover.md)
