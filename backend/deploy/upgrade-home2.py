"""Manual API/PWA 0.13.0 install; keep the installed management 0.3.0 identity."""
from __future__ import annotations

import contextlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("home2_install_common", HERE / "management/upgrade-analytics.py")
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
common.STATE = Path("/var/lib/khaneyar/releases/home2-0.13.0")
common.BACKUPS = Path("/var/backups/khaneyar/home2-0.13.0")
common.IMAGE = "khaneyar-api:v0.13.0"
REVISION = "0042_meal_inventory_links"


class Installer(common.Installer):
    def container(self, mode, *, running=False, database=None, image=False):
        if running and mode not in {"source", "database"}:
            raise ValueError("Running containers support read-only probes only")
        helper = (self.bundle / "management/analytics-container.py").read_text()
        home = (self.bundle / "home2-container.py").read_text()
        rest = home.split("BASELINE = ", 1)[1]
        code = helper + "\nimport sys, types\nsys.dont_write_bytecode=True\nanalytics=types.SimpleNamespace(**globals().copy())\nBASELINE = " + rest
        code = code.split('\nif __name__ == "__main__":', 1)[0]
        code += "\ntry:\n main(" + repr(mode) + ",json.loads(" + repr(json.dumps(self.manifest["container"])) + ")," + repr(database) + ")\n"
        code += "except Exception:\n raise SystemExit('Home 2 container " + mode + " failed; private diagnostics withheld.') from None\n"
        if image:
            return self.run(["docker", "run", "--rm", "--network", "none", "-i", "--entrypoint", "python",
                             common.IMAGE, "-"], data=code.encode(), timeout=600).decode().strip()
        args = ("exec", "-T", "api", "python", "-") if running else (
            "run", "--rm", "--no-deps", "-T", "--entrypoint", "python", "api", "-")
        return self.compose(*args, data=code.encode(), timeout=600).decode().strip()

    def preflight(self):
        self.check = "release manifest and file hashes"
        m = self.manifest
        if (m.get("tag"), m.get("software_version"), m.get("database_baseline_revision"),
                m.get("database_revision")) != ("v0.13.0", "0.13.0", "0039", REVISION):
            raise ValueError("Unexpected Home 2 release contract")
        common.verify_tree(self.bundle, m["files_sha256"] | {"validation.json": common.digest(self.bundle / "validation.json")})
        for path in (common.BASE, common.DEPLOY, common.CONFIG, common.STATE, common.BACKUPS, common.PWA,
                     common.DEPLOY / ".env", common.DEPLOY / "docker-compose.release.json",
                     common.BASE / "source", common.BASE / "web"):
            if any(p.is_symlink() for p in [path, *path.parents]):
                raise ValueError("Linked installation path: " + str(path))
        self.check = "installed management configuration and version"
        self.cfg = json.loads(common.CONFIG.read_text())
        if (self.cfg.get("mode"), self.cfg.get("origin"), self.cfg.get("web_root")) != (
                "production", "https://supp.khaanehyar.ir", str(common.BASE / "web")):
            raise ValueError("Unexpected management configuration")
        self.state_dir = Path(self.cfg.get("state_dir", "/var/lib/khaneyar-management"))
        if self.state_dir != Path("/var/lib/khaneyar-management") or self.state_dir.is_symlink():
            raise ValueError("Unexpected management state path")
        if json.loads((common.BASE / "web/version.json").read_text()).get("version") != "0.3.0":
            raise ValueError("Expected installed management 0.3.0")
        runtime = common.DEPLOY / "management/runtime.json"
        if runtime.is_symlink() or not runtime.is_file():
            raise ValueError("Existing management runtime file is required")
        common.STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        journal = common.STATE / "journal.json"
        if journal.exists():
            self.journal = json.loads(journal.read_text())
            if self.journal.get("manifest_sha256") != common.digest(self.bundle / "validation.json"):
                raise ValueError("Another package owns the retained Home 2 journal")
            self.backup = Path(self.journal["backup"])
            if self.backup.parent != common.BACKUPS or self.backup.is_symlink() or not self.backup.is_dir():
                raise ValueError("Invalid backup journal")
            if not self.journal.get("activated"):
                raise ValueError("Previous pre-activation attempt needs review; retained its private log")
            self.quiesced = True
        else:
            self.system("is-active")
            self.check = "installed PWA 0.12.0 files"
            common.verify_tree(common.PWA, m["baseline_pwa_sha256"])
            self.check = "installed management 0.3.0 API source and dependencies"
            if self.container("source", running=True) != "BASELINE":
                raise ValueError("API source differs from management 0.3.0")
            self.check = "installed database revision 0039 and restricted grants"
            if self.container("database", running=True) != "0039":
                raise ValueError("Database differs from management 0.3.0")
            self.snapshot_identity(self.state_dir)
            for suffix in (".home2-next", ".home2-before"):
                if common.PWA.with_name(common.PWA.name + suffix).exists():
                    raise ValueError("Existing PWA staging directory preserved")
            common.BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
            import tempfile
            self.backup = Path(tempfile.mkdtemp(prefix="before-0.13.0-", dir=common.BACKUPS))
            self.save(manifest_sha256=common.digest(self.bundle / "validation.json"), backup=str(self.backup),
                      config_sha256=common.digest(common.CONFIG), pwa_sha256=m["pwa_sha256"],
                      management_source_sha256=common.tree(common.BASE / "source", cache=True),
                      management_web_sha256=common.tree(common.BASE / "web"), phase="preflight")
        self.log = (self.backup / "install.log").open("ab", buffering=0)

    def stage(self):
        stage = common.PWA.with_name(common.PWA.name + ".home2-next")
        if stage.exists() or stage.is_symlink():
            raise ValueError("Existing PWA staging directory preserved")
        shutil.copytree(self.bundle / "pwa", stage)
        for path in [stage, *stage.rglob("*")]:
            path.chmod(0o755 if path.is_dir() else 0o644)
        common.verify_tree(stage, self.manifest["pwa_sha256"])

    def backup_and_migrate(self):
        print("2/5 Pausing API/management and saving verified private backups...", flush=True)
        self.system("stop")
        self.quiesced = True
        self.compose("stop", "api")
        self.save(identity_sha256=self.snapshot_identity(self.state_dir),
                  runtime_sha256=common.digest(common.DEPLOY / "management/runtime.json"))
        shutil.copytree(self.state_dir, self.backup / "management-state")
        shutil.copyfile(common.CONFIG, self.backup / "management-config.json")
        shutil.copytree(common.PWA, self.backup / "pwa-before")
        shutil.copyfile(common.DEPLOY / ".env", self.backup / "env-before")
        override = common.DEPLOY / "docker-compose.release.json"
        self.save(had_override=override.exists())
        if override.exists():
            shutil.copyfile(override, self.backup / "compose-before.json")
        with (self.backup / "database-before.dump").open("xb") as stream:
            self.compose("exec", "-T", "db", "sh", "-c", 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                         output=stream, timeout=1800)
            stream.flush()
            os.fsync(stream.fileno())
        self.prepare_compose()
        restore = "khaneyar_analytics_restore_" + os.urandom(8).hex()
        self.compose("exec", "-T", "db", "sh", "-c", 'exec createdb -U "$POSTGRES_USER" -T template0 "$1"', "_", restore)
        self.created_restore = restore
        with (self.backup / "database-before.dump").open("rb") as stream:
            result = subprocess.run(["docker", "compose", "exec", "-T", "db", "sh", "-c",
                                     'exec pg_restore --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$1"', "_", restore],
                                    stdin=stream, stdout=self.log, stderr=self.log, cwd=common.DEPLOY, timeout=1800)
        if result.returncode or self.container("migrate", database=restore) != "MIGRATED":
            raise ValueError("Backup restore or migration rehearsal failed")
        self.drop_restore()
        print("3/5 Backup restored successfully; applying migrations 0040 through 0042...", flush=True)
        if self.container("migrate") != "MIGRATED":
            raise ValueError("Home 2 migration was not committed")
        self.save(phase="migrated")

    def swap(self):
        common.verify_tree(common.PWA, self.manifest["baseline_pwa_sha256"])
        previous = common.PWA.with_name(common.PWA.name + ".home2-before")
        if previous.exists() or previous.is_symlink():
            raise ValueError("Existing PWA backup preserved")
        common.PWA.rename(previous)
        common.PWA.with_name(common.PWA.name + ".home2-next").rename(common.PWA)
        common.verify_tree(common.PWA, self.manifest["pwa_sha256"])

    def unchanged_management(self):
        common.verify_tree(common.BASE / "source", self.journal["management_source_sha256"], cache=True)
        common.verify_tree(common.BASE / "web", self.journal["management_web_sha256"])
        if common.digest(common.DEPLOY / "management/runtime.json") != self.journal["runtime_sha256"]:
            raise ValueError("Management runtime settings changed")

    def probe(self):
        super().probe()
        self.unchanged_management()
        if self.container("source", running=True) != "NEW" or self.container("database", running=True) != REVISION:
            raise ValueError("Activated API source/schema verification failed")
        for name in self.manifest["pwa_sha256"]:
            if name not in {"version.json", "index.html", "sw.js"} and not name.endswith((".js", ".css")):
                continue
            request = Request("https://pwa.khaanehyar.ir/" + name + "?verify=home2-0.13.0", headers={"Cache-Control": "no-cache"})
            with urlopen(request, timeout=30) as response:
                import hashlib
                if hashlib.sha256(response.read()).hexdigest() != self.manifest["pwa_sha256"][name]:
                    raise ValueError("Public PWA differs: " + name)

    def restore_before_activation(self):
        previous = common.PWA.with_name(common.PWA.name + ".home2-before")
        if previous.exists():
            common.verify_tree(previous, self.manifest["baseline_pwa_sha256"])
            if common.PWA.exists():
                common.PWA.rename(common.PWA.with_name(common.PWA.name + ".home2-failed-" + os.urandom(4).hex()))
            previous.rename(common.PWA)
        if (self.backup / "env-before").exists():
            common.atomic(common.DEPLOY / ".env", (self.backup / "env-before").read_bytes())
            override = common.DEPLOY / "docker-compose.release.json"
            if self.journal.get("had_override"):
                common.atomic(override, (self.backup / "compose-before.json").read_bytes())
            elif override.exists():
                override.unlink()
        self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "api")
        self.system("start")

    def apply(self):
        try:
            self.preflight()
            self.check = "API build and image verification"
            if not self.journal.get("activated"):
                print("1/5 Building from the verified installed API image without dependency downloads...", flush=True)
                container_id = self.compose("ps", "-q", "api").decode().strip()
                image_id = self.run(["docker", "inspect", "--format", "{{.Image}}", container_id]).decode().strip()
                self.save(previous_image=image_id)
                baseline_tag = "khaneyar-api:home2-0.13.0-baseline"
                self.run(["docker", "image", "tag", image_id, baseline_tag])
                self.run(["docker", "build", "--pull=false", "--network=none", "--build-arg", "KHANEYAR_BASE=" + baseline_tag,
                          "-t", common.IMAGE, str(self.bundle / "api")], output=self.log, timeout=600)
                if self.container("image", image=True) != "VERIFIED":
                    raise ValueError("Home 2 API image verification failed")
                self.stage()
                self.check = "backup restore and migration rehearsal"
                self.backup_and_migrate()
                self.check = "PWA staging and activation"
                self.swap()
                self.save(activated=True, phase="activated")
            else:
                if (common.digest(common.DEPLOY / ".env") != self.journal["env_after_sha256"] or
                        common.digest(common.DEPLOY / "docker-compose.release.json") != self.journal["compose_after_sha256"]):
                    raise ValueError("Activated Compose settings changed; preserved")
                self.unchanged_management()
                common.verify_tree(common.PWA, self.manifest["pwa_sha256"])
                if self.container("source") != "NEW" or self.container("database") != REVISION:
                    raise ValueError("Activated source or schema differs")
            print("4/5 Starting the checked API and existing management service...", flush=True)
            self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "api")
            self.system("start")
            self.check = "API, management and public PWA verification"
            self.probe()
            self.save(phase="completed")
            print("5/5 UPGRADE COMPLETE: Home 2 / PWA 0.13.0; database 0042; management 0.3.0 preserved.", flush=True)
            print("Private backup/log: " + str(self.backup), flush=True)
        except BaseException:
            if self.created_restore:
                with contextlib.suppress(Exception):
                    self.drop_restore()
            if self.quiesced:
                if self.journal.get("activated"):
                    with contextlib.suppress(Exception):
                        self.compose("stop", "api")
                    with contextlib.suppress(Exception):
                        self.system("stop")
                    print("MAINTENANCE: activation began; services left OFF. Rerun the same verified installer. No database restore/downgrade.", flush=True)
                else:
                    try:
                        self.restore_before_activation()
                        self.save(phase="failed-before-activation")
                        print("Previous services/PWA restored; additive schema retained; inspect the private log.", flush=True)
                    except Exception:
                        with contextlib.suppress(Exception):
                            self.compose("stop", "api")
                        with contextlib.suppress(Exception):
                            self.system("stop")
            if self.backup:
                print("Private backup/log: " + str(self.backup), flush=True)
            print("Stopped during: " + getattr(self, "check", "initial verification"), flush=True)
            raise
        finally:
            if self.log:
                self.log.close()


def main():
    import fcntl

    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise SystemExit("Run as root in VNC: python3 upgrade-home2.py EXTRACTED_BUNDLE")
    os.umask(0o077)
    with contextlib.ExitStack() as stack:
        for path in (Path("/var/lock/khaneyar-release.lock"), common.BASE / ".web-upgrade.lock",
                     Path("/var/backups/khaneyar/management/.operation.lock")):
            stream = stack.enter_context(path.open("a"))
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        Installer(Path(sys.argv[1]).resolve(strict=True)).apply()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Home 2 upgrade stopped: " + type(error).__name__ + ". Inspect the protected install log if created.", file=sys.stderr)
        raise SystemExit(1) from None
