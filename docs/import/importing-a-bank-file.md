---
title: Importing a Bank File
---

## Walk through the import wizard

The import wizard guides you through uploading a file and reviewing every row before anything is saved.

## Step-by-step

1. On the **Transactions** page, click **Import**.
2. **Upload** - choose a `.csv`, `.ofx`, or `.qfx` file (up to 2 MB). If your file
   uses non-US dates, a currency symbol other than `$`, or a separator other than
   commas, prepare it first - see [Preparing Your File](./preparing-your-file.md).
3. **Mapping** *(CSV files only)* - confirm which column maps to date, description, amount, and so on. Corvale pre-fills its best guess; adjust any dropdown that's wrong. OFX files skip this step since the format is already structured.
4. **Account** - choose which account these transactions belong to, and a default category to apply to rows that don't match a [categorization rule](../categories/categorization-rules.md).
5. **Preview** - review a summary (total rows, valid rows, duplicates found, income and expense totals) and a row-by-row table.
6. **Done** - confirm the import to create the transactions.

## Handling duplicates

Corvale compares each row against your existing posted transactions on the chosen account, using the date, amount, and description to detect likely duplicates. Flagged rows show a duplicate action you can set individually or in bulk:

| Action | Result |
|--------|--------|
| **Skip** | The row is not imported (default for duplicates) |
| **Import anyway** | A new transaction is created regardless of the match |
| **Merge** | The matching existing transaction is updated with the imported row's category, tags, and description instead of creating a new one |

Rows Corvale doesn't flag as duplicates default to **Import**.

## After the import

The done step shows how many transactions were imported and how many were merged, with a link back to the Transactions page.

## Related pages

- [Import Overview](./overview.md)
- [Preparing Your File](./preparing-your-file.md)
- [Auto-Categorization Rules](../categories/categorization-rules.md)
- [Managing Transactions](../transactions/managing-transactions.md)
