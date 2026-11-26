"""اندپوینت‌های سلامت (liveness/readiness)."""

from __future__ import annotations

import hashlib
import json
import os

from fastapi import APIRouter

from app import __version__
from app.core.config import settings
from app.core.feature_policy import AI_ENV_DEFAULTS, ai_configuration_revision
from app.core.managed_runtime import read_flags

router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz() -> dict[str, str]:
    """زنده بودن سرویس (بدون بررسی وابستگی‌ها)."""
    result = {"status": "ok", "version": __version__}
    if os.environ.get("KHANEYAR_RUNTIME_FILE"):
        try:
            flags = read_flags()
            result.update(managed_runtime="v1", feature_controls="v1", ai_controls="v1")
            result["runtime_revision"] = hashlib.sha256(
                json.dumps(flags, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            result["ai_configuration_revision"] = ai_configuration_revision(
                {key: str(getattr(settings, key.lower())) for key in AI_ENV_DEFAULTS},
                settings.file_signing_secret,
            )
        except (OSError, ValueError, TypeError):
            pass
    return result


@router.get("/readyz")
def readyz() -> dict[str, str]:
    """آمادگی سرویس. بررسی اتصال دیتابیس در فاز ۳ اضافه می‌شود."""
    return {"status": "ready"}
