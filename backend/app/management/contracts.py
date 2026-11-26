"""The same finite operation contract is checked by the web service and root worker."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.feature_policy import FEATURE_KEYS, FEATURE_STATES

Role = Literal["owner", "operator", "viewer"]
Kind = Literal[
    "service.start",
    "service.stop",
    "service.restart",
    "nginx.reload",
    "certificate.renew",
    "host.reboot",
    "host.cancel_reboot",
    "backup.create",
    "backup.verify",
    "backup.restore",
    "backup.schedule",
    "release.fetch",
    "release.install",
    "settings.update",
    "user.suspend",
    "user.activate",
    "user.revoke_sessions",
]
OWNER_ONLY = {"backup.restore", "release.install", "host.reboot", "host.cancel_reboot"}
SECRET_KEYS = {"SMS_API_KEY", "DEEPSEEK_API_KEY", "AI_SMS_GATEWAY_TOKEN"}
ENV_KEYS = SECRET_KEYS | {
    "SMS_PROVIDER",
    "SMS_SENDER",
    "SMS_TEMPLATE",
    "AI_SMS_MODEL",
    "AI_SMS_GATEWAY_URL",
    "AI_CONNECTION_MODE", "AI_SMS_TIMEOUT_SECONDS", "AI_MAX_OUTPUT_TOKENS",
    "AI_REQUESTS_PER_DAY", "AI_FAMILY_REQUESTS_PER_DAY", "AI_MAX_CONCURRENT",
}
AI_CONTROL_KEYS = {
    "AI_CONNECTION_MODE", "AI_SMS_TIMEOUT_SECONDS", "AI_MAX_OUTPUT_TOKENS",
    "AI_REQUESTS_PER_DAY", "AI_FAMILY_REQUESTS_PER_DAY", "AI_MAX_CONCURRENT",
}
AI_NUMERIC_BOUNDS = {
    "AI_SMS_TIMEOUT_SECONDS": (1, 25), "AI_MAX_OUTPUT_TOKENS": (256, 8192),
    "AI_REQUESTS_PER_DAY": (0, 1_000_000), "AI_FAMILY_REQUESTS_PER_DAY": (0, 100_000),
    "AI_MAX_CONCURRENT": (0, 64),
}
FLAG_KEYS = {"maintenance", "registration_enabled", "assistant_enabled", "otp_enabled"}
READS = {
    "overview", "services", "users", "settings", "backups", "releases", "logs", "analytics",
    "ai-analytics",
}


class ManagementError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        self.code, self.message, self.status = code, message, status
        super().__init__(code)


class Operation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Kind
    target: str = Field(default="", max_length=100)
    values: dict[str, str | bool] = Field(default_factory=dict, max_length=64)
    expected: str = Field(default="", max_length=64)

    @model_validator(mode="after")
    def validate_operation(self):
        valid = True
        if self.kind.startswith("service."):
            valid = self.target in {"api", "db"} and not self.values
        elif self.kind.startswith("user."):
            from uuid import UUID

            try:
                valid = str(UUID(self.target)) == self.target and not self.values
            except ValueError:
                valid = False
        elif self.kind in {"backup.restore", "backup.verify"}:
            valid = (
                bool(re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", self.target))
                and not self.values
            )
        elif self.kind in {"release.fetch", "release.install"}:
            valid = (
                bool(re.fullmatch(r"v[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}", self.target))
                and not self.values
            )
        elif self.kind == "backup.schedule":
            valid = (
                not self.target
                and set(self.values) == {"enabled"}
                and type(self.values["enabled"]) is bool
            )
        elif self.kind == "settings.update":
            valid = (
                not self.target and bool(self.values)
                and set(self.values) <= ENV_KEYS | FLAG_KEYS | FEATURE_KEYS
            )
            for key, value in self.values.items():
                if key in FLAG_KEYS:
                    valid = valid and type(value) is bool
                elif key in FEATURE_KEYS:
                    valid = valid and isinstance(value, str) and value in FEATURE_STATES
                else:
                    valid = (
                        valid
                        and isinstance(value, str)
                        and len(value) <= 1024
                        and not any(c in value for c in "\r\n\x00")
                    )
                    if isinstance(value, str) and any(c in value for c in "\"'`$\\"):
                        valid = False
                    if key in AI_NUMERIC_BOUNDS:
                        lower, upper = AI_NUMERIC_BOUNDS[key]
                        valid = (valid and isinstance(value, str) and value.isascii()
                                 and value.isdigit() and len(value) <= 7
                                 and lower <= int(value) <= upper)
                    if key == "AI_CONNECTION_MODE":
                        valid = valid and value in {"auto", "direct", "gateway", "disabled"}
                    if key == "AI_SMS_MODEL":
                        valid = valid and bool(re.fullmatch(r"[A-Za-z0-9._-]{1,100}", str(value)))
            provider = self.values.get("SMS_PROVIDER", "")
            valid = valid and provider in {"", "kavenegar"}
            gateway = self.values.get("AI_SMS_GATEWAY_URL", "")
            if gateway:
                from urllib.parse import urlsplit

                url = urlsplit(str(gateway))
                valid = (
                    valid
                    and url.scheme == "https"
                    and bool(url.hostname)
                    and not url.username
                    and not url.password
                    and not url.fragment
                    and not url.query
                )
        else:
            valid = not self.target and not self.values
        if not valid or (self.expected and not re.fullmatch(r"[a-f0-9]{64}", self.expected)):
            raise ValueError("Invalid management operation")
        return self

    def public(self) -> dict:
        result = self.model_dump()
        result["values"] = {
            key: "[redacted]" if key in SECRET_KEYS else value for key, value in self.values.items()
        }
        return result


def authorize(role: Role, kind: str) -> None:
    if role == "viewer" or (kind in OWNER_ONLY and role != "owner"):
        raise ManagementError("FORBIDDEN", "برای انجام این عملیات دسترسی کافی ندارید.", 403)


class Config(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["production", "demo"] = "production"
    origin: str
    state_dir: Path
    web_root: Path
    deploy_dir: Path = Path("/opt/khaneyar/backend/deploy")
    backup_dir: Path = Path("/var/backups/khaneyar/management")
    release_dir: Path = Path("/opt/khaneyar-management/releases")
    web_dir: Path = Path("/var/www/khaneyar")
    helper: Path = Path("/usr/local/sbin/khaneyar-management-worker")
    host: str = "127.0.0.1"
    port: int = Field(default=5710, ge=1024, le=65535)

    @model_validator(mode="after")
    def validate_origin(self):
        from urllib.parse import urlsplit

        url = urlsplit(self.origin)
        if (
            url.path
            or url.query
            or url.fragment
            or url.username
            or url.password
            or not url.hostname
        ):
            raise ValueError("Origin must be exact and must not contain a path")
        if self.host != "127.0.0.1":
            raise ValueError("Management listens on loopback only")
        if self.mode == "production" and url.scheme != "https":
            raise ValueError("Production requires HTTPS")
        if self.mode == "demo" and url.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("Demo is local only")
        paths = [self.state_dir, self.web_root]
        if self.mode == "production":
            paths.extend(
                [self.deploy_dir, self.backup_dir, self.release_dir, self.web_dir, self.helper]
            )
        for path in paths:
            if not path.is_absolute():
                raise ValueError("Management paths must be absolute")
        return self
