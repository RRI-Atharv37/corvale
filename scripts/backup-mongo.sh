#!/usr/bin/env bash
#
# Nightly off-box backup of the bundled MongoDB (docker-compose.yml `mongo` service).
# Dumps the whole `corvale` database, gzips it, uploads it to object storage, and
# prunes local STAGING copies older than RETAIN_DAYS. Retention in the bucket itself is
# enforced by an object-lifecycle rule on the bucket, NOT by this script - see the
# Retention section of docs/developers/guides/backup-restore-runbook.md. The hosted service's
# Privacy Policy and Terms commit to a 30-day window, so the bucket rule must match it.
#
# Setup:
#   1. Set BUCKET below. Swap `gcloud storage cp` for `aws s3 cp --endpoint-url ...`
#      if you use S3 / R2 / B2.
#   2. Give the host write access to it (VM service-account role, or `gcloud auth`).
#   3. Schedule it (crontab -e):
#        0 2 * * * /home/YOU/corvale/scripts/backup-mongo.sh >> /home/YOU/backups/backup.log 2>&1
#   4. Set a 30-day delete lifecycle rule on the bucket (see the Retention section of
#      docs/developers/guides/backup-restore-runbook.md) - this script does not prune the bucket.
#
# The erasure ledger (collection `erasureledgers`: keyed hashes of deleted accounts, see the Erasure
# ledger section of the runbook) is also written to its own small archive on every run, so a restore
# can re-erase accounts deleted since the dump. `--ledger-only` dumps just that archive; run it from
# cron hourly (`0 * * * * .../backup-mongo.sh --ledger-only`) to shrink the gap after a total loss.
#
# Dumps are plaintext financial data: this script creates everything owner-only (umask 077) and never
# puts the Mongo password on a command line (mongodump reads it from a config file on stdin).
#
# Receipt files (the uploads-data volume) are NOT covered here. Use a host/disk
# snapshot, or set RECEIPT_STORAGE_DRIVER=s3 and back up that bucket.
#
# Restore procedure: docs/developers/guides/backup-restore-runbook.md

set -euo pipefail
umask 077

BUCKET="gs://REPLACE_WITH_YOUR_BUCKET"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${BACKUP_OUT_DIR:-$HOME/backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-7}"
LEDGER_ONLY=false
[ "${1:-}" = "--ledger-only" ] && LEDGER_ONLY=true

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
cd "$PROJECT_DIR"

MU=$(grep -E '^MONGO_ROOT_USERNAME=' .env | cut -d= -f2-)
MP=$(grep -E '^MONGO_ROOT_PASSWORD=' .env | cut -d= -f2-)
: "${MU:?MONGO_ROOT_USERNAME not found in .env}"
: "${MP:?MONGO_ROOT_PASSWORD not found in .env}"
MP_YAML=$(printf '%s' "$MP" | sed "s/'/''/g")
unset MP

dump() {
  printf "password: '%s'
" "$MP_YAML" | docker compose exec -T mongo mongodump --config=/dev/stdin --username "$MU" --authenticationDatabase admin --db corvale --archive --gzip "$@"
}

TS=$(date +%Y%m%d-%H%M%S)

LEDGER_FILE="$OUT_DIR/corvale-erasure-ledger-$TS.archive.gz"
dump --collection erasureledgers > "$LEDGER_FILE"
chmod 600 "$LEDGER_FILE"
gcloud storage cp "$LEDGER_FILE" "$BUCKET/corvale-erasure-ledger-$TS.archive.gz" --quiet

if [ "$LEDGER_ONLY" = false ]; then
  FILE="$OUT_DIR/corvale-$TS.archive.gz"
  dump > "$FILE"
  chmod 600 "$FILE"
  gcloud storage cp "$FILE" "$BUCKET/corvale-$TS.archive.gz" --quiet
fi

find "$OUT_DIR" -name 'corvale-*.archive.gz' -mtime "+$RETAIN_DAYS" -delete

echo "backup ok: ${FILE:-$LEDGER_FILE} ($(du -h "${FILE:-$LEDGER_FILE}" | cut -f1))"
