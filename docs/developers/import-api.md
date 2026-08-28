---
title: Import API
---

## Endpoints

All routes are mounted at `/api/v1/imports` and require authentication.

## Upload constraints

File uploads use the `file` form field, memory storage, and a **2 MB** cap. Accepted extensions: `.csv`, `.ofx`, `.qfx`.

## POST /imports/parse

Multipart upload. Detects OFX vs. CSV automatically.

- **OFX/QFX**: parsed directly - no mapping needed. Response: `{ format: 'ofx', requiresMapping: false, parsedRows, sampleRows }`.
- **CSV**: parsed and format-detected (`generic`, `chase`, or `corvale_export`, based on header matching). CSV files exported by older versions are still recognized and reported as the legacy `spndr_export` format. Response: `{ format: 'csv', requiresMapping: true, headers, rows, suggestedMapping, sampleRows }`, where `suggestedMapping` maps `date`/`description`/`amount`/`debit`/`credit`/`type` to detected column headers.

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

Provide `parsedRows` for OFX imports, or `headers`+`rows`+`mapping` for CSV imports (`mapping.date` is required, plus at least one of description/amount/debit/credit). Each row is run through the user's [categorization rules](./categorization-rules-api.md); unmatched rows fall back to `defaultCategoryId`.

Response includes a `summary` (`total, valid, invalid, duplicates, incomeTotal, expenseTotal`) and per-row items, each flagged with `duplicateOf` (matching existing transaction id/title/date/amount/category) when applicable.

## POST /imports/commit

Same body as preview, plus `rowDecisions`: `{ "<rowIndex>": "skip" | "import" | "merge" }`. Rows without an explicit decision default to `skip` if flagged as a duplicate, or `import` otherwise.

| Decision | Result |
|----------|--------|
| `skip` | No transaction created |
| `import` | New posted transaction created regardless of any duplicate match |
| `merge` | The matched existing transaction is updated (category, tags, empty description filled) - amount and date are untouched. 400 if the row has no duplicate match |

Response: `{ imported, merged, skipped, transactionIds, mergedTransactionIds, summary }` (201).

## Duplicate fingerprint

A row and an existing transaction are considered a duplicate match when their date, minor-unit amount, and a normalized (lowercased, punctuation-stripped) description all agree.

## Related pages

- [API Overview](./api-overview.md)
- [Import Overview](../import/overview.md)
- [Importing a Bank File](../import/importing-a-bank-file.md)
