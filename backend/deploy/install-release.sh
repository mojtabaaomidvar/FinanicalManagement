#!/usr/bin/env bash
# Called from the checksum-verified release archive; the existing database stays in place.
set -Eeuo pipefail
umask 077

release_root="$(cd -- "${1:?Pass the extracted release directory}" && pwd)"
source_root="$release_root/source"
compose_dir=/opt/khaneyar/backend/deploy
web_dir=/var/www/khaneyar
site_dir=/var/www/khaneyar-site
nginx_file=/etc/nginx/sites-available/khaneyar.conf
image="khaneyar-api:$(cat "$release_root/release-tag.txt")"
backup_dir="/var/backups/khaneyar/releases/$(date -u +%Y%m%d-%H%M%S)"
completed=0
stopped=0
prepared=0
migration_started=0
web_swapped=0
nginx_changed=0

[[ $EUID -eq 0 ]] || { echo 'Run this installer as root.' >&2; exit 1; }
for command in docker curl python3 tar gzip nginx; do command -v "$command" >/dev/null; done
[[ -f "$compose_dir/.env" && -f "$compose_dir/docker-compose.yml" && -d "$web_dir" ]]
[[ -f "$release_root/pwa/index.html" && -f "$source_root/backend/Dockerfile" ]]
cd "$compose_dir"
docker compose config --quiet
api_id="$(docker compose ps -q api)"
[[ -n "$api_id" ]] || { echo 'The existing API container must be running.' >&2; exit 1; }
old_image="$(docker inspect --format '{{.Image}}' "$api_id")"

rollback() {
    local code=$?
    trap - EXIT
    if [[ $completed -ne 1 && $stopped -eq 1 ]]; then
        echo "Upgrade stopped. Restoring the previous API and web files; backup: $backup_dir" >&2
        if [[ $web_swapped -eq 1 ]]; then
            mv -- "$web_dir" "$release_root/pwa-failed"
            mv -- "$backup_dir/pwa-previous" "$web_dir"
        fi
        if [[ $nginx_changed -eq 1 ]]; then
            cp -p -- "$backup_dir/nginx.conf" "$nginx_file"
            nginx -t && systemctl reload nginx
        fi
        if [[ $prepared -eq 1 && $migration_started -eq 0 ]]; then
            cp -p -- "$backup_dir/env-before" .env
            if [[ -f "$backup_dir/compose-release-before.json" ]]; then
                cp -p -- "$backup_dir/compose-release-before.json" docker-compose.release.json
            else
                rm -f -- "$compose_dir/docker-compose.release.json"
            fi
        elif [[ $prepared -eq 1 ]]; then
            # Keep the generated key so a retry cannot change it after migration.
            python3 - "$compose_dir/docker-compose.release.json" "$old_image" <<'PY'
import json, os, sys
from pathlib import Path
p = Path(sys.argv[1])
p.write_text(json.dumps({'services': {'api': {'image': sys.argv[2]}}}), encoding='utf-8')
os.chmod(p, 0o600)
PY
        fi
        docker compose up -d --no-deps --no-build --pull never api || true
        echo 'No database downgrade or restore was attempted.' >&2
    fi
    exit "$code"
}
trap rollback EXIT

echo 'Building the new API while the current application remains available...'
docker build --network=host --build-arg PIP_INDEX_URL=https://pypi.org/simple \
    -t "$image" "$source_root/backend"
mkdir -p -- "$backup_dir"
cp -p -- .env "$backup_dir/env-before"
[[ ! -f docker-compose.release.json ]] || cp -p -- docker-compose.release.json "$backup_dir/compose-release-before.json"
[[ ! -f "$nginx_file" ]] || cp -p -- "$nginx_file" "$backup_dir/nginx.conf"
[[ ! -f "$site_dir/download/index.html" ]] || cp -p -- "$site_dir/download/index.html" "$backup_dir/download-before.html"
tar -czf "$backup_dir/pwa-before.tar.gz" -C "$web_dir" .

echo 'Stopping the API briefly for a consistent database and upload backup...'
docker compose stop api
stopped=1
# Backup credentials remain inside the database container and are never printed.
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    | gzip > "$backup_dir/database-before.sql.gz"
gzip -t "$backup_dir/database-before.sql.gz"
if [[ -d uploads ]]; then tar -czf "$backup_dir/uploads-before.tar.gz" uploads; gzip -t "$backup_dir/uploads-before.tar.gz"; fi

prepared=1
generated_key="$(python3 "$source_root/backend/deploy/release-server.py" prepare "$source_root" "$image")"
cp -p -- .env "$backup_dir/env-after"
echo 'Verifying database access, applying additive migrations, and preserving the encryption key...'
docker compose run --rm --no-deps -T -e "KHANEYAR_GENERATED_KEY=$generated_key" \
    -v "$source_root/backend/deploy/release-server.py:/tmp/release-server.py:ro" \
    api python /tmp/release-server.py check
migration_started=1
docker compose run --rm --no-deps -T -e "KHANEYAR_GENERATED_KEY=$generated_key" \
    -v "$source_root/backend/deploy/release-server.py:/tmp/release-server.py:ro" \
    api python /tmp/release-server.py migrate
docker compose up -d --no-deps --no-build --pull never api

for attempt in {1..30}; do
    if curl -fsS --max-time 3 http://127.0.0.1:8000/api/v1/auth/config >/dev/null; then break; fi
    [[ $attempt -lt 30 ]] || { echo 'New API health check failed.' >&2; exit 1; }
    sleep 2
done

if [[ -f "$nginx_file" ]] && grep -q 'client_max_body_size' "$nginx_file"; then
    python3 - "$nginx_file" <<'PY'
import re, sys
from pathlib import Path
p = Path(sys.argv[1])
p.write_text(re.sub(r'(?m)^(\s*client_max_body_size\s+)[^;]+;', r'\g<1>12m;', p.read_text()), encoding='utf-8')
PY
    nginx_changed=1
    nginx -t
    systemctl reload nginx
fi
new_web="$(mktemp -d /var/www/khaneyar-next.XXXXXX)"
cp -a -- "$release_root/pwa/." "$new_web/"
chown -R root:root "$new_web"
find "$new_web" -type d -exec chmod 755 {} +
find "$new_web" -type f -exec chmod 644 {} +
mv -- "$web_dir" "$backup_dir/pwa-previous"
if mv -- "$new_web" "$web_dir"; then web_swapped=1; else mv -- "$backup_dir/pwa-previous" "$web_dir"; exit 1; fi
curl -fsS --max-time 15 https://pwa.khaanehyar.ir/ >/dev/null
curl -fsS --max-time 15 https://api.khaanehyar.ir/api/v1/auth/config >/dev/null
if [[ -f "$site_dir/download/index.html" ]]; then
    install -m 644 "$source_root/site/download/index.html" "$site_dir/download/index.html"
fi
completed=1
echo "RELEASE INSTALLED: $(cat "$release_root/release-tag.txt")"
echo "Source: $source_root"
echo "Database, uploads, encryption key, existing accounts and APK preserved. Backup: $backup_dir"
