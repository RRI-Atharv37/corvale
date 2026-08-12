---
title: Adding Expenses
---

## Record a new expense entry

Follow these steps to log spending in spndr.

## Step-by-step

1. Navigate to **Expense** from the sidebar.
2. Click the **Add expense** button in the page header.
3. Fill in the form:
   - **Title** (required) — e.g., "Monthly rent"
   - **Amount** (required) — enter a number such as `1200.00`
   - **Date** (required) — defaults to today
   - **Category** (required) — e.g., "Housing"
   - **Payment method** (optional) — e.g., "Bank transfer"
   - **Recurring** (optional) — e.g., "Monthly"
   - **Tags** (optional) — comma-separated, e.g., "fixed, essential"
   - **Description** (optional) — any additional notes
4. Click **Add expense**.

On success, spndr closes the modal, shows a success notification, refreshes the list, and returns you to page 1.

## Validation

spndr requires title, amount, category, and date. If any required field is missing, you see an error toast.

Tags are entered as a comma-separated string in the form. spndr splits them into an array, trimming whitespace and removing empty values.

## Tips

- Use categories consistently across entries so you can scan spending patterns visually.
- The recurring field is a free-text note — spndr does not automatically create recurring entries.
- Payment method helps you remember how you paid, which is useful for reconciliation.

## Related pages

- [Expense Overview](./overview.md)
- [Managing Expense Entries](./managing-expense-entries.md)
