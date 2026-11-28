"""Wallet installer lifecycle checks with local Docker/systemd doubles."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("wallet_upgrade_test", ROOT / "backend/deploy/upgrade-wallet.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
common = release.common
spec = importlib.util.spec_from_file_location("wallet_package_test", ROOT / "scripts/package-wallet-access-release.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class WalletTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="wallet-installer-", dir=Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def file(self, name, content=b"checked"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def test_bootstrap_pins_new_archive_and_separate_release_path(self):
        value = package.bootstrap("a" * 64).decode()
        self.assertIn("/releases/download/v0.14.0/wallet-0.14.0.tgz", value)
        self.assertIn("/opt/khaneyar/releases/wallet-0.14.0", value)
        self.assertIn("upgrade-wallet.py", value)
        self.assertIn("a" * 64, value)
        self.assertNotIn("home2-0.13.0", value)

    def test_rejects_migration_contract_before_production_checks(self):
        self.file("bundle/validation.json", b'{"database_migration_required":true}')
        installer = release.Installer(self.root / "bundle")
        with self.assertRaisesRegex(ValueError, "must not migrate"), patch.object(installer, "run", side_effect=AssertionError):
            installer.preflight()

    def exercise(self, failure=None):
        base, deploy, state, backup, identity, pwa = [self.root / name for name in ("base", "deploy", "state", "backup", "identity", "pwa")]
        for path in (state, backup, identity):
            path.mkdir()
        self.file("base/source/manager.py", b"unchanged-management-source")
        self.file("base/web/version.json", b'{"version":"0.3.0"}')
        self.file("deploy/.env", b"DATABASE_URL=retained-private\n")
        self.file("deploy/management/runtime.json", b'{"assistant_enabled":true}')
        self.file("config.json", b'{"origin":"https://supp.khaanehyar.ir"}')
        self.file("pwa/version.json", b'{"version":"0.13.0"}')
        self.file("bundle/pwa/version.json", b'{"version":"0.14.0"}')
        baseline_pwa, new_pwa = common.tree(pwa), common.tree(self.root / "bundle/pwa")
        self.file("bundle/validation.json", json.dumps({"pwa_sha256": new_pwa, "baseline_pwa_sha256": baseline_pwa}).encode())
        with contextlib.closing(sqlite3.connect(identity / "management.sqlite3")) as db, db:
            db.executescript("CREATE TABLE accounts(id TEXT,password_hash TEXT,totp_secret TEXT);"
                             "CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE jobs(status TEXT);"
                             "INSERT INTO accounts VALUES ('admin','same-password','same-totp');"
                             "INSERT INTO metadata VALUES ('salt','same-salt');")
        installer = release.Installer(self.root / "bundle")
        machine = {"api": True, "management": True, "revision": release.home.REVISION,
                   "restores": 0, "builds": 0, "failure": failure}
        commands = []
        original = {"services": {"db": {"image": "postgres:17-alpine"}, "api": {
            "image": "khaneyar-api:v0.13.0", "build": {"context": "old-source"},
            "environment": {"DATABASE_URL": "retained-private"},
            "volumes": [{"type": "bind", "source": str(deploy / "uploads"), "target": "/app/var/uploads"}]}}}

        def config():
            value = json.loads(json.dumps(original))
            api = value["services"]["api"]
            api["environment"].update(dict(line.split("=", 1) for line in (deploy / ".env").read_text().splitlines() if "=" in line))
            override = deploy / "docker-compose.release.json"
            if override.exists():
                change = json.loads(override.read_text())["services"]["api"]
                api.update({key: item for key, item in change.items() if key not in {"environment", "volumes"}})
                api["environment"].update(change.get("environment", {}))
                api["volumes"].extend(change.get("volumes", []))
            return value

        def command(args, **kwargs):
            commands.append(args)
            output = b""
            if args[:3] == ["docker", "compose", "config"]:
                output = json.dumps(config()).encode()
            elif args[:3] == ["docker", "compose", "ps"]:
                output = b"existing-container"
            elif args[:2] == ["docker", "inspect"]:
                output = b"sha256:retained-image"
            elif args[:2] == ["docker", "build"]:
                machine["builds"] += 1
                self.assertIn("--network=none", args)
            elif args[:3] == ["docker", "compose", "stop"]:
                machine["api"] = False
            elif args[:3] == ["docker", "compose", "up"]:
                machine["api"] = True
            elif args[0] == "systemctl":
                machine["management"] = args[1] != "stop"
            elif any("pg_dump" in str(arg) for arg in args):
                output = b"private-backup"
            elif any("pg_restore" in str(arg) for arg in args):
                self.assertEqual(kwargs["stdin"].read(), b"private-backup")
                machine["restores"] += 1
                if machine["failure"] == "before-activation":
                    raise RuntimeError("injected restore rehearsal failure")
            destination = kwargs.get("stdout")
            if hasattr(destination, "write"):
                destination.write(output)
                output = None
            return SimpleNamespace(returncode=0, stdout=output)

        def preflight():
            installer.backup, installer.state_dir = backup, identity
            installer.cfg = {"origin": "https://supp.khaanehyar.ir"}
            journal = state / "journal.json"
            if journal.exists():
                installer.journal = json.loads(journal.read_text())
                installer.quiesced = installer.journal.get("activated", False)
            else:
                installer.save(pwa_sha256=new_pwa, config_sha256=common.digest(self.root / "config.json"),
                               management_source_sha256=common.tree(base / "source"), management_web_sha256=common.tree(base / "web"))
            installer.log = (backup / "install.log").open("ab", buffering=0)

        def container(mode, **kwargs):
            if mode == "image": return "VERIFIED"
            if mode == "source": return "NEW"
            if mode == "database": return machine["revision"]
            raise AssertionError("No migration or other mode is permitted: " + mode)

        def probe():
            installer.unchanged_management()
            common.verify_tree(pwa, new_pwa)
            self.assertEqual(installer.snapshot_identity(identity), installer.journal["identity_sha256"])
            if machine["failure"] == "after-activation":
                raise RuntimeError("injected HTTP failure")

        with patch.multiple(common, BASE=base, DEPLOY=deploy, STATE=state, BACKUPS=backup.parent,
                            PWA=pwa, CONFIG=self.root / "config.json"), \
             patch.object(common.subprocess, "run", side_effect=command), \
             patch.object(installer, "preflight", side_effect=preflight), \
             patch.object(installer, "container", side_effect=container), \
             patch.object(installer, "probe", side_effect=probe), contextlib.redirect_stdout(io.StringIO()):
            if failure:
                with self.assertRaises(RuntimeError): installer.apply()
            else:
                installer.apply()
                installer.apply()
            if failure == "after-activation":
                self.assertFalse(machine["api"])
                self.assertFalse(machine["management"])
                machine["failure"] = None
                installer.apply()
        self.assertEqual((base / "source/manager.py").read_bytes(), b"unchanged-management-source")
        self.assertIn(b"DATABASE_URL=retained-private", (deploy / ".env").read_bytes())
        self.assertEqual(machine["restores"], 1)
        self.assertEqual(machine["builds"], 1)
        self.assertEqual(machine["revision"], release.home.REVISION)
        self.assertTrue(machine["api"] and machine["management"])
        self.assertTrue(all("downgrade" not in str(call) and "alembic" not in str(call) for call in commands))
        common.verify_tree(pwa, baseline_pwa if failure == "before-activation" else new_pwa)
        self.assertEqual(installer.journal["phase"], "failed-before-activation" if failure == "before-activation" else "completed")

    def test_install_and_repeat_keep_schema_and_management_identity(self): self.exercise()
    def test_failed_restore_rehearsal_restores_old_services(self): self.exercise("before-activation")
    def test_failed_activation_stops_services_and_same_release_resumes(self): self.exercise("after-activation")


if __name__ == "__main__":
    unittest.main(verbosity=2)
