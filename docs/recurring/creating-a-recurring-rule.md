---
title: Creating a Recurring Rule
---

## Set up a repeating income or expense

You create recurring rules from the **Recurring** page. Each rule describes a transaction template and a schedule for how often it repeats.

## Step-by-step

1. Navigate to **Recurring** from the sidebar.
2. Click **Create rule**.
3. Fill in the form fields described below.
4. Click **Create rule** to save.

## Form fields

### Title

A short label for the rule, such as "Rent" or "Paycheck."

### Type

Choose **Income** or **Expense**. Recurring rules cannot generate transfers.

### Amount and currency

Enter a positive amount (for example, `1,200.00`) and select the currency. Defaults come from your preferred currency in Settings.

### Account and category

Choose the account the generated transactions post against and the category they're tagged with.

### Interval

| Interval | Description |
|----------|-------------|
| **Daily** | Every day |
| **Weekly** | Every 7 days |
| **Biweekly** | Every 14 days |
| **Monthly** | Same day each calendar month |
| **Quarterly** | Every 3 months |
| **Yearly** | Same date each year |
| **Custom** | Every N days, where you set N |

When you choose **Custom**, an additional **Custom interval (days)** field appears - enter the number of days between occurrences.

### Next due date

The date spndr uses to generate the first draft. After each draft is generated, spndr advances this date to the next occurrence automatically.

### Description and payment method (optional)

Free-text fields carried onto each generated draft transaction.

### Tags (optional)

Use the tag picker to attach one or more tags to every transaction this rule generates. See [Using Tags](../tags/using-tags.md).

## Editing and cancelling

- Click a rule to edit its fields. You can toggle a rule inactive or mark it cancelled without deleting it - inactive and cancelled rules stop generating new drafts.
- Click the archive action to remove a rule from your active list. Archived rules cannot be edited and stop generating drafts; you cannot archive a rule twice.

## Related pages

- [Recurring Overview](./overview.md)
- [Managing Drafts](./managing-drafts.md)
- [Creating Categories](../categories/creating-categories.md)
