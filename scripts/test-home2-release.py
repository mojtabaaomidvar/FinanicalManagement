"""Home 2 installer lifecycle checks with Docker/systemd doubles."""
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
spec = importlib.util.spec_from_file_location("home2_upgrade_test", ROOT / "backend/deploy/upgrade-home2.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
common = release.common
spec = importlib.util.spec_from_file_location("home2_package_test", ROOT / "scripts/package-home2-release.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class Home2Tests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="home2-installer-", dir=Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def file(self, name, content=b"checked"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def test_running_source_probe_executes_and_preserves_files(self):
        bundle = self.root / "bundle"
        for name in ("home2-container.py", "management/analytics-container.py"):
            self.file("bundle/" + name, (ROOT / "backend/deploy" / name).read_bytes())
        self.file("api/app/main.py", b"pass\n")
        self.file("api/alembic/env.py", b"pass\n")
        project = self.file("api/pyproject.toml", b"# unchanged\n")
        spec = importlib.util.spec_from_file_location("source_helper", ROOT / "backend/deploy/management/analytics-container.py")
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        contract = {"app_sha256": helper.tree(self.root / "api/app"),
                    "alembic_sha256": helper.tree(self.root / "api/alembic"),
                    "pyproject_sha256": common.digest(project)}
        self.file("bundle/validation.json", json.dumps({"container": contract}).encode())
        installer = release.Installer(bundle)
        before = common.tree(self.root / "api")
        def compose(*args, **kwargs):
            self.assertEqual(args[:3], ("exec", "-T", "api"))
            result = subprocess.run([sys.executable, "-"], input=kwargs["data"], cwd=self.root / "api", capture_output=True, check=True)
            return result.stdout
        with patch.object(installer, "compose", side_effect=compose):
            self.assertEqual(installer.container("source", running=True), "NEW")
        def image_run(args, **kwargs):
            self.assertEqual(args[:5], ["docker", "run", "--rm", "--network", "none"])
            self.assertNotIn("-v", args)
            result = subprocess.run([sys.executable, "-"], input=kwargs["data"], cwd=self.root / "api", capture_output=True, check=True)
            return result.stdout
        with patch.object(installer, "run", side_effect=image_run):
            self.assertEqual(installer.container("image", image=True), "VERIFIED")
        self.assertEqual(common.tree(self.root / "api"), before)

    def test_bootstrap_targets_new_release_and_pins_archive(self):
        value = package.bootstrap("a" * 64).decode()
        self.assertIn("/releases/download/v0.13.0/home2-0.13.0.tgz", value)
        self.assertIn("/opt/khaneyar/releases/home2-0.13.0", value)
        self.assertIn("upgrade-home2.py", value)
        self.assertIn("a" * 64, value)
        self.assertNotIn("management-v0.3.0-r1", value)

    def exercise(self, failure=None):
        base, deploy, state, backup, identity, pwa = [self.root / name for name in ("base", "deploy", "state", "backup", "identity", "pwa")]
        for path in (state, backup, identity):
            path.mkdir()
        self.file("base/source/manager.py", b"unchanged-management-source")
        self.file("base/web/version.json", b'{"version":"0.3.0"}')
        self.file("deploy/.env", b"DATABASE_URL=retained-private\n")
        self.file("deploy/management/runtime.json", b'{"assistant_enabled":true}')
        self.file("config.json", b'{"origin":"https://supp.khaanehyar.ir"}')
        self.file("pwa/version.json", b'{"version":"0.12.0"}')
        self.file("bundle/pwa/version.json", b'{"version":"0.13.0"}')
        baseline_pwa, new_pwa = common.tree(pwa), common.tree(self.root / "bundle/pwa")
        self.file("bundle/validation.json", json.dumps({"pwa_sha256": new_pwa, "baseline_pwa_sha256": baseline_pwa}).encode())
        with contextlib.closing(sqlite3.connect(identity / "management.sqlite3")) as db, db:
            db.executescript("CREATE TABLE accounts(id TEXT,password_hash TEXT,totp_secret TEXT);"
                             "CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE jobs(status TEXT);"
                             "INSERT INTO accounts VALUES ('admin','same-password','same-totp');"
                             "INSERT INTO metadata VALUES ('salt','same-salt');")
        installer = release.Installer(self.root / "bundle")
        machine = {"api": True, "management": True, "revision": "0039", "restores": 0, "builds": 0,
                   "failure": failure, "migration_calls": []}
        commands = []
        original = {"services": {"db": {"image": "postgres:17-alpine"}, "api": {
            "image": "khaneyar-api:management-0.3.0", "build": {"context": "old-source"},
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
                self.assertTrue(args[-1].startswith("khaneyar_analytics_restore_"))
                self.assertEqual(kwargs["stdin"].read(), b"private-backup")
                machine["restores"] += 1
            destination = kwargs.get("stdout")
            if hasattr(destination, "write"):
                destination.write(output)
                output = None
            return SimpleNamespace(returncode=0, stdout=output)
        def preflight():
            installer.backup = backup
            installer.cfg = {"origin": "https://supp.khaanehyar.ir"}
            installer.state_dir = identity
            journal = state / "journal.json"
            if journal.exists():
                installer.journal = json.loads(journal.read_text())
                installer.quiesced = installer.journal.get("activated", False)
            else:
                installer.save(pwa_sha256=new_pwa, config_sha256=common.digest(self.root / "config.json"),
                               management_source_sha256=common.tree(base / "source"), management_web_sha256=common.tree(base / "web"))
            installer.log = (backup / "install.log").open("ab", buffering=0)
        def container(mode, *, running=False, database=None, image=False):
            if mode == "image":
                return "VERIFIED"
            if mode == "source":
                return "NEW"
            if mode == "database":
                return machine["revision"]
            if mode == "migrate":
                machine["migration_calls"].append(database)
                self.assertEqual(machine["restores"], 1)
                if database is None:
                    if machine["failure"] == "before-activation":
                        raise RuntimeError("injected migration failure")
                    machine["revision"] = release.REVISION
                return "MIGRATED"
            raise AssertionError(mode)
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
                with self.assertRaises(RuntimeError):
                    installer.apply()
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
        self.assertEqual(len(machine["migration_calls"]), 2)
        self.assertTrue(machine["api"] and machine["management"])
        self.assertTrue(all("downgrade" not in str(call) for call in commands))
        if failure == "before-activation":
            common.verify_tree(pwa, baseline_pwa)
            self.assertEqual(machine["revision"], "0039")
            self.assertEqual((deploy / ".env").read_bytes(), b"DATABASE_URL=retained-private\n")
        else:
            common.verify_tree(pwa, new_pwa)
            self.assertEqual(machine["revision"], release.REVISION)
            self.assertEqual(installer.journal["phase"], "completed")

    def test_install_and_repeat_preserve_management_identity(self):
        self.exercise()

    def test_failed_migration_restores_previous_pwa_and_services(self):
        self.exercise("before-activation")

    def test_failed_activation_stops_services_and_same_release_resumes(self):
        self.exercise("after-activation")


if __name__ == "__main__":
    unittest.main(verbosity=2)
