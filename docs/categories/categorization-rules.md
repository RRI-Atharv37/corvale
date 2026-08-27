---
title: Auto-Categorization Rules
---

## Categorize transactions automatically

**Categorization rules** watch new transactions as you create them and assign a category - and optionally tags - based on conditions you define. Reach this page from a link on the Categories page, or go to `/categories/rules`.

## How matching works

Every active rule is checked, in priority order (highest first), against each new transaction. The **first rule that matches wins** - once a match is found, Corvale stops checking. Rules never apply to transfers.

Rule application on create is automatic and not optional: if a rule matches, it **overwrites** whatever category you picked on the transaction form and merges in the rule's tags.

## Creating a rule

1. Click **Create rule**.
2. Enter a **name** for the rule.
3. Choose a **match type**:

| Match type | Matches when |
|------------|---------------|
| **Description contains** | The transaction description contains the text you enter |
| **Description equals** | The transaction description exactly matches the text you enter |
| **Amount range** | The transaction amount falls within a min and/or max you set |
| **Account** | The transaction belongs to a specific account |

4. Fill in the fields that appear for your chosen match type.
5. Choose the **category** to assign on match.
6. Optionally add **tags** to attach on match.
7. Set a **priority** (higher runs first when multiple rules could match) and whether the rule is **active**.
8. Click **Create rule** to save.

## Testing a rule

Use the **Test rules** panel to enter a sample title, description, amount, and account, then run it against your active rules without creating a transaction. Corvale shows which rule matched (if any) and the category and tags it would apply.

## Applying rules to existing transactions

Click **Apply to existing** to re-run every active rule against your existing, already-categorized transactions. Corvale only updates a transaction if its category or tags actually change, and reports how many were updated versus left alone.

## Related pages

- [Categories Overview](./overview.md)
- [Tags Overview](../tags/overview.md)
- [Adding Transactions](../transactions/adding-transactions.md)
