#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root in the server console.' >&2; exit 1; }
release_root="$(cd -- "${1:?Pass the verified extracted release}" && pwd)"
state_dir="/var/backups/khaneyar/$(cat "$release_root/release-tag.txt")"
mkdir -p -- "$state_dir"
printf '%s\n' "$release_root" > "$state_dir/release-root.txt"
for command in docker curl python3 tar gzip nginx certbot; do command -v "$command" >/dev/null; done
python3 "$release_root/source/backend/deploy/configure-support-host.py" prepare
bash "$release_root/source/backend/deploy/install-release.sh" "$release_root" 2>&1 | tee "$state_dir/installation.log"
python3 "$release_root/source/backend/deploy/configure-support-host.py" activate "$release_root/source"
python3 "$release_root/source/backend/deploy/verify-support-release.py" "$release_root"
echo 'SUPPORT UPDATE COMPLETE: https://supp.khaanehyar.ir/'
