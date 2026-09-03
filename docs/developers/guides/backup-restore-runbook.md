---
title: Backup & Restore Runbook
---

## Scope

This is the disaster-recovery runbook for the **hosted MongoDB database** — the operator-level
backup of the whole system of record. It is a different thing from the [Backup and Restore
API](../api/backup-restore-api.md), which lets an individual user export or restore *their own*
data as JSON/ZIP from inside the app. Losing the underlying MongoDB deployment (bad migration,
accidental `deleteMany`, a corrupted volume, a botched deploy) is what this runbook is for.

Receipt files are not included in a MongoDB backup. Under the default local-disk driver
they live on the API server's filesystem (`uploads/receipts/`); under the S3-compatible driver
(see [Environment Variables](./environment-variables.md)) they live in that bucket. Back up
whichever of the two is in use separately from the steps below.

## Prerequisites

- The [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools)
  (`mongodump` / `mongorestore`), matching the hosted server's major version or newer.
- A `MONGO_URI` (or an equivalent connection string with backup credentials) for the deployment
  being backed up. Use a role scoped to backup/restore rather than the application's own
  credential where the hosting provider supports it.
- Enough local disk to hold one uncompressed dump. `mongodump --gzip` cuts this down
  significantly for a production-sized database and is the recommended default.

## Taking a backup

```bash
mongodump --uri="<connection-string>" --gzip --out=./corvale-backup-$(date +%Y%m%d-%H%M%S)
```

This dumps every collection in every database the credential can see, as BSON, one file per
collection plus a `.metadata.json` sidecar with its indexes. Corvale's own data lives in a single
database (the one named in `MONGO_URI`'s path segment) — add `--db=<name>` to scope the dump to
just that database on a shared cluster.

**Cadence.** At minimum, a nightly dump for the G1 private-beta scale this runbook targets. A
managed provider's continuous/point-in-time backups (MongoDB Atlas backups, or your host's
volume-snapshot equivalent) are a stronger complement, not a replacement — they protect against
a different failure mode (need to roll back to an exact point in time) than an off-cluster
`mongodump` archive (protects against losing the cluster/host entirely).

**Storage.** A dump is a plaintext, unencrypted export of every user's financial data. Store it
encrypted at rest (e.g. a private bucket with server-side encryption) and restrict access to
whoever is actually on call for restores — treat dump access the same as production database
access, not as a casual download.

## Retention

The hosted service's Privacy Policy and Terms state that operator backups are **kept for 30 days,
then deleted**. That window has to be enforced by the storage layer, not just implied, and it is
enforced in two separate places:

- **Local staging copies** on the API host are pruned by `scripts/backup-mongo.sh` itself, via
  `BACKUP_RETAIN_DAYS` (7 by default). These are only a holding area before upload.
- **The off-box bucket** is *not* touched by that script. It needs its own object-lifecycle rule
  that deletes each archive 30 days after it is written. For Google Cloud Storage:

  ```bash
  printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > lifecycle.json
  gcloud storage buckets update gs://YOUR_BACKUP_BUCKET --lifecycle-file=lifecycle.json
  ```

  Confirm it applied:

  ```bash
  gcloud storage buckets describe gs://YOUR_BACKUP_BUCKET --format="value(lifecycle)"
  ```

  On S3, R2 or Backblaze B2, use that provider's equivalent lifecycle / object-expiration policy.

If you ever change the retention window, change it in the bucket policy **and** in the Privacy
Policy and Terms of Service, so the published number stays true.

## Restoring a backup

Restore into a **scratch database or a fresh scratch deployment first** — never straight into
production — so a bad dump or a wrong `--uri` can't make an active incident worse:

```bash
mongorestore --uri="<scratch-connection-string>" --gzip --nsInclude="<db-name>.*" ./corvale-backup-<timestamp>
```

Once the scratch restore is verified (see below), point the application's `MONGO_URI` at the
restored database, or replay the same `mongorestore` command against the real target once
you're confident it's the right dump.

`mongorestore` does not overwrite existing collections by default — it errors on a duplicate
key rather than silently merging. Drop the target database first (`mongosh <uri> --eval
"db.dropDatabase()"`) if you're intentionally restoring over existing data, or use
`--drop` to have `mongorestore` do it collection-by-collection as it goes.

## Verifying a restore

Before treating a restore as complete:

- [ ] `mongorestore`'s summary line reports the expected document count restored, `0` failures.
- [ ] Spot-check collection counts against the last known-good numbers (`db.<collection>.countDocuments()`
  for `users`, `accounts`, `transactions` at minimum).
- [ ] Start the API against the restored database and confirm `GET /health` and `GET /ready`
  both pass, then log in as a test account and confirm balances render.
- [ ] Confirm indexes came back — `mongorestore` recreates them from each collection's
  `.metadata.json`; `db.<collection>.getIndexes()` should match the pre-incident index list.

## Tested end to end

This procedure has been run against a real MongoDB instance, not just written from the
documentation: seed data was written into a fresh database, `mongodump` archived it, the
database was dropped to simulate loss, `mongorestore` rebuilt it from the archive, and the
restored document counts and content were confirmed to match the pre-drop state exactly, using
the same `mongodump`/`mongorestore` commands documented above (MongoDB Database Tools 100.18.0).

## Related pages

- [Environment Variables](./environment-variables.md) — `MONGO_URI` and receipt storage driver settings
- [Backup and Restore API](../api/backup-restore-api.md) — per-user JSON/ZIP export and restore, from inside the app
- [Data Migration](./data-migration.md)
