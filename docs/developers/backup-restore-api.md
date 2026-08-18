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

Response: `{ created: <counts per entity>, idMapping: <old id → new id> }` (201). A broken reference in the payload throws 400 (`BACKUP.BROKEN_REFERENCE`) and aborts - partial writes made before the error are not automatically rolled back.

## Related pages

- [API Overview](./api-overview.md)
- [Backup and Restore Overview](../backup-restore/overview.md)
- [Import API](./import-api.md)
