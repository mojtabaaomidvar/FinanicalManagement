"""Independent, loopback-only management HTTP service."""

from __future__ import annotations

import hmac
import json
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.background import BackgroundTask

from app.management import identity
from app.management.contracts import READS, Config, ManagementError, Operation, authorize
from app.management.driver import DemoDriver, Driver
from app.management.store import Store

HISTORY_PAGE_SIZE = 100
MAX_HISTORY_OFFSET = 1_000_000


def validate_history_offset(offset: int) -> None:
    if type(offset) is not int or not 0 <= offset <= MAX_HISTORY_OFFSET:
        raise ManagementError("INVALID_OFFSET", "شمارهٔ صفحهٔ گزارش معتبر نیست.", 422)


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Credential(Body):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(default="", max_length=6, pattern=r"^[0-9]{0,6}$")


class Login(Credential):
    username: str = Field(min_length=1, max_length=64)


class Execute(Credential):
    plan_id: str = Field(max_length=64)
    request_key: str = Field(max_length=64)


class NewAccount(Credential):
    username: str = Field(min_length=3, max_length=64)
    new_password: str = Field(min_length=12, max_length=128)
    role: Literal["owner", "operator", "viewer"]


class UpdateAccount(Credential):
    role: Literal["owner", "operator", "viewer"]
    enabled: bool
    new_password: str = Field(default="", max_length=128)


class Export(Credential):
    backup_id: str = Field(max_length=64)


