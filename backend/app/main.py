"""نقطهٔ ورود اپ FastAPI — کارخانهٔ اپ، CORS بسته، هندلر خطای یکپارچه."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import configure_logging

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    configure_logging(debug=settings.debug)

    app = FastAPI(
        title="KhanehYar API",
        version=__version__,
        # مستندات تعاملی فقط در حالت غیرتولید
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    # CORS بسته — فقط منشأهای مشخص (رفع D-5؛ بدون '*')
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    # خطاهای برنامه → پاسخ JSON با کد پایدار
    @app.exception_handler(AppError)
    async def _app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.http_status,
            content={"error": exc.code, "message": exc.message},
        )

    # خطای ناشناخته → ۵۰۰ بدون افشای جزئیات داخلی
    @app.exception_handler(Exception)
    async def _unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("خطای مدیریت‌نشده: %s", type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content={"error": "INTERNAL", "message": "خطای داخلی سرور."},
        )

    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
