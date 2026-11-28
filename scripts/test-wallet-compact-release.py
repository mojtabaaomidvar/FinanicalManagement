"""PWA lifecycle tests with disposable files and explicit Docker/systemd doubles."""
import importlib.util
import io
import json
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("wallet_compact", ROOT / "backend/deploy/upgrade-wallet-compact.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wallet016-", dir=Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        base, deploy = self.root / "management", self.root / "deploy"
        for folder in (base / "source", base / "web", deploy / "management", self.root / "pwa", self.root / "bundle/pwa"):
            folder.mkdir(parents=True, exist_ok=True)
        (base / "source/api.py").write_text("retained management source")
        (base / "web/version.json").write_text('{"version":"0.4.1"}')
        for path in (deploy / ".env", deploy / "docker-compose.release.json", deploy / "management/runtime.json"):
            path.write_text("retained private fixture")
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps({"mode": "production", "origin": "https://supp.khaanehyar.ir",
            "web_root": str(base / "web"), "state_dir": "/var/lib/khaneyar-management"}))
        self.live = self.root / "pwa"
        (self.live / "index.html").write_text("baseline 0.15.1")
        bundle = self.root / "bundle"
        (bundle / "pwa/index.html").write_text("wallet 0.16.0")
        self.manifest = {"tag": "v0.16.0", "software_version": "0.16.0", "management_version": "0.4.1",
            "database_revision": release.history.home2.REVISION, "database_migration_required": False,
            "deployment_scope": "pwa-only", "baseline_tag": "v0.15.1", "baseline_commit": release.BASELINE_COMMIT,
            "files_sha256": release.common.tree(bundle), "baseline_pwa_sha256": release.common.tree(self.live),
            "pwa_sha256": release.common.tree(bundle / "pwa"), "baseline_web_sha256": release.common.tree(base / "web"),
            "management_source_sha256": release.common.tree(base / "source")}
        (bundle / "validation.json").write_text(json.dumps(self.manifest))
        self.installer = release.Installer(bundle)
        self.stack = self.enterContext(__import__('contextlib').ExitStack())
        self.stack.enter_context(patch.multiple(release.common, BASE=base, DEPLOY=deploy, CONFIG=self.config,
            PWA=self.live, STATE=self.root / "state", BACKUPS=self.root / "backups"))
        self.stack.enter_context(patch.object(release, "PREVIOUS_STATE", self.root / "previous"))
        self.stack.enter_context(patch.object(self.installer, "snapshot_identity", return_value="retained identity"))
        self.stack.enter_context(patch.object(self.installer, "verify_runtime"))
        self.service = self.stack.enter_context(patch.object(self.installer, "system"))
        self.stack.enter_context(patch.object(self.installer, "compose", side_effect=AssertionError("No Docker write permitted")))
        self.stack.enter_context(patch.object(self.installer, "probe"))
        self.private_before = release.common.tree(deploy)

    def tearDown(self):
        self.assertEqual(release.common.tree(release.common.DEPLOY), self.private_before)
        self.assertTrue(all(call.args == ("is-active",) for call in self.service.call_args_list))

    def complete(self):
        self.assertEqual((self.live / "index.html").read_text(), "wallet 0.16.0")
        self.assertEqual((self.installer.backup / "pwa/index.html").read_text(), "baseline 0.15.1")
        self.assertEqual(self.installer.journal["phase"], "completed")
        release.common.verify_tree(self.installer.paths("pwa")[2], self.manifest["baseline_pwa_sha256"])

    def test_upgrade_and_repeat_change_only_pwa_and_preserve_backups(self):
        self.installer.apply()
        self.installer.apply()
        self.complete()

    def test_gap_between_rename_operations_resumes_with_original_backup(self):
        self.installer.preflight()
        self.installer.stage()
        self.installer.save(phase="activating")
        self.live.rename(self.installer.paths("pwa")[2])
        self.installer.apply()
        self.complete()

    def test_health_failure_preserves_new_pwa_and_same_release_resumes(self):
        self.installer.probe.side_effect = ValueError("health unavailable")
        with self.assertRaisesRegex(ValueError, "health"):
            self.installer.apply()
        self.assertEqual(self.installer.journal["phase"], "activating")
        self.installer.probe.side_effect = None
        self.installer.apply()
        self.complete()

    def test_partial_staging_is_retained_before_rebuilding(self):
        self.installer.preflight()
        stage = self.installer.paths("pwa")[1]
        stage.mkdir()
        (stage / "operator.txt").write_text("preserve")
        self.installer.apply()
        retained = list(stage.parent.glob(stage.name + ".retained-*"))
        self.assertEqual((retained[0] / "operator.txt").read_text(), "preserve")
        self.complete()

    def test_changed_baseline_is_preserved_and_blocks_activation(self):
        (self.live / "operator.txt").write_text("preserve")
        with self.assertRaises(ValueError):
            self.installer.apply()
        self.assertEqual((self.live / "operator.txt").read_text(), "preserve")
        self.assertEqual((self.live / "index.html").read_text(), "baseline 0.15.1")

    def test_changed_management_web_blocks_resume(self):
        self.installer.apply()
        (release.common.BASE / "web/version.json").write_text("operator edit")
        with self.assertRaises(ValueError):
            self.installer.apply()
        self.assertEqual((release.common.BASE / "web/version.json").read_text(), "operator edit")

    def test_changed_management_source_blocks_install(self):
        (release.common.BASE / "source/api.py").write_text("operator edit")
        with self.assertRaises(ValueError):
            self.installer.apply()

    def test_older_baseline_contract_is_rejected(self):
        self.installer.manifest["baseline_tag"] = "v0.14.0"
        with self.assertRaisesRegex(ValueError, "history 0.15.1 baseline"):
            self.installer.apply()

    def test_unexpected_schema_is_rejected_without_migrations(self):
        self.installer.manifest["database_revision"] = "newer"
        with self.assertRaisesRegex(ValueError, "contract"):
            self.installer.apply()

    def test_unfinished_previous_history_journal_is_preserved(self):
        previous = release.PREVIOUS_STATE
        previous.mkdir()
        journal = previous / "journal.json"
        journal.write_text('{"phase":"activating"}')
        before = journal.read_bytes()
        with self.assertRaisesRegex(ValueError, "Previous history installation"):
            self.installer.apply()
        self.assertEqual(journal.read_bytes(), before)

    def test_modified_incoming_bytes_are_rejected(self):
        (self.installer.bundle / "pwa/index.html").write_text("unexpected")
        with self.assertRaises(ValueError):
            self.installer.apply()

    def test_runtime_probe_is_read_only_and_requires_exact_source_and_schema(self):
        for values in (("BASELINE",), ("NEW", "0039")):
            with patch.object(self.installer, "container", side_effect=values), self.assertRaises(ValueError):
                release.history.Installer.verify_runtime(self.installer)
        with patch.object(self.installer, "container", side_effect=["NEW", release.history.home2.REVISION]) as calls:
            release.history.Installer.verify_runtime(self.installer)
            self.assertTrue(all(call.kwargs == {"running": True} for call in calls.call_args_list))

    def test_bootstrap_uses_atomic_extraction_and_rejects_unknown_or_unsafe_bytes(self):
        spec = importlib.util.spec_from_file_location("wallet_compact_package", ROOT / "scripts/package-wallet-compact-release.py")
        package = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(package)
        bootstrap = package.bootstrap("a" * 64).decode()
        self.assertIn("/v0.16.0/wallet-0.16.0.tgz", bootstrap)
        self.assertIn("upgrade-wallet-compact.py", bootstrap)
        code = bootstrap.split("<<'EXTRACT'\n", 1)[1].split("\nEXTRACT\n", 1)[0]
        target = self.root / "extracted"
        code = code.replace("target=pathlib.Path('/opt/khaneyar-management/releases/wallet-0.16.0')", "target=pathlib.Path(" + repr(str(target)) + ")")
        archive = self.root / "bundle.tgz"
        def write(name, link=False):
            with tarfile.open(archive, "w:gz") as stream:
                item = tarfile.TarInfo(name)
                item.size = 7
                if link:
                    item.type, item.linkname, item.size = tarfile.SYMTYPE, "../outside", 0
                stream.addfile(item, None if link else io.BytesIO(b"checked"))
        def extract():
            before = os.umask(0o077)
            try:
                with patch.object(sys, "argv", ["extract", str(archive)]):
                    exec(compile(code, "local-wallet-bootstrap-test", "exec"), {})
            finally:
                os.umask(before)
        write("pwa/index.html")
        extract()
        extract()
        (target / "pwa/index.html").write_text("operator edit")
        with self.assertRaises(SystemExit):
            extract()
        for name, link in (("../outside", False), ("pwa/link", True)):
            write(name, link)
            with self.assertRaises(SystemExit):
                extract()
        self.assertFalse((self.root / "outside").exists())


if __name__ == "__main__":
    unittest.main()
