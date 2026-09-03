---
title: Import API
---

## Endpoints

All routes are mounted at `/api/v1/imports` and require authentication.

## Upload constraints

File uploads use the `file` form field, memory storage, and a **2 MB** cap. Accepted extensions: `.csv`, `.ofx`, `.qfx`, `.qif`.

## POST /imports/parse

Multipart upload. Detects OFX, then QIF, then CSV from the file content.

- **OFX/QFX**: parsed directly - no mapping needed. Response: `{ format: 'ofx', requiresMapping: false, parsedRows, parsedRowErrors, statementCurrency, sampleRows }`. Each parsed row carries `externalId` (the OFX `FITID`) when present; `parsedRowErrors` lists `{ rowIndex, message }` for statement entries that were skipped (missing amount/date, unparseable value); `statementCurrency` is the `<CURDEF>` value.
- **QIF**: line-oriented parse, no mapping needed. Response: `{ format: 'qif', requiresMapping: false, parsedRows, parsedRowErrors, sampleRows }`.
- **CSV**: parsed and format-detected (`generic`, `chase`, or `corvale_export`, based on header matching). CSV files exported by older versions are still recognized and reported as the legacy `spndr_export` format. Response: `{ format: 'generic', requiresMapping: true, headers, rows, suggestedMapping, delimiter, sampleRows }`, where `suggestedMapping` maps `date`/`description`/`amount`/`debit`/`credit`/`type` to detected column headers and `delimiter` is the field separator used.
- An `.ofx`/`.qfx` upload whose content is neither OFX nor QIF returns `400` rather than being parsed as CSV.

Optional `delimiter` form field (`,`, `;`, tab, or `|`) forces the CSV field separator. When omitted, it is sniffed from the header line (highest unquoted count wins; comma breaks ties).

Row count is capped at 2,000.

## POST /imports/preview

Dry-runs the import without writing anything, including duplicate detection.

### Request body

```json
{
  "accountId": "<account-id>",
  "defaultCategoryId": "<category-id>",
  "workspaceId": null,
  "parsedRows": [],
  "headers": [],
  "rows": [],
  "mapping": {}
}
```

Provide `parsedRows` (and optionally `parsedRowErrors`) for OFX/QIF imports, or `headers`+`rows`+`mapping` for CSV imports (`mapping.date` is required, plus at least one of description/amount/debit/credit). `parsedRowErrors` are folded into the response as error rows and counted toward `skipped`. Each row is run through the user's [categorization rules](./categorization-rules-api.md); unmatched rows fall back to `defaultCategoryId`.

`mapping.dateFormat` (optional) controls how slash/dot/dash dates in the mapped date column are read: `auto` (default - inferred from the column's values), `YMD`, `MDY`, or `DMY`. ISO `YYYY-MM-DD` is always recognized regardless. A slash/dot/dash value that isn't a valid calendar date is rejected as a row-level error rather than being coerced.

Amount, debit, and credit cells are parsed locale-tolerantly: a surrounding currency symbol or ISO code is stripped, `(...)` / leading or trailing `-` mean negative, and the decimal separator is inferred (with both `.` and `,` present the rightmost is the decimal; a lone `,` with one or two trailing digits is a decimal comma; otherwise `,` is a grouping separator, including Indian `1,00,000` grouping). A cell that doesn't reduce to a single finite number is a row-level error.

Response includes a `summary` (`total, valid, invalid, duplicates, incomeTotal, expenseTotal`) and per-row items, each flagged with `duplicateOf` (matching existing transaction id/title/date/amount/category) when applicable.

## POST /imports/commit

Same body as preview, plus `rowDecisions`: `{ "<rowIndex>": "skip" | "import" | "merge" }`. Rows without an explicit decision default to `skip` if flagged as a duplicate, or `import` otherwise.

| Decision | Result |
|----------|--------|
| `skip` | No transaction created |
| `import` | New posted transaction created regardless of any duplicate match |
| `merge` | The matched existing transaction is updated (category, tags, empty description filled) - amount and date are untouched. 400 if the row has no duplicate match |

Response: `{ imported, merged, skipped, transactionIds, mergedTransactionIds, summary }` (201).

## Duplicate detection

A row matches an existing posted transaction on the target account when **either**:

- the row has an `externalId` (OFX `FITID`) equal to the existing transaction's `externalId` — an exact match, checked first; or
- the fuzzy fingerprint agrees: date, direction (`income`/`expense`), minor-unit amount, and a normalized (lowercased, punctuation-stripped) description.

Imported OFX rows persist their `FITID` to `Transaction.externalId`, so a later re-import of the same statement dedupes reliably even if the bank changed the payee text.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Import Overview](../../import/overview.md)
- [Importing a Bank File](../../import/importing-a-bank-file.md)
