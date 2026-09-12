"""قرارداد خروجیِ اندپوینت‌های خواندنِ داده (Pydantic v2) — فاز ۶.

اصول (هم‌راستا با schemas/auth.py):
- سازندهٔ صریحِ `.of(model)` هر فیلد را دستی می‌سازد؛ هرگز ستونِ ناخواسته‌ای درز نمی‌کند.
- نامِ فیلدها دقیقاً snake_case ستون‌های دیتابیس‌اند تا با ردیف‌های `mappers.ts`
  فرانت (فاز ۹) مو‌به‌مو بخوانند و نگاشت بدون تغییر بماند.
- مبالغ (Numeric) مثل `FamilyOut.budget` به‌صورت «عدد» (float) سریال می‌شوند تا با
  انتظار فعلی کلاینت (`+r.amount`) سازگار بمانند. محدودهٔ دقیقِ float64 (تا ۲^۵۳)
  برای مبالغ ریالیِ خانواده کافی است؛ اگر روزی دقتِ بانکی لازم شد، کلِ قراردادِ پول
  یک‌جا به رشته/واحدِ خرد تغییر می‌کند (تصمیمِ جداگانه).
- تاریخ‌های «فقط-تاریخ» (میلادی) به رشتهٔ 'YYYY-MM-DD' و `created_at` به ISO سریال می‌شوند.
"""

from __future__ import annotations

from datetime import date as _date
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from pydantic import BaseModel, field_serializer

if TYPE_CHECKING:  # فقط تایپ؛ وابستگی زمان‌اجرا به مدل‌ها ایجاد نمی‌کند
    from app.models.account import Account
    from app.models.category import CategoryBudget, CustomCategory, Subcategory
    from app.models.event import FamilyEvent
    from app.models.holding import Holding
    from app.models.messaging import SmsBridge, SmsMessage
    from app.models.transaction import Transaction, TransactionPhoto


def _uuid(value: object) -> str:
    """UUID → str (غیرِ None)."""
    return str(value)


def _uuid_opt(value: object) -> str | None:
    """UUID اختیاری → str یا None."""
    return None if value is None else str(value)


def _isodate(value: _date | None) -> str | None:
    """Date میلادی → 'YYYY-MM-DD' یا None."""
    return value.isoformat() if isinstance(value, _date) else None


# ── حساب‌ها ──────────────────────────────────────────────────
class AccountOut(BaseModel):
    id: str
    family_id: str
    member_id: str
    title: str
    kind: str
    bank: str | None
    card_number: str | None
    initial_balance: Decimal
    created_at: datetime

    @field_serializer("initial_balance")
    def _ser_initial_balance(self, v: Decimal) -> float:
        return float(v)

    @classmethod
    def of(cls, a: Account) -> AccountOut:
        return cls(
            id=_uuid(a.id),
            family_id=_uuid(a.family_id),
            member_id=_uuid(a.member_id),
            title=a.title,
            kind=a.kind,
            bank=a.bank,
            card_number=a.card_number,
            initial_balance=a.initial_balance,
            created_at=a.created_at,
        )


# ── تراکنش‌ها (+ عکس‌های تودرتو) ─────────────────────────────
class TransactionPhotoOut(BaseModel):
    """معادلِ آرایهٔ photos در list_transactions قدیمی: فقط id/url/caption."""

    id: str
    url: str
    caption: str | None

    @classmethod
    def of(cls, p: TransactionPhoto) -> TransactionPhotoOut:
        return cls(id=_uuid(p.id), url=p.url, caption=p.caption)


