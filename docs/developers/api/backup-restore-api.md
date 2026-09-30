---
title: Backup and Restore API
---

## Endpoints

All routes are mounted at `/api/v1/backup` and require authentication.

## GET /backup/export

Query params: `format` (`json` default, or `zip`), `workspaceId` (optional; requires editor access).

- `json` - a single pretty-printed JSON file. Includes accounts, categories, tags, budgets, savings goals and their contributions, recurring rules, categorization rules, transaction templates, transactions, and receipt **metadata** (not the files).
- `zip` - the same JSON payload plus the actual receipt files, streamed as an archive built with `archiver`.

Every document is serialized with `_id` renamed to `id` (string), `__v` and `userId` stripped, and dates/ObjectIds converted to strings.

## POST /backup/preview

Read-only dry run - performs no writes. Body can carry raw JSON (`{ "backup": {...} }`) or a multipart `.json`/`.zip` upload (`file`, up to 50 MB; JSON payloads specifically capped at 10 MB).

Validates the payload's `version` field and required arrays, then returns `{ valid, version, exportedAt, sourceScope, targetScope, counts, warnings, errors }`. Warns when the source and target workspace scope differ, and when a ZIP is needed to restore receipt files.

## POST /backup/restore

Same payload handling as preview, but writes to the database. **Every restored record gets a brand-new id** - restore never overwrites or reuses existing documents. References between records (a transaction's `accountId`, a budget's `categoryId`, and so on) are rewritten to point at the newly created ids via an in-memory old-id → new-id map built as each entity type is inserted. Global/master categories (`userId: null`) are matched by id and reused rather than duplicated; existing tags are deduped by name.

Receipt files (ZIP restores only) are matched to their record by `storedFilename`, written to disk under a new random filename; a receipt with no matching file in the archive is skipped rather than failing the restore.

Every record is checked against the same rules the REST API applies to new data before anything is written, and a record that fails is refused with a 400 (the preview reports the same error):

- Amounts must be whole numbers of minor units, and a transaction or recurring rule must use its account's currency.
- A transfer must be two legs on different accounts that name each other, with the same amount. A split must be a parent expense with at least two lines on the same account that add up to it.
- Categorization rules, recurring rules, budgets, goals and templates follow their normal bounds (for example a rule match value is at most 200 characters, and a custom recurring rule needs its interval days).
- Two records of the same kind may not share an id.

Values the server derives are recalculated, never read from the file: account balances come from the restored ledger, a savings goal's saved amount comes from its contributions (its status follows), and a split parent's `hasSplitChildren` comes from its lines. Reconciliation state, `externalId`, credit terms, a cancelled recurring rule and the default account are restored as they were. A backup's default account stays the default only if the target scope is personal and has no default yet.

Response: `{ created: <counts per entity>, idMapping: <old id → new id>, warnings? }` (201). A broken reference or an invalid record throws 400 (`BACKUP.BROKEN_REFERENCE` or one of the `BACKUP.INVALID_*` messages) and nothing is kept - everything written before the error is rolled back.

## Related pages

- [API Overview](../guides/api-overview.md)
- [Backup and Restore Overview](../../backup-restore/overview.md)
- [Import API](./import-api.md)
