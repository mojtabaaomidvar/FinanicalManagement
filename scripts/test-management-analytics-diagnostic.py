"""Verify the adjunct diagnostic reads only and never exposes source/config values."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("analytics_diagnostic", ROOT / "backend/deploy/management/diagnose-analytics.py")
diagnostic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostic)


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="analytics-diagnostic-", dir=Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        with tarfile.open(ROOT / ".local-test/management-analytics-release/management-0.3.0.tgz", "r:gz") as archive:
            archive.extractall(self.bundle, filter="data")

    def file(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)

    def snapshot(self):
        return {p.relative_to(self.root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.root.rglob("*") if p.is_file()}

    def test_corrupt_manifest_stops_before_any_external_command(self):
        (self.bundle / "validation.json").write_bytes(b"{}")
        before = self.snapshot()
        result = diagnostic.diagnose(self.bundle, runner=lambda *a, **k: self.fail("external command called"))
        self.assertEqual(result[0]["check"], "MANIFEST")
        self.assertFalse(result[0]["ok"])
        self.assertEqual(self.snapshot(), before)

    def test_extra_bundle_file_is_reported_without_changes(self):
        (self.bundle / "unreviewed.py").write_bytes(b"private-source-never-print")
        before = self.snapshot()
        result = diagnostic.diagnose(self.bundle, runner=lambda *a, **k: self.fail("external command called"))
        self.assertFalse(result[0]["ok"])
        self.assertIn("unreviewed.py", result[0]["detail"])
        self.assertNotIn("private-source-never-print", json.dumps(result))
        self.assertEqual(self.snapshot(), before)

    def test_all_baseline_checks_and_drift_reporting_are_read_only(self):
        locations = {name: self.root / name for name in diagnostic.LOCATIONS}
        for path in locations.values():
            if path != locations["config"]:
                path.mkdir(parents=True)
        config = {"mode": "production", "origin": "https://supp.khaanehyar.ir",
                  "web_root": str(locations["base"] / "web"), "state_dir": str(locations["identity"]),
                  "backup_dir": str(locations["backups"]), "unrelated_private": "private-value-never-print"}
        self.file(locations["config"], json.dumps(config).encode())
        self.file(locations["pwa"] / "version.json", b'{"version":"0.12.0"}')
        self.file(locations["base"] / "web/version.json", b'{"version":"0.2.0"}')
        self.file(locations["deploy"] / "management/runtime.json", b'{}')
        manifest = json.loads((self.bundle / "validation.json").read_bytes())
        for name in manifest["management_baseline_sha256"]:
            content = subprocess.run(["git", "show", "312f661:" + name], cwd=ROOT, capture_output=True, check=True).stdout
            self.file(locations["base"] / "source" / name, content)
        with contextlib.closing(sqlite3.connect(locations["identity"] / "management.sqlite3")) as db, db:
            db.executescript("CREATE TABLE jobs(status TEXT); CREATE TABLE accounts(id TEXT); CREATE TABLE metadata(key TEXT);")
        calls = []
        def run(arguments, **kwargs):
            calls.append(arguments)
            if arguments[0] == "systemctl":
                return SimpleNamespace(returncode=0, stdout=b"active\n")
            self.assertEqual(arguments[:4], ["docker", "compose", "exec", "-T"])
            self.assertIn(b"SET TRANSACTION READ ONLY", kwargs["input"])
            self.assertNotIn(b"main(", kwargs["input"].split(b"contract=json.loads(", 1)[1])
            return SimpleNamespace(returncode=0, stdout=json.dumps({"source": "BASELINE", "revision": "0037_wallet_corrections", "restricted_role": True}).encode())
        before = self.snapshot()
        result = diagnostic.diagnose(self.bundle, locations, run)
        self.assertTrue(all(row["ok"] for row in result), result)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(len(calls), 2)
        name = next(iter(manifest["management_baseline_sha256"]))
        (locations["base"] / "source" / name).write_bytes(b"private-source-never-print")
        before = self.snapshot()
        result = diagnostic.diagnose(self.bundle, locations, run)
        failure = next(row for row in result if row["check"] == "MANAGEMENT_SOURCE")
        self.assertFalse(failure["ok"])
        self.assertIn(name, failure["detail"])
        self.assertNotIn("private-source-never-print", json.dumps(result))
        self.assertNotIn("private-value-never-print", json.dumps(result))
        self.assertEqual(self.snapshot(), before)


if __name__ == "__main__":
    unittest.main()