class TransactionOut(BaseModel):
    id: str
    family_id: str
    member_id: str
    type: str
    amount: Decimal
    category: str
    date: str  # میلادی 'YYYY-MM-DD'
    time: str | None
    note: str | None
    account_id: str | None
    to_account_id: str | None
    subcategory_id: str | None
    repeat: str
    repeat_end: str | None  # میلادی 'YYYY-MM-DD'
    handled_occurrences: list[str]
    photos: list[TransactionPhotoOut]
    created_at: datetime

    @field_serializer("amount")
    def _ser_amount(self, v: Decimal) -> float:
        return float(v)

    @classmethod
    def of(cls, t: Transaction, photos: list[TransactionPhoto]) -> TransactionOut:
        return cls(
            id=_uuid(t.id),
            family_id=_uuid(t.family_id),
            member_id=_uuid(t.member_id),
            type=t.type,
            amount=t.amount,
            category=t.category,
            date=t.date.isoformat(),
            time=t.time,
            note=t.note,
            account_id=_uuid_opt(t.account_id),
            to_account_id=_uuid_opt(t.to_account_id),
            subcategory_id=_uuid_opt(t.subcategory_id),
            repeat=t.repeat,
            repeat_end=_isodate(t.repeat_end),
            handled_occurrences=list(t.handled_occurrences or []),
            photos=[TransactionPhotoOut.of(p) for p in photos],
            created_at=t.created_at,
        )


# ── زیردسته‌ها / دسته‌های سفارشی / بودجهٔ دسته‌ها ────────────
class SubcategoryOut(BaseModel):
    id: str
    family_id: str
    category: str
    name: str
    created_at: datetime

    @classmethod
    def of(cls, s: Subcategory) -> SubcategoryOut:
        return cls(
            id=_uuid(s.id),
            family_id=_uuid(s.family_id),
            category=s.category,
            name=s.name,
            created_at=s.created_at,
        )


class CustomCategoryOut(BaseModel):
    id: str
    family_id: str
    type: str
    name: str
    created_at: datetime

    @classmethod
    def of(cls, c: CustomCategory) -> CustomCategoryOut:
        return cls(
            id=_uuid(c.id),
            family_id=_uuid(c.family_id),
            type=c.type,
            name=c.name,
            created_at=c.created_at,
        )


class CategoryBudgetOut(BaseModel):
    id: str
    family_id: str
    category: str
    amount: Decimal
    created_at: datetime

    @field_serializer("amount")
    def _ser_amount(self, v: Decimal) -> float:
        return float(v)

    @classmethod
    def of(cls, b: CategoryBudget) -> CategoryBudgetOut:
        return cls(
            id=_uuid(b.id),
            family_id=_uuid(b.family_id),
            category=b.category,
            amount=b.amount,
            created_at=b.created_at,
        )


# ── پیامک‌های بانکی ──────────────────────────────────────────
class SmsOut(BaseModel):
    id: str
    family_id: str
    member_id: str | None
    raw_text: str
    bank: str | None
    type: str | None
    amount: Decimal | None
    balance: Decimal | None
    date: str | None  # میلادی 'YYYY-MM-DD'
    status: str
    created_at: datetime

    @field_serializer("amount", "balance")
    def _ser_money(self, v: Decimal | None) -> float | None:
        return None if v is None else float(v)

    @classmethod
    def of(cls, s: SmsMessage) -> SmsOut:
        return cls(
            id=_uuid(s.id),
            family_id=_uuid(s.family_id),
            member_id=_uuid_opt(s.member_id),
            raw_text=s.raw_text,
            bank=s.bank,
            type=s.type,
            amount=s.amount,
            balance=s.balance,
            date=_isodate(s.date),
            status=s.status,
            created_at=s.created_at,
        )


# ── پلِ پیامک (get_bridge: فقط token + member_id، یا null) ──
class BridgeOut(BaseModel):
    token: str
    member_id: str

    @classmethod
    def of(cls, b: SmsBridge) -> BridgeOut:
        return cls(token=b.token, member_id=_uuid(b.member_id))


