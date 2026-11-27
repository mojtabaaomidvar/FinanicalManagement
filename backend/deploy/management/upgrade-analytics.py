"""Manual root-console upgrade of API and independent management; keep PWA 0.12.0."""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import runpy
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

BASE = Path("/opt/khaneyar-management")
DEPLOY = Path("/opt/khaneyar/backend/deploy")
CONFIG = Path("/etc/khaneyar-management/config.json")
STATE = Path("/var/lib/khaneyar/releases/management-0.3.0")
BACKUPS = Path("/var/backups/khaneyar/management-analytics")
PWA = Path("/var/www/khaneyar")
IMAGE = "khaneyar-api:management-0.3.0"
SERVICE = "khaneyar-management.service"
OLD_REVISION = "0037_wallet_corrections"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(root, *, cache=False):
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Required directory missing or linked")
    values = {}
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError("Linked files are not supported")
        if path.is_file() and not (cache and ("__pycache__" in path.parts or path.suffix == ".pyc")):
            values[path.relative_to(root).as_posix()] = digest(path)
    return values


def verify_tree(root, expected, *, cache=False):
    for name, checksum in expected.items():
        p = PurePosixPath(name)
        if p.is_absolute() or ".." in p.parts or "\\" in name or ":" in name or len(checksum) != 64:
            raise ValueError("Invalid file manifest")
    if not expected or tree(root, cache=cache) != expected:
        raise ValueError("Checked source or web files differ: " + str(root))


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=".analytics-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def compose_invariant(value):
    result = json.loads(json.dumps(value))
    api = result["services"]["api"]
    api.pop("image", None)
    api.pop("build", None)
    env = api.setdefault("environment", {})
    env.pop("COMPOSE_FILE", None)
    env.pop("KHANEYAR_RUNTIME_FILE", None)
    api["volumes"] = [item for item in api.get("volumes", []) if item.get("target") != "/run/khaneyar-management"]
    return result


