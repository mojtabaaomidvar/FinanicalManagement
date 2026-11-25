"""Root-owned entry point. Run with Python -I and an empty environment, without arguments."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.management.contracts import READS, Config, ManagementError, Operation
from app.management.host import Host, host_lock


def main():
    if len(sys.argv) != 1 or os.geteuid() != 0:
        raise SystemExit("The management worker requires its fixed root launcher.")
    path = Path("/etc/khaneyar-management/config.json")
    if path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
        raise SystemExit(
            "Management configuration must be owned by root and not writable by others."
        )
    config = Config.model_validate_json(path.read_bytes())
    if config.mode != "production":
        raise SystemExit("The privileged worker cannot run in demo mode.")
    host = Host(config)
    payload = sys.stdin.buffer.read(32769)
    if len(payload) > 32768:
        raise SystemExit("Request too large.")
    try:
        request = json.loads(payload)
        method = request.get("method")
        if (
            method == "read"
            and set(request) == {"method", "section", "arguments"}
            and request["section"] in READS
            and isinstance(request["arguments"], dict)
        ):
            result = host.read(request["section"], request["arguments"])
        elif method in {"prepare", "apply"} and set(request) == {"method", "operation"}:
            operation = Operation.model_validate(request["operation"])
            if method == "prepare":
                result = host.prepare(operation).model_dump()
            else:
                with host_lock(config):
                    result = host.apply(operation)
        elif method == "export" and set(request) == {"method", "backup_id"}:
            Operation(kind="backup.verify", target=request["backup_id"])
            with host_lock(config):
                result = {"path": str(host.export_backup(request["backup_id"]))}
        else:
            raise ValueError("Invalid worker request")
        response = {"ok": True, "data": result}
    except ManagementError as exc:
        response = {
            "ok": False,
            "error": {"code": exc.code, "message": exc.message, "status": exc.status},
        }
    except Exception:
        response = {
            "ok": False,
            "error": {
                "code": "WORKER_FAILED",
                "message": "عملیات کامل نشد؛ وضعیت سرویس و سابقه را بررسی کنید.",
                "status": 409,
            },
        }
    print(json.dumps(response, ensure_ascii=True))


if __name__ == "__main__":
    main()
