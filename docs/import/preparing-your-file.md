---
title: Preparing Your File
---

## Get your file ready before you import

Corvale's import wizard is happiest with a tidy CSV. Most bank exports need a
little cleanup first — especially around dates, currency symbols, and how columns
are separated. This page covers exactly what Corvale accepts, and how to convert
a file that doesn't fit.

If your file is already a clean CSV from a US bank, you can probably skip
straight to [Importing a Bank File](./importing-a-bank-file.md).

## Accepted file formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Comma-separated values | `.csv` | Any layout. Corvale suggests a column mapping and lets you correct it. |
| Open Financial Exchange | `.ofx` | Parsed automatically — no mapping step. |
| Quicken Financial Exchange | `.qfx` | Read using the same parser as OFX. A `.qfx` file that isn't in OFX format won't import. |

A few more limits apply to every file:

- **Size:** up to 2 MB.
- **Rows:** up to 2,000 transactions. Split a larger export into several files.
- **Header row:** CSV files must have a header row naming the columns.

There is no XLSX, PDF, or JSON import. If that's what your bank gives you, see
[Convert your file first](#convert-your-file-first) below.

## Accepted date formats

For CSV files, Corvale reads the date column in this order:

1. **`YYYY-MM-DD`** (for example `2026-03-07`) — the recommended format. Anything
   after the first 10 characters, such as a timestamp, is ignored.
2. **`M/D/YYYY` or `M/D/YY`** (for example `3/7/2026` or `3/7/26`) — read as
   **month first, then day**, the US convention. Two-digit years from 70 to 99
   become 19xx; 00 to 69 become 20xx.
3. **Anything else** is handed to a generic date reader whose behavior varies.
   Values like `Jan 5, 2026` usually work; many others fail or are misread.

OFX and QFX files carry their dates in a fixed `YYYYMMDD` form, so there is
nothing to adjust.

::: warning Day-first dates are misread
Corvale always treats a slash-separated date as **month/day/year**. A
day-first date — common outside the US — is silently reinterpreted, with no
error shown:

- `12/06/2026` is read as **6 December 2026**, not 12 June 2026.
- `25/12/2026` is read as **12 January 2028** (month "25" rolls forward two
  years), not 25 December 2026.

Before importing, convert every date in your file to `YYYY-MM-DD`. It is the
only format Corvale reads unambiguously.
:::

## Delimiter and formatting limits

### Column separator

Corvale splits CSV rows on the **comma only**. Files that use a semicolon, tab,
or pipe between columns — common in European bank exports — are read as a single
column and won't map correctly. Re-export or re-save the file as
comma-separated.

Fields may be wrapped in double quotes (`"Coffee, black"`), and a literal quote
inside a quoted field is written as two quotes (`""`).

### Currency symbols and number formatting

When Corvale reads an amount, it removes a leading `$` and commas used as
thousands separators, then reads what's left as a number.

- `$1,250.00` → `1250.00` ✅
- `-$40.00` or `(40.00)` → treated as money out ✅
- `€40,00`, `£40.00`, `₹40.00`, `¥40` → the symbol is left in place, the amount
  can't be read, and the row fails ❌

::: warning Decimal commas are misread
Corvale expects a `.` for the decimal point. An amount written the European
way — `1.234,56` — has its `.` and `,` stripped and becomes **123456**, with no
error shown. Convert amounts to plain `1234.56` form before importing.
:::

If your file has separate **debit** and **credit** columns instead of one signed
amount column, that's fine — map both in the wizard and Corvale figures out the
direction.

## Convert your file first

Use this recipe when your file is an XLSX or PDF, uses day-first dates, has a
non-dollar currency symbol, or is separated by something other than commas.

1. **Open the file in a spreadsheet app** — Excel, Google Sheets, or LibreOffice
   Calc. XLSX opens directly; for a PDF statement, copy the transaction table and
   paste it into a blank sheet.
2. **Arrange the columns** so you have one date column, one description column,
   and either a single amount column (negative for money out) or separate debit
   and credit columns.
3. **Reformat the date column to `YYYY-MM-DD`.** In most apps this is
   Format → Number → Date, then choose the `2026-03-07` style, or use a formula
   like `TEXT(A2, "YYYY-MM-DD")`.
4. **Clean up the amounts.** Remove currency symbols and thousands separators,
   and make sure the decimal point is a `.` — find-and-replace, or set the column
   format to a plain number with no symbol.
5. **Split large files.** If you have more than 2,000 rows, save them across
   several files.
6. **Save as CSV.** Choose "CSV" (in Excel, "CSV UTF-8 (Comma delimited)"). If
   your system locale produces semicolons, change your list-separator setting or
   use Google Sheets, which always exports commas.
7. **Import each CSV** through the wizard. See
   [Importing a Bank File](./importing-a-bank-file.md).

## Related pages

- [Import Overview](./overview.md)
- [Importing a Bank File](./importing-a-bank-file.md)
- [Auto-Categorization Rules](../categories/categorization-rules.md)
- [Transactions Overview](../transactions/overview.md)
