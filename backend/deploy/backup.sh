#!/usr/bin/env bash
# ── بکاپِ خانه‌یار: دیتابیس (pg_dump) + فایل‌های آپلودی ──
#
# این مهم‌ترین کارِ مسیرِ «سرور ابری» است: بکاپ به عهدهٔ توست.
# در کرونِ سرور بگذار (مثلاً هر شب ۳ بامداد):
#     crontab -e
#     0 3 * * * /opt/khaneyar/backend/deploy/backup.sh >> /var/log/khaneyar-backup.log 2>&1
#
# تستِ بازگردانی را جدی بگیر: بکاپی که restore نشود، بکاپ نیست (restore.sh).

set -euo pipefail

# ── تنظیمات (روی سرورِ خودت بازبینی کن) ──────────────────────
COMPOSE_DIR="/opt/khaneyar/backend/deploy"   # مسیرِ docker-compose روی سرور
BACKUP_DIR="/var/backups/khaneyar"           # مقصدِ بکاپ‌ها
RETENTION_DAYS=14                            # نگه‌داریِ چند روز
# ─────────────────────────────────────────────────────────────

cd "$COMPOSE_DIR"

# نام کاربر/دیتابیس را از همان .env بردار (فقط مقادیرِ سادهٔ Postgres لازم است)
set -a
# shellcheck disable=SC1091
. ./.env
set +a

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d-%H%M%S)"

# ۱) دیتابیس — pg_dump از داخلِ کانتینر، فشرده
echo "[$(date)] dumping database…"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/db-$ts.sql.gz"

# ۲) فایل‌های آپلودی (فقط در حالتِ دیسک؛ اگر پوشه وجود دارد)
if [ -d "$COMPOSE_DIR/uploads" ]; then
  echo "[$(date)] archiving uploads…"
  tar -czf "$BACKUP_DIR/uploads-$ts.tar.gz" -C "$COMPOSE_DIR" uploads
fi

# ۳) حذفِ بکاپ‌های قدیمی‌تر از RETENTION_DAYS
find "$BACKUP_DIR" -name 'db-*.sql.gz'      -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

# ۴) (اختیاری، توصیه‌شده) کپیِ آفسایت به فضای ابری S3 — تا اگر خودِ سرور از بین رفت،
#    بکاپ جای دیگری باشد. اگر aws-cli نصب و STORAGE_* در .env ست است، از کامنت دربیاور:
# aws s3 cp "$BACKUP_DIR/db-$ts.sql.gz" "s3://$STORAGE_BUCKET/backups/" \
#     --endpoint-url "$STORAGE_ENDPOINT"

echo "[$(date)] backup done: $ts"
