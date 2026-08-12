---
title: Tracking Budget Progress
---

## See how your spending compares to your limit

Every budget card on the **Budgets** page includes a progress bar and summary numbers that update from your posted expense transactions.

## Progress metrics

Each budget displays:

| Metric | Description |
|--------|-------------|
| **Spent** | Total posted expenses counted toward this budget in the period |
| **Remaining** | Budget amount minus spent (can be negative when over budget) |
| **Percent used** | Spent divided by budget amount, capped for display |
| **Over budget** | Shown when spent exceeds the budget limit |

Amounts appear in the budget's currency with standard dollar formatting (for example, `$125.50`).

## Progress bar colors

The progress bar changes color as you approach or exceed your limit:

- **Cyan** - comfortably under budget
- **Amber** - nearing the limit
- **Rose** - over budget

When a budget is over limit, the card border turns rose and an **Over budget** badge appears.

## What counts toward spent

spndr includes transactions that match all of the following:

1. Type is **expense**
2. Status is **posted** (not draft)
3. Date falls within the budget period (monthly or custom range, resolved in your timezone)
4. Account is included in the budget's account scope (or all accounts if none are selected)
5. Category matches the budget scope (for category budgets)

### Excluded from spent

- Income and transfer transactions
- Draft transactions
- Expenses outside the selected accounts (when account scoping is enabled)
- Expenses tagged to a different category (for category budgets)

### Split expenses

When you split an expense across categories:

- **Category budgets** count each child line's amount toward its category
- **Overall budgets** count the parent expense total once (children are not double-counted)

## Active vs history tabs

| Tab | Shows |
|-----|-------|
| **Active** | Budgets whose period end date is today or in the future, and that are not archived |
| **History** | Archived budgets and budgets whose period has ended |

Use **History** to review past periods without cluttering your active view.

## Card details

Each budget card also shows:

- Period label (for example, "August 2026" or a custom date range)
- Scope label (overall or category name with icon)
- Account scope ("All accounts" or "N accounts")

## Related pages

- [Budgets Overview](./overview.md)
- [Creating a Budget](./creating-a-budget.md)
- [Managing Transactions](../transactions/managing-transactions.md)
