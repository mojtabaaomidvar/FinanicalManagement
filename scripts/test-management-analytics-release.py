"""Filesystem, manifest and fail-closed installer checks; no live server is used."""
from __future__ import annotations

import importlib.util
import contextlib
import ast
import io
import json
import os
import sqlite3
import tempfile
import tarfile
import sys
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("analytics_upgrade", ROOT / "backend/deploy/management/upgrade-analytics.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
spec = importlib.util.spec_from_file_location("analytics_container", ROOT / "backend/deploy/management/analytics-container.py")
container = importlib.util.module_from_spec(spec)
spec.loader.exec_module(container)
spec = importlib.util.spec_from_file_location("analytics_package", ROOT / "scripts/package-management-analytics.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="analytics-installer-", dir=Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def file(self, name, content=b"checked"):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def installer(self):
        self.file("bundle/validation.json", b"{}")
        return release.Installer(self.root / "bundle")

    def test_exact_tree_rejects_changed_and_extra_files(self):
        self.file("web/management.html")
        expected = release.tree(self.root / "web")
        release.verify_tree(self.root / "web", expected)
        extra = self.file("web/unreviewed.txt")
        with self.assertRaises(ValueError):
            release.verify_tree(self.root / "web", expected)
        extra.unlink()
        self.file("web/management.html", b"changed")
        with self.assertRaises(ValueError):
            release.verify_tree(self.root / "web", expected)

    def test_manifest_rejects_traversal(self):
        self.file("web/management.html")
        with self.assertRaises(ValueError):
            release.verify_tree(self.root / "web", {"../outside": "a" * 64})

    def test_python_caches_are_ignored_only_when_requested(self):
        self.file("source/app/main.py")
        expected = release.tree(self.root / "source")
        self.file("source/app/__pycache__/main.cpython-312.pyc")
        release.verify_tree(self.root / "source", expected, cache=True)
        with self.assertRaises(ValueError):
            release.verify_tree(self.root / "source", expected)

    def test_compose_invariant_keeps_private_and_unrelated_fields(self):
        before = {"services": {"api": {"image": "old", "build": {"context": "old"},
                  "environment": {"DATABASE_URL": "private", "COMPOSE_FILE": "old"},
                  "volumes": [{"source": "uploads", "target": "/app/var/uploads"}]},
                  "db": {"image": "postgres:17-alpine"}}}
        after = json.loads(json.dumps(before))
        after["services"]["api"].update(image="new", build={"context": "new"})
        after["services"]["api"]["environment"].update(COMPOSE_FILE="new", KHANEYAR_RUNTIME_FILE="runtime")
        after["services"]["api"]["volumes"].append({"target": "/run/khaneyar-management"})
        self.assertEqual(release.compose_invariant(before), release.compose_invariant(after))
        after["services"]["api"]["environment"]["DATABASE_URL"] = "changed"
        self.assertNotEqual(release.compose_invariant(before), release.compose_invariant(after))

    def test_atomic_file_write_replaces_content(self):
        path = self.file("state/journal.json", b"old")
        release.atomic(path, b"new")
        self.assertEqual(path.read_bytes(), b"new")
        self.assertEqual([p.name for p in path.parent.iterdir()], ["journal.json"])

    def test_identity_check_preserves_password_totp_and_salt(self):
        path = self.root / "management.sqlite3"
        with contextlib.closing(sqlite3.connect(path)) as db, db:
            db.executescript("CREATE TABLE accounts(id TEXT,password_hash TEXT,totp_secret TEXT);"
                             "CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE jobs(status TEXT);"
                             "INSERT INTO accounts VALUES ('existing','password-hash','totp-secret');"
                             "INSERT INTO metadata VALUES ('ip_salt','existing-salt');")
        installer = self.installer()
        before = installer.snapshot_identity(self.root)
        self.assertEqual(installer.snapshot_identity(self.root), before)
        with contextlib.closing(sqlite3.connect(path)) as db, db:
            db.execute("UPDATE accounts SET totp_secret='changed'")
        self.assertNotEqual(installer.snapshot_identity(self.root), before)

    def test_pending_management_operation_blocks_upgrade(self):
        path = self.root / "management.sqlite3"
        with contextlib.closing(sqlite3.connect(path)) as db, db:
            db.executescript("CREATE TABLE jobs(status TEXT);INSERT INTO jobs VALUES ('running');")
        with self.assertRaisesRegex(ValueError, "pending"):
            self.installer().snapshot_identity(self.root)

    def test_source_contract_rejects_extra_or_changed_api(self):
        self.file("api/app/main.py")
        self.file("api/alembic/env.py")
        project = self.file("api/pyproject.toml")
        app = container.tree(self.root / "api/app")
        alembic = container.tree(self.root / "api/alembic")
        contract = {"pyproject_sha256": release.digest(project), "app_sha256": {"new.py": "a" * 64},
                    "alembic_sha256": {}, "baseline_alembic_sha256": alembic,
                    "baseline_app_variants": [app]}
        self.assertEqual(container.source_state(contract, self.root / "api"), "BASELINE")
        self.file("api/app/extra.py")
        with self.assertRaises(ValueError):
            container.source_state(contract, self.root / "api")

    def test_bootstrap_extracts_verified_files_and_rejects_traversal_or_drift(self):
        source = package.bootstrap("a" * 64).decode().split("<<'EXTRACT'\n", 1)[1].split("\nEXTRACT\n", 1)[0]
        target = self.root / "extracted"
        source = source.replace("target=pathlib.Path('/opt/khaneyar-management/releases/analytics-0.3.0')",
                                "target=pathlib.Path(" + repr(str(target)) + ")")
        code = compile(source, "generated-safe-extraction", "exec")
        archive = self.root / "bundle.tgz"
        def write_archive(name, content):
            with tarfile.open(archive, "w:gz") as output:
                member = tarfile.TarInfo(name)
                member.size = len(content)
                output.addfile(member, io.BytesIO(content))
        def extract():
            previous = os.umask(0o077)
            try:
                with patch.object(sys, "argv", ["extract", str(archive)]):
                    exec(code, {})
            finally:
                os.umask(previous)
        write_archive("api/app/main.py", b"checked")
        extract()
        extract()
        self.assertEqual((target / "api/app/main.py").read_bytes(), b"checked")
        (target / "api/app/main.py").write_bytes(b"tampered")
        with self.assertRaises(SystemExit):
            extract()
        write_archive("../outside", b"unexpected")
        with self.assertRaises(SystemExit):
            extract()
        self.assertFalse((self.root / "outside").exists())

    def test_source_line_endings_are_portable_but_dependency_changes_are_not(self):
        self.file("api/app/main.py", b"first\r\nsecond\r\n")
        self.file("api/alembic/env.py", b"env\r\n")
        self.file("api/pyproject.toml", b"project\r\n")
        contract = {"pyproject_sha256": package.sha(b"project\n"),
                    "app_sha256": container.tree(self.root / "api/app"),
                    "alembic_sha256": container.tree(self.root / "api/alembic")}
        self.file("api/app/main.py", b"first\nsecond\n")
        self.assertEqual(container.source_state(contract, self.root / "api"), "NEW")
        self.file("api/pyproject.toml", b"different-project\n")
        with self.assertRaisesRegex(ValueError, "dependencies"):
            container.source_state(contract, self.root / "api")

    def test_failed_activation_stops_services_without_restoring_database(self):
        installer = self.installer()
        installer.journal = {"activated": True, "env_after_sha256": "different"}
        installer.quiesced = True
        self.file("deploy/.env")
        calls = []
        with patch.object(release, "DEPLOY", self.root / "deploy"), \
             patch.object(installer, "preflight"), \
             patch.object(installer, "compose", side_effect=lambda *a, **k: calls.append(a)), \
             patch.object(installer, "system", side_effect=lambda *a, **k: calls.append(a)):
            with self.assertRaises(ValueError):
                installer.apply()
        self.assertEqual(calls, [("stop", "api"), ("stop",)])

    def test_rollback_keeps_new_database_and_restores_only_files(self):
        installer = self.installer()
        installer.backup = self.root / "backup"
        installer.journal = {"had_override": True}
        self.file("backup/env-before", b"private-original")
        self.file("backup/compose-before.json", b"original-override")
        self.file("deploy/.env", b"changed")
        for kind in ("source", "web"):
            self.file("base/" + kind + "/code", b"new")
            self.file("base/.analytics-0.3.0-" + kind + "-before/code", b"old")
        calls = []
        with patch.object(release, "BASE", self.root / "base"), \
             patch.object(release, "DEPLOY", self.root / "deploy"), \
             patch.object(installer, "compose", side_effect=lambda *a, **k: calls.append(a)), \
             patch.object(installer, "system", side_effect=lambda *a, **k: calls.append(a)):
            installer.restore_before_activation()
        self.assertEqual((self.root / "deploy/.env").read_bytes(), b"private-original")
        self.assertEqual((self.root / "base/source/code").read_bytes(), b"old")
        self.assertTrue(all("restore" not in str(call) and "downgrade" not in str(call) for call in calls))

    def exercise_install(self, failure=None):
        base, deploy, state = [self.root / name for name in ("base", "deploy", "state")]
        backup, identity, pwa = [self.root / name for name in ("backup", "identity", "pwa")]
        for path in (backup, identity, state):
            path.mkdir()
        self.file("base/source/backend/old.py", b"retained-old-code")
        self.file("base/web/assets/old.js", b"retained-old-asset")
        self.file("base/web/version.json", b'{"version":"0.2.0"}')
        self.file("deploy/.env", b"DATABASE_URL=private-original\n")
        self.file("config.json", b'{"origin":"https://supp.khaanehyar.ir"}')
        self.file("pwa/version.json", b'{"version":"0.12.0"}')
        self.file("bundle/source/backend/new.py", b"checked-new-code")
        self.file("bundle/web/assets/new.js", b"checked-new-asset")
        self.file("bundle/web/version.json", b'{"version":"0.3.0"}')
        self.file("bundle/analytics-container.py", (ROOT / "backend/deploy/management/analytics-container.py").read_bytes())
        self.file("bundle/validation.json", json.dumps({"container": {},
            "management_source_sha256": release.tree(self.root / "bundle/source"),
            "web_sha256": release.tree(self.root / "bundle/web")}).encode())
        with contextlib.closing(sqlite3.connect(identity / "management.sqlite3")) as db, db:
            db.executescript("CREATE TABLE accounts(id TEXT,password_hash TEXT,totp_secret TEXT);"
                             "CREATE TABLE metadata(key TEXT,value TEXT);CREATE TABLE jobs(status TEXT);"
                             "INSERT INTO accounts VALUES ('admin','old-password-hash','old-totp');"
                             "INSERT INTO metadata VALUES ('ip_salt','old-salt');")
        machine = {"api": True, "management": True, "revision": release.OLD_REVISION,
                   "restore_created": 0, "restored": 0, "http_failure": failure == "after-activation"}
        commands = []
        original_config = {"services": {"db": {"image": "postgres:17-alpine"}, "api": {
            "image": "khaneyar-api:v0.11.0", "build": {"context": "previous-source"},
            "environment": {"DATABASE_URL": "private-original"},
            "volumes": [{"type": "bind", "source": str(deploy / "uploads"), "target": "/app/var/uploads", "read_only": False}]}}}

        def compose_config():
            result = json.loads(json.dumps(original_config))
            api = result["services"]["api"]
            env = dict(line.split("=", 1) for line in (deploy / ".env").read_text().splitlines() if "=" in line)
            api["environment"].update(env)
            override = deploy / "docker-compose.release.json"
            if override.exists():
                change = json.loads(override.read_text())["services"]["api"]
                api.update({key: value for key, value in change.items() if key not in {"volumes", "environment"}})
                api["environment"].update(change.get("environment", {}))
                api["volumes"].extend(change.get("volumes", []))
            return result

        def command(args, **kwargs):
            commands.append(args)
            output = b""
            if args[:3] == ["docker", "compose", "config"]:
                output = json.dumps(compose_config()).encode()
            elif args[:3] == ["docker", "compose", "ps"]:
                output = b"existing-container\n"
            elif args[:2] == ["docker", "inspect"]:
                output = b"sha256:previous-exact-image\n"
            elif args[:3] == ["docker", "compose", "stop"]:
                machine["api"] = False
            elif args[:3] == ["docker", "compose", "up"]:
                machine["api"] = True
            elif args[0] == "systemctl":
                machine["management"] = args[1] != "stop"
            elif args[0] == "/usr/local/sbin/khaneyar-management-worker":
                output = b'{"ok":true,"data":{"available":true}}'
            elif any("pg_dump" in str(item) for item in args):
                output = b"private-database-snapshot"
            elif any("pg_restore" in str(item) for item in args):
                self.assertEqual(kwargs["stdin"].read(), b"private-database-snapshot")
                machine["restored"] += 1
            elif any("createdb" in str(item) for item in args):
                machine["restore_created"] += 1
            elif (kwargs.get("input") or b"").startswith(b'"""Checked, additive'):
                code = ast.parse(kwargs["input"])
                call = next(node for node in ast.walk(code) if isinstance(node, ast.Call)
                            and isinstance(node.func, ast.Name) and node.func.id == "main")
                mode, database = ast.literal_eval(call.args[0]), ast.literal_eval(call.args[2])
                if mode == "image":
                    output = b"VERIFIED"
                elif mode == "source":
                    output = b"NEW"
                elif mode == "database":
                    output = machine["revision"].encode()
                elif mode == "migrate":
                    if database is None:
                        if failure == "before-activation":
                            raise RuntimeError("injected migration error")
                        machine["revision"] = "0039"
                    else:
                        self.assertEqual(machine["restored"], 1)
                    output = b"MIGRATED"
            destination = kwargs.get("stdout")
            if hasattr(destination, "write"):
                destination.write(output)
                output = None
            return SimpleNamespace(returncode=0, stdout=output)

        def request(url, **kwargs):
            url = url.full_url if hasattr(url, "full_url") else url
            if url.endswith("healthz"):
                if machine["http_failure"]:
                    raise OSError("injected health error")
                return io.BytesIO(b'{"status":"ok","feature_controls":"v1","ai_controls":"v1"}')
            if "/state/" in url:
                raise HTTPError(url, 401, "unauthenticated", {}, None)
            if url.endswith("version.json"):
                return io.BytesIO((base / "web/version.json").read_bytes())
            return io.BytesIO(b'{"mode":"production","authenticated":false}')

        installer = release.Installer(self.root / "bundle")
        installer.backup, installer.state_dir = backup, identity
        installer.cfg = {"origin": "https://supp.khaanehyar.ir"}
        installer.journal = {"pwa_sha256": release.tree(pwa), "config_sha256": release.digest(self.root / "config.json")}
        with patch.multiple(release, BASE=base, DEPLOY=deploy, STATE=state, PWA=pwa, CONFIG=self.root / "config.json"), \
             patch.object(installer, "preflight"), patch.object(release.subprocess, "run", side_effect=command), \
             patch.object(release, "urlopen", side_effect=request), patch.object(release.time, "sleep"):
            if failure:
                with self.assertRaises((ValueError, RuntimeError)):
                    installer.apply()
                if failure == "after-activation":
                    self.assertFalse(machine["api"])
                    self.assertFalse(machine["management"])
                    self.assertEqual(machine["revision"], "0039")
                    machine["http_failure"] = False
                    installer.apply()
            else:
                installer.apply()
                installer.apply()
        self.assertEqual(machine["restore_created"], 1)
        self.assertEqual(machine["restored"], 1)
        self.assertTrue(machine["api"])
        self.assertTrue(machine["management"])
        self.assertEqual((base / "web/assets/old.js").read_bytes(), b"retained-old-asset")
        self.assertEqual(json.loads((pwa / "version.json").read_text())["version"], "0.12.0")
        self.assertEqual((backup / "database-before.dump").read_bytes(), b"private-database-snapshot")
        self.assertFalse(any("downgrade" in str(args) for args in commands))
        if failure == "before-activation":
            self.assertEqual((base / "source/backend/old.py").read_bytes(), b"retained-old-code")
            self.assertEqual((deploy / ".env").read_bytes(), b"DATABASE_URL=private-original\n")
        else:
            self.assertEqual((base / "source/backend/new.py").read_bytes(), b"checked-new-code")
            self.assertEqual(installer.journal["phase"], "completed")

    def test_full_install_retains_pwa_identity_assets_and_repeat(self):
        self.exercise_install()

    def test_full_install_migration_failure_restores_previous_services(self):
        self.exercise_install("before-activation")

    def test_full_install_activation_failure_is_resumable_and_keeps_history(self):
        self.exercise_install("after-activation")


if __name__ == "__main__":
    unittest.main()
