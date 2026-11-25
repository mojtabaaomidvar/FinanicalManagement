"""Optional host-owned runtime switches, independent of family settings and memberships."""

from __future__ import annotations

import json
import os
from pathlib import Path

from starlette.responses import JSONResponse


def read_flags() -> dict[str, bool]:
    filename = os.environ.get("KHANEYAR_RUNTIME_FILE", "")
    if not filename:
        return {}
    path = Path(filename)
    if not path.is_file() or path.stat().st_size > 4096:
        raise ValueError("Managed runtime file is unavailable")
    flags = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(flags, dict) or any(
        key not in {"maintenance", "registration_enabled", "assistant_enabled"}
        or type(value) is not bool
        for key, value in flags.items()
    ):
        raise ValueError("Invalid managed runtime settings")
    return flags


class ManagedRuntimeMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("method") == "OPTIONS"
            or not scope.get("path", "").startswith("/api/v1/")
        ):
            return await self.app(scope, receive, send)
        path = scope["path"]
        # Management is a separate process. Support and safe session teardown remain available.
        if path.startswith("/api/v1/support/") or path in {
            "/api/v1/healthz",
            "/api/v1/readyz",
            "/api/v1/auth/config",
            "/api/v1/auth/logout",
            "/api/v1/auth/logout-all",
        }:
            return await self.app(scope, receive, send)
        try:
            flags = read_flags()
        except (OSError, ValueError, TypeError):
            response = JSONResponse(
                {
                    "error": "RUNTIME_UNAVAILABLE",
                    "message": "تنظیمات سرویس موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.",
                },
                status_code=503,
                headers={"Cache-Control": "no-store", "Retry-After": "60"},
            )
            return await response(scope, receive, send)
        error = None
        if flags.get("maintenance", False):
            error = {
                "error": "MAINTENANCE",
                "message": "خانه‌یار در حال نگهداری است؛ کمی بعد دوباره تلاش کنید.",
            }
        elif (
            flags.get("registration_enabled", True) is False
            and scope["method"] == "POST"
            and path in {"/api/v1/auth/register", "/api/v1/auth/join", "/api/v1/auth/accept-invite"}
        ):
            error = {
                "error": "REGISTRATION_CLOSED",
                "message": "ثبت‌نام و پیوستن حساب تازه موقتاً بسته است.",
            }
        elif flags.get("assistant_enabled", True) is False and (
            path.startswith("/api/v1/assistant/") or path.startswith("/api/v1/sms/assistant")
        ):
            error = {
                "error": "ASSISTANT_DISABLED",
                "message": "دستیار موقتاً غیرفعال است؛ ثبت دستی در دسترس است.",
            }
        if error:
            return await JSONResponse(
                error, status_code=503, headers={"Cache-Control": "no-store", "Retry-After": "60"}
            )(scope, receive, send)
        return await self.app(scope, receive, send)
