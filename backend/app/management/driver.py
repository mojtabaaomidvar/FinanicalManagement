"""Production uses a fixed privileged helper; demo has isolated persistent sample state."""

from __future__ import annotations

import copy
import hashlib
import json
import secrets
import subprocess
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from app.management.contracts import Config, ManagementError, Operation
from app.management.host import atomic_write


class Driver:
    def __init__(self, config: Config):
        self.config = config

    def call(self, request: dict, timeout=120):
        try:
            result = subprocess.run(  # noqa: S603 -- fixed root-owned helper, no shell or command arguments
                ["/usr/bin/sudo", "-n", str(self.config.helper)],
                input=json.dumps(request).encode(),
                capture_output=True,
                timeout=timeout,
                check=False,
            )
            response = json.loads(result.stdout)
        except Exception as exc:
            raise ManagementError(
                "WORKER_UNAVAILABLE",
                "سرویس عملیات در دسترس نیست؛ نصب و دسترسی راه‌انداز مدیریت را بررسی کنید.",
                503,
            ) from exc
        if not response.get("ok"):
            error = response.get("error", {})
            raise ManagementError(
                error.get("code", "WORKER_FAILED"),
                error.get("message", "اجرای عملیات موفق نبود."),
                error.get("status", 409),
            )
        return response["data"]

    def read(self, section: str, arguments: dict):
        return self.call({"method": "read", "section": section, "arguments": arguments})

    def prepare(self, operation: Operation):
        return Operation.model_validate(
            self.call({"method": "prepare", "operation": operation.model_dump()})
        )

    def apply(self, operation: Operation):
        return self.call({"method": "apply", "operation": operation.model_dump()}, timeout=4000)

    def export_backup(self, backup_id: str):
        Operation(kind="backup.verify", target=backup_id)
        result = self.call({"method": "export", "backup_id": backup_id}, timeout=900)
        path = Path(result["path"])
        if (
            path.parent.resolve() != (self.config.state_dir / "exports").resolve()
            or path.is_symlink()
        ):
            raise ManagementError("INVALID_EXPORT", "مسیر فایل دریافت معتبر نیست.", 409)
        return path


