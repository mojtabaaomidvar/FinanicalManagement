"""اندپوینت‌های سلامت (liveness/readiness)."""

from __future__ import annotations

from fastapi import APIRouter

from app import __version__

router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz() -> dict[str, str]:
    """زنده بودن سرویس (بدون بررسی وابستگی‌ها)."""
    return {"status": "ok", "version": __version__}


@router.get("/readyz")
def readyz() -> dict[str, str]:
    """آمادگی سرویس. بررسی اتصال دیتابیس در فاز ۳ اضافه می‌شود."""
    return {"status": "ready"}