def create_app(config: Config, *, driver=None) -> FastAPI:
    store = Store(config.state_dir)
    driver = driver or (DemoDriver(config) if config.mode == "demo" else Driver(config))
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="management")
    plans: dict[str, dict] = {}
    plans_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(_app):
        store.recover()
        yield
        executor.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(
        title="KhanehYar Management",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.store = store
    app.state.driver = driver
    app.state.executor = executor
    app.state.plans = plans
    prefix = "/management/api"

    def origin(request: Request):
        if request.headers.get("origin") != config.origin:
            raise ManagementError("ORIGIN", "مبدأ درخواست مدیریت مجاز نیست.", 403)

    def principal(request: Request):
        actor = identity.session(store, request.cookies.get(identity.COOKIE, ""))
        if not actor:
            raise ManagementError(
                "UNAUTHORIZED", "نشست مدیریت پایان یافته است؛ دوباره وارد شوید.", 401
            )
        if request.method not in {"GET", "HEAD"}:
            origin(request)
            if not hmac.compare_digest(request.headers.get("x-management-csrf", ""), actor["csrf"]):
                raise ManagementError(
                    "CSRF", "اعتبار درخواست پایان یافته است؛ صفحه را تازه کنید.", 403
                )
        return actor

    principal_dependency = Depends(principal)

    def owner(actor=principal_dependency):
        if actor["role"] != "owner":
            raise ManagementError("FORBIDDEN", "این بخش فقط برای مالک پنل در دسترس است.", 403)
        return actor

    owner_dependency = Depends(owner)

    def reauthenticate(
        actor: dict, body: Credential, *, required_role: str | None = None, kind: str | None = None
    ):
        scopes = store.rate_limit(actor["id"], actor["username"], "reauth")
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            account = db.execute("SELECT * FROM accounts WHERE id=?", (actor["id"],)).fetchone()
            active = db.execute(
                "SELECT created FROM sessions WHERE token=? AND expires>?",
                (actor["token"], time.time()),
            ).fetchone()
            if not active or not account or not account["enabled"]:
                raise ManagementError(
                    "UNAUTHORIZED", "نشست مدیریت معتبر نیست؛ دوباره وارد شوید.", 401
                )
            if required_role and account["role"] != required_role:
                raise ManagementError("FORBIDDEN", "دسترسی این عملیات تغییر کرده است.", 403)
            if kind:
                authorize(account["role"], kind)
            identity.verify_credential(
                db,
                account,
                body.password,
                body.code,
                config.mode == "production",
                recent_mfa=time.time() - active["created"] < 300,
            )
            db.executemany("DELETE FROM attempts WHERE scope=?", [(scope,) for scope in scopes])
            db.execute("UPDATE sessions SET created=? WHERE token=?", (time.time(), actor["token"]))

    @app.middleware("http")
    async def protect(request: Request, call_next):
        host = request.headers.get("host", "")
        from urllib.parse import urlsplit

        if host != urlsplit(config.origin).netloc:
            return JSONResponse(
                {"error": "HOST", "message": "نشانی پنل مدیریت معتبر نیست."}, status_code=400
            )
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
                return JSONResponse(
                    {"error": "CONTENT_TYPE", "message": "قالب درخواست معتبر نیست."},
                    status_code=415,
                )
            try:
                if int(request.headers.get("content-length", "0")) > 32768:
                    raise ValueError
                body = await request.body()
                if len(body) > 32768:
                    raise ValueError
            except ValueError:
                return JSONResponse(
                    {"error": "BODY_SIZE", "message": "حجم درخواست بیش از حد مجاز است."},
                    status_code=413,
                )
        response = await call_next(request)
        response.headers.update(
            {
                "Cache-Control": "no-store",
                "Pragma": "no-cache",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
                "Content-Security-Policy": (
                    "default-src 'none'; script-src 'self'; "
                    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
                    "connect-src 'self'; frame-ancestors 'none'; "
                    "base-uri 'none'; form-action 'self'"
                ),
            }
        )
        return response

    @app.exception_handler(ManagementError)
    async def management_error(_request, exc):
        return JSONResponse(
            {"error": exc.code, "message": exc.message},
            status_code=exc.status,
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, _exc):
        return JSONResponse(
            {
                "error": "INVALID_INPUT",
                "message": "اطلاعات ارسالی معتبر نیست؛ ورودی‌ها را بررسی کنید.",
            },
            status_code=422,
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(Exception)
    async def unknown_error(_request, _exc):
        return JSONResponse(
            {"error": "INTERNAL", "message": "درخواست مدیریت کامل نشد؛ دوباره تلاش کنید."},
            status_code=500,
            headers={"Cache-Control": "no-store"},
        )

    def session_out(actor):
        return {
            "authenticated": bool(actor),
            "mode": config.mode,
            "username": actor["username"] if actor else "",
            "role": actor["role"] if actor else "",
            "csrf": actor["csrf"] if actor else "",
            "mfa": bool(actor and actor["totp_secret"]),
            "expires_at": actor["expires"] if actor else None,
        }

    @app.get(prefix + "/session")
    def session(request: Request):
        return session_out(identity.session(store, request.cookies.get(identity.COOKIE, "")))

    @app.post(prefix + "/login")
    def login(request: Request, response: Response, body: Login):
        origin(request)
        ip = request.client.host if request.client else "unknown"
        if ip in {"127.0.0.1", "::1"}:
            ip = request.headers.get("x-real-ip", ip)
        raw = identity.login(
            store, body.username, body.password, body.code, ip, config.mode == "production"
        )
        response.set_cookie(
            identity.COOKIE,
            raw,
            path=identity.COOKIE_PATH,
            secure=config.mode == "production",
            httponly=True,
            samesite="strict",
            max_age=identity.SESSION_SECONDS,
        )
        return session_out(identity.session(store, raw))

    @app.post(prefix + "/logout")
    def logout(response: Response, actor=principal_dependency):
        with store.connect() as db:
            db.execute("DELETE FROM sessions WHERE token=?", (actor["token"],))
            store.audit(db, actor["username"], "session.logout")
        response.delete_cookie(
            identity.COOKIE,
            path=identity.COOKIE_PATH,
            secure=config.mode == "production",
            httponly=True,
            samesite="strict",
        )
        return {"ok": True}

    @app.get(prefix + "/state/{section}")
    def state(
        section: str,
        search: str = "",
        offset: int = 0,
        target: str = "api",
        days: int = 30,
        actor=principal_dependency,
    ):
        if section not in READS:
            raise ManagementError("NOT_FOUND", "بخش مدیریت پیدا نشد.", 404)
        if section == "logs" and actor["role"] == "viewer":
            raise ManagementError("FORBIDDEN", "مشاهدهٔ لاگ به دسترسی عملیات نیاز دارد.", 403)
        if section == "analytics":
            from app.management.analytics import period, validate_report

            period(days)
            return validate_report(driver.read(section, {"days": days}))
        if section == "ai-analytics":
            from app.management.ai_analytics import validate_ai_report
            from app.management.analytics import period

            period(days)
            return validate_ai_report(driver.read(section, {"days": days}))
        return driver.read(section, {"search": search, "offset": offset, "target": target})

    @app.post(prefix + "/plans")
    def plan(body: Operation, actor=principal_dependency):
        authorize(actor["role"], body.kind)
        operation = driver.prepare(body)
        plan_id = secrets.token_hex(24)
        with plans_lock:
            for key in list(plans):
                if plans[key]["expires"] < time.time():
                    del plans[key]
            if len(plans) >= 128:
                raise ManagementError(
                    "TOO_MANY_PLANS", "پیش‌نمایش‌های باز زیاد است؛ کمی بعد دوباره تلاش کنید.", 429
                )
            plans[plan_id] = {
                "operation": operation,
                "session": actor["token"],
                "expires": time.time() + 180,
            }
        return {
            "id": plan_id,
            "operation": operation.public(),
            "expires_at": time.time() + 180,
            "demo": config.mode == "demo",
        }

    def run_job(job_id: str, operation: Operation, actor: str):
        with store.connect() as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
        try:
            result = driver.apply(operation)
            status = "succeeded"
        except ManagementError as exc:
            result, status = {"error": exc.code, "message": exc.message}, "failed"
        except Exception:
            result, status = (
                {
                    "error": "OPERATION_FAILED",
                    "message": "عملیات کامل نشد؛ وضعیت سرویس‌ها و پشتیبان‌ها را بررسی کنید.",
                },
                "failed",
            )
        with store.connect() as db:
            db.execute(
                "UPDATE jobs SET status=?,result=?,finished=? WHERE id=?",
                (status, json.dumps(result, ensure_ascii=False), time.time(), job_id),
            )
            store.audit(
                db,
                actor,
                "operation." + status,
                {"job_id": job_id, "kind": operation.kind, "target": operation.target},
            )

    @app.post(prefix + "/jobs")
    def execute(body: Execute, actor=principal_dependency):
        try:
            UUID(body.request_key)
        except ValueError as exc:
            raise ManagementError("INVALID_KEY", "شناسهٔ درخواست معتبر نیست.", 422) from exc
        with store.connect() as db:
            previous = db.execute(
                "SELECT * FROM jobs WHERE account_id=? AND request_key=?",
                (actor["id"], body.request_key),
            ).fetchone()
            if previous:
                return store.job_out(previous)
        with plans_lock:
            selected = plans.get(body.plan_id)
            if (
                not selected
                or selected["session"] != actor["token"]
                or selected["expires"] < time.time()
            ):
                raise ManagementError(
                    "PLAN_EXPIRED", "پیش‌نمایش پایان یافته است؛ عملیات را دوباره بررسی کنید.", 409
                )
            operation = selected["operation"]
        reauthenticate(actor, body, kind=operation.kind)
        job_id = str(uuid4())
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            # Repeat the idempotency check while holding the write lock.
            previous = db.execute(
                "SELECT * FROM jobs WHERE account_id=? AND request_key=?",
                (actor["id"], body.request_key),
            ).fetchone()
            if previous:
                return store.job_out(previous)
            if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone():
                raise ManagementError(
                    "BUSY", "یک عملیات در حال اجراست؛ نتیجهٔ آن را در سابقه ببینید.", 409
                )
            db.execute(
                "INSERT INTO jobs VALUES (?,?,?,?,?,'queued',NULL,?,NULL)",
                (
                    job_id,
                    actor["username"],
                    actor["id"],
                    body.request_key,
                    json.dumps(operation.public(), ensure_ascii=False),
                    time.time(),
                ),
            )
            store.audit(
                db,
                actor["username"],
                "operation.queued",
                {"job_id": job_id, "operation": operation.public()},
            )
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            result = store.job_out(row)
        with plans_lock:
            plans.pop(body.plan_id, None)
        executor.submit(run_job, job_id, operation, actor["username"])
        return result

    @app.get(prefix + "/jobs")
    def jobs(offset: int = 0, _actor=principal_dependency):
        validate_history_offset(offset)
        return store.jobs_page(offset, HISTORY_PAGE_SIZE)

    @app.get(prefix + "/audit")
    def audit(offset: int = 0, _actor=owner_dependency):
        validate_history_offset(offset)
        with store.connect() as db:
            total = db.execute("SELECT count(*) FROM audit").fetchone()[0]
            return {
                "items": [
                    dict(row)
                    for row in db.execute(
                        "SELECT * FROM audit ORDER BY id DESC LIMIT ? OFFSET ?",
                        (HISTORY_PAGE_SIZE, offset),
                    )
                ],
                "total": total,
                "offset": offset,
            }

    @app.get(prefix + "/accounts")
    def accounts(_actor=owner_dependency):
        with store.connect() as db:
            return {
                "items": [
                    dict(row)
                    for row in db.execute(
                        "SELECT id,username,role,enabled,created,totp_secret!='' AS mfa "
                        "FROM accounts ORDER BY created"
                    )
                ]
            }

    @app.post(prefix + "/accounts")
    def new_account(body: NewAccount, actor=owner_dependency):
        reauthenticate(actor, body, required_role="owner")
        return identity.create_account(
            store,
            body.username,
            body.new_password,
            body.role,
            production=config.mode == "production",
            actor=actor["username"],
        )

    @app.patch(prefix + "/accounts/{account_id}")
    def update_account(account_id: str, body: UpdateAccount, actor=owner_dependency):
        reauthenticate(actor, body, required_role="owner")
        identity.update_account(
            store, actor, account_id, body.role, body.enabled, body.new_password
        )
        return {"ok": True}

    @app.post(prefix + "/backup-download")
    def download(body: Export, actor=owner_dependency):
        reauthenticate(actor, body, required_role="owner")
        path = driver.export_backup(body.backup_id)
        with store.connect() as db:
            store.audit(db, actor["username"], "backup.download", {"backup_id": body.backup_id})
        return FileResponse(
            path,
            filename="khaneyar-" + body.backup_id + path.suffix,
            media_type="application/octet-stream",
            background=BackgroundTask(path.unlink, missing_ok=True),
        )

    assets = config.web_root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
        app.mount("/management/assets", StaticFiles(directory=assets), name="management-assets")

    @app.get("/")
    @app.get("/management/")
    def index():
        path = config.web_root / "management.html"
        if not path.is_file():
            raise ManagementError("BUILD_MISSING", "نسخهٔ رابط مدیریت هنوز ساخته نشده است.", 503)
        return FileResponse(path)

    @app.get("/management/version.json")
    def version():
        path = config.web_root / "version.json"
        if not path.is_file():
            raise ManagementError("NOT_FOUND", "مشخصات نسخهٔ مدیریت پیدا نشد.", 404)
        return FileResponse(path)

    return app
