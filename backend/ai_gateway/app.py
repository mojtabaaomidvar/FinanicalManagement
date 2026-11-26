"""Deploy independently on the ParsPack server with official DeepSeek connectivity."""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from collections import deque

from fastapi import FastAPI, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import AppError
from app.core.logging import configure_logging
from app.services.household_ai_protocol import (
    KINDS,
    ContextPlan,
    ContextPlanIn,
    ContextReport,
    ContextReportIn,
    GatewayHouseholdIn,
    HouseholdResult,
    build_context_messages,
    build_household_messages,
)
from app.services.sms_ai_protocol import GatewayAnalyzeIn, build_messages
from app.services.sms_ai_provider import (
    ai_usage_headers,
    capture_ai_usage,
    provider_error,
    request_deepseek,
    request_deepseek_json,
)

MAX_REQUEST_BYTES = 256 * 1024
PRIVATE_PATH = "/v1/sms/analyze"
PRIVATE_PATHS = {PRIVATE_PATH, "/v1/assistant/analyze", "/v1/assistant/capabilities",
                 "/v1/assistant/plan", "/v1/assistant/report"}
NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


class GatewaySettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", hide_input_in_errors=True)
    deepseek_api_key: str = ""
    ai_gateway_token: str = ""
    ai_sms_model: str = "deepseek-flash"
    ai_sms_timeout_seconds: float = Field(default=25, gt=0, le=25)
    ai_gateway_requests_per_minute: int = Field(default=20, ge=1, le=120)
    ai_gateway_concurrency: int = Field(default=2, ge=1, le=8)


def error_response(code: str, *, status: int | None = None) -> JSONResponse:
    error = provider_error(code)
    return JSONResponse(
        {"error": error.code, "message": error.message},
        status_code=status or error.http_status,
        headers={**NO_STORE, "X-AI-Usage-Version": "1", "X-AI-Attempted": "0"},
    )


class PrivateRequestBoundary:
    """Authenticate and bound the body before JSON validation sees SMS text."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.authorization = ("Bearer " + token).encode("ascii")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] not in PRIVATE_PATHS:
            await self.app(scope, receive, send)
            return
        authorization = dict(scope["headers"]).get(b"authorization", b"")
        if not secrets.compare_digest(authorization, self.authorization):
            await error_response("AI_GATEWAY_AUTH_FAILED", status=401)(scope, receive, send)
            return
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > MAX_REQUEST_BYTES:
                await error_response("AI_GATEWAY_INVALID_REQUEST", status=413)(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, send)


class RequestLimits:
    """One-worker capacity protections; these are not a monetary or daily usage allowance."""

    def __init__(self, requests_per_minute: int, concurrency: int) -> None:
        self.requests_per_minute = requests_per_minute
        self.recent: deque[float] = deque()
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(concurrency)

    def enter(self) -> None:
        now = time.monotonic()
        with self.lock:
            while self.recent and self.recent[0] <= now - 60:
                self.recent.popleft()
            if len(self.recent) >= self.requests_per_minute:
                raise provider_error("AI_GATEWAY_BUSY")
            if not self.slots.acquire(blocking=False):
                raise provider_error("AI_GATEWAY_BUSY")
            self.recent.append(now)


def create_app(config: GatewaySettings | None = None) -> FastAPI:
    config = config or GatewaySettings()
    if (
        not config.deepseek_api_key.strip()
        or not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", config.ai_gateway_token)
    ):
        raise RuntimeError(
            "Configure DEEPSEEK_API_KEY and a strong AI_GATEWAY_TOKEN on the server."
        )
    configure_logging()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(PrivateRequestBoundary, token=config.ai_gateway_token)
    limits = RequestLimits(config.ai_gateway_requests_per_minute, config.ai_gateway_concurrency)

    @app.exception_handler(AppError)
    async def application_error(_request, error: AppError):
        return JSONResponse(
            {"error": error.code, "message": error.message},
            status_code=error.http_status,
            headers={**NO_STORE, "X-AI-Usage-Version": "1", "X-AI-Attempted": "0"},
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _error):
        # FastAPI's default validation response can echo the submitted SMS.
        return error_response("AI_GATEWAY_INVALID_REQUEST", status=422)

    @app.get("/healthz")
    def health():
        return JSONResponse({"status": "ok", "service": "sms-ai-gateway"}, headers=NO_STORE)

    def infer(messages, schema=None, *, sms=False):
        limits.enter()
        with capture_ai_usage() as usage:
            try:
                transport = request_deepseek if sms else request_deepseek_json
                result = transport(messages, api_key=config.deepseek_api_key,
                                   model=config.ai_sms_model, timeout=config.ai_sms_timeout_seconds)
                if sms and (
                    not isinstance(result, dict) or not isinstance(result.get("transactions"), list)
                    or len(result["transactions"]) > 80
                ):
                    raise provider_error("AI_INVALID_RESULT")
                if schema is not None:
                    try:
                        result = schema.model_validate(result)
                    except ValidationError:
                        raise provider_error("AI_INVALID_RESULT") from None
                encoded = result.model_dump_json() if schema else json.dumps(
                    result, ensure_ascii=False, default=str,
                )
                return Response(encoded, media_type="application/json",
                                headers={**NO_STORE, **ai_usage_headers(usage)})
            except AppError as error:
                return JSONResponse({"error": error.code, "message": error.message},
                                    status_code=error.http_status,
                                    headers={**NO_STORE, **ai_usage_headers(usage)})
            finally:
                limits.slots.release()

    @app.post(PRIVATE_PATH)
    def analyze(body: GatewayAnalyzeIn):
        return infer(build_messages([item.model_dump() for item in body.items]), sms=True)

    @app.get("/v1/assistant/capabilities")
    def household_capabilities():
        return JSONResponse(
            {"status": "ready", "protocol_version": 2, "kinds": KINDS,
             "contextual": True, "max_inferences": 2}, headers=NO_STORE,
        )

    @app.post("/v1/assistant/analyze")
    def household_analyze(body: GatewayHouseholdIn):
        return infer(build_household_messages(body), HouseholdResult)

    def contextual(body, schema):
        return infer(build_context_messages(body), schema)

    @app.post("/v1/assistant/plan")
    def contextual_plan(body: ContextPlanIn):
        return contextual(body, ContextPlan)

    @app.post("/v1/assistant/report")
    def contextual_report(body: ContextReportIn):
        return contextual(body, ContextReport)

    return app
