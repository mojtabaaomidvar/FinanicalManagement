"""Upgrade only the PWA and management web; keep API/schema and private identity."""
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
spec = importlib.util.spec_from_file_location("history_home2", HERE / "upgrade-home2.py")
home2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(home2)
common = home2.common
common.STATE = Path("/var/lib/khaneyar/releases/history-0.16.1")
common.BACKUPS = Path("/var/backups/khaneyar/history-0.16.1")
PWA_VERSION = "0.16.1"
MANAGEMENT_VERSION = "0.4.2"
BASELINE_COMMIT = "b794b15ed29dd86a2d5d77830bf1917016508127"
PREVIOUS_STATE = Path("/var/lib/khaneyar/releases/wallet-0.16.0")
BASELINE_MANIFEST_SHA256 = "72743fa711ffe8c104285e44ca84c3d7e70c9b9f402830cd54e501c82a846190"


class Installer(home2.Installer):
    def protected(self):
        """Only hashes leave these files; credentials are never printed or replaced."""
        return {
            "identity": self.snapshot_identity(self.state_dir),
            "config": common.digest(common.CONFIG),
            "environment": common.digest(common.DEPLOY / ".env"),
            "override": common.digest(common.DEPLOY / "docker-compose.release.json"),
            "runtime": common.digest(common.DEPLOY / "management/runtime.json"),
            "management_source": common.tree(common.BASE / "source", cache=True),
        }

    def verify_runtime(self):
        self.check = "installed API 0.14.0 source and dependencies"
        if self.container("source", running=True) != "NEW":
            raise ValueError("Installed API differs from the verified 0.14.0 source")
        self.check = "installed database revision 0042 (read-only)"
        if self.container("database", running=True) != home2.REVISION:
            raise ValueError("Installed database revision differs; no migration is permitted")

    def locations(self):
        return {"pwa": common.PWA, "web": common.BASE / "web"}

    def hashes(self, kind):
        return self.journal["new_" + kind]

    def paths(self, kind):
        live = self.locations()[kind]
        return (live, live.with_name(live.name + ".history-0.16.1-next"),
                live.with_name(live.name + ".history-0.16.1-before"))

    def preflight(self):
        self.check = "release contract and file hashes"
        m = self.manifest
        if (m.get("tag"), m.get("software_version"), m.get("management_version"),
            m.get("database_revision"), m.get("database_migration_required"),
            m.get("deployment_scope")) != (
                "v0.16.1", PWA_VERSION, MANAGEMENT_VERSION, home2.REVISION, False,
                "pwa-and-management-web-only"):
            raise ValueError("Unexpected history release contract")
        if (m.get("baseline_tag"), m.get("baseline_commit"), m.get("baseline_manifest_sha256")) != (
                "v0.16.0", BASELINE_COMMIT, BASELINE_MANIFEST_SHA256):
            raise ValueError("History release requires the pinned wallet 0.16.0 baseline")
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
        config_values = (self.cfg.get("mode"), self.cfg.get("origin"), self.cfg.get("web_root"))
        if (config_values != ("production", "https://supp.khaanehyar.ir", str(common.BASE / "web"))
                or self.state_dir != Path("/var/lib/khaneyar-management")):
            raise ValueError("Unexpected management configuration")
        if any(p.is_symlink() for p in [self.state_dir, *self.state_dir.parents]):
            raise ValueError("Linked management identity path")
        self.check = "previous wallet 0.16.0 installation state"
        if any(p.is_symlink() for p in [PREVIOUS_STATE, *PREVIOUS_STATE.parents]):
            raise ValueError("Linked previous wallet state")
        previous_journal = PREVIOUS_STATE / "journal.json"
        if previous_journal.is_symlink() or not previous_journal.is_file():
            raise ValueError("Completed previous wallet installation journal is required")
        previous = json.loads(previous_journal.read_text())
        if (previous.get("phase"), previous.get("manifest_sha256")) != (
                "completed", BASELINE_MANIFEST_SHA256):
            raise ValueError("Previous wallet installation journal requires review")
        if previous.get("new_pwa") != m["baseline_pwa_sha256"]:
            raise ValueError("Previous wallet PWA contract differs")
        previous_web = previous.get("protected", {}).get("management_web", {})
        baseline_web = m["baseline_web_sha256"]
        extra_web = set(previous_web) - set(baseline_web)
        if (any(previous_web.get(name) != checksum for name, checksum in baseline_web.items())
                or any(not name.startswith("assets/") for name in extra_web)):
            raise ValueError("Previous wallet management contract differs")
        self.verify_runtime()
        self.check = "active management service"
        self.system("is-active")
        self.check = "installed management source"
        common.verify_tree(common.BASE / "source", m["management_source_sha256"], cache=True)
        common.STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        journal = common.STATE / "journal.json"
        if journal.is_symlink():
            raise ValueError("Linked release journal")
        if journal.exists():
            self.journal = json.loads(journal.read_text())
            if self.journal.get("manifest_sha256") != manifest_hash:
                raise ValueError("Another package owns this journal")
            phases = {"preparing", "prepared", "activating", "completed"}
            if self.journal.get("phase") not in phases:
                raise ValueError("Unknown installation phase")
            self.backup = Path(self.journal["backup"])
            if (self.backup.parent != common.BACKUPS or not self.backup.is_dir()
                    or self.backup.is_symlink()):
                raise ValueError("Invalid retained backup")
            if self.protected() != self.journal["protected"]:
                raise ValueError("Private configuration or identity changed; review required")
            return
        self.check = "installed PWA 0.16.0 and management 0.4.1 web baselines"
        common.verify_tree(common.PWA, m["baseline_pwa_sha256"])
        actual = common.tree(common.BASE / "web")
        if any(actual.get(name) != digest for name, digest in m["baseline_web_sha256"].items()):
            raise ValueError("Management 0.4.1 web differs from the published baseline")
        extra = set(actual) - set(m["baseline_web_sha256"])
        if any(not name.startswith("assets/") for name in extra):
            raise ValueError("Unexpected management file outside retained assets")
        for kind in self.locations():
            for path in self.paths(kind)[1:]:
                if path.exists() or path.is_symlink():
                    raise ValueError("Existing staging or previous web directory; review required")
        incoming = m["web_sha256"].copy()
        for name, digest in actual.items():
            if name.startswith("assets/"):
                if name in incoming and incoming[name] != digest:
                    raise ValueError("Conflicting retained management asset")
                incoming[name] = digest
        common.BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.backup = Path(tempfile.mkdtemp(prefix="before-", dir=common.BACKUPS))
        self.save(manifest_sha256=manifest_hash, backup=str(self.backup),
                  protected=self.protected(), old_pwa=m["baseline_pwa_sha256"], old_web=actual,
                  new_pwa=m["pwa_sha256"], new_web=incoming, phase="preparing")

    def stage(self):
        for kind, live in self.locations().items():
            old = self.journal["old_" + kind]
            backup = self.backup / kind
            if not backup.exists():
                common.verify_tree(live, old)
                copying = self.backup / ("." + kind + "-copy-" + os.urandom(4).hex())
                shutil.copytree(live, copying)
                common.verify_tree(copying, old)
                copying.rename(backup)
            common.verify_tree(backup, old)
            _, stage, _ = self.paths(kind)
            # Preserve an interrupted copy before staging again; never discard unknown bytes.
            if stage.exists():
                if stage.is_symlink():
                    raise ValueError("Linked staging directory")
                stage.rename(stage.with_name(stage.name + ".retained-" + os.urandom(4).hex()))
            shutil.copytree(self.bundle / kind, stage)
            if kind == "web":
                for name in self.hashes(kind):
                    if name not in self.manifest["web_sha256"]:
                        target = stage / name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(backup / name, target)
            for path in [stage, *stage.rglob("*")]:
                path.chmod(0o755 if path.is_dir() else 0o644)
            common.verify_tree(stage, self.hashes(kind))
        self.save(phase="prepared")

    def swap(self, kind):
        live, stage, previous = self.paths(kind)
        old, new = self.journal["old_" + kind], self.hashes(kind)
        if previous.exists():
            common.verify_tree(previous, old)
            if live.exists():
                common.verify_tree(live, new)
                if stage.exists():
                    raise ValueError("Ambiguous retained stage")
                return
        else:
            common.verify_tree(live, old)
            common.verify_tree(stage, new)
            live.rename(previous)
        common.verify_tree(stage, new)
        stage.rename(live)
        common.verify_tree(live, new)

    def probe(self):
        versions = (("/version.json", PWA_VERSION),
                    ("/management/version.json", MANAGEMENT_VERSION))
        for path, expected in versions:
            origin = "https://pwa.khaanehyar.ir" if path == "/version.json" else self.cfg["origin"]
            request = Request(origin + path, headers={"Cache-Control": "no-cache"})  # noqa: S310 -- Fixed verified HTTPS origin.
            with urlopen(request, timeout=20) as response:  # noqa: S310 -- Fixed verified HTTPS origin.
                if json.load(response).get("version") != expected:
                    raise ValueError("Public web version differs")
        for kind, root in self.locations().items():
            common.verify_tree(root, self.hashes(kind))
            origin = "https://pwa.khaanehyar.ir" if kind == "pwa" else self.cfg["origin"]
            prefix = "/" if kind == "pwa" else "/management/"
            for name, expected in self.hashes(kind).items():
                if not name.endswith((".html", ".js", ".css")):
                    continue
                address = "" if name == "management.html" else name
                request = Request(  # noqa: S310 -- Fixed verified HTTPS origin.
                    origin + prefix + address, headers={"Cache-Control": "no-cache"})
                with urlopen(request, timeout=20) as response:  # noqa: S310 -- Fixed verified HTTPS origin.
                    if hashlib.sha256(response.read()).hexdigest() != expected:
                        raise ValueError("Public web file checksum differs: " + name)
        # Reuse the existing loopback isolation checks without restarting the service.
        helper = self.bundle / "management/upgrade-management-web.py"
        spec = importlib.util.spec_from_file_location("history_web_probe", helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.probe(self.cfg["origin"], MANAGEMENT_VERSION)
        self.verify_runtime()
        if self.protected() != self.journal["protected"]:
            raise ValueError("Protected identity/configuration differs")

    def apply(self):
        try:
            self.preflight()
        except Exception:
            print("Preflight stopped during: " + self.check + "; no web activation.", flush=True)
            raise
        self.log = (self.backup / "install.log").open("ab", buffering=0)
        try:
            if self.journal["phase"] in {"preparing", "prepared"}:
                self.check = "protected web backups and staging"
                self.log.write((self.check + "\n").encode())
                self.stage()
                if self.protected() != self.journal["protected"]:
                    raise ValueError("Protected state changed while staging")
                self.save(phase="activating")
            self.check = "resumable web activation"
            self.log.write((self.check + "\n").encode())
            for kind in self.locations():
                self.swap(kind)
            self.check = "active files, API/schema and management health"
            self.log.write((self.check + "\n").encode())
            self.probe()
            self.save(phase="completed")
            print("UPGRADE COMPLETE: release history / PWA 0.16.1 / management 0.4.2", flush=True)
            print("API/schema unchanged: " + home2.REVISION
                  + "; protected backup/log: " + str(self.backup), flush=True)
        except BaseException:
            self.log.write(("STOPPED: " + self.check + "\n").encode())
            print("Stopped during: " + self.check
                  + ". Web backups retained; rerun this same verified installer.", flush=True)
            print("Protected backup/log: " + str(self.backup), flush=True)
            raise
        finally:
            self.log.close()


def main():
    import fcntl
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise SystemExit("Run as root in VNC: python3 upgrade-history-compact.py EXTRACTED_BUNDLE")
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
        print("History upgrade stopped: " + type(error).__name__
              + "; no database migration or service restart.", file=sys.stderr)
        raise SystemExit(1) from None
