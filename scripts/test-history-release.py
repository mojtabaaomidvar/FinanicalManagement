"""Resumable web swaps and unchanged state; Docker/HTTP are explicit local doubles."""
import importlib.util
import io
import json
import os
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("history_release", ROOT / "backend/deploy/upgrade-history.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="history-installer-", dir=Path(os.environ["LOCALAPPDATA"]) / "Temp/opencode")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        (self.bundle / "validation.json").write_text("{}")
        self.installer = release.Installer(self.bundle)
        self.installer.backup = self.root / "backup"
        self.installer.backup.mkdir()
        self.locations = {kind: self.root / ("live-" + kind) for kind in ("pwa", "web")}
        for kind, live in self.locations.items():
            live.mkdir()
            (live / "index.html").write_text("old-" + kind)
            incoming = self.bundle / kind
            incoming.mkdir()
            (incoming / "index.html").write_text("new-" + kind)
            self.installer.journal["old_" + kind] = release.common.tree(live)
            self.installer.journal["new_" + kind] = release.common.tree(incoming)
        self.installer.manifest["web_sha256"] = self.installer.journal["new_web"].copy()
        self.installer.journal.update(phase="preparing", protected={"identity": "same"})
        self.patch = patch.object(self.installer, "locations", return_value=self.locations)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.state = patch.object(release.common, "STATE", self.root / "state")
        self.state.start()
        self.addCleanup(self.state.stop)

    def apply(self, probe=None):
        with patch.object(self.installer, "preflight"), patch.object(self.installer, "protected", return_value={"identity": "same"}), \
                patch.object(self.installer, "probe", side_effect=probe), \
                patch.object(self.installer, "compose", side_effect=AssertionError("No Docker write permitted")), \
                patch.object(self.installer, "system", side_effect=AssertionError("No service restart permitted")):
            self.installer.apply()

    def assert_complete(self):
        for kind, live in self.locations.items():
            self.assertEqual((live / "index.html").read_text(), "new-" + kind)
            self.assertEqual((self.installer.backup / kind / "index.html").read_text(), "old-" + kind)
            release.common.verify_tree(self.installer.paths(kind)[2], self.installer.journal["old_" + kind])
        self.assertEqual(self.installer.journal["phase"], "completed")

    def test_web_only_upgrade_and_repeat_preserve_both_backups(self):
        self.apply()
        self.apply()
        self.assert_complete()

    def test_failure_after_first_swap_resumes_second_without_restaging(self):
        original = self.installer.swap
        def interrupted(kind):
            original(kind)
            if kind == "pwa":
                raise OSError("interrupted after first web activation")
        with patch.object(self.installer, "swap", side_effect=interrupted), self.assertRaises(OSError):
            self.apply()
        self.assertEqual(self.installer.journal["phase"], "activating")
        self.apply()
        self.assert_complete()

    def test_interruption_between_old_and_new_renames_is_resumable(self):
        self.installer.stage()
        self.installer.journal["phase"] = "activating"
        live, _, previous = self.installer.paths("pwa")
        live.rename(previous)
        self.apply()
        self.assert_complete()

    def test_health_failure_keeps_new_files_and_retries_same_release(self):
        with self.assertRaisesRegex(ValueError, "health"):
            self.apply(ValueError("health unavailable"))
        self.assertEqual(self.installer.journal["phase"], "activating")
        self.apply()
        self.assert_complete()

    def test_modified_baseline_is_not_replaced(self):
        (self.locations["pwa"] / "user.txt").write_text("preserve")
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual((self.locations["pwa"] / "user.txt").read_text(), "preserve")
        self.assertEqual((self.locations["pwa"] / "index.html").read_text(), "old-pwa")

    def test_unexpected_changes_after_activation_stop_resume(self):
        self.apply()
        (self.locations["web"] / "index.html").write_text("operator edit")
        with self.assertRaises(ValueError):
            self.apply()
        self.assertEqual((self.locations["web"] / "index.html").read_text(), "operator edit")

    def test_incomplete_stage_is_preserved_and_rebuilt_before_activation(self):
        _, stage, _ = self.installer.paths("pwa")
        stage.mkdir()
        (stage / "unknown").write_text("preserve partial copy")
        self.apply()
        retained = list(self.root.glob("live-pwa.history-next.retained-*"))
        self.assertEqual(len(retained), 1)
        self.assertEqual((retained[0] / "unknown").read_text(), "preserve partial copy")
        self.assert_complete()

    def test_previous_management_assets_remain_available(self):
        live = self.locations["web"]
        (live / "assets").mkdir()
        (live / "assets/old.js").write_text("previous tab")
        self.installer.journal["old_web"] = release.common.tree(live)
        self.installer.journal["new_web"]["assets/old.js"] = release.common.digest(live / "assets/old.js")
        self.apply()
        self.assertEqual((live / "assets/old.js").read_text(), "previous tab")

    def test_runtime_probe_accepts_only_the_unchanged_source_and_schema(self):
        for values in [("BASELINE",), ("NEW", "0039")]:
            with patch.object(self.installer, "container", side_effect=values), self.assertRaises(ValueError):
                self.installer.verify_runtime()
        with patch.object(self.installer, "container", side_effect=["NEW", release.home2.REVISION]) as call:
            self.installer.verify_runtime()
            self.assertEqual([args.args[0] for args in call.call_args_list], ["source", "database"])
            self.assertTrue(all(args.kwargs == {"running": True} for args in call.call_args_list))

    def exercise_preflight(self, change=None):
        base, deploy = self.root / "base", self.root / "deploy"
        (base / "source").mkdir(parents=True)
        (base / "source/code.py").write_text("checked runtime")
        shutil.copytree(self.locations["web"], base / "web")
        deploy.mkdir()
        for name in (".env", "docker-compose.release.json", "management/runtime.json"):
            path = deploy / name
            path.parent.mkdir(exist_ok=True)
            path.write_text("private, preserved")
        config = self.root / "config.json"
        config.write_text(json.dumps({"mode": "production", "origin": "https://supp.khaanehyar.ir",
                                     "web_root": str(base / "web"), "state_dir": "/var/lib/khaneyar-management"}))
        self.installer.manifest.update(tag="v0.15.0", software_version="0.15.0", management_version="0.4.0",
            database_revision=release.home2.REVISION, database_migration_required=False,
            files_sha256={k: v for k, v in release.common.tree(self.bundle).items() if k != "validation.json"},
            management_source_sha256=release.common.tree(base / "source"),
            baseline_pwa_sha256=release.common.tree(self.locations["pwa"]),
            baseline_web_sha256=release.common.tree(base / "web"),
            pwa_sha256=self.installer.journal["new_pwa"])
        if change:
            change(base)
        original = release.common.tree(deploy)
        with patch.multiple(release.common, BASE=base, DEPLOY=deploy, CONFIG=config,
                            PWA=self.locations["pwa"], BACKUPS=self.root / "new-backups"), \
                patch.object(self.installer, "verify_runtime"), \
                patch.object(self.installer, "protected", return_value={"identity": "same"}), \
                patch.object(self.installer, "system") as service:
            try:
                self.installer.preflight()
            finally:
                self.assertEqual(release.common.tree(deploy), original)
                self.assertTrue(all(call.args == ("is-active",) for call in service.call_args_list))

    def test_preflight_requires_published_baseline_and_preserves_private_files(self):
        self.exercise_preflight()
        self.assertEqual(self.installer.journal["phase"], "preparing")
        self.assertEqual((self.locations["pwa"] / "index.html").read_text(), "old-pwa")

    def test_preflight_rejects_an_unrelated_schema_contract(self):
        with self.assertRaisesRegex(ValueError, "contract"):
            self.exercise_preflight(lambda _: self.installer.manifest.update(database_revision="newer"))

    def test_preflight_rejects_modified_management_source(self):
        with self.assertRaises(ValueError):
            self.exercise_preflight(lambda base: (base / "source/code.py").write_text("operator edit"))

    def test_bootstrap_stages_atomically_and_rejects_modified_or_unsafe_archives(self):
        spec = importlib.util.spec_from_file_location("history_package", ROOT / "scripts/package-history-release.py")
        package = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(package)
        bootstrap = package.bootstrap("a" * 64).decode()
        self.assertIn("https://github.com/", bootstrap)
        self.assertIn("/v0.15.0/history-0.15.0.tgz", bootstrap)
        code = bootstrap.split("<<'EXTRACT'\n", 1)[1].split("\nEXTRACT\n", 1)[0]
        target = self.root / "extracted"
        code = code.replace("target=pathlib.Path('/opt/khaneyar-management/releases/history-0.15.0')",
                            "target=pathlib.Path(" + repr(str(target)) + ")")
        archive = self.root / "archive.tgz"
        def write(name, content=b"checked", link=False):
            with tarfile.open(archive, "w:gz") as stream:
                entry = tarfile.TarInfo(name)
                entry.size = len(content)
                if link:
                    entry.type, entry.linkname, entry.size = tarfile.SYMTYPE, "../outside", 0
                stream.addfile(entry, None if link else io.BytesIO(content))
        def extract():
            before = os.umask(0o077)
            try:
                with patch.object(sys, "argv", ["extract", str(archive)]):
                    exec(compile(code, "safe-history-bootstrap", "exec"), {})  # noqa: S102 -- Execute only the generated local bootstrap under test.
            finally:
                os.umask(before)
        write("pwa/index.html")
        extract()
        extract()
        self.assertEqual((target / "pwa/index.html").read_bytes(), b"checked")
        (target / "pwa/index.html").write_text("operator edit")
        with self.assertRaises(SystemExit):
            extract()
        for name, link in [("../outside", False), ("pwa/link", True)]:
            write(name, link=link)
            with self.assertRaises(SystemExit):
                extract()
        self.assertFalse((self.root / "outside").exists())


if __name__ == "__main__":
    unittest.main()
