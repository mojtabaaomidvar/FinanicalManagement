"""Fixed official DeepSeek transport, shared with the database-free private gateway."""

from __future__ import annotations

import json
import logging
from decimal import Decimal

import httpx

from app.core.errors import AppError

logger = logging.getLogger(__name__)

# @copy-text sms.assistant.not_configured
NOT_CONFIGURED = "دستیار پیامک برای این نسخه تنظیم نشده است."
# @copy-text sms.assistant.request_failed
MODEL_FAILED = "تحلیل پیامک انجام نشد؛ کمی بعد دوباره تلاش کنید."
# @copy-text sms.assistant.invalid_result
OUTPUT_FAILED = "نتیجهٔ تحلیل قابل‌استفاده نبود؛ متن را بررسی و دوباره تلاش کنید."
# @copy-text sms.assistant.provider_key_rejected
KEY_REJECTED = "کلید هوش مصنوعی پذیرفته نشد؛ کلید DeepSeek را در تنظیمات سرور بررسی کنید."
# @copy-text sms.assistant.provider_access_denied
ACCESS_DENIED = "دسترسی DeepSeek رد شد (۴۰۳)؛ مجوز سرویس و اتصال اینترنت سرور را بررسی کنید."
# @copy-text sms.assistant.provider_credit_required
CREDIT_REQUIRED = "اعتبار حساب DeepSeek کافی نیست؛ موجودی حساب سرویس را بررسی کنید."
# @copy-text sms.assistant.provider_model_unavailable
MODEL_UNAVAILABLE = "مدل انتخاب‌شدهٔ هوش مصنوعی در دسترس نیست؛ مدل تنظیم‌شده را بررسی کنید."
# @copy-text sms.assistant.provider_rate_limited
PROVIDER_LIMITED = "سرویس DeepSeek درخواست‌ها را موقتاً محدود کرده است؛ کمی بعد دوباره تلاش کنید."
# @copy-text sms.assistant.provider_invalid_request
INVALID_PARAMETERS = "درخواست تحلیل با تنظیمات DeepSeek سازگار نیست؛ تنظیمات سرور را بررسی کنید."
# @copy-text sms.assistant.provider_timeout
PROVIDER_TIMEOUT = "پاسخ سرویس هوش مصنوعی به‌موقع نرسید؛ دوباره تلاش کنید."
# @copy-text sms.assistant.provider_connection_failed
CONNECTION_FAILED = "اتصال به سرویس هوش مصنوعی برقرار نشد؛ اینترنت این محیط را بررسی کنید."
# @copy-text sms.assistant.gateway_not_configured
GATEWAY_NOT_CONFIGURED = "تنظیمات سرور تحلیل کامل نیست؛ نشانی و رمز دسترسی درگاه را بررسی کنید."
# @copy-text sms.assistant.gateway_auth_failed
GATEWAY_AUTH_FAILED = "دسترسی به سرور تحلیل تأیید نشد؛ رمز دسترسی درگاه را بررسی کنید."
# @copy-text sms.assistant.gateway_unavailable
GATEWAY_UNAVAILABLE = "ارتباط با سرور تحلیل برقرار نشد؛ نشانی سرور و اتصال اینترنت را بررسی کنید."
# @copy-text sms.assistant.gateway_invalid_request
GATEWAY_INVALID_REQUEST = "درخواست تحلیل برای درگاه معتبر نبود؛ تنظیمات این نسخه را بررسی کنید."
# @copy-text sms.assistant.gateway_busy
GATEWAY_BUSY = "سرور تحلیل در حال پاسخ‌گویی به درخواست‌های دیگر است؛ کمی بعد دوباره تلاش کنید."

