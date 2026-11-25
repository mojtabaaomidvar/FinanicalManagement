"""Wire-capability gate; it is not authentication or permission to write money."""
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

MONEY_CONTRACT_HEADER = "X-Khaneyar-Money-Contract"
MONEY_CONTRACT = "decimal-v1"
FINANCIAL_ROOTS = {"accounts", "transactions", "bills", "shopping", "sms"}


def needs_money_contract(path: str, method: str) -> bool:
    parts = path.rstrip("/").split("/")
    if method == "OPTIONS" or parts[:3] != ["", "api", "v1"] or len(parts) < 4:
        return False
    resource = parts[3]
    # The existing machine bridge accepts raw SMS, never client money or a ledger write.
    if parts[3:] == ["sms", "bridge-ingest"] and method == "POST":
        return False
    # These exact existing routes forbid all monetary fields in their schema.
    if ((parts[3:] == ["shopping", "offline"] and method == "GET") or
            (parts[3:] == ["shopping", "offline", "mutations"] and method == "POST")):
        return False
    if resource in FINANCIAL_ROOTS:
        return True
    if resource in {"vehicles", "equipment"} and method not in {"GET", "HEAD"}:
        return method == "DELETE" or "services" in parts[4:]
    return False


class FinancialContractMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and needs_money_contract(scope["path"], scope["method"]):
            values = [value for name, value in scope["headers"]
                      if name.lower() == MONEY_CONTRACT_HEADER.lower().encode("ascii")]
            if values != [MONEY_CONTRACT.encode("ascii")]:
                # @copy-text errors.client_update_required
                message = "برای استفاده از بخش مالی، ابتدا برنامه را از تنظیمات به‌روزرسانی کنید."
                response = JSONResponse(status_code=409, content={
                    "error": "CLIENT_UPDATE_REQUIRED", "message": message,
                }, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