class DemoDriver:
    def __init__(self, config: Config):
        self.config = config
        self.path = config.state_dir / "demo.json"
        self.lock = threading.RLock()
        if not self.path.exists():
            now = time.time()
            state = {
                "services": [
                    {
                        "id": "api",
                        "state": "running",
                        "health": "healthy",
                        "image": "khaneyar-api:demo",
                    },
                    {
                        "id": "db",
                        "state": "running",
                        "health": "healthy",
                        "image": "postgres:17-alpine",
                    },
                    {"id": "nginx", "state": "active", "health": "", "image": ""},
                ],
                "version": "0.6.0",
                "backups": [],
                "releases": [],
                "scheduled": False,
                "flags": {
                    "maintenance": False,
                    "registration_enabled": True,
                    "assistant_enabled": True,
                    "otp_enabled": False,
                },
                "environment": {
                    "SMS_PROVIDER": "",
                    "SMS_API_KEY": False,
                    "SMS_SENDER": "",
                    "SMS_TEMPLATE": "",
                    "DEEPSEEK_API_KEY": False,
                    "AI_SMS_GATEWAY_URL": "",
                    "AI_SMS_GATEWAY_TOKEN": False,
                    "AI_SMS_MODEL": "deepseek-flash",
                },
                "users": [
                    {
                        "id": "ddc41176-861c-44c5-a67a-ff0aba53ee80",
                        "role": "owner",
                        "state": "active",
                        "phone": "0912***45",
                        "created_at": datetime.fromtimestamp(now - 86400 * 8, UTC).isoformat(),
                        "last_login": datetime.fromtimestamp(now, UTC).isoformat(),
                    },
                    {
                        "id": "bb06ac87-e3af-40e1-9f3f-471b2935a9ab",
                        "role": "member",
                        "state": "suspended",
                        "phone": "0935***18",
                        "created_at": datetime.fromtimestamp(now - 86400 * 3, UTC).isoformat(),
                        "last_login": None,
                    },
                ],
            }
            atomic_write(self.path, json.dumps(state).encode())

    def state(self):
        return json.loads(self.path.read_text())

    def revision(self, state):
        return hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()

    def read(self, section: str, arguments: dict):
        with self.lock:
            state = self.state()
        if section == "analytics":
            from app.management.analytics import demo_analytics

            return demo_analytics(state["users"], arguments.get("days", 30))
        if section == "overview":
            api_running = state["services"][0]["state"] == "running"
            db_running = state["services"][1]["state"] == "running"
            return {
                "api": "available" if api_running else "unavailable",
                "database": "available" if db_running else "unavailable",
                "version": state["version"],
                "cpu_load": 0.38,
                "cpu_cores": 2,
                "memory_total": 2 * 1024**3,
                "memory_used": 780 * 1024**2,
                "disk_total": 25 * 1024**3,
                "disk_used": 8 * 1024**3,
                "uptime_seconds": 86400 * 12 + 3600 * 4,
                "services": state["services"],
                "checked_at": time.time(),
            }
        if section == "services":
            return {"items": state["services"]}
        if section == "users":
            search = str(arguments.get("search", "")).strip()
            items = [
                item
                for item in state["users"]
                if not search or search in item["id"] or search in item["phone"]
            ]
            offset = int(arguments.get("offset", 0))
            return {"items": items[offset : offset + 25], "total": len(items), "offset": offset}
        if section == "settings":
            return {
                "flags": state["flags"],
                "environment": state["environment"],
                "revision": self.revision(state),
                "runtime_supported": True,
            }
        if section == "backups":
            return {
                "items": [
                    {key: value for key, value in item.items() if key != "snapshot"}
                    for item in state["backups"]
                ],
                "scheduled": state["scheduled"],
            }
        if section == "releases":
            return {"items": state["releases"]}
        if section == "logs":
            return {
                "target": arguments.get("target", "api"),
                "text": (
                    "2026-11-25T10:42:10Z INFO service started\n"
                    "2026-11-25T10:42:11Z INFO database connection verified\n"
                    "2026-11-25T10:45:00Z INFO health check completed\n"
                ),
            }
        raise ManagementError("NOT_FOUND", "بخش مدیریت پیدا نشد.", 404)

    def prepare(self, operation: Operation):
        with self.lock:
            state = self.state()
            if operation.kind in {"backup.restore", "backup.verify"} and not any(
                item["id"] == operation.target for item in state["backups"]
            ):
                raise ManagementError("NOT_FOUND", "پشتیبان پیدا نشد.", 404)
            if operation.kind == "release.install" and not any(
                item["tag"] == operation.target for item in state["releases"]
            ):
                raise ManagementError("NOT_FOUND", "ابتدا بستهٔ نسخه را دریافت کنید.", 404)
            return operation.model_copy(update={"expected": self.revision(state)})

    def apply(self, operation: Operation):
        with self.lock:
            state = self.state()
            if operation.expected != self.revision(state):
                raise ManagementError(
                    "STALE_PLAN", "اطلاعات پس از پیش‌نمایش تغییر کرده است؛ دوباره بررسی کنید.", 409
                )
            result = {"completed": True, "demo": True}
            kind = operation.kind
            if kind.startswith("service."):
                for row in state["services"]:
                    if row["id"] == operation.target:
                        row["state"] = "exited" if kind == "service.stop" else "running"
            elif kind.startswith("user."):
                user = next((row for row in state["users"] if row["id"] == operation.target), None)
                if not user:
                    raise ManagementError("NOT_FOUND", "کاربر پیدا نشد.", 404)
                if kind == "user.suspend":
                    user["state"] = "suspended"
                elif kind == "user.activate":
                    user["state"] = "active"
            elif kind == "settings.update":
                from app.management.contracts import SECRET_KEYS

                for key, value in operation.values.items():
                    (state["flags"] if key in state["flags"] else state["environment"])[key] = (
                        bool(value) if key in SECRET_KEYS else value
                    )
            elif kind == "backup.schedule":
                state["scheduled"] = operation.values["enabled"]
            elif kind in {"backup.create", "backup.restore", "release.install"}:
                backup_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ-") + secrets.token_hex(4)
                snapshot = copy.deepcopy(
                    {
                        key: value
                        for key, value in state.items()
                        if key not in {"backups", "releases"}
                    }
                )
                state["backups"].insert(
                    0,
                    {
                        "id": backup_id,
                        "created_at": time.time(),
                        "bytes": 84934656,
                        "image": "khaneyar-api:demo",
                        "snapshot": snapshot,
                    },
                )
                result["backup_id"] = backup_id
                if kind == "backup.restore":
                    saved = next(
                        item for item in state["backups"] if item["id"] == operation.target
                    )
                    state.update(copy.deepcopy(saved["snapshot"]))
                    result["safety_backup"] = backup_id
                if kind == "release.install":
                    state["version"] = operation.target.removeprefix("v")
                    result["safety_backup"] = backup_id
            elif kind == "release.fetch":
                if any(item["tag"] == operation.target for item in state["releases"]):
                    raise ManagementError("RELEASE_EXISTS", "این نسخه قبلاً دریافت شده است.", 409)
                state["releases"].insert(
                    0,
                    {
                        "tag": operation.target,
                        "sha256": hashlib.sha256(operation.target.encode()).hexdigest(),
                        "fetched_at": time.time(),
                    },
                )
            atomic_write(self.path, json.dumps(state).encode())
            return result

    def export_backup(self, backup_id: str):
        Operation(kind="backup.verify", target=backup_id)
        with self.lock:
            saved = next(
                (item for item in self.state()["backups"] if item["id"] == backup_id), None
            )
            if not saved:
                raise ManagementError("NOT_FOUND", "پشتیبان پیدا نشد.", 404)
        exports = self.config.state_dir / "exports"
        exports.mkdir(exist_ok=True)
        path = exports / (backup_id + "-" + secrets.token_hex(4) + ".json")
        atomic_write(path, json.dumps({"demo": True, **saved}).encode())
        return path