# A remote response can select only these local, editable messages.
ERRORS = {
    "AI_NOT_CONFIGURED": (NOT_CONFIGURED, 503),
    "AI_UNAVAILABLE": (MODEL_FAILED, 502),
    "AI_INVALID_RESULT": (OUTPUT_FAILED, 502),
    "AI_PROVIDER_KEY_REJECTED": (KEY_REJECTED, 502),
    "AI_ACCESS_DENIED": (ACCESS_DENIED, 502),
    "AI_PROVIDER_CREDIT_REQUIRED": (CREDIT_REQUIRED, 502),
    "AI_MODEL_UNAVAILABLE": (MODEL_UNAVAILABLE, 502),
    "AI_PROVIDER_RATE_LIMITED": (PROVIDER_LIMITED, 503),
    "AI_PROVIDER_INVALID_REQUEST": (INVALID_PARAMETERS, 502),
    "AI_PROVIDER_TIMEOUT": (PROVIDER_TIMEOUT, 504),
    "AI_CONNECTION_FAILED": (CONNECTION_FAILED, 502),
    "AI_GATEWAY_NOT_CONFIGURED": (GATEWAY_NOT_CONFIGURED, 503),
    "AI_GATEWAY_AUTH_FAILED": (GATEWAY_AUTH_FAILED, 502),
    "AI_GATEWAY_UNAVAILABLE": (GATEWAY_UNAVAILABLE, 502),
    "AI_GATEWAY_INVALID_REQUEST": (GATEWAY_INVALID_REQUEST, 502),
    "AI_GATEWAY_BUSY": (GATEWAY_BUSY, 503),
}


def provider_error(code: str) -> AppError:
    message, status = ERRORS[code]
    return AppError(code, message, status)


def reject_nonfinite(_value: str) -> None:
    raise ValueError("Non-finite JSON numbers are not accepted")


def request_deepseek_json(
    messages: list[dict[str, str]], *, api_key: str, model: str, timeout: float
) -> dict:
    if not api_key.strip():
        raise provider_error("AI_NOT_CONFIGURED")
    try:
        response = httpx.post(
            "https://api.deepseek.com/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key.strip()}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "temperature": 0,
                "thinking": {"type": "disabled"},
                "stream": False,
                "max_tokens": 1800,
                "response_format": {"type": "json_object"},
            },
            timeout=timeout,
            follow_redirects=False,
        )
        response.raise_for_status()
        payload = response.json()
        choice = payload["choices"][0]
        content = choice["message"]["content"]
        if (
            not isinstance(content, str) or not content.strip()
            or len(content) > 1024 * 1024 or choice.get("finish_reason") != "stop"
        ):
            raise ValueError("Assistant response was blank, oversized or incomplete")
        result = json.loads(
            content, parse_float=Decimal, parse_int=Decimal, parse_constant=reject_nonfinite,
        )
        if not isinstance(result, dict):
            raise ValueError("Assistant response was not a JSON object")
        return result
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        logger.warning("SMS assistant provider request failed status=%s", status)
        code = {
            400: "AI_PROVIDER_INVALID_REQUEST", 422: "AI_PROVIDER_INVALID_REQUEST",
            401: "AI_PROVIDER_KEY_REJECTED", 403: "AI_ACCESS_DENIED",
            402: "AI_PROVIDER_CREDIT_REQUIRED", 404: "AI_MODEL_UNAVAILABLE",
            429: "AI_PROVIDER_RATE_LIMITED",
            408: "AI_PROVIDER_TIMEOUT", 504: "AI_PROVIDER_TIMEOUT",
        }.get(status, "AI_UNAVAILABLE")
        raise provider_error(code) from None
    except httpx.TimeoutException:
        logger.warning("SMS assistant provider request failed reason=timeout")
        raise provider_error("AI_PROVIDER_TIMEOUT") from None
    except httpx.HTTPError:
        logger.warning("SMS assistant provider request failed reason=connection")
        raise provider_error("AI_CONNECTION_FAILED") from None
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        logger.warning("SMS assistant provider request failed reason=invalid_response")
        raise provider_error("AI_INVALID_RESULT") from None


def request_deepseek(
    messages: list[dict[str, str]], *, api_key: str, model: str, timeout: float,
) -> dict:
    """Retain the released SMS contract; household routes validate their own schema."""
    result = request_deepseek_json(messages, api_key=api_key, model=model, timeout=timeout)
    if not isinstance(result.get("transactions"), list) or len(result["transactions"]) > 80:
        logger.warning("SMS assistant provider request failed reason=invalid_response")
        raise provider_error("AI_INVALID_RESULT")
    return result
