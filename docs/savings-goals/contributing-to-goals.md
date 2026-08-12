---
title: Contributing to Goals
---

## Record progress toward your target

Contributions increase the **current amount** saved on a goal. spndr tracks each contribution in a history timeline so you can see manual deposits and automatic transfers separately.

## Manual contributions

### Step-by-step

1. Open **Savings Goals** and find an **Active** goal that is not yet complete.
2. Click the **cash** icon on the goal card (Add contribution).
3. Enter a positive **Amount** and an optional **Note**.
4. Click **Contribute**.

On success, spndr updates the progress bar, refreshes progress metrics, and closes the modal.

### Auto-complete

When a contribution brings the current amount to or above the target, spndr marks the goal **Completed** automatically. You can still view it on the **Completed** tab.

### Validation

- Amount must be a positive number
- Paused, completed, and archived goals reject new contributions

## Automatic contributions

If you enabled automatic contributions when creating or editing a goal, spndr evaluates whether a contribution is due based on:

- The selected interval (weekly or monthly)
- For monthly intervals, the configured day of month (1–28)
- The timestamp of the last automatic contribution

### Processing a due auto contribution

When a goal shows an **Auto due** badge:

1. Click the **refresh** icon on the goal card.
2. spndr records an automatic contribution for the configured amount.
3. Progress updates and the badge clears until the next interval elapses.

Automatic contributions appear in history with an **Automatic** badge.

### When auto contributions are blocked

spndr rejects automatic contributions when:

- Auto contributions are disabled on the goal
- The interval has not elapsed since the last automatic contribution
- The goal is paused, completed, or archived

## Contribution history

Click the **clock** icon on any goal card to open the contribution timeline. Each entry shows:

- Contribution amount and date
- Type badge (**Manual** or **Automatic**)
- Optional note (for manual contributions)

History loads when you open the modal. If loading fails, spndr shows an error toast and an empty list.

## Progress metrics

After contributions, the goal card may show:

| Metric | When shown |
|--------|------------|
| **Required monthly** | Target date is set and goal is not complete |
| **Projected completion** | Calculated from current pace and remaining amount |
| **Months remaining** | Target date is set |

These metrics help you see whether you are on track to meet a deadline.

## Related pages

- [Savings Goals Overview](./overview.md)
- [Creating a Savings Goal](./creating-a-savings-goal.md)
- [Goal Lifecycle](./goal-lifecycle.md)
