"""Provision one operator without printing passwords or reading user records."""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--sandbox", action="store_true")
    mode.add_argument("--env-file", type=Path)
    parser.add_argument("--username", default="support")
    parser.add_argument("--password-hash-hex", default="")
    parser.add_argument("--rotate", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9_-]{2,31}", args.username):
        raise SystemExit("Use a lowercase operator username of 3 to 32 characters.")
    os.umask(0o077)
    root = Path(__file__).resolve().parents[2]
    if args.sandbox:
        directory = root / ".local-test"
        path = directory / "support-operator.json"
        if path.exists() and not args.rotate:
            print("Existing local operator credentials retained.")
            return
        directory.mkdir(exist_ok=True)
        from argon2 import PasswordHasher
        password = secrets.token_hex(24)
        hashed = PasswordHasher().hash(password)
        path.write_text(json.dumps({"Username":args.username,"PasswordHash":hashed}),encoding="utf-8")
        path.chmod(0o600)
        credentials = directory / "support-panel-login.txt"
        credentials.write_text("Local support panel: http://127.0.0.1:5700/support\nUsername: "
                               +args.username+"\nPassword: "+password+"\n",encoding="utf-8")
        credentials.chmod(0o600)
        print("Local operator prepared; credentials saved in .local-test/support-panel-login.txt.")
        return
    path = args.env_file.resolve(strict=True)
    if path.name != ".env" or not path.is_file():
        raise SystemExit("Pass the existing deployment .env file.")
    try:
        hashed = bytes.fromhex(args.password_hash_hex).decode("ascii")
    except (ValueError, UnicodeDecodeError):
        raise SystemExit("A valid encoded Argon2id hash is required.") from None
    if not re.fullmatch(r"\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+",hashed):
        raise SystemExit("A valid Argon2id hash is required.")
    original = path.read_text(encoding="utf-8")
    keys = {"SUPPORT_USERNAME", "SUPPORT_PASSWORD_HASH"}
    configured = any(line.partition("=")[0].strip() in keys for line in original.splitlines())
    if configured and not args.rotate:
        raise SystemExit("Existing operator settings retained; rotation must be explicit.")
    backup = path.with_name(".env.support-before-"+datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"))
    backup.write_bytes(path.read_bytes()); backup.chmod(0o600)
    retained = [line for line in original.splitlines() if line.partition("=")[0].strip() not in keys]
    content = "\n".join(retained)+"\nSUPPORT_USERNAME="+args.username+"\nSUPPORT_PASSWORD_HASH='"+hashed+"'\n"
    temporary = path.with_name(".env.support-next-"+secrets.token_hex(6))
    temporary.write_text(content,encoding="utf-8",newline="\n"); temporary.chmod(0o600)
    temporary.replace(path)
    print("Operator configured. Existing deployment settings retained and backed up; restart the API to apply.")


if __name__ == "__main__":
    main()
