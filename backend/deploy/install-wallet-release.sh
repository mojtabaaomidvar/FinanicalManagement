#!/usr/bin/env bash
# Coordinated, exact-baseline API/PWA upgrade. Never rewind wallet audit history.
set -Eeuo pipefail
umask 077
release_root="$(cd -- "${1:?Pass the extracted release directory}" && pwd)"
source_root="$release_root/source"
compose_dir=/opt/khaneyar/backend/deploy
web_dir=/var/www/khaneyar
state_dir=/var/lib/khaneyar/releases/v0.11.0
backup_root=/var/backups/khaneyar/releases
image=khaneyar-api:v0.11.0
checker="$source_root/backend/deploy/check-wallet-release.py"
completed=0
stopped=0
prepared=0
previous_moved=0
web_swapped=0
restore_created=0
[[ $EUID -eq 0 ]] || { echo 'Run as root in the server console.' >&2; exit 1; }
for command in docker curl python3 tar gzip flock realpath sync cp mv find mktemp chown chmod cat date; do command -v "$command" >/dev/null; done
[[ -f "$compose_dir/.env" && ! -L "$compose_dir/.env" && -f "$compose_dir/docker-compose.yml" && ! -L "$compose_dir" ]]
[[ ! -L "$compose_dir/docker-compose.release.json" && ! -L "$compose_dir/uploads" ]]
[[ ! -L "$web_dir" && ! -L "$state_dir" && ! -L "$backup_root" ]]
exec 9>/var/lock/khaneyar-release.lock
flock -n 9 || { echo 'Another release installer is running.' >&2; exit 1; }
python3 "$checker" incoming "$release_root"
contract="$(python3 "$checker" contract "$release_root")"
mkdir -p -- "$state_dir" "$backup_root"
chmod 700 "$state_dir" "$backup_root"
for entry in "$state_dir"/*; do
    [[ ! -e "$entry" ]] || [[ -f "$entry" && ! -L "$entry" ]]
done
release_hash="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$release_root/validation.json")"
if [[ -f "$state_dir/manifest-sha256" ]]; then
    [[ "$(cat "$state_dir/manifest-sha256")" == "$release_hash" ]] || { echo 'Retained release journal belongs to different bytes; stopped.' >&2; exit 1; }
else
    printf '%s\n' "$release_hash" > "$state_dir/manifest-sha256"
fi
cd "$compose_dir"
# A repeat of an activated release must also fail closed during early verification.
preflight_exit() {
    local code=$?
    trap - EXIT
    if [[ $code -ne 0 && -f "$state_dir/activated" ]]; then
        docker compose stop api || true
        echo 'MAINTENANCE: activated source/schema/PWA could not be verified; API left OFF. No old API or database was restored.' >&2
    fi
    exit "$code"
}
trap preflight_exit EXIT
docker compose config --quiet
api_id="$(docker compose ps -q api)"
if [[ -n "$api_id" ]]; then
    state="$(docker compose exec -T api python - container "$contract" < "$checker")"
else
    [[ -f "$state_dir/activated" ]] || { echo 'Existing API must be running before a first installation.' >&2; exit 1; }
    state="$(docker compose run --rm --no-deps -T api python - container "$contract" < "$checker")"
fi
if [[ -d "$web_dir" ]]; then
    [[ "$(realpath "$web_dir")" == "$web_dir" ]]
    web_state="$(python3 "$checker" pwa "$release_root" "$web_dir")"
else
    web_state=MISSING
    [[ -f "$state_dir/backup-path" ]]
fi
if [[ -f "$state_dir/activated" ]]; then
    [[ "$state" == ALREADY ]] || { echo 'Activated release cannot restart an old API; administrator review required.' >&2; exit 1; }
    backup_dir="$(cat "$state_dir/backup-path")"
    [[ "$backup_dir" == "$backup_root"/wallet-0.11.0-* && -d "$backup_dir" && ! -L "$backup_dir" ]]
    if [[ -f "$state_dir/completed" && "$web_state" == ALREADY && -n "$api_id" ]]; then
        python3 "$checker" public "$release_root"
        echo 'RELEASE ALREADY INSTALLED: v0.11.0; API/schema/PWA/public contract verified.'
        exit 0
    fi
    echo 'Resuming the same verified activated release; old API/database rollback is prohibited.'
else
    [[ "$state" == BASELINE || "$state" == MIGRATED_BASELINE ]]
    [[ "$web_state" == BASELINE ]]
    old_image="$(docker inspect --format '{{.Image}}' "$api_id")"
    old_reference="$(docker inspect --format '{{.Config.Image}}' "$api_id")"
    [[ "$old_image" == sha256:* && -n "$old_reference" ]]
    backup_dir="$(mktemp -d "$backup_root/wallet-0.11.0-$(date -u +%Y%m%d-%H%M%S).XXXXXX")"
    printf '%s\n' "$backup_dir" > "$state_dir/backup-path"
    printf '%s\n' "$old_image" > "$backup_dir/previous-image-id"
    cp -p -- .env "$backup_dir/env-before"
    [[ ! -f docker-compose.release.json ]] || cp -p -- docker-compose.release.json "$backup_dir/compose-release-before.json"
    tar -czf "$backup_dir/pwa-before.tar.gz" -C "$web_dir" .
    gzip -t "$backup_dir/pwa-before.tar.gz"
fi

cleanup() {
    local code=$?
    trap - EXIT
    if [[ $restore_created -eq 1 ]]; then
        docker compose exec -T db sh -c 'exec dropdb -U "$POSTGRES_USER" "$1"' _ "$restore_db" || true
    fi
    if [[ $completed -ne 1 && $stopped -eq 1 ]]; then
        docker compose stop api || true
        if [[ -f "$state_dir/activated" ]]; then
            echo "MAINTENANCE: new release activation began; API left OFF, new PWA/history retained. Rerun the same verified installer. Backup: $backup_dir" >&2
        else
            if [[ $web_swapped -eq 1 ]]; then mv -- "$web_dir" "$backup_dir/pwa-failed"; fi
            if [[ $previous_moved -eq 1 ]]; then
                if [[ "$(python3 "$checker" pwa "$release_root" "$previous_web")" == BASELINE ]]; then
                    mv -- "$previous_web" "$web_dir"
                else
                    echo 'MAINTENANCE: previous PWA differs; preserved and API left OFF.' >&2
                    exit "$code"
                fi
            fi
            if [[ $prepared -eq 1 ]]; then
                cp -p -- "$backup_dir/env-before" .env
                if [[ -f "$backup_dir/compose-release-before.json" ]]; then
                    cp -p -- "$backup_dir/compose-release-before.json" docker-compose.release.json
                else
                    rm -f -- "$compose_dir/docker-compose.release.json"
                fi
            fi
            if [[ "$old_reference" != sha256:* ]]; then docker image tag "$old_image" "$old_reference" || true; fi
            if docker compose run --rm --no-deps -T api python - rollback "$contract" < "$checker" >/dev/null; then
                docker compose up -d --no-deps --no-build --pull never api && echo "Previous verified API/PWA restored; additive schema retained. Backup: $backup_dir" >&2
            else
                echo 'MAINTENANCE: old source/schema/history cannot be verified; API left OFF.' >&2
            fi
        fi
        echo 'No production database restore or downgrade was performed.' >&2
    fi
    exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo 'Building and verifying 0.11.0 API source...'
docker build --network=host --build-arg PIP_INDEX_URL=https://pypi.org/simple -t "$image" "$source_root/backend"
docker run --rm --network none --entrypoint python -i "$image" - image "$contract" < "$checker" >/dev/null
new_web="$(mktemp -d /var/www/khaneyar-next-0.11.0.XXXXXX)"
cp -a -- "$release_root/pwa/." "$new_web/"
chown -R root:root "$new_web"
find "$new_web" -type d -exec chmod 755 {} +
find "$new_web" -type f -exec chmod 644 {} +
[[ "$(python3 "$checker" pwa "$release_root" "$new_web")" == ALREADY ]]
if [[ -f "$state_dir/previous-web-path" ]]; then
    previous_web="$(cat "$state_dir/previous-web-path")"
    [[ "$previous_web" == /var/www/khaneyar-next-0.11.0.*.previous && ! -L "$previous_web" ]]
else
    previous_web="$new_web.previous"
    printf '%s\n' "$previous_web" > "$state_dir/previous-web-path"
fi
stopped=1
docker compose stop api
if [[ ! -f "$state_dir/activated" ]]; then
    [[ "$(docker compose run --rm --no-deps -T api python - container "$contract" < "$checker")" == "$state" ]]
    docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$backup_dir/database-before.sql.gz"
    gzip -t "$backup_dir/database-before.sql.gz"
    restore_db="khaneyar_wallet_restore_$(date -u +%Y%m%d%H%M%S)_$$_$RANDOM"
    docker compose exec -T db sh -c 'exec createdb -U "$POSTGRES_USER" -T template0 "$1"' _ "$restore_db"
    restore_created=1
    gzip -dc "$backup_dir/database-before.sql.gz" | docker compose exec -T db sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' _ "$restore_db" > "$backup_dir/restore-check.log" 2>&1
    # New image is selected only for the private verification process; no service is started.
    prepared=1
    python3 "$source_root/backend/deploy/prepare-wallet-release.py" "$source_root" "$image"
    docker compose run --rm --no-deps -T -v "$source_root/backend/deploy:/wallet-release:ro" api python /wallet-release/verify-wallet-backup.py "$restore_db"
    docker compose exec -T db sh -c 'exec dropdb -U "$POSTGRES_USER" "$1"' _ "$restore_db"
    restore_created=0
    if [[ -d uploads ]]; then
        tar -czf "$backup_dir/uploads-before.tar.gz" uploads
        gzip -t "$backup_dir/uploads-before.tar.gz"
    fi
    docker compose run --rm --no-deps -T -v "$source_root/backend/deploy:/wallet-release:ro" api python /wallet-release/migrate-wallet-release.py "$contract"
fi
[[ "$(docker compose run --rm --no-deps -T api python - container "$contract" < "$checker")" == ALREADY ]]
# The new app is exercised in-process while port 8000 remains OFF. No real data read/write.
docker compose run --rm --no-deps -T api python - <<'PRIVATE_HEALTH'
import asyncio
import httpx
from app.main import app
async def check():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://private-check') as client:
        assert (await client.get('/api/v1/auth/config')).status_code == 200
        assert (await client.get('/api/v1/accounts')).status_code == 409
        assert (await client.get('/api/v1/accounts',headers={'X-Khaneyar-Money-Contract':'decimal-v1'})).status_code == 401
asyncio.run(check())
print('PRIVATE API VERIFIED: auth/old-client gate; no financial data accessed.')
PRIVATE_HEALTH
if [[ -d "$web_dir" ]]; then
    [[ "$(python3 "$checker" pwa "$release_root" "$web_dir")" == "$web_state" ]]
    if [[ "$web_state" != ALREADY ]]; then
        [[ ! -e "$previous_web" ]]
        mv -- "$web_dir" "$previous_web"
        previous_moved=1
        mv -- "$new_web" "$web_dir"
        web_swapped=1
    fi
else
    [[ -d "$previous_web" && ! -L "$previous_web" ]]
    python3 "$checker" pwa "$release_root" "$previous_web" >/dev/null
    mv -- "$new_web" "$web_dir"
    web_swapped=1
fi
[[ "$(python3 "$checker" pwa "$release_root" "$web_dir")" == ALREADY ]]
# Durable write BEFORE exposing the new API: after this boundary never restart old money code.
printf 'activation began\n' > "$state_dir/activated"
sync -f "$state_dir/activated"
sync -f "$state_dir"
docker compose up -d --no-deps --no-build --pull never api
for attempt in {1..30}; do
    if curl -fsS --max-time 3 http://127.0.0.1:8000/api/v1/auth/config >/dev/null; then break; fi
    [[ $attempt -lt 30 ]] || { echo 'New API health check failed.' >&2; exit 1; }
    sleep 2
done
[[ "$(docker compose exec -T api python - container "$contract" < "$checker")" == ALREADY ]]
python3 "$checker" public "$release_root"
curl -fsS --max-time 20 https://api.khaanehyar.ir/api/v1/auth/config >/dev/null
printf 'complete\n' > "$state_dir/completed"
sync -f "$state_dir/completed"
completed=1
echo 'RELEASE INSTALLED: v0.11.0'
echo "API source, migration 0037, restricted grants, all PWA files and old-client gate verified. Backup: $backup_dir"
