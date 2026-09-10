#!/usr/bin/env bash
# ── بازگردانیِ دیتابیسِ خانه‌یار از یک فایلِ بکاپ ──
#
# استفاده:
#     ./restore.sh /var/backups/khaneyar/db-YYYYMMDD-HHMMSS.sql.gz
#
# هشدار: این روی دیتابیسِ فعلی می‌نویسد. برای بازگردانیِ تمیز (فاجعه/سرورِ نو)،
# بهتر است دیتابیس خالی باشد. تستِ دوره‌ایِ این اسکریپت = تنها راهِ اطمینان از بکاپ.

set -euo pipefail

COMPOSE_DIR="/opt/khaneyar/backend/deploy"
cd "$COMPOSE_DIR"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

f="${1:-}"
if [ -z "$f" ] || [ ! -f "$f" ]; then
  echo "usage: ./restore.sh <path/to/db-backup.sql.gz>" >&2
  exit 1
fi

echo "restoring '$f' → دیتابیسِ '$POSTGRES_DB' (دادهٔ فعلی بازنویسی می‌شود)"
read -r -p "ادامه؟ [yes/no] " ans
[ "$ans" = "yes" ] || { echo "لغو شد."; exit 1; }

gunzip -c "$f" | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "restore done."
