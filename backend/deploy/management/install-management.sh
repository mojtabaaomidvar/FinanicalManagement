#!/usr/bin/env bash
# Install only the reviewed independent management bundle; run manually on the VPS.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run as root in the server console.' >&2; exit 1; }
source_root="$(cd -- "${1:?Pass the reviewed source root}" && pwd)"
web_root="$(cd -- "${2:?Pass the independent management web build}" && pwd)"
origin="${3:?Pass the HTTPS management origin}"
hosting="${4:-dedicated}"
[[ "$origin" =~ ^https://[a-z0-9][a-z0-9.-]+$ ]] || { echo 'Pass an exact HTTPS hostname without a path.' >&2; exit 1; }
[[ "$hosting" == dedicated || "$hosting" == shared-support ]] || { echo 'Unknown management hosting mode.' >&2; exit 1; }
[[ "$hosting" != shared-support || "$origin" == https://supp.khaanehyar.ir ]] || { echo 'Shared hosting requires the existing support hostname.' >&2; exit 1; }
hostname="${origin#https://}"
base=/opt/khaneyar-management
deploy=/opt/khaneyar/backend/deploy
certificate="/etc/letsencrypt/live/$hostname"
for command in python3 docker nginx systemctl visudo runuser; do command -v "$command" >/dev/null; done
python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is required"'
[[ -f "$certificate/fullchain.pem" && -f "$certificate/privkey.pem" ]]
[[ -f "$deploy/.env" && -f "$deploy/docker-compose.yml" && -f "$web_root/management.html" ]]
[[ -f "$source_root/backend/app/management/main.py" && -f "$source_root/backend/management-worker.py" ]]
[[ ! -e /etc/nginx/sites-available/khaneyar-management.conf && ! -L /etc/nginx/sites-available/khaneyar-management.conf && ! -L /etc/nginx/sites-enabled/khaneyar-management.conf && ! -e /etc/nginx/sites-enabled/khaneyar-management.conf ]] || { echo 'Existing management nginx configuration requires review.' >&2; exit 1; }
if [[ "$hosting" == shared-support ]]; then
    python3 "$source_root/backend/deploy/management/support_host.py" check
fi
nginx -t
activated=0
service_started=0
nginx_link_created=0
install_state=""
cleanup() {
    local code=$?
    trap - EXIT
    if [[ $activated -eq 0 && -n "$install_state" && -f "$install_state/nginx/before.json" ]]; then
        python3 "$source_root/backend/deploy/management/support_host.py" restore "$install_state/nginx" || true
        if nginx -t; then systemctl reload nginx || true; fi
    fi
    if [[ $activated -eq 0 && $nginx_link_created -eq 1 && -L /etc/nginx/sites-enabled/khaneyar-management.conf ]]; then
        rm -- /etc/nginx/sites-enabled/khaneyar-management.conf
    fi
    if [[ $activated -eq 0 && $service_started -eq 1 ]]; then
        systemctl stop khaneyar-management.service || true
    fi
    exit "$code"
}
trap cleanup EXIT
# Existing service installations require an explicit reviewed upgrade, avoiding overwriting live identity/config.
[[ ! -e /etc/khaneyar-management/config.json && ! -e "$base/source" ]] || { echo 'Management is already installed. Preserve its configuration and identity during a reviewed upgrade.' >&2; exit 1; }
python3 - <<'PY'
import socket
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 5710))
PY
install -d -m 700 /var/backups/khaneyar/management-install
install_state="$(mktemp -d /var/backups/khaneyar/management-install/initial.XXXXXXXX)"
getent passwd khaneyar-management >/dev/null || useradd --system --home-dir /var/lib/khaneyar-management --shell /usr/sbin/nologin khaneyar-management
install -d -m 755 "$base" "$base/source" "$base/source/backend" "$base/source/backend/app" "$base/web"
install -d -m 750 -o root -g khaneyar-management /etc/khaneyar-management
install -d -m 700 -o khaneyar-management -g khaneyar-management /var/lib/khaneyar-management
install -d -m 700 "$base/releases" /var/backups/khaneyar/management
install -d -m 755 "$base/source/backend/app/management"
for module in "$source_root/backend/app/management/"*.py; do
    install -m 644 "$module" "$base/source/backend/app/management/"
done
install -m 644 "$source_root/backend/app/__init__.py" "$base/source/backend/app/__init__.py"
install -m 644 "$source_root/backend/management-worker.py" "$base/source/backend/management-worker.py"
cp -a -- "$web_root/." "$base/web/"
chown -R root:root "$base/source" "$base/web"
find "$base/source" "$base/web" -type d -exec chmod 755 {} +
find "$base/source" "$base/web" -type f -exec chmod 644 {} +
python3 -m venv "$base/venv"
"$base/venv/bin/pip" install -r "$source_root/backend/deploy/management/requirements.txt"
chmod -R a+rX "$base/venv"
python3 - "$origin" <<'PY'
import json, os, sys
from pathlib import Path
p=Path('/etc/khaneyar-management/config.json')
p.write_text(json.dumps({'mode':'production','origin':sys.argv[1],'state_dir':'/var/lib/khaneyar-management','web_root':'/opt/khaneyar-management/web'}))
os.chmod(p,0o640)
PY
chown root:khaneyar-management /etc/khaneyar-management/config.json
cat > /usr/local/sbin/khaneyar-management-worker <<'SH'
#!/bin/sh
[ "$#" -eq 0 ] || exit 64
exec /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin /opt/khaneyar-management/venv/bin/python -I /opt/khaneyar-management/source/backend/management-worker.py
SH
chmod 755 /usr/local/sbin/khaneyar-management-worker
printf '%s\n' 'khaneyar-management ALL=(root) NOPASSWD: /usr/local/sbin/khaneyar-management-worker ""' > /etc/sudoers.d/khaneyar-management
chmod 440 /etc/sudoers.d/khaneyar-management
visudo -cf /etc/sudoers.d/khaneyar-management
install -m 644 "$source_root/backend/deploy/management/"*.service /etc/systemd/system/
install -m 644 "$source_root/backend/deploy/management/"*.timer /etc/systemd/system/
# Prepare runtime integration without restarting or rebuilding the existing application.
install -d -m 755 "$deploy/management"
[[ -f "$deploy/management/runtime.json" ]] || printf '%s\n' '{}' > "$deploy/management/runtime.json"
chmod 644 "$deploy/management/runtime.json"
python3 - "$deploy" <<'PY'
import json, os, sys
from pathlib import Path
root=Path(sys.argv[1]); p=root/'docker-compose.management.json'
p.write_text(json.dumps({'services':{'api':{'environment':{'KHANEYAR_RUNTIME_FILE':'/run/khaneyar-management/runtime.json'},'volumes':[str(root/'management')+':/run/khaneyar-management:ro']}}}))
os.chmod(p,0o600)
PY
if [[ "$hosting" == dedicated ]]; then
cat > /etc/nginx/sites-available/khaneyar-management.conf <<NGINX
server {
    listen 80;
    server_name $hostname;
    location / { return 308 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name $hostname;
    ssl_certificate $certificate/fullchain.pem;
    ssl_certificate_key $certificate/privkey.pem;
    client_max_body_size 32k;
    access_log off;
    location / {
        proxy_pass http://127.0.0.1:5710;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 180s;
        proxy_buffering off;
    }
}
NGINX
[[ ! -e /etc/nginx/sites-enabled/khaneyar-management.conf ]] || { echo 'Existing management nginx link requires review.' >&2; exit 1; }
ln -s /etc/nginx/sites-available/khaneyar-management.conf /etc/nginx/sites-enabled/khaneyar-management.conf
nginx_link_created=1
nginx -t
fi
(cd "$base/source/backend" && runuser -u khaneyar-management -- "$base/venv/bin/python" -m app.management.cli --config /etc/khaneyar-management/config.json init)
systemctl daemon-reload
systemctl start khaneyar-management.service
service_started=1
python3 - "$hostname" <<'PY'
import json, sys, time
from urllib.request import Request, urlopen
for attempt in range(30):
    try:
        request = Request('http://127.0.0.1:5710/management/api/session', headers={'Host': sys.argv[1]})
        with urlopen(request, timeout=2) as response:
            assert json.load(response)['mode'] == 'production'
        break
    except Exception:
        if attempt == 29:
            raise SystemExit('Management did not become healthy. Inspect journalctl -u khaneyar-management.')
        time.sleep(1)
PY
if [[ "$hosting" == shared-support ]]; then
    python3 "$source_root/backend/deploy/management/support_host.py" activate "$install_state/nginx"
fi
systemctl reload nginx
systemctl enable khaneyar-management.service
activated=1
if [[ "$hosting" == shared-support ]]; then
    echo "Management installed: $origin/management/"
else
    echo "Management installed: $origin"
fi
echo 'Daily backup timer remains disabled until enabled in the panel.'
echo 'For runtime switches, include docker-compose.management.json in the reviewed application deployment and deploy the compatible household API.'
