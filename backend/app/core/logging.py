"""پیکربندی لاگ با ردکشن اسرار/توکن.

هدف: هیچ توکن نشست، کلید، یا رمزی هرگز در لاگ ظاهر نشود (پیشگیری از نشت).

**چرا ردکشن در `Formatter` است، نه فقط در `Filter` (۲۰۲۶-۰۹-۲۸).** نسخهٔ پیشین
تنها `record.msg` را می‌شست. ولی `logging.Formatter` تراسِ خطا را از
`record.exc_info` می‌سازد و **پس از** اجرای فیلترها به متن می‌چسباند — پس هر
`log.exception(...)` یک تراسِ نشویده بیرون می‌داد و ادعای بالا دروغ بود. دو
نمونهٔ واقعی: تراسِ `httpx` آدرسِ کاوه‌نگار را با کلیدِ درونِ *مسیر* دارد، و
تراسِ `StatementError` پستگرس بندِ `[parameters: …]` را با `password_hash` و
`code_hash` و هشِ توکنِ نشست چاپ می‌کند (قاعدهٔ ۲۳).

پس دو تور گذاشته شد: فیلتر (پیام را در سطحِ رکورد بی‌خطر می‌کند، تا هندلرِ
ثالث هم پوشیده باشد) و فورمتر (متنِ نهایی — پیام + تراس + استک — را می‌شوید).
"""

from __future__ import annotations

import logging
import re

# الگوهای حساس که در متن لاگ ماسک می‌شوند
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9._\-]+"), r"\1***"),
    (re.compile(r"(?i)(api[_-]?key\"?\s*[:=]\s*\"?)[^\"\s,&]+"), r"\1***"),
    # پارامتر لخت `key=` در کوئری‌استرینگ (مثلاً ?key=… در آدرس BrsApi).
    # الگوی api_key بالا این را نمی‌گرفت و کلید کامل در لاگ می‌نشست.
    (re.compile(r"(?i)([?&]key=)[^&\s\"]+"), r"\1***"),
    # `key` بی‌هیچ `?`/`&`ِ پیشین — مثلاً وقتی دیکشنریِ پارامترها مستقیم لاگ
    # می‌شود: `params: {'key': '…'}`. الگوی بالا فقط شکلِ کوئری را می‌گرفت.
    # دو مهارِ خطای‌مثبت: (۱) پیش از `key` باید آغازِ متن یا یکی از
    # `فاصله ، { ( [` باشد، تا دنبالهٔ واژه‌هایی مثل `sortkey=`/`cache_key=`
    # تطبیق نکند؛ (۲) مقدار دست‌کم ۸ نویسه، تا نثرِ انگلیسیِ متنِ خطا مثل
    # `primary key: id` ماسک نشود. هیچ کلیدِ واقعی کوتاه‌تر از ۸ نیست، و
    # شکلِ کوئری‌استرینگ همچنان با الگوی بالا بی‌قید‌وشرط ماسک می‌شود.
    (
        re.compile(
            r"(?i)((?:^|[\s,{(\[])['\"]?key['\"]?\s*[:=]\s*['\"]?)[^'\"\s,&}\)\]]{8,}"
        ),
        r"\1***",
    ),
    # کاوه‌نگار کلید را در *مسیرِ* آدرس می‌گذارد، نه در کوئری:
    # https://api.kavenegar.com/v1/{API-KEY}/verify/lookup.json
    # پس هیچ‌یک از الگوهای بالا آن را نمی‌گرفت. متنِ استثنای httpx آدرس را
    # در خودش دارد، پس این الگو تورِ دومِ ایمنی است (تورِ اول: services/sms.py
    # هیچ آدرسی لاگ نمی‌کند و خطاها را از _scrub رد می‌کند).
    (re.compile(r"(?i)(kavenegar\.com/v[0-9]+/)[^/\s\"]+"), r"\1***"),
    (re.compile(r"(?i)(password\"?\s*[:=]\s*\"?)[^\"\s,&]+"), r"\1***"),
    (re.compile(r"(?i)(token\"?\s*[:=]\s*\"?)[^\"\s,&]+"), r"\1***"),
    # خودِ *مقدارِ* هشِ رمز، بی‌نیاز به برچسبِ `password=`. در تراسِ
    # SQLAlchemy هش‌ها لخت داخل تاپلِ پارامترها می‌نشینند و هیچ‌یک از
    # الگوهای برچسب‌دارِ بالا آن‌ها را نمی‌گرفت.
    #
    # ⚠️ ویرگول **نباید** در مجموعهٔ استثنا باشد: خودِ هشِ Argon2 ویرگول دارد
    # (`m=65536,t=3,p=4`)، پس با استثنا‌کردنِ ویرگول تطبیق همان‌جا می‌ایستاد و
    # نمک و دایجست — یعنی بخشِ حساس — بیرون می‌ماند. مقادیرِ تاپل کوتیشن‌دارند،
    # پس ایستادن روی کوتیشن/فاصله/پرانتز کافی است.
    (re.compile(r"\$argon2[a-z]*\$[^\s'\")]+"), "***"),
    (re.compile(r"\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}"), "***"),
    # بندِ پارامترهای SQLAlchemy تا پایانِ خط بریده می‌شود: محتوایش هر ستونی
    # می‌تواند باشد (هشِ رمز، هشِ کدِ یک‌بارمصرف، شمارهٔ کارت)، پس وارسیِ
    # الگو‌به‌الگو شکننده است. خودِ متنِ خطا و جایگاهش باقی می‌ماند.
    (re.compile(r"(?i)\[parameters:.*"), "[parameters: ***]"),
    (re.compile(r"\b[a-fA-F0-9]{64}\b"), "***"),  # توکن/هش ۶۴ کاراکتری hex
]


