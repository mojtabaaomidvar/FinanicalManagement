"""Bootstrap, serve or schedule the independent management service."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import secrets
from pathlib import Path

from app.management.contracts import Config
from app.management.host import Host, atomic_write, host_lock
from app.management.identity import create_account
from app.management.store import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("--username", default="admin")
    init.add_argument("--credentials-file", type=Path)
    commands.add_parser("serve")
    commands.add_parser("backup")
    args = parser.parse_args()
    config = Config.model_validate_json(args.config.read_bytes())
    if args.command == "serve":
        import uvicorn

        from app.management.main import create_app

        uvicorn.run(create_app(config), host=config.host, port=config.port, access_log=False)
    elif args.command == "backup":
        if config.mode != "production" or not hasattr(os, "geteuid") or os.geteuid() != 0:
            raise SystemExit("Scheduled backups require the production root service.")
        with host_lock(config):
            print(json.dumps(Host(config).backup()))
    else:
        store = Store(config.state_dir)
        with store.connect() as db:
            if db.execute("SELECT 1 FROM accounts").fetchone():
                if (
                    config.mode == "demo"
                    and args.credentials_file
                    and args.credentials_file.is_file()
                ):
                    lines = args.credentials_file.read_text(encoding="utf-8").splitlines()
                    lines = [
                        "URL: " + config.origin if line.startswith("URL: ") else line
                        for line in lines
                    ]
                    atomic_write(args.credentials_file, ("\n".join(lines) + "\n").encode())
                print("Management is already initialized; existing accounts were retained.")
                return
        if config.mode == "production":
            password = getpass.getpass("New management password (12+ characters): ")
            if getpass.getpass("Repeat password: ") != password:
                raise SystemExit("Passwords differ.")
        else:
            password = secrets.token_urlsafe(20)
        result = create_account(
            store, args.username, password, "owner", production=config.mode == "production"
        )
        if args.credentials_file and config.mode == "demo":
            atomic_write(
                args.credentials_file,
                (
                    "URL: "
                    + config.origin
                    + "\nUsername: "
                    + args.username
                    + "\nPassword: "
                    + password
                    + "\nDemo: isolated sample data only\n"
                ).encode(),
            )
            print("Local demo credentials saved: " + str(args.credentials_file))
        if result["totp_secret"]:
            print("Register this TOTP secret in your authenticator before signing in:")
            print(result["totp_secret"])
        print("Management owner initialized.")


if __name__ == "__main__":
    main()
