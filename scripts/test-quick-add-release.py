"""PWA lifecycle/contract tests with explicit local Docker, systemd and HTTPS doubles."""
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("quick_release", ROOT / "backend/deploy/upgrade-quick-add.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="quick-add-installer-", dir=Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle, self.live = self.root / "bundle", self.root / "pwa"
        self.bundle.mkdir(); self.live.mkdir(); (self.bundle / "pwa").mkdir()
        (self.bundle / "validation.json").write_text("{}")
        (self.live / "index.html").write_text("old PWA")
        (self.bundle / "pwa/index.html").write_text("new PWA")
        self.installer = release.Installer(self.bundle)
        self.installer.backup = self.root / "backup"; self.installer.backup.mkdir()
        self.installer.journal.update(phase="preparing", old_pwa=release.common.tree(self.live),
            new_pwa=release.common.tree(self.bundle / "pwa"), protected={"identity": "same"})
        for name, value in {"STATE": self.root / "state", "BACKUPS": self.root / "backups", "PWA": self.live}.items():
            item = patch.object(release.common, name, value); item.start(); self.addCleanup(item.stop)

    def apply(self, probe=None):
        with patch.object(self.installer, "preflight"), patch.object(self.installer, "protected", return_value={"identity": "same"}), \
             patch.object(self.installer, "probe", side_effect=probe), \
             patch.object(self.installer, "compose", side_effect=AssertionError("Docker write forbidden")), \
             patch.object(self.installer, "system", side_effect=AssertionError("Service write forbidden")):
            self.installer.apply()

    def test_only_pwa_is_replaced_and_repeat_keeps_the_backup(self):
        self.apply(); self.apply()
        self.assertEqual((self.live / "index.html").read_text(), "new PWA")
        self.assertEqual((self.installer.backup / "pwa/index.html").read_text(), "old PWA")
        self.assertEqual(list(self.installer.locations()), ["pwa"])
        self.assertEqual(self.installer.journal["phase"], "completed")

    def test_interruption_between_renames_resumes_same_package(self):
        self.installer.stage(); self.installer.journal["phase"] = "activating"
        self.live.rename(self.installer.paths("pwa")[2]); self.apply()
        self.assertEqual((self.live / "index.html").read_text(), "new PWA")

    def test_public_probe_failure_keeps_history_and_resumes_without_service_changes(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            self.apply(ValueError("HTTPS unavailable"))
        self.assertEqual(self.installer.journal["phase"], "activating")
        self.apply(); self.assertEqual(self.installer.journal["phase"], "completed")

    def test_unknown_baseline_files_are_preserved(self):
        (self.live / "operator.txt").write_text("preserve")
        with self.assertRaises(ValueError): self.apply()
        self.assertEqual((self.live / "operator.txt").read_text(), "preserve")
        self.assertEqual((self.live / "index.html").read_text(), "old PWA")

    def test_operator_changes_after_activation_stop_repeat(self):
        self.apply(); (self.live / "index.html").write_text("operator edit")
        with self.assertRaises(ValueError): self.apply()
        self.assertEqual((self.live / "index.html").read_text(), "operator edit")

    def test_partial_stage_is_retained_before_retry(self):
        stage = self.installer.paths("pwa")[1]; stage.mkdir(); (stage / "unknown").write_text("preserve")
        self.apply()
        retained = list(self.root.glob("pwa.quick-add-next.retained-*"))
        self.assertEqual(len(retained), 1); self.assertEqual((retained[0] / "unknown").read_text(), "preserve")

    def preflight(self, change=None):
        base, deploy = self.root / "management", self.root / "deploy"
        (base / "source").mkdir(parents=True); (base / "web/assets").mkdir(parents=True)
        (base / "source/code.py").write_text("unchanged management")
        (base / "web/index.html").write_text("management 0.4.1")
        (base / "web/assets/old.js").write_text("retained tab")
        deploy.mkdir(); config = self.root / "config.json"
        config.write_text(json.dumps({"mode": "production", "origin": "https://supp.khaanehyar.ir",
            "web_root": str(base / "web"), "state_dir": "/var/lib/khaneyar-management"}))
        old_web = release.common.tree(base / "web")
        retained = {"assets/old.js": old_web.pop("assets/old.js")}
        self.installer.manifest.update(tag="v0.17.0", software_version="0.17.0", management_version="0.4.1",
            baseline_tag="v0.16.0", baseline_commit=release.BASELINE_COMMIT, deployment_scope="pwa-only",
            database_revision=release.history.home2.REVISION, database_migration_required=False,
            files_sha256={name: value for name, value in release.common.tree(self.bundle).items() if name != "validation.json"},
            management_source_sha256=release.common.tree(base / "source"), baseline_web_sha256=old_web,
            retained_web_sha256=retained, baseline_pwa_sha256=release.common.tree(self.live),
            pwa_sha256=self.installer.journal["new_pwa"])
        if change: change(base)
        with patch.multiple(release.common, BASE=base, DEPLOY=deploy, CONFIG=config), \
             patch.object(release, "PREVIOUS_STATES", (self.root / "wallet-state", self.root / "history-state")), \
             patch.object(self.installer, "verify_runtime"), patch.object(self.installer, "protected", return_value={"identity": "same"}), \
             patch.object(self.installer, "system") as service:
            self.installer.preflight()
            self.assertTrue(all(call.args == ("is-active",) for call in service.call_args_list))

    def test_preflight_accepts_exact_wallet_and_retained_management_assets(self):
        self.preflight(); self.assertEqual(self.installer.journal["phase"], "preparing")

    def test_preflight_rejects_the_wrong_pwa_baseline(self):
        with self.assertRaises(ValueError):
            self.preflight(lambda _: self.installer.manifest.update(baseline_tag="v0.14.0"))

    def test_preflight_rejects_a_different_schema(self):
        with self.assertRaises(ValueError):
            self.preflight(lambda _: self.installer.manifest.update(database_revision="newer"))

    def test_preflight_rejects_an_api_replacement_scope(self):
        with self.assertRaises(ValueError):
            self.preflight(lambda _: self.installer.manifest.update(deployment_scope="api"))

    def test_preflight_rejects_changed_management_bytes(self):
        with self.assertRaises(ValueError):
            self.preflight(lambda base: (base / "web/index.html").write_text("operator edit"))

    def test_preflight_rejects_incomplete_prior_wallet_installation(self):
        previous = self.root / "wallet-state"
        previous.mkdir()
        (previous / "journal.json").write_text(json.dumps({"phase": "activating"}))
        with self.assertRaisesRegex(ValueError, "Previous installation is incomplete"):
            self.preflight()
        self.assertEqual((self.live / "index.html").read_text(), "old PWA")

    def test_preflight_accepts_completed_prior_wallet_installation(self):
        previous = self.root / "wallet-state"
        previous.mkdir()
        (previous / "journal.json").write_text(json.dumps({"phase": "completed"}))
        self.preflight()
        self.assertEqual(self.installer.journal["phase"], "preparing")

    def test_preflight_rejects_a_newer_pwa_without_changing_it(self):
        def change(_):
            (self.live / "index.html").write_text("newer independently released PWA")
        with self.assertRaises(ValueError):
            self.preflight(change)
        self.assertEqual((self.live / "index.html").read_text(), "newer independently released PWA")

    def test_runtime_is_read_only_and_refuses_migration(self):
        with patch.object(self.installer, "container", side_effect=["NEW", release.history.home2.REVISION]) as call:
            self.installer.verify_runtime()
            self.assertTrue(all(item.kwargs == {"running": True} for item in call.call_args_list))
        with self.assertRaisesRegex(ValueError, "read-only"):
            self.installer.container("migrate", running=True)

    def test_bootstrap_pins_version_and_runs_only_the_new_installer(self):
        spec = importlib.util.spec_from_file_location("quick_package", ROOT / "scripts/package-quick-add-release.py")
        package = importlib.util.module_from_spec(spec); spec.loader.exec_module(package)
        text = package.bootstrap("a" * 64).decode()
        self.assertIn("/v0.17.0/quick-add-0.17.0.tgz", text)
        self.assertIn('"$release/upgrade-quick-add.py"', text)
        self.assertNotIn('/releases/download/v0.16.0/', text)
        self.assertIn("a" * 64, text)
        code = text.split("<<'EXTRACT'\n", 1)[1].split("\nEXTRACT\n", 1)[0]
        compile(code, "quick-add-bootstrap", "exec")
        baseline = package.baseline()
        self.assertEqual(baseline["source_commit"], release.BASELINE_COMMIT)


if __name__ == "__main__":
    unittest.main()