def scrub(text: str) -> str:
    """همهٔ الگوهای حساس را در یک رشته ماسک می‌کند."""
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    return text


class RedactingFilter(logging.Filter):
    """اسرار را از پیام لاگ قبل از خروجی حذف می‌کند.

    تورِ اول. تراس را نمی‌گیرد (آن کارِ `RedactingFormatter` است)، ولی پیام را
    در سطحِ *رکورد* بی‌خطر می‌کند تا اگر روزی هندلرِ دیگری هم به این لاگر وصل
    شد، پیام از آن مسیر هم نشت نکند.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        record.msg = scrub(msg)
        record.args = ()
        return True


class RedactingFormatter(logging.Formatter):
    """تورِ دوم: متنِ نهایی را می‌شوید — شاملِ تراسِ خطا و استک.

    این تنها جایی است که `exc_info`/`stack_info` به رشته تبدیل شده و قابلِ
    شستن است؛ فیلترها پیش از آن اجرا می‌شوند.
    """

    def format(self, record: logging.LogRecord) -> str:
        return scrub(super().format(record))


def configure_logging(debug: bool = False) -> None:
    """پیکربندی لاگ ریشه با فیلتر ردکشن."""
    level = logging.DEBUG if debug else logging.INFO
    handler = logging.StreamHandler()
    handler.setFormatter(
        RedactingFormatter("%(asctime)s %(levelname)s %(name)s — %(message)s")
    )
    handler.addFilter(RedactingFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # httpx در سطح INFO کل آدرس درخواست را لاگ می‌کند؛ برای فراخوانی BrsApi
    # یعنی `?key=…` مستقیم روی دیسک سرور می‌نشیند. فیلتر ردکشن آن را ماسک
    # می‌کند، ولی اتکا به یک الگوی رشته‌ای برای یک راز شکننده است — پس خود
    # لاگر هم به WARNING می‌رود (خطاها باقی می‌مانند، آدرس‌ها نه).
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
