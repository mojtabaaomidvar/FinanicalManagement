"""Finite host operations. Only the root-owned worker imports this module in production."""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen

from app.management.contracts import ENV_KEYS, SECRET_KEYS, Config, ManagementError, Operation

DOCKER = "/usr/bin/docker"
SYSTEMCTL = "/usr/bin/systemctl"
PSQL = 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"'
PG_DUMP = 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
PG_RESTORE = (
    "exec pg_restore --clean --if-exists --exit-on-error --single-transaction "
    '--no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
)
REPOSITORY = "mojtabaaomidvar/FinanicalManagement"
MAX_ARCHIVE_BYTES = 2 * 1024**3


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def atomic_write(path: Path, data: bytes, mode: int = 0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, name = tempfile.mkstemp(prefix=".management-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def safe_extract(archive: Path, target: Path, *, limit: int = MAX_ARCHIVE_BYTES * 3):
    """Reject links, special files, duplicate names and traversal before writing any member."""
    with tarfile.open(archive) as source:
        members = []
        seen = set()
        total = 0
        for member in source:
            if len(members) >= 100000:
                raise ManagementError("INVALID_ARCHIVE", "آرشیو بیش از حد بزرگ است.", 422)
            path = PurePosixPath(member.name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or "\\" in member.name
                or ":" in member.name
                or path.as_posix() in seen
                or not (member.isfile() or member.isdir())
            ):
                raise ManagementError(
                    "INVALID_ARCHIVE", "مسیرها یا نوع فایل‌های آرشیو معتبر نیست.", 422
                )
            seen.add(path.as_posix())
            members.append(member)
            total += member.size
            if total > limit:
                raise ManagementError(
                    "INVALID_ARCHIVE", "حجم بازشدهٔ آرشیو بیش از حد مجاز است.", 422
                )
        source.extractall(target, members=members, filter="data")


class Host:
    def __init__(self, config: Config):
        self.config = config
        self.deploy = config.deploy_dir
        self.runtime = self.deploy / "management" / "runtime.json"

    def run(
        self,
        args: list[str],
        *,
        data: bytes | None = None,
        timeout: int = 45,
        output=None,
        allow_failure: bool = False,
    ) -> bytes:
        result = subprocess.run(  # noqa: S603 -- argv is built only by the finite operation handlers below
            args,
            input=data,
            stdout=output or subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self.deploy,
            timeout=timeout,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root", "LANG": "C.UTF-8"},
            check=False,
        )
        if result.returncode and not allow_failure:
            # Raw command errors may include SQL, env values or user content.
            raise ManagementError(
                "COMMAND_FAILED",
                "اجرای فرمان سرویس موفق نبود؛ وضعیت سرویس و لاگ پالایش‌شده را بررسی کنید.",
                409,
            )
        return result.stdout or b""

    def compose(self, *args, **kwargs):
        return self.run([DOCKER, "compose", *args], **kwargs)

    def sql(self, statement: str, parameters: dict[str, str] | None = None) -> str:
        arguments = ["--set=" + key + "=" + value for key, value in (parameters or {}).items()]
        return (
            self.compose(
                "exec",
                "-T",
                "db",
                "sh",
                "-c",
                PSQL,
                "management-psql",
                *arguments,
                data=statement.encode(),
                timeout=30,
            )
            .decode()
            .strip()
        )

    def env(self) -> dict[str, str]:
        # Values accepted by the management editor are a safe dotenv subset.
        result = {}
        for line in (self.deploy / ".env").read_text(encoding="utf-8").splitlines():
            if line.lstrip().startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip().strip("\"'")
        return result

    def redact(self, text: str) -> str:
        for key, value in self.env().items():
            if len(value) >= 4 and any(
                word in key for word in ("SECRET", "KEY", "TOKEN", "PASSWORD", "DATABASE_URL")
            ):
                text = text.replace(value, "[redacted]")
        text = re.sub(
            r"(?i)(bearer\s+|(?:password|token|secret|api[_-]?key)[\s=:]+)[^\s,;]+",
            r"\1[redacted]",
            text,
        )
        text = re.sub(r"(?<!\d)(?:\+98|0)9\d{9}(?!\d)", "[phone]", text)
        text = re.sub(r"\b[0-9a-fA-F]{48,}\b", "[redacted]", text)
        text = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", text)
        return text[-100000:]

    def revision(self) -> str:
        hasher = hashlib.sha256()
        for path in (self.deploy / ".env", self.runtime):
            hasher.update(path.read_bytes() if path.exists() else b"")
        hasher.update(
            self.sql(
                "SELECT dev_mode::text || ':' || otp_enabled::text FROM app_settings WHERE id=1;"
            ).encode()
        )
        return hasher.hexdigest()

    def services(self):
        output = self.compose("ps", "--all", "--format", "json").decode().strip()
        rows = (
            json.loads(output)
            if output.startswith("[")
            else [json.loads(line) for line in output.splitlines() if line]
        )
        by_name = {row.get("Service"): row for row in rows}
        result = [
            {
                "id": name,
                "state": by_name.get(name, {}).get("State", "missing"),
                "health": by_name.get(name, {}).get("Health", ""),
                "image": by_name.get(name, {}).get("Image", ""),
            }
            for name in ("api", "db")
        ]
        state = self.run([SYSTEMCTL, "is-active", "nginx"], allow_failure=True).decode().strip()
        result.append({"id": "nginx", "state": state or "unknown", "health": "", "image": ""})
        return result

    def read(self, section: str, arguments: dict):
        if section == "analytics":
            from app.management.analytics import read_analytics

            return read_analytics(self.sql, arguments.get("days", 30))
        if section == "services":
            return {"items": self.services()}
        if section == "overview":
            memory = {}
            for line in Path("/proc/meminfo").read_text().splitlines():
                key, value = line.split(":", 1)
                memory[key] = int(value.strip().split()[0]) * 1024
            disk = shutil.disk_usage(self.deploy)
            probe = "unavailable"
            version = ""
            try:
                with urlopen("http://127.0.0.1:8000/api/v1/healthz", timeout=3) as response:
                    version = str(json.load(response).get("version", ""))[:64]
                    probe = "available"
            except Exception:
                probe = "unavailable"
            try:
                database = "available" if self.sql("SELECT 1;") == "1" else "unavailable"
            except ManagementError:
                database = "unavailable"
            try:
                services = self.services()
            except ManagementError:
                services = []
            return {
                "api": probe,
                "database": database,
                "version": version,
                "cpu_load": os.getloadavg()[0],
                "cpu_cores": os.cpu_count() or 1,
                "memory_total": memory["MemTotal"],
                "memory_used": memory["MemTotal"] - memory["MemAvailable"],
                "disk_total": disk.total,
                "disk_used": disk.used,
                "uptime_seconds": float(Path("/proc/uptime").read_text().split()[0]),
                "services": services,
                "checked_at": time.time(),
            }
        if section == "users":
            search = str(arguments.get("search", "")).strip()
            offset = int(arguments.get("offset", 0))
            if (
                not 0 <= offset <= 1000000
                or len(search) > 64
                or (search and not re.fullmatch(r"[a-fA-F0-9+-]{6,64}", search))
            ):
                raise ManagementError(
                    "INVALID_SEARCH", "کد پشتیبانی یا شمارهٔ جست‌وجو معتبر نیست.", 422
                )
            query = """SELECT coalesce(json_agg(t), '[]'::json) FROM (
                SELECT support_code::text AS id, role, membership_state AS state,
                    CASE WHEN phone IS NULL THEN ''
                        ELSE left(phone,4)||'***'||right(phone,2) END AS phone,
                    created_at::text AS created_at, support_last_login_at::text AS last_login
                FROM members WHERE (:'search'='' OR support_code::text=:'search' OR phone=:'search')
                ORDER BY created_at DESC,id LIMIT 25 OFFSET :'offset'::int) t;"""
            total = self.sql(
                "SELECT count(*) FROM members WHERE "
                "(:'search'='' OR support_code::text=:'search' OR phone=:'search');",
                {"search": search},
            )
            return {
                "items": json.loads(self.sql(query, {"search": search, "offset": str(offset)})),
                "total": int(total),
                "offset": offset,
            }
        if section == "settings":
            env = self.env()
            flags = json.loads(self.runtime.read_text()) if self.runtime.exists() else {}
            flags.update(
                {"otp_enabled": self.sql("SELECT otp_enabled FROM app_settings WHERE id=1;") == "t"}
            )
            return {
                "flags": {
                    "maintenance": False,
                    "registration_enabled": True,
                    "assistant_enabled": True,
                    **flags,
                },
                "runtime_supported": self.runtime_supported(),
                "environment": {
                    key: bool(env.get(key)) if key in SECRET_KEYS else env.get(key, "")
                    for key in sorted(ENV_KEYS)
                },
                "revision": self.revision(),
            }
        if section == "backups":
            items = []
            self.config.backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            for path in sorted(self.config.backup_dir.glob("*/manifest.json"), reverse=True):
                try:
                    manifest = json.loads(path.read_text())
                    items.append(
                        {key: manifest[key] for key in ("id", "created_at", "image", "bytes")}
                    )
                except (ValueError, KeyError):
                    continue
            enabled = (
                self.run(
                    [SYSTEMCTL, "is-enabled", "khaneyar-management-backup.timer"],
                    allow_failure=True,
                )
                .decode()
                .strip()
                == "enabled"
            )
            return {"items": items[:100], "scheduled": enabled}
        if section == "releases":
            self.config.release_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            items = []
            for path in sorted(self.config.release_dir.glob("v*/verified.json"), reverse=True):
                item = json.loads(path.read_text())
                items.append({key: item[key] for key in ("tag", "sha256", "fetched_at")})
            return {"items": items}
        if section == "logs":
            target = arguments.get("target", "api")
            if target in {"api", "db"}:
                raw = self.compose("logs", "--no-color", "--tail", "150", target)
            elif target == "nginx":
                raw = self.run(
                    [
                        "/usr/bin/journalctl",
                        "-u",
                        "nginx",
                        "-n",
                        "150",
                        "--no-pager",
                        "--output=short-iso",
                    ]
                )
            else:
                raise ManagementError("INVALID_TARGET", "سرویس انتخاب‌شده معتبر نیست.", 422)
            return {"text": self.redact(raw.decode(errors="replace")), "target": target}
        raise ManagementError("INVALID_SECTION", "بخش مدیریت پیدا نشد.", 404)

    def prepare(self, operation: Operation) -> Operation:
        if operation.kind == "settings.update":
            operation = operation.model_copy(update={"expected": self.revision()})
        if operation.kind in {"backup.restore", "backup.verify"}:
            path, _ = self.verify_backup(operation.target)
            operation = operation.model_copy(update={"expected": digest(path / "manifest.json")})
        if operation.kind == "release.install":
            path = self.release_path(operation.target)
            self.verify_release(path)
            operation = operation.model_copy(update={"expected": digest(path / "verified.json")})
        if operation.kind.startswith("user."):
            state = self.sql(
                "SELECT membership_state FROM members WHERE support_code=:'reference'::uuid;",
                {"reference": operation.target},
            )
            if not state:
                raise ManagementError("NOT_FOUND", "کاربر پیدا نشد.", 404)
            operation = operation.model_copy(
                update={"expected": hashlib.sha256(state.encode()).hexdigest()}
            )
        return operation

    def apply(self, operation: Operation) -> dict:
        kind = operation.kind
        if kind.startswith("service."):
            action = kind.split(".")[1]
            if operation.target == "db" and action in {"stop", "restart"}:
                self.compose("stop", "api", timeout=90)
            self.compose(action, operation.target, timeout=120)
            # A database restart also starts the API; an explicit stop leaves both stopped.
            if operation.target == "db" and action == "restart":
                self.check_database()
                self.compose("start", "api", timeout=120)
                self.check_api()
            elif action in {"start", "restart"}:
                self.check_api() if operation.target == "api" else self.check_database()
            return {"services": self.services()}
        if kind == "nginx.reload":
            self.run(["/usr/sbin/nginx", "-t"])
            self.run([SYSTEMCTL, "reload", "nginx"])
        elif kind == "certificate.renew":
            self.run(["/usr/bin/certbot", "renew", "--quiet"], timeout=900)
            self.run(["/usr/sbin/nginx", "-t"])
            self.run([SYSTEMCTL, "reload", "nginx"])
        elif kind == "host.reboot":
            self.run(["/usr/sbin/shutdown", "-r", "+1"])
        elif kind == "host.cancel_reboot":
            self.run(["/usr/sbin/shutdown", "-c"])
        elif kind == "backup.create":
            return self.backup()
        elif kind == "backup.verify":
            _, manifest = self.verify_backup(operation.target)
            return {"backup_id": manifest["id"], "verified": True}
        elif kind == "backup.restore":
            return self.restore(operation)
        elif kind == "backup.schedule":
            self.run(
                [
                    SYSTEMCTL,
                    "enable" if operation.values["enabled"] else "disable",
                    "--now",
                    "khaneyar-management-backup.timer",
                ]
            )
        elif kind == "settings.update":
            return self.update_settings(operation)
        elif kind.startswith("user."):
            return self.update_user(operation)
        elif kind == "release.fetch":
            return self.fetch_release(operation.target)
        elif kind == "release.install":
            return self.install_release(operation)
        return {"completed": True}

    def image(self) -> str:
        identifier = self.compose("ps", "--all", "-q", "api").decode().strip()
        if not re.fullmatch(r"[a-f0-9]{12,64}", identifier):
            raise ManagementError("API_MISSING", "کانتینر برنامه برای پشتیبان‌گیری پیدا نشد.", 409)
        image = self.run([DOCKER, "inspect", "--format", "{{.Image}}", identifier]).decode().strip()
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
            raise ManagementError("INVALID_IMAGE", "شناسهٔ تصویر برنامه معتبر نیست.", 409)
        return image

    def application_role(self):
        from urllib.parse import unquote, urlsplit

        name = unquote(urlsplit(self.env().get("DATABASE_URL", "")).username or "")
        if not name:
            raise ManagementError(
                "ROLE_UNAVAILABLE", "نقش اتصال برنامه برای پشتیبان‌گیری مشخص نیست.", 409
            )
        raw = self.sql(
            """SELECT json_build_object('name',rolname,'password',rolpassword,
            'superuser',rolsuper,'bypass',rolbypassrls)::text
            FROM pg_authid WHERE rolname=:'role';""",
            {"role": name},
        )
        role = json.loads(raw) if raw else {}
        if (
            role.get("superuser") is not False
            or role.get("bypass") is not False
            or not str(role.get("password", "")).startswith(("SCRAM-SHA-256$", "md5"))
        ):
            raise ManagementError(
                "ROLE_UNSAFE",
                "نقش برنامه باید محدود و دارای رمز اتصال معتبر باشد؛ پشتیبان‌گیری متوقف شد.",
                409,
            )
        return role

    def backup(self, *, resume: bool = True) -> dict:
        backup_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + secrets.token_hex(4)
        root = self.config.backup_dir
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = root / (".partial-" + backup_id)
        path.mkdir(mode=0o700)
        was_running = any(
            row["id"] == "api" and row["state"] == "running" for row in self.services()
        )
        image = self.image()
        environment = self.env()
        if environment.get("STORAGE_ENDPOINT") and environment.get("STORAGE_BUCKET"):
            raise ManagementError(
                "EXTERNAL_STORAGE",
                "برای پشتیبان کاملِ فضای ذخیره‌سازی بیرونی، "
                "ابتدا اتصال پشتیبان همان مخزن را آماده کنید.",
                409,
            )
        # Require room for uploaded files, web, image and a conservative database allowance.
        estimate = sum(
            p.stat().st_size
            for directory in (self.deploy / "uploads", self.config.web_dir)
            if directory.exists()
            for p in directory.rglob("*")
            if p.is_file()
        )
        if shutil.disk_usage(root).free < estimate * 2 + 512 * 1024**2:
            raise ManagementError("DISK_SPACE", "فضای آزاد برای ساخت پشتیبان کافی نیست.", 409)
        self.compose("stop", "api", timeout=90)
        try:
            atomic_write(
                path / "application-role.json", json.dumps(self.application_role()).encode()
            )
            with (path / "database.dump").open("wb") as output:
                self.compose("exec", "-T", "db", "sh", "-c", PG_DUMP, output=output, timeout=900)
            if (path / "database.dump").stat().st_size < 10:
                raise ManagementError("BACKUP_FAILED", "فایل پشتیبان دیتابیس کامل نیست.", 409)
            self.run(
                [DOCKER, "image", "save", "-o", str(path / "api-image.tar"), image], timeout=900
            )
            with tarfile.open(path / "files.tar.gz", "w:gz", dereference=False) as archive:
                names = {
                    ".env",
                    "docker-compose.yml",
                    "docker-compose.override.yml",
                    "docker-compose.release.json",
                    "docker-compose.management.json",
                    "docker-compose.management-image.json",
                    "management/runtime.json",
                }
                for entry in environment.get("COMPOSE_FILE", "docker-compose.yml").split(":"):
                    file = (self.deploy / entry).resolve()
                    if not file.is_relative_to(self.deploy.resolve()):
                        raise ManagementError(
                            "COMPOSE_LOCATION",
                            "فایل ترکیب سرویس‌ها خارج از پوشهٔ استقرار است؛ "
                            "پیش از پشتیبان‌گیری آن را بررسی کنید.",
                            409,
                        )
                    names.add(file.relative_to(self.deploy.resolve()).as_posix())
                for name in sorted(names):
                    source = self.deploy / name
                    if source.is_file():
                        archive.add(source, arcname="config/" + name)
                if (self.deploy / "uploads").is_dir():
                    archive.add(self.deploy / "uploads", arcname="uploads")
                archive.add(self.config.web_dir, arcname="pwa")
            files = {
                name: digest(path / name)
                for name in (
                    "database.dump",
                    "api-image.tar",
                    "files.tar.gz",
                    "application-role.json",
                )
            }
            manifest = {
                "format": 1,
                "id": backup_id,
                "created_at": time.time(),
                "image": image,
                "bytes": sum((path / name).stat().st_size for name in files),
                "files": files,
            }
            atomic_write(path / "manifest.json", json.dumps(manifest).encode())
            path.rename(root / backup_id)
            return {"backup_id": backup_id, "bytes": manifest["bytes"]}
        finally:
            if was_running and resume:
                self.compose("start", "api", timeout=120)

    def verify_backup(self, backup_id: str):
        Operation(kind="backup.verify", target=backup_id)
        path = self.config.backup_dir / backup_id
        if path.is_symlink() or not (path / "manifest.json").is_file():
            raise ManagementError("BACKUP_MISSING", "پشتیبان کامل پیدا نشد.", 404)
        manifest = json.loads((path / "manifest.json").read_text())
        if (
            manifest.get("format") != 1
            or manifest.get("id") != backup_id
            or set(manifest.get("files", {}))
            != {"database.dump", "api-image.tar", "files.tar.gz", "application-role.json"}
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", manifest.get("image", ""))
        ):
            raise ManagementError("BACKUP_INVALID", "ساختار پشتیبان معتبر نیست.", 422)
        for name, expected in manifest["files"].items():
            file = path / name
            if file.is_symlink() or not file.is_file() or digest(file) != expected:
                raise ManagementError(
                    "BACKUP_HASH", "بررسی یکپارچگی پشتیبان ناموفق بود؛ بازیابی انجام نمی‌شود.", 409
                )
        role = json.loads((path / "application-role.json").read_text())
        if (
            not isinstance(role.get("name"), str)
            or not role["name"]
            or role.get("superuser") is not False
            or role.get("bypass") is not False
            or not str(role.get("password", "")).startswith(("SCRAM-SHA-256$", "md5"))
        ):
            raise ManagementError(
                "BACKUP_ROLE", "مشخصات نقش محدود برنامه در پشتیبان معتبر نیست.", 409
            )
        return path, manifest

    def restore(self, operation: Operation):
        path, manifest = self.verify_backup(operation.target)
        if not operation.expected or operation.expected != digest(path / "manifest.json"):
            raise ManagementError(
                "STALE_PLAN", "پشتیبان پس از پیش‌نمایش تغییر کرده است؛ دوباره بررسی کنید.", 409
            )
        with tempfile.TemporaryDirectory(
            prefix="restore-", dir=self.config.backup_dir
        ) as temporary:
            extracted = Path(temporary)
            safe_extract(path / "files.tar.gz", extracted, limit=50 * 1024**3)
            if (
                not (extracted / "config/.env").is_file()
                or not (extracted / "pwa/index.html").is_file()
            ):
                raise ManagementError(
                    "BACKUP_INVALID", "تنظیمات یا فایل‌های وب در پشتیبان کامل نیست.", 409
                )
            self.run([DOCKER, "image", "load", "-i", str(path / "api-image.tar")], timeout=900)
            self.run([DOCKER, "image", "inspect", manifest["image"]])
            safety = self.backup(resume=False)
            self.compose("stop", "api", timeout=90)
            role = json.loads((path / "application-role.json").read_text())
            self.sql(
                r"""SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS', :'role')
                WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'role')
                \gexec
                ALTER ROLE :"role" WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'password';
                """,
                {"role": role["name"], "password": role["password"]},
            )
            # The custom-format dump is restored atomically. A failure leaves the API stopped.
            with (path / "database.dump").open("rb") as stream:
                result = subprocess.run(  # noqa: S603 -- fixed pg_restore command and verified backup stream
                    [DOCKER, "compose", "exec", "-T", "db", "sh", "-c", PG_RESTORE],
                    stdin=stream,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    cwd=self.deploy,
                    timeout=1800,
                    check=False,
                )
            if result.returncode:
                raise ManagementError(
                    "RESTORE_FAILED",
                    "بازیابی دیتابیس موفق نبود؛ "
                    "برنامه متوقف مانده و پشتیبان پیش از بازیابی محفوظ است.",
                    409,
                )
            # Keep previous directories until the new API passes its health check.
            retained = self.config.backup_dir / safety["backup_id"]
            for source, target, name in (
                (extracted / "pwa", self.config.web_dir, "web-before-restore"),
                (extracted / "uploads", self.deploy / "uploads", "uploads-before-restore"),
            ):
                if target.exists():
                    shutil.move(str(target), str(retained / name))
                if source.exists():
                    shutil.copytree(source, target)
            for source in (extracted / "config").rglob("*"):
                if source.is_file():
                    relative = source.relative_to(extracted / "config")
                    atomic_write(
                        self.deploy / relative,
                        source.read_bytes(),
                        0o644 if relative.as_posix() == "management/runtime.json" else 0o600,
                    )
            uploads = self.deploy / "uploads"
            if uploads.exists():
                for target in [uploads, *uploads.rglob("*")]:
                    os.chown(target, 10001, 10001)
            self.pin_image(manifest["image"])
            self.compose(
                "up", "-d", "--no-deps", "--no-build", "--pull", "never", "api", timeout=120
            )
            self.check_api()
            return {"restored": operation.target, "safety_backup": safety["backup_id"]}

    def pin_image(self, image: str):
        override = self.deploy / "docker-compose.management-image.json"
        atomic_write(override, json.dumps({"services": {"api": {"image": image}}}).encode())
        files = self.env().get("COMPOSE_FILE", "docker-compose.yml").split(":")
        if str(override) not in files:
            files.append(str(override))
        self.write_env({"COMPOSE_FILE": ":".join(files)})

    def check_api(self):
        for _ in range(20):
            try:
                with urlopen("http://127.0.0.1:8000/api/v1/auth/config", timeout=2) as response:
                    if response.status == 200:
                        return
            except Exception:
                time.sleep(2)
                continue
            time.sleep(2)
        raise ManagementError(
            "HEALTH_FAILED",
            "بررسی سلامت برنامه موفق نبود؛ پشتیبان و جزئیات عملیات را بررسی کنید.",
            409,
        )

    def check_database(self):
        for _ in range(20):
            try:
                if self.sql("SELECT 1;") == "1":
                    return
            except ManagementError:
                time.sleep(2)
        raise ManagementError(
            "DATABASE_HEALTH",
            "دیتابیس پس از راه‌اندازی آماده نشد؛ برنامه را متوقف نگه دارید و لاگ را بررسی کنید.",
            409,
        )

    def runtime_supported(self):
        try:
            with urlopen("http://127.0.0.1:8000/api/v1/healthz", timeout=3) as response:
                return json.load(response).get("managed_runtime") == "v1"
        except Exception:
            return False

    def write_env(self, updates: dict[str, str]):
        path = self.deploy / ".env"
        before = path.read_text(encoding="utf-8")
        lines = [
            line for line in before.splitlines() if line.partition("=")[0].strip() not in updates
        ]
        lines.extend(key + "=" + value for key, value in updates.items())
        atomic_write(path, ("\n".join(lines) + "\n").encode())

    def update_settings(self, operation: Operation):
        if not operation.expected or self.revision() != operation.expected:
            raise ManagementError(
                "STALE_PLAN", "تنظیمات هم‌زمان تغییر کرده است؛ پیش‌نمایش تازه بگیرید.", 409
            )
        values = operation.values
        if (
            any(
                key in values
                for key in {"maintenance", "registration_enabled", "assistant_enabled"}
            )
            and not self.runtime_supported()
        ):
            raise ManagementError(
                "RUNTIME_UPGRADE_REQUIRED",
                "نسخهٔ فعلی برنامه کنترل‌های مدیریت را پشتیبانی نمی‌کند؛ "
                "ابتدا نسخهٔ سازگار را نصب و اتصال تنظیمات را فعال کنید.",
                409,
            )
        merged = {**self.env(), **{key: value for key, value in values.items() if key in ENV_KEYS}}
        if values.get("otp_enabled") and not (
            merged.get("SMS_PROVIDER") == "kavenegar" and merged.get("SMS_API_KEY")
        ):
            raise ManagementError(
                "SMS_NOT_CONFIGURED", "پیش از فعال‌کردن کد ورود، درگاه پیامک را تنظیم کنید.", 409
            )
        old_env = (self.deploy / ".env").read_bytes()
        old_runtime = self.runtime.read_bytes() if self.runtime.exists() else b"{}"
        old_otp = self.sql("SELECT otp_enabled FROM app_settings WHERE id=1;")
        try:
            updates = {key: str(value) for key, value in values.items() if key in ENV_KEYS}
            if updates:
                self.write_env(updates)
            flags = json.loads(old_runtime)
            flags.update(
                {
                    key: value
                    for key, value in values.items()
                    if key in {"maintenance", "registration_enabled", "assistant_enabled"}
                }
            )
            atomic_write(self.runtime, json.dumps(flags).encode(), 0o644)
            if "otp_enabled" in values:
                self.sql(
                    "UPDATE app_settings SET otp_enabled=:'enabled'::boolean WHERE id=1;",
                    {"enabled": "true" if values["otp_enabled"] else "false"},
                )
            if updates:
                self.compose(
                    "up", "-d", "--no-deps", "--force-recreate", "--no-build", "api", timeout=120
                )
                self.check_api()
        except Exception:
            atomic_write(self.deploy / ".env", old_env)
            atomic_write(self.runtime, old_runtime, 0o644)
            self.sql(
                "UPDATE app_settings SET otp_enabled=:'enabled'::boolean WHERE id=1;",
                {"enabled": "true" if old_otp == "t" else "false"},
            )
            if any(key in ENV_KEYS for key in values):
                self.compose(
                    "up", "-d", "--no-deps", "--force-recreate", "--no-build", "api", timeout=120
                )
            raise
        return {"updated": sorted(values)}

    def update_user(self, operation: Operation):
        # UUID is validated by the shared contract; SQL shape is fixed.
        reference = operation.target
        state = self.sql(
            "SELECT membership_state FROM members WHERE support_code=:'reference'::uuid;",
            {"reference": reference},
        )
        if (
            not operation.expected
            or hashlib.sha256(state.encode()).hexdigest() != operation.expected
        ):
            raise ManagementError(
                "STALE_PLAN", "وضعیت کاربر تغییر کرده است؛ دوباره بررسی کنید.", 409
            )
        action = operation.kind
        if (
            action == "user.suspend"
            and state != "active"
            or action == "user.activate"
            and state != "suspended"
        ):
            raise ManagementError("INVALID_STATE", "این تغییر برای وضعیت فعلی حساب مجاز نیست.", 409)
        parameters = {"reference": reference, "previous": state}
        if action != "user.revoke_sessions":
            parameters["next_state"] = "suspended" if action == "user.suspend" else "active"
            statement = """WITH target AS (
                UPDATE members SET membership_state=:'next_state'
                WHERE support_code=:'reference'::uuid AND membership_state=:'previous' RETURNING id
            ), revoked AS (DELETE FROM sessions WHERE member_id IN (SELECT id FROM target))
            SELECT count(*) FROM target;"""
        else:
            statement = """WITH target AS (
                SELECT id FROM members WHERE support_code=:'reference'::uuid
                AND membership_state=:'previous' FOR UPDATE
            ), revoked AS (DELETE FROM sessions WHERE member_id IN (SELECT id FROM target))
            SELECT count(*) FROM target;"""
        if self.sql(statement, parameters) != "1":
            raise ManagementError(
                "STALE_PLAN", "وضعیت کاربر هم‌زمان تغییر کرده است؛ دوباره بررسی کنید.", 409
            )
        return {"user": reference, "sessions_revoked": True}

    def release_path(self, tag: str) -> Path:
        Operation(kind="release.install", target=tag)
        path = self.config.release_dir / tag
        if path.is_symlink() or not (path / "verified.json").is_file():
            raise ManagementError("RELEASE_MISSING", "بستهٔ بررسی‌شدهٔ این نسخه پیدا نشد.", 404)
        return path

    def verify_release(self, path: Path):
        record = json.loads((path / "verified.json").read_text())
        if digest(path / "release.tar.gz") != record["sha256"]:
            raise ManagementError("RELEASE_HASH", "بستهٔ نسخه پس از دریافت تغییر کرده است.", 409)
        # Extract afresh from the verified archive before every execution.

    def fetch_release(self, tag: str):
        Operation(kind="release.fetch", target=tag)
        root = self.config.release_dir
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if (root / tag).exists():
            raise ManagementError("RELEASE_EXISTS", "این نسخه قبلاً دریافت شده است.", 409)
        request = Request(
            f"https://api.github.com/repos/{REPOSITORY}/releases/tags/{tag}",
            headers={"User-Agent": "KhanehYar-Management", "Accept": "application/vnd.github+json"},
        )
        with urlopen(request, timeout=30) as response:  # noqa: S310 -- fixed HTTPS repository, validated tag
            release = json.loads(response.read(2 * 1024**2))
        assets = release.get("assets", [])
        archives = [asset for asset in assets if asset["name"].endswith((".tar.gz", ".tgz"))]
        if len(archives) != 1 or release.get("draft") or release.get("prerelease"):
            raise ManagementError(
                "RELEASE_FORMAT", "انتشار رسمی باید دقیقاً یک بستهٔ کامل داشته باشد.", 409
            )
        archive = archives[0]
        checksums = [
            asset
            for asset in assets
            if asset["name"]
            in {archive["name"] + ".sha256", "SHA256SUMS", "SHA256SUMS.txt", "checksums.txt"}
        ]
        if not checksums or archive.get("size", MAX_ARCHIVE_BYTES + 1) > MAX_ARCHIVE_BYTES:
            raise ManagementError(
                "RELEASE_CHECKSUM", "فایل بررسی SHA-256 یا حجم مجاز انتشار موجود نیست.", 409
            )

        def asset_stream(asset):
            # Asset source is constrained to this repository, never a browser-supplied URL.
            url = asset["browser_download_url"]
            if not url.startswith(f"https://github.com/{REPOSITORY}/releases/download/{tag}/"):
                raise ManagementError("RELEASE_ORIGIN", "مبدأ فایل انتشار معتبر نیست.", 409)
            return urlopen(  # noqa: S310 -- checked exact HTTPS repository release prefix
                Request(url, headers={"User-Agent": "KhanehYar-Management"}),  # noqa: S310
                timeout=60,
            )

        with asset_stream(checksums[0]) as response:
            text = response.read(65536).decode()
        matches = [
            line.split()[0].lower()
            for line in text.splitlines()
            if re.match(r"^[a-fA-F0-9]{64}(?:\s|$)", line)
            and (len(line.split()) == 1 or line.split()[-1].lstrip("*") == archive["name"])
        ]
        if len(matches) != 1:
            raise ManagementError("RELEASE_CHECKSUM", "هش یکتای بسته در فایل بررسی پیدا نشد.", 409)
        with tempfile.TemporaryDirectory(prefix="fetch-", dir=root) as temporary:
            path = Path(temporary)
            count = 0
            with asset_stream(archive) as response, (path / "release.tar.gz").open("wb") as output:
                while chunk := response.read(1024**2):
                    count += len(chunk)
                    if count > MAX_ARCHIVE_BYTES:
                        raise ManagementError("RELEASE_SIZE", "حجم بسته بیش از حد مجاز است.", 409)
                    output.write(chunk)
            if digest(path / "release.tar.gz") != matches[0]:
                raise ManagementError("RELEASE_HASH", "هش بسته با انتشار رسمی مطابقت ندارد.", 409)
            extracted = path / "checked"
            extracted.mkdir()
            safe_extract(path / "release.tar.gz", extracted)
            self.validate_release_tree(extracted)
            shutil.rmtree(extracted)
            record = {"tag": tag, "sha256": matches[0], "fetched_at": time.time()}
            atomic_write(path / "verified.json", json.dumps(record).encode())
            path.rename(root / tag)
        return record

    @staticmethod
    def validate_release_tree(path: Path):
        for name in (
            "release-tag.txt",
            "pwa/index.html",
            "source/backend/Dockerfile",
            "source/backend/deploy/install-release.sh",
        ):
            if not (path / name).is_file():
                raise ManagementError(
                    "RELEASE_FORMAT", "ساختار بسته با نصب‌کنندهٔ خانه‌یار سازگار نیست.", 409
                )
        tag = (path / "release-tag.txt").read_bytes()
        installer = (path / "source/backend/deploy/install-release.sh").read_bytes()
        if (
            not re.fullmatch(rb"[a-z0-9][a-z0-9._-]*\n", tag)
            or b"\r" in installer
            or installer.startswith(b"\xef\xbb\xbf")
        ):
            raise ManagementError("RELEASE_FORMAT", "قرارداد اجرای نصب‌کننده معتبر نیست.", 409)

    def install_release(self, operation: Operation):
        path = self.release_path(operation.target)
        self.verify_release(path)
        if not operation.expected or digest(path / "verified.json") != operation.expected:
            raise ManagementError(
                "STALE_PLAN", "بسته پس از پیش‌نمایش تغییر کرده است؛ دوباره بررسی کنید.", 409
            )
        installed = path / ("installed-" + secrets.token_hex(6))
        installed.mkdir(mode=0o700)
        safe_extract(path / "release.tar.gz", installed)
        self.validate_release_tree(installed)
        safety = self.backup()
        # Avoid pinning a previous restored image over the official installer's release override.
        files = self.env().get("COMPOSE_FILE", "docker-compose.yml").split(":")
        files = [
            item for item in files if Path(item).name != "docker-compose.management-image.json"
        ]
        self.write_env({"COMPOSE_FILE": ":".join(files)})
        log = path / ("installation-" + str(int(time.time())) + ".log")
        with log.open("wb") as output:
            self.run(
                [
                    "/usr/bin/bash",
                    str(installed / "source/backend/deploy/install-release.sh"),
                    str(installed),
                ],
                timeout=3600,
                output=output,
            )
        self.check_api()
        return {"installed": operation.target, "safety_backup": safety["backup_id"]}

    def export_backup(self, backup_id: str) -> Path:
        path, _ = self.verify_backup(backup_id)
        exports = self.config.state_dir / "exports"
        exports.mkdir(exist_ok=True, mode=0o700)
        if exports.is_symlink():
            raise ManagementError("INVALID_PATH", "مسیر دریافت معتبر نیست.", 409)
        descriptor, name = tempfile.mkstemp(prefix=backup_id + "-", suffix=".tar", dir=exports)
        with os.fdopen(descriptor, "wb") as output:
            with tarfile.open(fileobj=output, mode="w|") as archive:
                for child in path.iterdir():
                    if child.is_file() and not child.is_symlink():
                        archive.add(child, arcname=child.name)
        os.chown(name, self.config.state_dir.stat().st_uid, self.config.state_dir.stat().st_gid)
        os.chmod(name, 0o600)
        return Path(name)


@contextlib.contextmanager
def host_lock(config: Config):
    import fcntl

    path = config.backup_dir / ".operation.lock"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ManagementError(
                "HOST_BUSY", "یک عملیات دیگر روی سرور در حال اجراست.", 409
            ) from exc
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)
