"""زمینهٔ خانواده برای RLS — پیوند درخواست احرازشده به پالیسی‌های Postgres.

هر درخواست احرازشده family_id عضو را در یک ContextVar می‌گذارد؛ این ماژول تضمین
می‌کند که این مقدار به‌صورت `SET LOCAL app.family_id` روی «هر» تراکنش آن درخواست
اعمال شود تا پالیسی‌های RLS (مهاجرت 0002) ردیف‌ها را به همان خانواده محدود کنند.

چرا رویداد after_begin و نه یک‌بار تنظیم در وابستگی؟ سرویس‌ها در میانهٔ درخواست
commit می‌کنند؛ با پایان تراکنش، GUC transaction-local پاک می‌شود و تراکنش بعدی
همان درخواست باید دوباره آن را بگیرد. رویداد این کار را خودکار می‌کند (fail-safe).

رفعِ شکافِ #۶ (زمینه پس از commit گم می‌شد): منبعِ حقیقتِ اصلی از یک ContextVar به
`Session.info` منتقل شد. ContextVar در threadpoolِ FastAPI بینِ وابستگیِ همگام و
اندپوینتِ همگام کپی/گم می‌شود؛ ولی آبجکتِ Session در طولِ کلِ درخواست یکی است و
`after_begin` همان session را به‌عنوان آرگومان می‌گیرد. پس خواندن از `session.info`
مستقل از زمینهٔ اجراست و پس از هر commit هم درست بازمی‌گردد. ContextVar فقط fallback
می‌ماند (برای کدی که هنوز current_family() را صدا می‌زند).
"""

from __future__ import annotations

from contextvars import ContextVar, Token

from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal

# مقدار جاری family_id برای درخواست فعلی (ایزوله per-request با contextvars — fallback).
_current_family: ContextVar[str | None] = ContextVar("app_current_family_id", default=None)

# کلیدِ پایدارِ روی خودِ آبجکتِ Session (منبعِ اصلیِ زمینه؛ رفعِ #۶).
_INFO_KEY = "app_family_id"

# نسخهٔ ORM (bind param امن) برای اعمال روی تراکنش باز فعلی.
_SET_SQL = text("SELECT set_config('app.family_id', :fid, true)")


def _effective_family(session: Session) -> str | None:
    """زمینهٔ مؤثر: اول Session.info (پایدار پس از commit)، بعد ContextVar."""
    fid = session.info.get(_INFO_KEY)
    return fid if fid is not None else _current_family.get()


def bind_family_to_session(db: Session, family_id: object) -> None:
    """family_id را روی خودِ آبجکتِ Session می‌چسباند (نه ContextVar).

    این روی همهٔ تراکنش‌های همان Session — و مهم‌تر، «پس از commit» — پایدار است، پس
    after_begin می‌تواند GUC را دوباره بگذارد. برای دو کاربرد: (۱) مسیرهای دادهٔ
    احرازشده (get_tenant_member)، (۲) جریانِ پیش‌از‌احرازِ پیوستن که زمینه را از
    توکنِ سرور-تأییدشدهٔ دعوت/کد می‌گیرد تا INSERT زیرِ RLS برقرار بماند.
    """
    db.info[_INFO_KEY] = str(family_id)
    apply_to_transaction(db)  # پوشش تراکنشی که همین‌حالا باز است


def clear_family_from_session(db: Session) -> None:
    """زمینهٔ چسبیده به Session را پاک می‌کند (پایان مسیرِ احرازشده)."""
    db.info.pop(_INFO_KEY, None)


def set_current_family(family_id: object) -> Token:
    """family_id درخواست را در ContextVar ثبت می‌کند؛ توکن ریست را برمی‌گرداند."""
    return _current_family.set(str(family_id))


def reset_current_family(token: Token) -> None:
    """زمینه را به حالت قبل برمی‌گرداند (پایان درخواست) تا به درخواست بعدی نشت نکند.

    چرا try/except: FastAPI وابستگی ژنراتور همگام را در threadpool اجرا می‌کند و
    starlette زمینه را کپی می‌کند؛ گاه بخش finally در زمینه‌ای جدا از جایی که
    توکن ساخته شد اجرا می‌شود و `reset` با «was created in a different Context»
    استثنا می‌دهد. آن استثنا از وابستگی بالا می‌رفت و پاسخ درخواست را خراب
    می‌کرد. در آن حالت پاک‌کردن صریح (ست روی None) همان اثر ایمن را دارد:
    زمینه به درخواست بعدی نشت نمی‌کند و RLS همچنان fail-closed می‌ماند.
    """
    try:
        _current_family.reset(token)
    except ValueError:
        _current_family.set(None)


def current_family() -> str | None:
    return _current_family.get()


def apply_to_transaction(db: Session) -> None:
    """اگر زمینهٔ خانواده ست شده، GUC را روی تراکنش باز فعلی هم بگذار.

    برای پوشش تراکنشی که «پیش از» ست‌شدن زمینه باز شده بود (مثلاً خواندن عضو در
    get_current_member) و رویداد after_begin برایش دیرکرده است.
    """
    fid = _effective_family(db)
    if fid is not None:
        db.execute(_SET_SQL, {"fid": fid})


@event.listens_for(SessionLocal, "after_begin")
def _set_family_on_begin(session: Session, transaction: object, connection: object) -> None:
    """با آغاز هر تراکنش، در صورت وجود زمینه، GUC transaction-local را تنظیم کن.

    زمینه از session.info خوانده می‌شود (پایدار پس از commit؛ رفعِ #۶) و اگر نبود
    از ContextVar. آرگومانِ session همیشه همان Session این تراکنش است، پس مستقل از
    زمینهٔ اجرای threadpool درست کار می‌کند.
    """
    fid = _effective_family(session)
    if fid is not None:
        # exec_driver_sql: مستقیم روی DBAPI (psycopg3، paramstyle=pyformat).
        connection.exec_driver_sql(  # type: ignore[attr-defined]
            "SELECT set_config('app.family_id', %s, true)", (fid,)
        )
