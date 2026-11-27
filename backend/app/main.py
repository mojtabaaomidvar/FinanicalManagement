"""نقطهٔ ورود اپ FastAPI — کارخانهٔ اپ، CORS بسته، هندلر خطای یکپارچه."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import AppError
from app.core.financial_contract import MONEY_CONTRACT_HEADER, FinancialContractMiddleware
from app.core.logging import configure_logging
from app.core.managed_runtime import ManagedRuntimeMiddleware
from app.services import support as support_service
from app.services import usage as usage_service
from app.services.household_changes import HouseholdChanges

logger = logging.getLogger(__name__)


def _error_headers(request: Request) -> dict[str, str]:
    if any(
        request.url.path == prefix or request.url.path.startswith(prefix + "/")
        for prefix in (
            "/api/v1/documents", "/api/v1/equipment", "/api/v1/vehicles", "/api/v1/goals",
            "/api/v1/activities", "/api/v1/events", "/api/v1/children", "/api/v1/pets",
            "/api/v1/support", "/api/v1/members/me/support-code", "/api/v1/assistant",
        )
    ):
        return {"Cache-Control": "no-store", "Pragma": "no-cache"}
    return {}


def create_app() -> FastAPI:
    configure_logging(debug=settings.debug)

    @asynccontextmanager
    async def lifespan(app):
        app.state.household_changes = HouseholdChanges()
        try:
            yield
        finally:
            await app.state.household_changes.close()

    app = FastAPI(
        lifespan=lifespan,
        title="KhanehYar API",
        version=__version__,
        # مستندات تعاملی فقط در حالت غیرتولید
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )

    # CORS must wrap the contract gate so old clients can read update errors.
    app.add_middleware(ManagedRuntimeMiddleware)
    app.add_middleware(FinancialContractMiddleware)
    # CORS بسته — فقط منشأهای مشخص (رفع D-5؛ بدون '*')
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", MONEY_CONTRACT_HEADER],
    )

    @app.middleware("http")
    async def support_headers(request: Request, call_next):
        response = await call_next(request)
        if request.url.path == "/api/v1/support" or request.url.path.startswith("/api/v1/support/"):
            response.headers.update({"Cache-Control": "no-store", "Pragma": "no-cache"})
        if request.url.path == "/api/v1/members/me/support-code":
            response.headers.update({"Cache-Control": "no-store", "Pragma": "no-cache"})
        if request.method == "POST" and response.status_code >= 400 and request.url.path in support_service.ERROR_ROUTES:
            # Aggregate fixed route/status only; no request body or response text.
            from starlette.concurrency import run_in_threadpool
            await run_in_threadpool(support_service.record_error, request.url.path, response.status_code)
        if 200 <= response.status_code < 300:
            operation = getattr(request.state, "usage_operation", None) or usage_service.successful_operation(request.url.path, request.method)
            if operation:
                from starlette.concurrency import run_in_threadpool
                await run_in_threadpool(usage_service.record, *operation)
        return response

    # خطاهای برنامه → پاسخ JSON با کد پایدار
    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.http_status,
            content={"error": exc.code, "message": exc.message},
            headers=_error_headers(request),
        )

    # خطای ناشناخته → ۵۰۰ بدون افشای جزئیات داخلی
    @app.exception_handler(Exception)
    async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("خطای مدیریت‌نشده: %s", type(exc).__name__)
        if request.method == "POST" and request.url.path in support_service.ERROR_ROUTES:
            from starlette.concurrency import run_in_threadpool
            await run_in_threadpool(support_service.record_error, request.url.path, 500)
        return JSONResponse(
            status_code=500,
            content={"error": "INTERNAL", "message": "خطای داخلی سرور."},
            headers=_error_headers(request),
        )

    # اعتبارسنجیِ بدنه (Pydantic) → همان پوششِ {"error", "message"}.
    #
    # دو دلیل، و دومی امنیتی است:
    # ۱) پاسخِ پیش‌فرضِ FastAPI شکلِ {"detail": [...]} دارد؛ کلاینت فقط `error` و
    #    `message` را می‌خواند، پس کاربر «خطا در ارتباط با سرور (۴۲۲)» می‌دید —
    #    یعنی برای یک اشتباهِ سادهٔ ورودی، پیامی که هیچ راهنمایی ندارد.
    # ۲) آن `detail` برای هر خطا کلیدِ `input` هم دارد، یعنی **مقدارِ ارسالی را
    #    بازمی‌تاباند**. روی `RegisterRequest.password` (حداقل ۸) این به‌معنای
    #    برگشتنِ رمزِ کوتاهِ کاربر در بدنهٔ پاسخ است — مصداقِ روشنِ §۵
    #    («دادهٔ حساس در خطا/لاگ نه»). اینجا فقط *نامِ* فیلدها برمی‌گردد که
    #    خودش بخشی از قراردادِ عمومیِ API است، نه مقدارشان.
    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields: list[str] = []
        for err in exc.errors():
            loc = err.get("loc") or ()
            # loc معمولاً ("body", "<field>") است؛ فقط آخرین جزء نامِ فیلد است.
            name = str(loc[-1]) if isinstance(loc, (list, tuple)) and loc else ""
            if name and name not in fields:
                fields.append(name)
        return JSONResponse(
            status_code=422,
            headers=_error_headers(request),
            content={
                "error": "INVALID_INPUT",
                "message": "اطلاعات ارسالی معتبر نیست؛ ورودی‌ها را بررسی کنید.",
                "fields": fields,
            },
        )

    app.include_router(api_router, prefix="/api/v1")
    return app


app = create_app()