class Installer:
    def __init__(self, bundle):
        self.bundle = bundle
        self.manifest = json.loads((bundle / "validation.json").read_text(encoding="utf-8"))
        self.journal = {}
        self.backup = None
        self.log = None
        self.quiesced = False
        self.created_restore = None

    def run(self, args, *, data=None, output=None, timeout=120, check=True, cwd=DEPLOY):
        result = subprocess.run(args, input=data, stdout=output or subprocess.PIPE,
                                stderr=self.log or subprocess.PIPE, cwd=cwd, timeout=timeout)
        if check and result.returncode:
            raise RuntimeError("Command failed: " + Path(args[0]).name)
        return result.stdout or b""

    def compose(self, *args, **kwargs):
        return self.run(["docker", "compose", *args], **kwargs)

    def system(self, operation, unit=SERVICE, *, check=True):
        return self.run(["systemctl", operation, unit], check=check)

    def save(self, **values):
        self.journal.update(values)
        atomic(STATE / "journal.json", json.dumps(self.journal, sort_keys=True).encode())

    def container(self, mode, *, running=False, database=None, image=False):
        code = (self.bundle / "analytics-container.py").read_text(encoding="utf-8")
        code += "\ntry:\n main(" + repr(mode) + ",json.loads(" + repr(json.dumps(self.manifest["container"]))
        code += ")," + repr(database) + ")\nexcept Exception:\n raise SystemExit('Container verification or migration failed; private diagnostics withheld.') from None\n"
        if image:
            command = ["docker", "run", "--rm", "--network", "none", "-i", "--entrypoint", "python", IMAGE, "-"]
            return self.run(command, data=code.encode(), timeout=600).decode().strip()
        arguments = ("exec", "-T", "api", "python", "-") if running else (
            "run", "--rm", "--no-deps", "-T", "--entrypoint", "python", "api", "-")
        return self.compose(*arguments, data=code.encode(), timeout=600).decode().strip()

    def config(self):
        return json.loads(self.compose("config", "--format", "json"))

    def prepare_compose(self):
        before = self.config()
        api = before["services"]["api"]
        files = api.get("environment", {}).get("COMPOSE_FILE", "").split(":")
        if files == [""]:
            files = ["docker-compose.yml"]
            if (DEPLOY / "docker-compose.override.yml").is_file():
                files.append("docker-compose.override.yml")
        files = [str((DEPLOY / name).resolve()) for name in files]
        override = DEPLOY / "docker-compose.release.json"
        old = json.loads(override.read_text()) if override.exists() else {}
        target = old.setdefault("services", {}).setdefault("api", {})
        target["image"] = IMAGE
        target["build"] = {"context": str(self.bundle / "api")}
        target.setdefault("environment", {})["KHANEYAR_RUNTIME_FILE"] = "/run/khaneyar-management/runtime.json"
        volumes = target.setdefault("volumes", [])
        def destination(item):
            return item.get("target") if isinstance(item, dict) else item.split(":")[1]
        volumes[:] = [item for item in volumes if destination(item) != "/run/khaneyar-management"]
        volumes.append({"type": "bind", "source": str(DEPLOY / "management"),
                        "target": "/run/khaneyar-management", "read_only": True})
        if str(override) not in files:
            files.append(str(override))
        atomic(override, json.dumps(old).encode())
        atomic(DEPLOY / ".env", (self.backup / "env-before").read_bytes()
               + ("\nCOMPOSE_FILE=" + ":".join(files) + "\n").encode())
        after = self.config()
        if compose_invariant(before) != compose_invariant(after):
            raise ValueError("Unrelated Compose configuration changed")
        actual = after["services"]["api"]
        mounts = [item for item in actual.get("volumes", []) if item.get("target") == "/run/khaneyar-management"]
        if (actual.get("image") != IMAGE or len(mounts) != 1 or mounts[0].get("read_only") is not True
                or Path(mounts[0]["source"]) != DEPLOY / "management"
                or actual["environment"].get("KHANEYAR_RUNTIME_FILE") != "/run/khaneyar-management/runtime.json"):
            raise ValueError("Runtime mount or API image differs")
        self.save(env_after_sha256=digest(DEPLOY / ".env"), compose_after_sha256=digest(override))

    def snapshot_identity(self, state_dir):
        path = state_dir / "management.sqlite3"
        with contextlib.closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as connection:
            if connection.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0]:
                raise ValueError("A management operation is pending; finish it before upgrading")
            values = [connection.execute("SELECT * FROM " + table + " ORDER BY 1").fetchall()
                      for table in ("accounts", "metadata")]
        return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()

    def preflight(self):
        if (self.manifest.get("tag"), self.manifest.get("management_version")) != ("management-v0.3.0-r1", "0.3.0"):
            raise ValueError("Unexpected release")
        verify_tree(self.bundle, self.manifest["files_sha256"] | {"validation.json": digest(self.bundle / "validation.json")})
        for path in (BASE, DEPLOY, CONFIG, STATE, BACKUPS, PWA, BASE / "source", BASE / "web",
                     DEPLOY / ".env", DEPLOY / "docker-compose.release.json", DEPLOY / "management"):
            if path.is_symlink() or any(p.is_symlink() for p in path.parents):
                raise ValueError("Linked installation path")
        config = json.loads(CONFIG.read_text())
        if (config.get("mode"), config.get("origin"), config.get("web_root")) != (
                "production", "https://supp.khaanehyar.ir", str(BASE / "web")):
            raise ValueError("Unexpected management configuration")
        state_dir = Path(config.get("state_dir", "/var/lib/khaneyar-management"))
        if state_dir != Path("/var/lib/khaneyar-management") or state_dir.is_symlink():
            raise ValueError("Unexpected management identity path")
        if json.loads((PWA / "version.json").read_text()).get("version") != "0.12.0":
            raise ValueError("Expected the installed PWA 0.12.0")
        self.cfg, self.state_dir = config, state_dir
        runtime = DEPLOY / "management/runtime.json"
        if runtime.is_symlink() or not runtime.is_file() or runtime.stat().st_size > 4096 or not runtime.stat().st_mode & 0o004:
            raise ValueError("Existing runtime settings are missing, linked or unreadable by the API")
        flags = json.loads(runtime.read_text())
        policy = runpy.run_path(str(self.bundle / "source/backend/app/core/feature_policy.py"))
        if not isinstance(flags, dict) or any(not (
                key in {"maintenance", "registration_enabled", "assistant_enabled"} and type(value) is bool
                or key in policy["FEATURE_KEYS"] and value in policy["FEATURE_STATES"])
                for key, value in flags.items()):
            raise ValueError("Existing runtime policy is not supported; it was preserved")
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        journal = STATE / "journal.json"
        if journal.is_file():
            self.journal = json.loads(journal.read_text())
            if self.journal["manifest_sha256"] != digest(self.bundle / "validation.json"):
                raise ValueError("A different release owns the retained journal")
            self.backup = Path(self.journal["backup"])
            if self.backup.parent != BACKUPS or not self.backup.is_dir() or self.backup.is_symlink():
                raise ValueError("Invalid retained backup path")
            if not self.journal.get("activated"):
                raise ValueError("An incomplete pre-activation attempt exists; inspect its private log before retrying")
        else:
            self.system("is-active")
            if json.loads((BASE / "web/version.json").read_text()).get("version") != "0.2.0":
                raise ValueError("Expected management 0.2.0")
            for name, expected in self.manifest["management_baseline_sha256"].items():
                p = BASE / "source" / name
                if p.is_symlink() or hashlib.sha256(p.read_bytes().replace(b"\r\n", b"\n")).hexdigest() != expected:
                    raise ValueError("Existing management source differs: " + name)
            if self.container("source", running=True) != "BASELINE" or self.container("database", running=True) != OLD_REVISION:
                raise ValueError("API source or schema does not match the supported baseline")
            self.snapshot_identity(state_dir)
            BACKUPS.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.backup = Path(tempfile.mkdtemp(prefix="before-0.3.0-", dir=BACKUPS))
            self.save(manifest_sha256=digest(self.bundle / "validation.json"), backup=str(self.backup),
                      pwa_sha256=tree(PWA), config_sha256=digest(CONFIG), phase="preflight")
        self.log = (self.backup / "install.log").open("ab", buffering=0)

    def stage(self):
        for kind, hashes in (("source", self.manifest["management_source_sha256"]),
                             ("web", self.manifest["web_sha256"])):
            stage = BASE / (".analytics-0.3.0-" + kind + "-next")
            if stage.exists():
                raise ValueError("An existing staging directory was preserved")
            shutil.copytree(self.bundle / kind, stage)
            expected = dict(hashes)
            if kind == "web":
                for path in (BASE / "web/assets").rglob("*"):
                    if path.is_symlink():
                        raise ValueError("Linked management asset")
                    if path.is_file():
                        name = path.relative_to(BASE / "web").as_posix()
                        if name in expected:
                            if digest(path) != expected[name]:
                                raise ValueError("Conflicting static asset")
                        else:
                            target = stage / name
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copyfile(path, target)
                            expected[name] = digest(path)
                self.save(web_with_retained_sha256=expected)
            for path in [stage, *stage.rglob("*")]:
                path.chmod(0o755 if path.is_dir() else 0o644)
            verify_tree(stage, expected)

    def backup_and_migrate(self):
        print("2/5 Pausing API/management and saving private backups...", flush=True)
        self.system("stop")
        self.quiesced = True
        self.compose("stop", "api")
        self.save(identity_sha256=self.snapshot_identity(self.state_dir))
        shutil.copytree(self.state_dir, self.backup / "management-state")
        shutil.copyfile(CONFIG, self.backup / "management-config.json")
        shutil.copytree(BASE / "source", self.backup / "management-source")
        shutil.copytree(BASE / "web", self.backup / "management-web")
        shutil.copyfile(DEPLOY / ".env", self.backup / "env-before")
        override = DEPLOY / "docker-compose.release.json"
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
                                    stdin=stream, stdout=self.log, stderr=self.log, cwd=DEPLOY, timeout=1800)
        if result.returncode or self.container("migrate", database=restore) != "MIGRATED":
            raise ValueError("Backup restore and migration rehearsal failed")
        self.drop_restore()
        print("3/5 Backup restore verified; applying additive migrations 0038/0039...", flush=True)
        if self.container("migrate") != "MIGRATED":
            raise ValueError("Migration was not committed")
        self.save(phase="migrated")

    def drop_restore(self):
        if self.created_restore:
            self.compose("exec", "-T", "db", "sh", "-c", 'exec dropdb -U "$POSTGRES_USER" "$1"',
                         "_", self.created_restore)
            self.created_restore = None

    def swap(self):
        for kind in ("source", "web"):
            previous = BASE / (".analytics-0.3.0-" + kind + "-before")
            if previous.exists():
                raise ValueError("A previous source/web swap exists")
            (BASE / kind).rename(previous)
            (BASE / (".analytics-0.3.0-" + kind + "-next")).rename(BASE / kind)

    def probe(self):
        origin = self.cfg["origin"]
        host = urlsplit(origin).netloc
        for attempt in range(30):
            try:
                with urlopen("http://127.0.0.1:8000/api/v1/healthz", timeout=2) as response:
                    value = json.load(response)
                if value.get("status") != "ok" or value.get("feature_controls") != "v1" or value.get("ai_controls") != "v1":
                    raise ValueError("API controls are not active")
                for path in ("/management/version.json", "/management/api/session"):
                    with urlopen(Request("http://127.0.0.1:5710" + path, headers={"Host": host}), timeout=2) as response:
                        value = json.load(response)
                    if path.endswith("version.json"):
                        if value.get("version") != "0.3.0":
                            raise ValueError("Management web version differs")
                    elif value.get("mode") != "production" or value.get("authenticated") is not False:
                        raise ValueError("Management session isolation differs")
                break
            except (OSError, ValueError):
                if attempt == 29:
                    raise ValueError("New services did not become healthy") from None
                time.sleep(1)
        for path in ("/management/api/state/analytics", "/management/api/state/ai-analytics"):
            try:
                urlopen(Request("http://127.0.0.1:5710" + path, headers={"Host": host}), timeout=3).close()
            except HTTPError as error:
                error.close()
                if error.code == 401:
                    continue
                raise
            raise ValueError("An anonymous analytics request was accepted")
        result = json.loads(self.run(["/usr/local/sbin/khaneyar-management-worker"], data=json.dumps({
            "method": "read", "section": "ai-analytics", "arguments": {"days": 7}}).encode()))
        if not result.get("ok") or not result["data"].get("available"):
            raise ValueError("Independent AI report is unavailable")
        if self.snapshot_identity(self.state_dir) != self.journal["identity_sha256"]:
            raise ValueError("Management accounts or TOTP metadata changed")
        if digest(CONFIG) != self.journal["config_sha256"] or tree(PWA) != self.journal["pwa_sha256"]:
            raise ValueError("Management configuration or PWA changed")

    def restore_before_activation(self):
        for kind in ("source", "web"):
            old = BASE / (".analytics-0.3.0-" + kind + "-before")
            current = BASE / kind
            if old.exists():
                if current.exists():
                    current.rename(BASE / (".analytics-0.3.0-" + kind + "-failed-" + os.urandom(4).hex()))
                old.rename(current)
        if (self.backup / "env-before").exists():
            atomic(DEPLOY / ".env", (self.backup / "env-before").read_bytes())
            override = DEPLOY / "docker-compose.release.json"
            if self.journal.get("had_override"):
                atomic(override, (self.backup / "compose-before.json").read_bytes())
            elif override.exists():
                override.unlink()
        self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "api")
        self.system("start")

    def apply(self):
        self.preflight()
        try:
            if not self.journal.get("activated"):
                print("1/5 Verifying baseline and building from the installed API image (no dependency downloads)...", flush=True)
                container_id = self.compose("ps", "-q", "api").decode().strip()
                image_id = self.run(["docker", "inspect", "--format", "{{.Image}}", container_id]).decode().strip()
                self.save(previous_image=image_id)
                baseline_tag = "khaneyar-api:analytics-0.3.0-baseline"
                self.run(["docker", "image", "tag", image_id, baseline_tag])
                self.run(["docker", "build", "--pull=false", "--network=none", "--build-arg", "KHANEYAR_BASE=" + baseline_tag,
                          "-t", IMAGE, str(self.bundle / "api")], output=self.log, timeout=600)
                if self.container("image", image=True) != "VERIFIED":
                    raise ValueError("New image verification failed")
                self.stage()
                self.backup_and_migrate()
                self.swap()
                self.save(activated=True, phase="activated")
            else:
                self.quiesced = True
                if digest(DEPLOY / ".env") != self.journal["env_after_sha256"] or digest(DEPLOY / "docker-compose.release.json") != self.journal["compose_after_sha256"]:
                    raise ValueError("Activated deployment configuration changed; inspect before resuming")
                verify_tree(BASE / "source", self.manifest["management_source_sha256"], cache=True)
                verify_tree(BASE / "web", self.journal["web_with_retained_sha256"])
                if self.container("source") != "NEW" or self.container("database") != "0039":
                    raise ValueError("Activated source or schema differs")
                self.quiesced = True
            print("4/5 Starting checked API and management...", flush=True)
            self.compose("up", "-d", "--no-deps", "--no-build", "--pull", "never", "api")
            self.system("start")
            self.probe()
            self.save(phase="completed")
            print("5/5 UPGRADE COMPLETE: management 0.3.0; database 0039; PWA 0.12.0 preserved.", flush=True)
            print("Password, TOTP and existing management accounts preserved. Backup: " + str(self.backup), flush=True)
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
                    print("MAINTENANCE: activation began. API/management left OFF; no database downgrade or restore. Rerun the same verified installer.", flush=True)
                else:
                    try:
                        self.restore_before_activation()
                        self.save(phase="failed-before-activation")
                        print("Previous API and management restored. Additive schema and all history retained.", flush=True)
                    except Exception:
                        with contextlib.suppress(Exception):
                            self.compose("stop", "api")
                        with contextlib.suppress(Exception):
                            self.system("stop")
                        print("MAINTENANCE: previous services could not be verified; inspect the private backup log.", flush=True)
            if self.backup:
                print("Private backup/log: " + str(self.backup), flush=True)
            raise
        finally:
            if self.log:
                self.log.close()


def main():
    import fcntl

    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise SystemExit("Run as root: python3 upgrade-analytics.py EXTRACTED_BUNDLE")
    os.umask(0o077)
    bundle = Path(sys.argv[1]).resolve(strict=True)
    with contextlib.ExitStack() as stack:
        for path in (Path("/var/lock/khaneyar-release.lock"), BASE / ".web-upgrade.lock",
                     Path("/var/backups/khaneyar/management/.operation.lock")):
            stream = stack.enter_context(path.open("a"))
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        Installer(bundle).apply()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Upgrade stopped. No private settings printed; see the protected install log, if created.") from None
