---
title: Import Overview
---

## Bring in transactions from your bank

Instead of entering historical transactions by hand, you can import them from a file your bank exports.

## Supported files

- **CSV** - any comma-separated export, up to 2,000 rows. Corvale recognizes a few common layouts automatically (including its own [CSV export](../transactions/overview.md) format) and suggests a column mapping; you can adjust it if the guess is wrong.
- **OFX / QFX** - standard bank statement formats. These are parsed automatically with no mapping step needed.

Files are capped at 2 MB.

Bank exports often need a little cleanup first — non-US dates, currency symbols, and
semicolon separators all trip up the import. See [Preparing Your File](./preparing-your-file.md)
for exactly what Corvale accepts and how to convert a file that doesn't fit.

## Getting started

Click **Import** on the **Transactions** page toolbar to open the import wizard. See [Importing a Bank File](./importing-a-bank-file.md) for the full walkthrough.

## Related pages

- [Preparing Your File](./preparing-your-file.md)
- [Importing a Bank File](./importing-a-bank-file.md)
- [Transactions Overview](../transactions/overview.md)
- [Backup and Restore](../backup-restore/overview.md)
