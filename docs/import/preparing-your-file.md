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

For CSV files, Corvale reads the date column like this:

1. **`YYYY-MM-DD`** (for example `2026-03-07`) is always recognised, whatever the
   date format setting says. Anything after the first 10 characters, such as a
   timestamp, is ignored.
2. **Slash, dot, or dash dates** (for example `7/3/2026`, `07.03.2026`, or
   `7-3-2026`) are read according to the **Date format** control in the mapping
   step — see below. Two-digit years from 70 to 99 become 19xx; 00 to 69 become
   20xx.
3. **Anything else** (such as `Jan 5, 2026`) is handed to a generic date reader
   whose behavior varies. Values like that usually work, but many others don't —
   convert them to `YYYY-MM-DD` to be safe.

A slash/dot/dash date whose numbers can't make a real calendar date — a "month"
of 25, or 30 February — is reported as an error on that row rather than being
guessed at or rolled forward.

OFX and QFX files carry their dates in a fixed `YYYYMMDD` form, so there is
nothing to adjust.

### The Date format control

The mapping step has a **Date format** dropdown that tells Corvale how to read
slash, dot, and dash dates:

| Option | Order | Example |
|--------|-------|---------|
| **Auto-detect** (default) | Corvale scans the whole date column and chooses (see below) | — |
| **Year first** | `YYYY/MM/DD` | `2026/03/07` → 7 March 2026 |
| **Month first (US)** | `MM/DD/YYYY` | `03/07/2026` → 7 March 2026 |
| **Day first** | `DD/MM/YYYY` | `07/03/2026` → 7 March 2026 |

Auto-detect picks an order from the column's own values: a value whose first
number is over 12 (like `25/03/2026`) means day-first; a four-digit year first
(like `2026/03/07`) means year-first; otherwise it uses month-first, the US
convention.

Set the dropdown explicitly when your file's dates are all ambiguous — every day
and month is 12 or lower, like `07/03/2026` — and you know which convention your
bank uses. The preview step shows the parsed dates before anything is saved, so
you can check the result and go back if it looks wrong.

## Delimiter and formatting limits

### Column separator

Corvale splits CSV rows on the **comma only**. Files that use a semicolon, tab,
or pipe between columns — common in European bank exports — are read as a single
column and won't map correctly. Re-export or re-save the file as
comma-separated.

Fields may be wrapped in double quotes (`"Coffee, black"`), and a literal quote
inside a quoted field is written as two quotes (`""`).

### Currency symbols and number formatting

When Corvale reads an amount, it ignores any currency symbol or code around the
number and reads the digits, grouping separators, and decimal point that remain.

- `$1,250.00`, `€1.250,00`, `£1 250.00`, `₹1,250.00`, `INR 1250` → all read as
  `1250.00` ✅
- `-$40.00`, `(40.00)`, `40.00-` → treated as money out ✅
- `1,00,000.00` (Indian grouping) → read as `100000.00` ✅

Corvale works out which mark is the decimal point:

- If the value has both a `.` and a `,`, the **rightmost** one is the decimal
  point and the other is a thousands separator — so `1.234,56` is `1234.56` and
  `1,234.56` is also `1234.56`.
- If the value has only a `,` followed by one or two digits (`40,00`, `40,5`),
  the comma is treated as a decimal point.
- A lone `,` with three or more trailing digits (`1,250`) is treated as a
  thousands separator.

The preview step shows every parsed amount before anything is saved, so you can
check the result and go back if a value looks wrong. A value Corvale can't read
as a single number — `1.2.3`, or text with no digits — is reported as an error on
that row.

If your file has separate **debit** and **credit** columns instead of one signed
amount column, that's fine — map both in the wizard and Corvale figures out the
direction. The same number formatting rules apply to those columns.

## Convert your file first

Use this recipe when your file is an XLSX or PDF, or is separated by something
other than commas. Currency symbols, decimal commas, and day-first or year-first
dates no longer need converting — Corvale reads them, and the preview step lets
you confirm — but reformatting to plain `1234.56` amounts and `YYYY-MM-DD` dates
is still the safest option if you're editing the file anyway.

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
