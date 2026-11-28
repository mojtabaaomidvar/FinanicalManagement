"""Pinned PWA-only upgrade after history 0.15.1; reuse the reviewed web lifecycle."""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("quick_add_history", HERE / "upgrade-history.py")
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)
common = history.common
common.STATE = Path("/var/lib/khaneyar/releases/quick-add-0.16.0")
common.BACKUPS = Path("/var/backups/khaneyar/quick-add-0.16.0")
BASELINE_COMMIT = "7b4854a97ddaed345f073a23d422500ed6f28fc4"
VERSION = "0.16.0"


class Installer(history.Installer):
    def locations(self):
        return {"pwa": common.PWA}

    def paths(self, kind):
        live = self.locations()[kind]
        return (live, live.with_name(live.name + ".quick-add-next"),
                live.with_name(live.name + ".quick-add-before"))

    def protected(self):
        return super().protected() | {"management_web": common.tree(common.BASE / "web")}

    def preflight(self):
        self.check = "release contract and checksums"
        m = self.manifest
        if (m.get("tag"), m.get("software_version"), m.get("management_version"),
            m.get("database_revision"), m.get("database_migration_required"),
            m.get("deployment_scope")) != (
                "v0.16.0", VERSION, "0.4.1", history.home2.REVISION, False, "pwa-only"):
            raise ValueError("Unexpected quick-add release contract")
        if (m.get("baseline_tag"), m.get("baseline_commit")) != ("v0.15.1", BASELINE_COMMIT):
            raise ValueError("Quick add requires the pinned history 0.15.1 baseline")
        manifest_hash = common.digest(self.bundle / "validation.json")
        common.verify_tree(self.bundle, m["files_sha256"] | {"validation.json": manifest_hash})
        for path in (common.BASE, common.DEPLOY, common.CONFIG, common.PWA,
                     common.STATE, common.BACKUPS,
                     common.BASE / "source", common.BASE / "web", common.DEPLOY / ".env",
                     common.DEPLOY / "docker-compose.release.json",
                     common.DEPLOY / "management/runtime.json"):
            if any(p.is_symlink() for p in [path, *path.parents]):
                raise ValueError("Linked installation path")
        self.cfg = json.loads(common.CONFIG.read_text())
        self.state_dir = Path(self.cfg.get("state_dir", ""))
        if ((self.cfg.get("mode"), self.cfg.get("origin"), self.cfg.get("web_root")) != (
                "production", "https://supp.khaanehyar.ir", str(common.BASE / "web"))
                or self.state_dir != Path("/var/lib/khaneyar-management")):
            raise ValueError("Unexpected management configuration")
        if any(p.is_symlink() for p in [self.state_dir, *self.state_dir.parents]):
            raise ValueError("Linked management identity path")
        self.verify_runtime()
        self.check = "existing management service/source/web"
        self.system("is-active")
        common.verify_tree(common.BASE / "source", m["management_source_sha256"], cache=True)
        actual_web = common.tree(common.BASE / "web")
        if any(actual_web.get(name) != digest for name, digest in m["baseline_web_sha256"].items()):
            raise ValueError("Management 0.4.1 web differs")
        extra = set(actual_web) - set(m["baseline_web_sha256"])
        if any(m["retained_web_sha256"].get(name) != actual_web[name] for name in extra):
            raise ValueError("Unknown retained management asset")
        common.STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        journal = common.STATE / "journal.json"
        if journal.exists():
            self.journal = json.loads(journal.read_text())
            if self.journal.get("manifest_sha256") != manifest_hash:
                raise ValueError("Another package owns this journal")
            self.backup = Path(self.journal["backup"])
            if (self.backup.parent != common.BACKUPS or not self.backup.is_dir()
                    or self.backup.is_symlink()):
                raise ValueError("Invalid retained backup")
            if self.protected() != self.journal["protected"]:
                raise ValueError("Protected configuration or identity changed")
            return
        self.check = "complete installed PWA 0.15.1 inventory"
        common.verify_tree(common.PWA, m["baseline_pwa_sha256"])
        for path in self.paths("pwa")[1:]:
            if path.exists() or path.is_symlink():
                raise ValueError("Existing PWA stage requires review")
        common.BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.backup = Path(tempfile.mkdtemp(prefix="before-", dir=common.BACKUPS))
        self.save(manifest_sha256=manifest_hash, backup=str(self.backup),
                  protected=self.protected(),
                  old_pwa=m["baseline_pwa_sha256"], new_pwa=m["pwa_sha256"], phase="preparing")

    def probe(self):
        common.verify_tree(common.PWA, self.hashes("pwa"))
        for name, expected in self.hashes("pwa").items():
            request = Request("https://pwa.khaanehyar.ir/" + name,
                              headers={"Cache-Control": "no-cache"})
            with urlopen(request, timeout=30) as response:  # noqa: S310 -- Fixed HTTPS deployment origin.
                if hashlib.sha256(response.read()).hexdigest() != expected:
                    raise ValueError("Public PWA checksum differs: " + name)
        spec = importlib.util.spec_from_file_location(
            "quick_add_management_probe", self.bundle / "management/upgrade-management-web.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.probe(self.cfg["origin"], "0.4.1")
        self.verify_runtime()
        if self.protected() != self.journal["protected"]:
            raise ValueError("Protected state changed")

    def apply(self):
        try:
            self.preflight()
        except Exception:
            print("Preflight stopped during: " + self.check + "; no PWA activation.", flush=True)
            raise
        self.log = (self.backup / "install.log").open("ab", buffering=0)
        try:
            if self.journal["phase"] in {"preparing", "prepared"}:
                self.check = "protected PWA backup and stage"
                self.stage()
                if self.protected() != self.journal["protected"]:
                    raise ValueError("Protected state changed while staging")
                self.save(phase="activating")
            self.check = "resumable PWA activation"
            self.swap("pwa")
            self.check = "PWA hashes and unchanged API/schema/management"
            self.probe()
            self.save(phase="completed")
            print("UPGRADE COMPLETE: Quick add / PWA 0.16.0 / API 0.14.0 / "
                  "management 0.4.1 preserved", flush=True)
            print("Database unchanged: " + history.home2.REVISION
                  + "; protected backup/log: " + str(self.backup), flush=True)
        except BaseException:
            self.log.write(("STOPPED: " + self.check + "\n").encode())
            print("Stopped during: " + self.check
                  + "; rerun this same verified installer.", flush=True)
            print("Protected backup/log: " + str(self.backup), flush=True)
            raise
        finally:
            self.log.close()


def main():
    import fcntl
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise SystemExit("Run as root: python3 upgrade-quick-add.py EXTRACTED_BUNDLE")
    os.umask(0o077)
    for tool in ("docker", "systemctl"):
        if not shutil.which(tool):
            raise ValueError("Required tool unavailable: " + tool)
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
        print("Quick-add upgrade stopped: " + type(error).__name__
              + "; backups retained; rerun the same verified release.", file=sys.stderr)
        raise SystemExit(1) from None
