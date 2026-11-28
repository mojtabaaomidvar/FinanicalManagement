"""Resume a checked PWA-only upgrade while preserving API, schema and management."""
from __future__ import annotations

import contextlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("compact_history", HERE / "upgrade-history.py")
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)
common = history.common
VERSION = "0.16.0"
MANAGEMENT_VERSION = "0.4.1"
BASELINE_COMMIT = "7b4854a97ddaed345f073a23d422500ed6f28fc4"
PREVIOUS_STATE = Path("/var/lib/khaneyar/releases/history-0.15.1")
common.STATE = Path("/var/lib/khaneyar/releases/wallet-0.16.0")
common.BACKUPS = Path("/var/backups/khaneyar/wallet-0.16.0")
# Reuse the reviewed public/loopback probes with the new PWA version only.
history.PWA_VERSION = VERSION


class Installer(history.Installer):
    def locations(self):
        return {"pwa": common.PWA}

    def paths(self, kind):
        if kind != "pwa":
            raise ValueError("Only the PWA is an activation target")
        live = common.PWA
        return live, live.with_name(live.name + ".wallet016-next"), live.with_name(live.name + ".wallet016-before")

    def protected(self):
        return super().protected() | {"management_web": common.tree(common.BASE / "web")}

    def preflight(self):
        self.check = "release contract and complete incoming file hashes"
        m = self.manifest
        if (m.get("tag"), m.get("software_version"), m.get("management_version"),
                m.get("database_revision"), m.get("database_migration_required"), m.get("deployment_scope")) != (
                "v" + VERSION, VERSION, MANAGEMENT_VERSION, history.home2.REVISION, False, "pwa-only"):
            raise ValueError("Unexpected wallet release contract")
        if (m.get("baseline_tag"), m.get("baseline_commit")) != ("v0.15.1", BASELINE_COMMIT):
            raise ValueError("Wallet release requires the pinned history 0.15.1 baseline")
        manifest_hash = common.digest(self.bundle / "validation.json")
        common.verify_tree(self.bundle, m["files_sha256"] | {"validation.json": manifest_hash})
        for path in (common.BASE, common.DEPLOY, common.CONFIG, common.PWA, common.STATE, common.BACKUPS,
                     common.BASE / "source", common.BASE / "web", common.DEPLOY / ".env",
                     common.DEPLOY / "docker-compose.release.json", common.DEPLOY / "management/runtime.json", PREVIOUS_STATE):
            if any(p.is_symlink() for p in [path, *path.parents]):
                raise ValueError("Linked installation path")
        self.cfg = json.loads(common.CONFIG.read_text())
        self.state_dir = Path(self.cfg.get("state_dir", ""))
        if (self.cfg.get("mode"), self.cfg.get("origin"), self.cfg.get("web_root"), self.state_dir) != (
                "production", "https://supp.khaanehyar.ir", str(common.BASE / "web"), Path("/var/lib/khaneyar-management")):
            raise ValueError("Unexpected management configuration")
        if any(p.is_symlink() for p in [self.state_dir, *self.state_dir.parents]):
            raise ValueError("Linked management identity path")
        self.check = "previous history installation state"
        previous = PREVIOUS_STATE / "journal.json"
        if previous.is_symlink() or (previous.exists() and json.loads(previous.read_text()).get("phase") != "completed"):
            raise ValueError("Previous history installation is incomplete; review its retained log")
        self.verify_runtime()
        self.check = "active management service and unchanged 0.4.1 files"
        self.system("is-active")
        common.verify_tree(common.BASE / "source", m["management_source_sha256"], cache=True)
        actual_web = common.tree(common.BASE / "web")
        if any(actual_web.get(name) != value for name, value in m["baseline_web_sha256"].items()):
            raise ValueError("Management 0.4.1 web differs from the published baseline")
        if any(not name.startswith("assets/") for name in actual_web.keys() - m["baseline_web_sha256"].keys()):
            raise ValueError("Unexpected management file outside retained assets")
        common.STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        journal = common.STATE / "journal.json"
        if journal.is_symlink():
            raise ValueError("Linked release journal")
        if journal.exists():
            self.journal = json.loads(journal.read_text())
            if self.journal.get("manifest_sha256") != manifest_hash:
                raise ValueError("Another package owns this retained journal")
            if self.journal.get("phase") not in {"preparing", "prepared", "activating", "completed"}:
                raise ValueError("Unknown installation phase")
            self.backup = Path(self.journal["backup"])
            if self.backup.parent != common.BACKUPS or not self.backup.is_dir() or self.backup.is_symlink():
                raise ValueError("Invalid retained backup")
            if self.protected() != self.journal["protected"]:
                raise ValueError("Protected configuration or management identity changed")
            return
        self.check = "installed PWA 0.15.1 complete file inventory"
        common.verify_tree(common.PWA, m["baseline_pwa_sha256"])
        for path in self.paths("pwa")[1:]:
            if path.exists() or path.is_symlink():
                raise ValueError("Existing wallet stage or backup requires review")
        protected = self.protected()
        common.BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.backup = Path(tempfile.mkdtemp(prefix="before-", dir=common.BACKUPS))
        self.save(manifest_sha256=manifest_hash, backup=str(self.backup), protected=protected,
                  old_pwa=m["baseline_pwa_sha256"], new_pwa=m["pwa_sha256"], phase="preparing")

    def apply(self):
        try:
            self.preflight()
        except Exception:
            print("Preflight stopped during: " + self.check + "; PWA not activated.", flush=True)
            raise
        self.log = (self.backup / "install.log").open("ab", buffering=0)
        try:
            if self.journal["phase"] in {"preparing", "prepared"}:
                self.check = "verified PWA backup and staging"
                self.log.write((self.check + "\n").encode())
                self.stage()
                if self.protected() != self.journal["protected"]:
                    raise ValueError("Protected state changed while staging")
                self.save(phase="activating")
            self.check = "resumable PWA activation"
            self.swap("pwa")
            self.check = "active PWA, API/schema and management identity/health"
            self.probe()
            self.save(phase="completed")
            print("UPGRADE COMPLETE: Wallet / PWA 0.16.0; API/schema unchanged; management 0.4.1 preserved.", flush=True)
            print("Database: " + history.home2.REVISION + "; protected backup/log: " + str(self.backup), flush=True)
        except BaseException:
            self.log.write(("STOPPED: " + self.check + "\n").encode())
            print("Stopped during: " + self.check + ". Backups retained; rerun this same verified installer.", flush=True)
            print("Protected backup/log: " + str(self.backup), flush=True)
            raise
        finally:
            self.log.close()


def main():
    import fcntl
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise SystemExit("Run as root in VNC: python3 upgrade-wallet-compact.py EXTRACTED_BUNDLE")
    os.umask(0o077)
    for name in ("docker", "systemctl"):
        if not shutil.which(name):
            raise ValueError("Required tool unavailable: " + name)
    with contextlib.ExitStack() as stack:
        for path in (Path("/var/lock/khaneyar-release.lock"), common.BASE / ".web-upgrade.lock",
                     Path("/var/backups/khaneyar/management/.operation.lock")):
            if path.is_symlink():
                raise ValueError("Linked lock file")
            stream = stack.enter_context(path.open("a"))
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        Installer(Path(sys.argv[1]).resolve(strict=True)).apply()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Wallet upgrade stopped: " + type(error).__name__ + "; no database migration or service restart.", file=sys.stderr)
        raise SystemExit(1) from None