# ── عکسِ کاملِ تراکنش (خروجیِ add_tx_photo؛ معادل to_jsonb(row) قدیمی) ──
class PhotoOut(BaseModel):
    """ردیفِ کاملِ عکس — خروجیِ نوشتنِ add_tx_photo (خواندن نمای کوتاهِ
    TransactionPhotoOut را دارد). فرانت خروجی را نادیده می‌گیرد، اما قرارداد
    را وفادار به RPC قدیمی (returns json) نگه می‌داریم."""

    id: str
    family_id: str
    transaction_id: str
    member_id: str
    url: str
    caption: str | None
    created_at: datetime

    @classmethod
    def of(cls, p: TransactionPhoto) -> PhotoOut:
        return cls(
            id=_uuid(p.id),
            family_id=_uuid(p.family_id),
            transaction_id=_uuid(p.transaction_id),
            member_id=_uuid(p.member_id),
            url=p.url,
            caption=p.caption,
            created_at=p.created_at,
        )


# ── رویدادهای خانواده ────────────────────────────────────────
class EventOut(BaseModel):
    id: str
    family_id: str
    member_id: str | None
    for_member_id: str | None
    title: str
    date: str  # میلادی 'YYYY-MM-DD'
    note: str | None
    created_at: datetime

    @classmethod
    def of(cls, e: FamilyEvent) -> EventOut:
        return cls(
            id=_uuid(e.id),
            family_id=_uuid(e.family_id),
            member_id=_uuid_opt(e.member_id),
            for_member_id=_uuid_opt(e.for_member_id),
            title=e.title,
            date=e.date.isoformat(),
            note=e.note,
            created_at=e.created_at,
        )


# ═══════════════════════════════════════════════════════════════
# بدنه‌های ورودیِ نوشتن (فاز ۷)
# ───────────────────────────────────────────────────────────────
# عمداً «سهل‌گیر» (فیلدها Optional با پیش‌فرضِ None): همهٔ اعتبارسنجیِ
# تجاری در لایهٔ سرویس با کدهای خطای پایدار (INVALID_TYPE، INVALID_AMOUNT،
# BANK_MISMATCH، …) انجام می‌شود تا نگاشتِ خطای کلاینت (RPC_ERROR_MAP) بی‌تغییر
# بماند. اگر اینجا اعتبارسنجیِ سخت بگذاریم، خطاها به‌جای کدِ دامنه، 422ِ Pydantic
# می‌شوند و قرارداد می‌شکند. تاریخ‌ها 'YYYY-MM-DD' و مبالغ عدد/رشته → Decimal.
# ═══════════════════════════════════════════════════════════════


class TransactionWrite(BaseModel):
    """ورودیِ افزودن/ویرایش تراکنش (هزینه/درآمد/انتقال)."""

    member_id: str | None = None
    type: str | None = None
    amount: Decimal | None = None
    category: str | None = None
    date: _date | None = None
    note: str | None = None
    account_id: str | None = None
    subcategory_id: str | None = None
    time: str | None = None
    to_account_id: str | None = None
    repeat: str = "none"
    repeat_end: _date | None = None


class OccurrenceMark(BaseModel):
    """ثبتِ رسیدگی به یک سررسیدِ تراکنش تکرارشونده."""

    due_date: _date | None = None


class PhotoCreate(BaseModel):
    url: str | None = None
    caption: str | None = None


class CaptionUpdate(BaseModel):
    caption: str | None = None


class AccountCreate(BaseModel):
    member_id: str | None = None
    title: str | None = None
    bank: str | None = None
    card_number: str | None = None
    kind: str = "bank"
    initial_balance: Decimal | None = None


class AccountUpdate(BaseModel):
    """ویرایش حساب: نوع (kind) و مالک تغییرناپذیرند؛ موجودی اینجا منفی هم می‌پذیرد."""

    title: str | None = None
    bank: str | None = None
    card_number: str | None = None
    initial_balance: Decimal | None = None


class SubcategoryCreate(BaseModel):
    category: str | None = None
    name: str | None = None


class CustomCategoryCreate(BaseModel):
    type: str | None = None
    name: str | None = None


