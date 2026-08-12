---
title: Transfers and Splits
---

## Move money between accounts and split expenses

spndr supports two advanced transaction patterns: **transfers** (moving money between your own accounts) and **splits** (dividing one expense across multiple categories).

## Transfers

A transfer moves money from one account to another without changing your overall net worth. spndr creates a linked pair of transactions - one outbound from the source account and one inbound to the destination account.

### When to use a transfer

Use transfers when you:

- Move cash from checking to savings
- Pay a credit card from checking
- Shift funds between any two accounts you own

Transfers do **not** count as income or expense. They only redistribute money across accounts.

### Creating a transfer

1. Navigate to **Transactions**.
2. Click **Transfer** (or open the transfer modal).
3. Fill in:
   - **Title** - for example, "Move to savings"
   - **Amount** - how much to move
   - **Date** - when the transfer occurred
   - **From account** - source account
   - **To account** - destination account
4. Optionally add a **description**.
5. Click **Save**.

Both accounts must use the **same currency**. You cannot transfer from an account to itself.

### Viewing transfers

Switch to the **Transfer** type tab to see only transfer entries. Each row represents one leg of the pair.

### Deleting a transfer

Deleting a transfer removes both linked legs and restores both account balances. spndr shows a confirmation warning because this action affects two accounts.

## Split expenses

A split lets you divide a single expense across multiple categories while posting once to one account.

### When to use a split

Use splits when one purchase spans several categories - for example, a grocery run with both Food and Household items on one receipt.

### Creating a split expense

1. Open the **Add transaction** modal and choose **Expense**.
2. Enable **Split expense**.
3. Enter the total **amount** and select the **account**.
4. Add split lines - each line needs a **category** and **amount**.
5. Ensure the split line amounts **sum to the total** amount.
6. Click **Save**.

spndr posts the full amount once to the selected account. Split children are linked to the parent but do not appear as separate rows in the main transaction list.

### Split rules

- Splits are available for **expense** transactions only
- Each split line must have a valid category and a positive amount
- The sum of all split amounts must equal the parent transaction amount

## Related pages

- [Transactions Overview](./overview.md)
- [Adding Transactions](./adding-transactions.md)
- [Managing Transactions](./managing-transactions.md)
- [Account Types](../accounts/account-types.md)
