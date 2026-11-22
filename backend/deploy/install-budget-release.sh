#!/usr/bin/env bash
# Update the budget API and PWA together; schema revision stays at 0029.
set -Eeuo pipefail
umask 077
release_root="$(cd -- "${1:?Pass the extracted release directory}" && pwd)"
source_root="$release_root/source"
compose_dir=/opt/khaneyar/backend/deploy
web_dir=/var/www/khaneyar
image=khaneyar-api:v0.5.0
checker="$source_root/backend/deploy/check-budget-release.py"
completed=0
stopped=0
prepared=0
web_swapped=0
[[ $EUID -eq 0 ]] || { echo 'Run as root in the server console.' >&2; exit 1; }
for command in docker curl python3 tar gzip flock; do command -v "$command" >/dev/null; done
[[ -f "$compose_dir/.env" && -f "$compose_dir/docker-compose.yml" ]]
[[ -d "$web_dir" && ! -L "$web_dir" ]]
exec 9>/var/lock/khaneyar-release.lock
flock -n 9 || { echo 'Another release installer is running.' >&2; exit 1; }
python3 "$checker" incoming "$release_root"
web_state="$(python3 "$checker" pwa "$release_root" "$web_dir")"
contract="$(python3 "$checker" contract "$release_root")"
cd "$compose_dir"
docker compose config --quiet
api_id="$(docker compose ps -q api)"
[[ -n "$api_id" ]] || { echo 'The existing API container must be running.' >&2; exit 1; }
old_image="$(docker inspect --format '{{.Image}}' "$api_id")"
old_reference="$(docker inspect --format '{{.Config.Image}}' "$api_id")"
api_state="$(docker compose exec -T api python - container "$contract" < "$checker")"
if [[ "$web_state" == ALREADY && "$api_state" == ALREADY ]]; then
    echo 'RELEASE ALREADY INSTALLED: v0.5.0'
    exit 0
fi
[[ "$web_state" == BASELINE || "$web_state" == ALREADY ]]
[[ "$api_state" == BASELINE || "$api_state" == ALREADY ]]
echo 'Building the verified budget API while the current application remains available...'
docker build --network=host --build-arg PIP_INDEX_URL=https://pypi.org/simple \
    -t "$image" "$source_root/backend"
docker run --rm --network none --entrypoint python -i "$image" \
    - image "$contract" < "$checker"
backup_dir="$(mktemp -d /var/backups/khaneyar/releases/budget-0.5.0-XXXXXX)"
chmod 700 "$backup_dir"
cp -p -- .env "$backup_dir/env-before"
[[ ! -f docker-compose.release.json ]] || cp -p -- docker-compose.release.json "$backup_dir/compose-release-before.json"
tar -czf "$backup_dir/pwa-before.tar.gz" -C "$web_dir" .
rollback() {
    local code=$?
    trap - EXIT
    if [[ $completed -ne 1 && $stopped -eq 1 ]]; then
        echo "Upgrade stopped. Restoring the previous API and PWA; backup: $backup_dir" >&2
        if [[ $web_swapped -eq 1 ]]; then
            mv -- "$web_dir" "$backup_dir/pwa-failed"
            mv -- "$backup_dir/pwa-previous" "$web_dir"
        fi
        if [[ $prepared -eq 1 ]]; then
            cp -p -- "$backup_dir/env-before" .env
            if [[ -f "$backup_dir/compose-release-before.json" ]]; then
                cp -p -- "$backup_dir/compose-release-before.json" docker-compose.release.json
            else
                rm -f -- "$compose_dir/docker-compose.release.json"
            fi
        fi
        if [[ "$old_reference" != sha256:* ]]; then
            docker image tag "$old_image" "$old_reference" || true
        fi
        docker compose up -d --no-deps --no-build --pull never api || true
        echo 'No database migration, downgrade or restore was performed.' >&2
    fi
    exit "$code"
}
trap rollback EXIT
echo 'Stopping the API briefly for a consistent database and upload backup...'
stopped=1
docker compose stop api
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    | gzip > "$backup_dir/database-before.sql.gz"
gzip -t "$backup_dir/database-before.sql.gz"
if [[ -d uploads ]]; then
    tar -czf "$backup_dir/uploads-before.tar.gz" uploads
    gzip -t "$backup_dir/uploads-before.tar.gz"
fi
prepared=1
generated_key="$(python3 "$source_root/backend/deploy/release-server.py" prepare "$source_root" "$image")"
[[ "$generated_key" == 0 ]] || { echo 'Existing encryption key must be preserved.' >&2; exit 1; }
docker compose up -d --no-deps --no-build --pull never api
for attempt in {1..30}; do
    if curl -fsS --max-time 3 http://127.0.0.1:8000/api/v1/auth/config >/dev/null; then break; fi
    [[ $attempt -lt 30 ]] || { echo 'New API health check failed.' >&2; exit 1; }
    sleep 2
done
[[ "$(docker compose exec -T api python - container "$contract" < "$checker")" == ALREADY ]]
new_web="$(mktemp -d /var/www/khaneyar-next-0.5.0.XXXXXX)"
cp -a -- "$release_root/pwa/." "$new_web/"
chown -R root:root "$new_web"
find "$new_web" -type d -exec chmod 755 {} +
find "$new_web" -type f -exec chmod 644 {} +
mv -- "$web_dir" "$backup_dir/pwa-previous"
if mv -- "$new_web" "$web_dir"; then web_swapped=1; else mv -- "$backup_dir/pwa-previous" "$web_dir"; exit 1; fi
[[ "$(python3 "$checker" pwa "$release_root" "$web_dir")" == ALREADY ]]
curl -fsS --max-time 30 https://pwa.khaanehyar.ir/version.json \
    | python3 -c 'import json,sys; assert json.load(sys.stdin)["version"] == "0.5.0"'
curl -fsS --max-time 20 https://api.khaanehyar.ir/api/v1/auth/config >/dev/null
completed=1
echo 'RELEASE INSTALLED: v0.5.0'
echo "Source: $source_root"
echo "Database, uploads, keys, support configuration and APK preserved. Backup: $backup_dir"
