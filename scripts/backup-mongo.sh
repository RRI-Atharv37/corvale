#!/usr/bin/env bash
#
# Nightly off-box backup of the bundled MongoDB (docker-compose.yml `mongo` service).
# Dumps the whole `corvale` database, gzips it, uploads it to object storage, and
# prunes local copies older than RETAIN_DAYS. Object storage keeps the full history.
#
# Setup:
#   1. Set BUCKET below. Swap `gcloud storage cp` for `aws s3 cp --endpoint-url ...`
#      if you use S3 / R2 / B2.
#   2. Give the host write access to it (VM service-account role, or `gcloud auth`).
#   3. Schedule it (crontab -e):
#        0 2 * * * /home/YOU/corvale/scripts/backup-mongo.sh >> /home/YOU/backups/backup.log 2>&1
#
# Receipt files (the uploads-data volume) are NOT covered here. Use a host/disk
# snapshot, or set RECEIPT_STORAGE_DRIVER=s3 and back up that bucket.
#
# Restore procedure: docs/developers/backup-restore-runbook.md

set -euo pipefail

BUCKET="gs://REPLACE_WITH_YOUR_BUCKET"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${BACKUP_OUT_DIR:-$HOME/backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-7}"

mkdir -p "$OUT_DIR"
cd "$PROJECT_DIR"

MU=$(grep -E '^MONGO_ROOT_USERNAME=' .env | cut -d= -f2-)
MP=$(grep -E '^MONGO_ROOT_PASSWORD=' .env | cut -d= -f2-)
: "${MU:?MONGO_ROOT_USERNAME not found in .env}"
: "${MP:?MONGO_ROOT_PASSWORD not found in .env}"

TS=$(date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/corvale-$TS.archive.gz"

docker compose exec -T mongo mongodump \
  --username "$MU" --password "$MP" --authenticationDatabase admin \
  --db corvale --archive --gzip > "$FILE"

gcloud storage cp "$FILE" "$BUCKET/corvale-$TS.archive.gz" --quiet

find "$OUT_DIR" -name 'corvale-*.archive.gz' -mtime "+$RETAIN_DAYS" -delete

echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"