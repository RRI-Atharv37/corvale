---
title: Adding Income
---

## Record a new income entry

Follow these steps to add income to spndr.

## Step-by-step

1. Navigate to **Income** from the sidebar.
2. Click the **Add income** button in the page header.
3. Fill in the form:
   - **Title** (required) - e.g., "Freelance project payment"
   - **Amount** (required) - enter a number such as `1500.00`
   - **Date** (required) - defaults to today
   - **Source** (optional) - e.g., "Acme Corp"
   - **Category** (optional) - e.g., "Freelance"
   - **Description** (optional) - any additional notes
4. Click **Add income**.

On success, spndr closes the modal, shows a success notification, refreshes the list, and returns you to page 1.

## Validation

Before submitting, spndr checks that title, amount, and date are provided. If any required field is missing, you see an error toast and the form stays open.

Amount must be a valid number. The form accepts decimal values with up to two decimal places.

## Tips

- Use consistent category names to make scanning your list easier (e.g., always "Salary" rather than mixing "Salary" and "salary").
- Set the date to when you actually received the money, not when you recorded it.
- The source field is helpful when you have multiple income streams from different employers or clients.

## Related pages

- [Income Overview](./overview.md)
- [Managing Income Entries](./managing-income-entries.md)
