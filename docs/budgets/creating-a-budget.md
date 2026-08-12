---
title: Creating a Budget
---

## Add a spending limit

You create budgets from the **Budgets** page. Each budget defines how much you plan to spend during a period and what spending it applies to.

## Step-by-step

1. Navigate to **Budgets** from the sidebar.
2. Click **Create budget**.
3. Fill in the form fields described below.
4. Click **Create budget** to save.

On success, spndr closes the modal, shows a success notification, and refreshes the budget list with progress calculated from your existing transactions.

## Form fields

### Name (optional)

A short label such as "Groceries" or "Monthly spending." If you leave this empty, spndr displays a default name based on the category scope.

### Period type

Choose how the budget window is defined:

| Type | Description |
|------|-------------|
| **Monthly** | A full calendar month in your user timezone |
| **Custom duration** | Any start and end date you choose |

You cannot change the period type when editing an existing budget. Create a new budget if you need a different period shape.

### Monthly period fields

When **Monthly** is selected:

- **Month** - the calendar month (January through December)
- **Year** - the four-digit year (for example, `2026`)

spndr resolves the exact start and end timestamps using your account timezone.

### Custom period fields

When **Custom duration** is selected:

- **Start date** - first day of the budget window
- **End date** - last day of the budget window (must be on or after the start date)

### Budget scope

| Scope | Behavior |
|-------|----------|
| **Overall spending** | Counts all posted expenses in the period (subject to account scoping) |
| **Category** | Counts only expenses tagged with the selected category |

For category budgets, use the **Category** picker to choose a master category or one of your sub-categories.

### Amount and currency

Enter a positive budget limit (for example, `500.00`) and select the currency. Defaults come from your preferred currency in **Settings**.

### Rollover

Enable **Rollover unused amount to next period** if you want unused budget capacity to carry forward. The rollover flag is stored on the budget for future period logic; progress for the current period still reflects only transactions in that window.

### Accounts

Choose which accounts count toward this budget:

- **All accounts** (default) - every active account contributes to spent totals
- **Selected accounts** - check one or more accounts to scope spending

If you deselect all accounts while active accounts exist, spndr asks you to pick at least one or revert to all accounts.

## Editing and archiving

- Click the **pencil** icon on a budget card to edit name, amount, scope, accounts, and rollover settings. Period type and dates are fixed after creation.
- Click the **trash** icon to archive a budget. Archived budgets move to the **History** tab and no longer appear in active lists.

## Related pages

- [Budgets Overview](./overview.md)
- [Tracking Budget Progress](./tracking-budget-progress.md)
- [Creating Categories](../categories/creating-categories.md)