class CategoryBudgetSet(BaseModel):
    category: str | None = None
    amount: Decimal | None = None


class SmsItem(BaseModel):
    raw_text: str | None = None
    bank: str | None = None
    type: str | None = None
    amount: Decimal | None = None
    balance: Decimal | None = None
    date: _date | None = None


class SmsBatch(BaseModel):
    items: list[SmsItem] = []


class SmsStatusUpdate(BaseModel):
    status: str | None = None


# ── ingestِ پیامک (فاز ۸): پارس «سمت سرور» ───────────────────
# برخلافِ SmsItem/SmsBatch (که فیلدهای «پارس‌شده» را از کلاینت می‌گیرند)، این‌ها فقط
# متنِ خام را می‌گیرند و سرور خودش پارس می‌کند تا وب و اندروید یک نتیجهٔ یکسان بدهند.
class SmsIngestItem(BaseModel):
    """یک پیامکِ خام برای پارسِ سمت‌سرور (خواندنِ نیتیوِ اپ یا مسیرِ دستیِ آینده)."""

    raw_text: str | None = None
    sender: str | None = None  # فرستنده (اختیاری) — فقط کمکی برای تشخیصِ بانک


class SmsIngestBatch(BaseModel):
    items: list[SmsIngestItem] = []


class BridgeIngest(BaseModel):
    """بدنهٔ webhookِ پل (جایگزینِ api/sms-webhook.js): {token, text, sender?}.

    احراز با «توکنِ پل» است، نه نشستِ کاربر؛ پس token در بدنه می‌آید (استثنای آگاهانه
    نسبت به قاعدهٔ «هویت فقط از Bearer»؛ این یک webhookِ ماشین-به-ماشین است)."""

    token: str | None = None
    text: str | None = None
    sender: str | None = None


class IngestResult(BaseModel):
    """خروجیِ bridge-ingest: تعدادِ پیامکِ واردشده (۰ یا ۱)."""

    ok: bool
    count: int


# ── آپلودِ فایل (فاز ۸): dataURL → استوریجِ خصوصی + URLِ امضاشده ──
# احراز با نشستِ Bearer است (نه توکن-در-بدنه مثلِ توابعِ سرورلسِ قبلی)؛ پس بدنه فقط
# خودِ تصویر را دارد. خروجی همان شکلِ قبلی {ok, url} است تا نگاشتِ کلاینت کم‌تغییر بماند.
class UploadIn(BaseModel):
    """بدنهٔ آپلود: تصویر به‌صورتِ dataURLِ base64 (png/jpeg/webp)."""

    image: str | None = None


class UploadOut(BaseModel):
    """خروجیِ آپلود: URLِ امضاشدهٔ قابلِ ذخیره در DB و رندر در <img>."""

    ok: bool
    url: str


class EventCreate(BaseModel):
    title: str | None = None
    date: _date | None = None
    note: str | None = None
    member_id: str | None = None
    for_member_id: str | None = None


class FamilySettingsUpdate(BaseModel):
    """فقط budget اعمال می‌شود؛ currency/dark برای سازگاریِ امضا پذیرفته و
    عمداً نادیده گرفته می‌شوند (واحد پول/تم اکنون شخصی‌اند)."""

    budget: Decimal | None = None
    currency: str | None = None
    dark: bool | None = None


class MemberProfileUpdate(BaseModel):
    name: str | None = None
    gender: str | None = None
    birth_date: _date | None = None
    # national_id حذف شد (درخواست مالک ۲۰۲۶-۰۹-۰۸): کدملی دیگر جمع‌آوری/ذخیره نمی‌شود.
    avatar_url: str | None = None
    theme: str | None = None


class ThemeUpdate(BaseModel):
    theme: str | None = None


class CurrencyUpdate(BaseModel):
    currency: str | None = None


class RelationUpdate(BaseModel):
    relation: str | None = None


