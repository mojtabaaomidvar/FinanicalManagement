"""Stage HTTPS and activate the dedicated support origin without changing secrets."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HOST = "supp.khaanehyar.ir"
TARGET = Path("/etc/nginx/sites-available/khaneyar-support.conf")
LINK = Path("/etc/nginx/sites-enabled/khaneyar-support.conf")
DEPLOY = Path("/opt/khaneyar/backend/deploy")
STATE = Path("/var/backups/khaneyar/support-host")
MARKER = "# khaneyar-support-host\n"


def run(args):
    subprocess.run(args, check=True)


def write(path, content, mode=0o600):
    temporary = path.with_name(path.name+".next")
    temporary.write_text(content,encoding="utf-8",newline="\n")
    temporary.chmod(mode); temporary.replace(path)


def prepare():
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    if not (STATE/"original.json").exists():
        if TARGET.exists() and MARKER not in TARGET.read_text():
            raise RuntimeError("An existing unmanaged support configuration must be reviewed first.")
        if LINK.exists() and (not LINK.is_symlink() or LINK.resolve() != TARGET):
            raise RuntimeError("The support site link belongs to another configuration.")
        backup = STATE/datetime.now(timezone.utc).strftime("before-%Y%m%d-%H%M%S")
        backup.mkdir(mode=0o700)
        main = Path("/etc/nginx/sites-available/khaneyar.conf")
        for name,path in (("nginx-main",main),("env",DEPLOY/".env"),("support",TARGET)):
            if path.exists(): shutil.copy2(path,backup/name)
        write(STATE/"original.json",json.dumps({"backup":str(backup),"had_support":TARGET.exists(),"had_link":LINK.exists()}))
    challenge = MARKER+"""server {
    listen 80;
    listen [::]:80;
    server_name supp.khaanehyar.ir;
    location ^~ /.well-known/acme-challenge/ { root /var/www/khaneyar; try_files $uri =404; }
    location / { return 503; }
}
"""
    if not Path("/etc/letsencrypt/live/supp.khaanehyar.ir/fullchain.pem").exists():
        write(TARGET,challenge,0o644)
        if not LINK.exists(): LINK.symlink_to(TARGET)
        run(["nginx","-t"]); run(["systemctl","reload","nginx"])
        run(["certbot","certonly","--webroot","--webroot-path","/var/www/khaneyar","--cert-name",HOST,
             "-d",HOST,"--non-interactive","--agree-tos","--keep-until-expiring"])
    print("Support hostname certificate prepared. Existing application hosts retained.")


def _activate(source):
    os.chdir(DEPLOY)
    certificate = Path("/etc/letsencrypt/live/supp.khaanehyar.ir/fullchain.pem")
    if not certificate.exists(): raise RuntimeError("Prepare the support certificate first.")
    source = source.resolve(strict=True)
    configuration = (source/"backend/deploy/nginx/support.conf").read_text()
    if "server_name supp.khaanehyar.ir;" not in configuration:
        raise RuntimeError("Unexpected support host template.")
    env = DEPLOY/".env"
    before = env.read_text()
    retained = [line for line in before.splitlines() if line.partition("=")[0].strip() != "SUPPORT_ORIGINS"]
    write(env,"\n".join(retained)+"\nSUPPORT_ORIGINS=https://supp.khaanehyar.ir\n")
    old_keys = {line.partition("=")[0].strip():line for line in before.splitlines() if "=" in line and not line.lstrip().startswith("#")}
    after_keys = {line.partition("=")[0].strip():line for line in env.read_text().splitlines() if "=" in line and not line.lstrip().startswith("#")}
    assert all(after_keys.get(key)==value for key,value in old_keys.items() if key!="SUPPORT_ORIGINS")
    write(TARGET,MARKER+configuration,0o644)
    if not LINK.exists(): LINK.symlink_to(TARGET)
    snippet = Path("/etc/nginx/snippets/khaneyar-support-redirect.conf")
    snippet.parent.mkdir(parents=True,exist_ok=True)
    write(snippet,"location = /support { return 308 https://supp.khaanehyar.ir/; }\nlocation = /support/ { return 308 https://supp.khaanehyar.ir/; }\n",0o644)
    main = Path("/etc/nginx/sites-available/khaneyar.conf")
    text = main.read_text()
    include = "include /etc/nginx/snippets/khaneyar-support-redirect.conf;"
    if include not in text:
        pattern = r"(server_name\s+[^;]*\bpwa\.khaanehyar\.ir\b[^;]*;)"
        changed, count = re.subn(pattern,lambda match:match[0]+"\n    "+include,text)
        if not count: raise RuntimeError("The existing PWA host was not found; its configuration was retained.")
        write(main,changed,0o644)
    run(["nginx","-t"])
    run(["docker","compose","up","-d","--no-deps","--force-recreate","api"])
    run(["systemctl","reload","nginx"])
    write(STATE/"activated.json",json.dumps({"host":HOST,"source":str(source),"activated_at":datetime.now(timezone.utc).isoformat(),
        "previous_env_values_preserved":True,"support_configuration_sha256":hashlib.sha256(TARGET.read_bytes()).hexdigest()}))
    print("Support hostname activated; existing credentials and unrelated environment settings preserved.")


def activate(source):
    paths = [DEPLOY/".env", TARGET, Path("/etc/nginx/sites-available/khaneyar.conf"),
             Path("/etc/nginx/snippets/khaneyar-support-redirect.conf")]
    saved = {path: (path.read_bytes(),path.stat().st_mode & 0o777) if path.exists() else None for path in paths}
    had_link = LINK.exists()
    try:
        _activate(source)
    except Exception:
        for path,before in saved.items():
            if before is None: path.unlink(missing_ok=True)
            else:
                path.write_bytes(before[0]); path.chmod(before[1])
        if not had_link and LINK.is_symlink(): LINK.unlink()
        subprocess.run(["nginx","-t"],check=False)
        subprocess.run(["systemctl","reload","nginx"],check=False)
        subprocess.run(["docker","compose","up","-d","--no-deps","--force-recreate","api"],cwd=DEPLOY,check=False)
        raise


if __name__ == "__main__":
    if os.geteuid()!=0: raise SystemExit("Run as the server administrator.")
    parser=argparse.ArgumentParser()
    parser.add_argument("action",choices=["prepare","activate"])
    parser.add_argument("source",nargs="?",type=Path)
    args=parser.parse_args()
    if args.action=="prepare": prepare()
    elif args.source: activate(args.source)
    else: raise SystemExit("Pass the reviewed release source directory.")
