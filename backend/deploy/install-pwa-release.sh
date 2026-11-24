#!/usr/bin/env bash
# Only the checksum-verified PWA changes. API, database, configuration and APK stay intact.
set -Eeuo pipefail
umask 077
release_root="$(cd -- "${1:?Pass the extracted release directory}" && pwd)"
checker="$release_root/source/backend/deploy/check-pwa-release.py"
web_dir=/var/www/khaneyar
completed=0
previous_moved=0
web_swapped=0
[[ $EUID -eq 0 ]] || { echo 'Run as root in the server console.' >&2; exit 1; }
for command in python3 curl tar mktemp realpath flock cp mv chown chmod find; do command -v "$command" >/dev/null; done
exec 9>/var/lock/khaneyar-release.lock
flock -n 9 || { echo 'Another release installer is running.' >&2; exit 1; }
[[ -d "$web_dir" && ! -L "$web_dir" && "$(realpath "$web_dir")" == "$web_dir" ]]
python3 "$checker" incoming "$release_root"
status="$(python3 "$checker" pwa "$release_root" "$web_dir")"
if [[ "$status" == ALREADY ]]; then
    python3 "$checker" public "$release_root"
    echo 'RELEASE ALREADY INSTALLED: v0.10.0'
    exit 0
fi
[[ "$status" == BASELINE ]]
curl -fsS --max-time 20 https://api.khaanehyar.ir/api/v1/auth/config >/dev/null
backup_dir="$(mktemp -d /var/backups/khaneyar/releases/pwa-0.10.0-XXXXXX)"
tar -czf "$backup_dir/pwa-before.tar.gz" -C "$web_dir" .
tar -tzf "$backup_dir/pwa-before.tar.gz" >/dev/null
new_web="$(mktemp -d /var/www/khaneyar-next-0.10.0.XXXXXX)"
previous_web="$new_web.previous"
rollback() {
    local code=$?
    trap - EXIT
    if [[ $completed -ne 1 && $previous_moved -eq 1 ]]; then
        if python3 "$checker" baseline "$release_root" "$previous_web"; then
            if [[ $web_swapped -eq 1 ]]; then mv -- "$web_dir" "$new_web.failed"; fi
            mv -- "$previous_web" "$web_dir"
            echo "Previous verified PWA restored. Backup: $backup_dir" >&2
        else
            echo "ROLLBACK BLOCKED: previous files differ; preserved at $previous_web. Backup: $backup_dir" >&2
        fi
    fi
    exit "$code"
}
trap rollback EXIT
cp -a -- "$release_root/pwa/." "$new_web/"
chown -R root:root "$new_web"
find "$new_web" -type d -exec chmod 755 {} +
find "$new_web" -type f -exec chmod 644 {} +
[[ "$(python3 "$checker" pwa "$release_root" "$new_web")" == ALREADY ]]
# Check again after staging, before the two same-filesystem renames.
python3 "$checker" baseline "$release_root" "$web_dir"
[[ ! -e "$previous_web" && ! -e "$new_web.failed" ]]
mv -- "$web_dir" "$previous_web"
previous_moved=1
mv -- "$new_web" "$web_dir"
web_swapped=1
[[ "$(python3 "$checker" pwa "$release_root" "$web_dir")" == ALREADY ]]
python3 "$checker" public "$release_root"
curl -fsS --max-time 20 https://api.khaanehyar.ir/api/v1/auth/config >/dev/null
completed=1
echo 'RELEASE INSTALLED: v0.10.0'
echo "PWA backup: $backup_dir; previous files: $previous_web"
echo 'API, database, uploads, private settings, AI gateway and APK were not changed.'
