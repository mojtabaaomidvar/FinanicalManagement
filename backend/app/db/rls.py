"""زمینهٔ خانواده برای RLS — پیوندِ درخواستِ احرازشده به پالیسی‌های Postgres.

هر درخواستِ احرازشده family_id عضو را در یک ContextVar می‌گذارد؛ این ماژول تضمین
می‌کند که این مقدار به‌صورت `SET LOCAL app.family_id` روی «هر» تراکنشِ آن درخواست
اعمال شود تا پالیسی‌های RLS (مهاجرت 0002) ردیف‌ها را به همان خانواده محدود کنند.

چرا رویدادِ after_begin و نه یک‌بار تنظیم در وابستگی؟ سرویس‌ها در میانهٔ درخواست
commit می‌کنند؛ با پایانِ تراکنش، GUCِ transaction-local پاک می‌شود و تراکنشِ بعدیِ
همان درخواست باید دوباره آن را بگیرد. رویداد این کار را خودکار می‌کند (fail-safe).
"""

from __future__ import annotations

from contextvars import ContextVar, Token

from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal

# مقدار جاریِ family_id برای درخواست فعلی (ایزوله per-request با contextvars).
_current_family: ContextVar[str | None] = ContextVar("app_current_family_id", default=None)

# نسخهٔ ORM (bind param امن) برای اعمال روی تراکنشِ بازِ فعلی.
_SET_SQL = text("SELECT set_config('app.family_id', :fid, true)")


def set_current_family(family_id: object) -> Token:
    """family_id درخواست را ثبت می‌کند؛ توکنِ ریست را برای finally برمی‌گرداند."""
    return _current_family.set(str(family_id))


def reset_current_family(token: Token) -> None:
    """زمینه را به حالت قبل برمی‌گرداند (پایان درخواست) تا به درخواست بعدی نشت نکند."""
    _current_family.reset(token)


def current_family() -> str | None:
    return _current_family.get()


def apply_to_transaction(db: Session) -> None:
    """اگر زمینهٔ خانواده ست شده، GUC را روی تراکنشِ بازِ فعلی هم بگذار.

    برای پوشش تراکنشی که «پیش از» ست‌شدن contextvar باز شده بود (مثلاً خواندنِ عضو در
    get_current_member) و رویدادِ after_begin برایش دیرکرده است.
    """
    fid = _current_family.get()
    if fid is not None:
        db.execute(_SET_SQL, {"fid": fid})


@event.listens_for(SessionLocal, "after_begin")
def _set_family_on_begin(session: Session, transaction: object, connection: object) -> None:
    """با آغازِ هر تراکنش، در صورت وجودِ زمینه، GUCِ transaction-local را تنظیم کن."""
    fid = _current_family.get()
    if fid is not None:
        # exec_driver_sql: مستقیم روی DBAPI (psycopg3، paramstyle=pyformat).
        connection.exec_driver_sql(  # type: ignore[attr-defined]
            "SELECT set_config('app.family_id', %s, true)", (fid,)
        )
