---
title: Importing a Bank File
---

## Walk through the import wizard

The import wizard guides you through uploading a file and reviewing every row before anything is saved.

## Step-by-step

1. On the **Transactions** page, click **Import**.
2. **Upload** - choose a `.csv`, `.ofx`, `.qfx`, or `.qif` file (up to 2 MB). If
   your file is an XLSX or PDF, prepare it first - see
   [Preparing Your File](./preparing-your-file.md).
3. **Mapping** *(CSV files only)* - confirm which column maps to date, description, amount, and so on. Corvale pre-fills its best guess; adjust any dropdown that's wrong. Use the **Column separator** control if the columns look wrong (Corvale detects comma, semicolon, tab, or pipe, but you can set it yourself). Set the **Date format** control if your dates aren't `YYYY-MM-DD` - auto-detect handles most files, but you can force day-first, month-first, or year-first. OFX, QFX, and QIF files skip this step since the format is already structured.
4. **Account** - choose which account these transactions belong to, and a default category to apply to rows that don't match a [categorization rule](../categories/categorization-rules.md). If any rows in an OFX or QIF file couldn't be read, or the statement is in a different currency from the account, Corvale shows a note here.
5. **Preview** - review a summary (total rows, valid rows, duplicates found, income and expense totals) and a row-by-row table.
6. **Done** - confirm the import to create the transactions.

## Handling duplicates

Corvale compares each row against your existing posted transactions on the chosen account to detect likely duplicates. It matches on the date, whether the row is money in or money out, the amount, and the description — so a refund never looks like a duplicate of the original charge. For OFX and QFX files, Corvale also matches on the bank's own transaction ID, so re-importing the same statement reliably finds every row even if the bank changed the wording between exports. Flagged rows show a duplicate action you can set individually or in bulk:

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
