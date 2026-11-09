#!/usr/bin/env bash
# Nightly MongoDB backup with 14-day retention. Cron example (as the deploy user):
#   15 2 * * * /var/www/video-platform/infrastructure/deployment/backup-mongo.sh >> /var/log/video-platform/backup.log 2>&1
# Restore: mongorestore --uri "$MONGODB_URI" --gzip --archive=/var/backups/videoplatform/<file>.gz --drop
set -euo pipefail
: "${MONGODB_URI:?set MONGODB_URI (e.g. via /etc/video-platform/backup.env)}"
DEST=${BACKUP_DIR:-/var/backups/videoplatform}
mkdir -p "$DEST"
FILE="$DEST/videoplatform-$(date -u +%Y%m%dT%H%M%SZ).gz"
mongodump --uri "$MONGODB_URI" --gzip --archive="$FILE"
find "$DEST" -name 'videoplatform-*.gz' -mtime +14 -delete
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
# Copy off-box too (object storage, another server). A backup on the same disk is not a backup.