# ── دارایی‌های بازاری ────────────────────────────────────────
class HoldingCreate(BaseModel):
    """افزودن دارایی — کاربر «مقدار» می‌دهد، نه مبلغ.

    symbol/name/unit از همان ردیفِ قیمتی می‌آید که کاربر رویش زده، پس کلاینت
    آن‌ها را عیناً پس می‌فرستد؛ سرور دوباره اعتبارسنجی می‌کند.
    """

    kind: str | None = None       # gold | currency | crypto | stock
    symbol: str | None = None
    name: str | None = None
    unit: str | None = None
    quantity: Decimal | None = None


class HoldingUpdate(BaseModel):
    """فقط مقدار ویرایش می‌شود؛ نوع و نماد تغییرناپذیرند.

    اگر کاربر بخواهد دارایی دیگری ثبت کند ردیفِ تازه می‌سازد — تغییرِ نماد یعنی
    ردیف دیگر معنایِ قبلی‌اش را ندارد و تاریخچه‌اش گمراه‌کننده می‌شود.
    """

    quantity: Decimal | None = None


class HoldingOut(BaseModel):
    """یک دارایی به‌همراهِ ارزشِ امروزش.

    price/value عمداً «ذخیره‌شده» نیستند؛ هر بار از قیمتِ روز حساب می‌شوند.
    priced=false یعنی نمادِ این ردیف در دادهٔ امروزِ بازار پیدا نشد (حذف/تغییرِ
    نام در بالادست یا خطای موقت). در آن حالت value صفر است ولی این «صفر» با
    «ارزشِ صفر» فرق دارد — کلاینت باید به‌جای عدد، هشدار نشان دهد. برای همین
    پرچمِ صریح داریم و صفرِ خاموش برنمی‌گردانیم.
    """

    id: str
    family_id: str
    member_id: str
    kind: str
    symbol: str
    name: str
    unit: str
    quantity: Decimal
    created_at: datetime
    price: float          # قیمتِ واحد در آخرین اسنپ‌شات
    value: float          # quantity × price
    priced: bool          # false = قیمتِ امروز پیدا نشد

    @field_serializer("quantity")
    def _ser_quantity(self, v: Decimal) -> float:
        return float(v)

    @classmethod
    def of(
        cls, h: Holding, price: float, priced: bool, unit: str | None = None
    ) -> HoldingOut:
        """unit از قیمتِ زنده می‌آید و فقط اگر نبود به عکسِ ذخیره‌شده برمی‌گردیم.

        اگر همیشه واحدِ ذخیره‌شده را نشان می‌دادیم، تغییرِ واحد در بالادست
        (مثلاً تومان → ریال) عددِ تازه را کنارِ برچسبِ کهنه می‌گذاشت — یعنی
        دقیقاً همان دادهٔ بی‌صدا کهنه‌ای که این طراحی برای حذفش ساخته شده.
        """
        return cls(
            id=_uuid(h.id),
            family_id=_uuid(h.family_id),
            member_id=_uuid(h.member_id),
            kind=h.kind,
            symbol=h.symbol,
            name=h.name,
            unit=unit if unit else h.unit,
            quantity=h.quantity,
            created_at=h.created_at,
            price=price,
            value=float(h.quantity) * price if priced else 0.0,
            priced=priced,
        )


class HoldingListOut(BaseModel):
    """فهرستِ دارایی‌ها + جمعِ ارزش.

    total فقط ردیف‌هایِ قیمت‌خورده را جمع می‌زند؛ پس اگر نمادی قیمت نداشت،
    جمع کم‌تر از واقعیت است نه غلط. unpriced تعدادشان را می‌گوید تا کلاینت
    بتواند بگوید «۱ مورد قیمت ندارد» به‌جای نمایشِ جمعِ گمراه‌کننده.
    """

    items: list[HoldingOut]
    total: float
    unpriced: int
    stale: bool           # true = قیمت‌ها از کشِ قدیمی آمده‌اند
