# خانه یار — بک‌اند (FastAPI)

بک‌اند مستقلِ «خانه یار» که جای Supabase (Postgres + RPCها + PostgREST + Storage + توابع Vercel) را می‌گیرد.

## معماری لایه‌ای

```
app/
  core/        پیکربندی، امنیت (Argon2id + توکن)، خطاها، لاگ
  db/          اتصال SQLAlchemy + Base  (فاز ۳)
  models/      مدل‌های ORM جداول  (فاز ۳)
  schemas/     مدل‌های Pydantic ورودی/خروجی  (فاز ۶+)
  services/    منطق کسب‌وکار (قواعد سمت سرور)  (فاز ۴+)
  api/v1/      روترها و اندپوینت‌ها
  main.py      کارخانهٔ اپ + میان‌افزار + هندلر خطا
alembic/       مهاجرت‌های نسخه‌دار دیتابیس  (فاز ۳)
tests/         تست‌ها  (فاز ۱۲)
```

## راه‌اندازی محلی

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # ویندوز: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env        # سپس مقادیر واقعی را در .env بگذارید
uvicorn app.main:app --reload --port 8000
```

بررسی سلامت: `GET http://localhost:8000/healthz`
مستندات تعاملی: `http://localhost:8000/docs` (فقط در حالت توسعه)

## مهاجرت‌های دیتابیس (Alembic)

نشانی دیتابیس از `DATABASE_URL` در `.env` خوانده می‌شود (نه از `alembic.ini`).

```bash
cd backend
alembic upgrade head          # ساخت کل اسکیمای کانونی (۱۸ جدول)
alembic downgrade -1          # بازگشت یک نسخه
alembic current               # نسخهٔ فعلی دیتابیس
alembic history               # تاریخچهٔ نسخه‌ها
```

نسخهٔ اولیه `0001_initial` تمام ۱۸ جدول را از نو و تمیز می‌سازد — بدون آرتیفکت‌های
سوپابیس (RPCهای SECURITY DEFINER، گرنت‌های PostgREST). دو نکتهٔ کلیدی این نسخه:

- **رفع D-7:** قید نوع تراکنش اکنون `('expense','income','transfer')` است؛ ثبت انتقال دیگر خطا نمی‌دهد.
- **رفع D-3:** ستون `sessions.token` هش SHA-256 توکن را نگه می‌دارد، نه توکن خام.

برای ساخت نسخهٔ بعدی پس از تغییر مدل‌ها:

```bash
alembic revision --autogenerate -m "توضیح تغییر"
# فایل تولیدشده را حتماً مرور کنید (autogenerate قیدهای بی‌نام و افزونه‌ها را نمی‌بیند)
```

> پالیسی‌های RLS در مهاجرت `0002_rls` اضافه شده‌اند (بخش «RLS و مرز خانواده» پایین‌تر).
> دادهٔ فاز ۱۰ با ابزارِ **«فقط ضروری»** ([`migration/migrate_essentials.py`](migration/migrate_essentials.py)،
> رانبوک: [`migration/RUNBOOK.md`](migration/RUNBOOK.md)) وارد همین اسکیمای ساخته‌شده می‌شود:
> فقط families/members/accounts/دسته‌ها + جدولِ مرجعِ `card_bins`؛ تراکنش/پیامک/رویداد و
> فایل‌ها (آواتار/رسید) از صفر، و `national_id` هرگز منتقل نمی‌شود. **مهم:** چون RLS با
> `FORCE` است، `0002` باید «پس از» بار دادهٔ فاز ۱۰ اجرا شود — یعنی `upgrade 0001` → بار
> داده → `upgrade head` (ابزار خودش این ترتیب را بررسی می‌کند).

## استقرار روی لیارا (فاز ۱۱)

بستهٔ استقرار در همین پوشه آماده است: [`Dockerfile`](Dockerfile)،
[`.dockerignore`](.dockerignore)، [`liara.json`](liara.json) (پلتفرم `docker`،
اپ `khaneyar-api`، پورت `8000`). راهنمای کاملِ گام‌به‌گام — متغیرهای محیطی، دستورِ
دیپلوی، ترتیبِ حیاتیِ مهاجرت، دامنه/SSL و DNS، و بیلدِ فرانت — در
[`DEPLOY.md`](DEPLOY.md).

دو نکتهٔ کلیدی:

- **مهاجرت خودکار اجرا نمی‌شود.** ایمیج فقط اپ را بالا می‌آورد؛ `alembic` باید دستی و
  با ترتیبِ فاز ۱۰ اجرا شود (`0001` → بار داده → `head`) وگرنه RLSِ FORCE بارگذاری را می‌بندد.
- **ذخیره‌سازیِ فایل با env انتخاب می‌شود.** اگر `STORAGE_ENDPOINT` و `STORAGE_BUCKET`
  ست باشند → `S3Storage` (باکتِ خصوصی، سرو از راهِ URLِ امضاشدهٔ HMAC)؛ وگرنه دیسکِ محلی.
  بدونِ این متغیرها رفتار دقیقاً مثلِ قبل است (غیرمخرب).

## RLS و مرز چند-مستأجری (فاز ۵)

دفاع در عمق در سطح دیتابیس: حتی اگر لایهٔ اپ فیلترِ `family_id` را فراموش کند، خودِ
Postgres ردیف‌های خانواده‌های دیگر را نه می‌خواند و نه می‌نویسد.

**دامنه — ۹ جدولِ «همیشه‌احرازشده»** که RLS خانواده می‌گیرند (`ENABLE` + `FORCE` +
یک پالیسی `FOR ALL`): `transactions`، `transaction_photos`، `accounts`،
`subcategories`، `custom_categories`، `category_budgets`، `sms_messages`،
`sms_bridges`، `family_events`.

**بیرون از RLS و چرا:** `members`/`families`/`family_invites` لایهٔ «بوت‌استرپِ
هویت»‌اند — ورود با شماره، ثبت‌نام و باز کردن لینک دعوت پیش از داشتنِ زمینهٔ خانواده
به آن‌ها دسترسی دارند، پس با tenancy لایهٔ اپ محافظت می‌شوند. `sessions`،
`otp_codes`، `auth_attempts`، `lookup_attempts` (احراز، بدون family_id) و
`card_bins`/`app_settings` (سراسری) هم خانواده‌محور نیستند.

**مکانیزم:** هر درخواستِ احرازشده باید وابستگی `get_tenant_member` را بگیرد؛ این
وابستگی `app.family_id` (برابرِ family_id عضو) را روی تراکنش می‌گذارد. یک شنوندهٔ
`after_begin` در `app/db/rls.py` این مقدار را روی «هر» تراکنشِ آن درخواست دوباره
اعمال می‌کند (چون `commit`‌های میان‌راهیِ سرویس‌ها GUCِ transaction-local را پاک
می‌کنند). محملِ پالیسی:

```sql
family_id = NULLIF(current_setting('app.family_id', true), '')::uuid
```

**fail-closed:** اگر زمینه ست نشده باشد (`get_tenant_member` به‌کار نرفته باشد)،
مقدار NULL می‌شود و `family_id = NULL` هیچ‌گاه true نیست → صفر ردیف و ردِ هر نوشتن.
هویت هرگز از بدنهٔ کلاینت نمی‌آید؛ `family_id` از خودِ عضوِ توکن استخراج می‌شود.

**FORCE چرا:** اپ فعلاً با نقشِ مالکِ جدول‌ها متصل است و مالک به‌صورت پیش‌فرض از RLS
معاف است؛ `FORCE` مالک را هم مشمول می‌کند. نقشِ کم‌دسترسیِ جدا (اپ ≠ مالک) سخت‌سازیِ
اختیاریِ فاز ۱۱ است (وابسته به هاست).

## احراز هویت (فاز ۴)

توکن نشست **فقط** از هدر `Authorization: Bearer <token>` خوانده می‌شود؛ هیچ اندپوینتی
توکن را از بدنه نمی‌پذیرد. توکن خام فقط یک‌بار هنگام ورود/ثبت‌نام برمی‌گردد و در سرور
تنها هشِ SHA-256 آن ذخیره می‌شود (رفع D-3).

معناشناسی نشست: `expires_at` = سقف مطلق ۹۰ روز از ساخت (تمدید نمی‌شود)،
`last_seen_at` = پنجرهٔ لغزان ۷ روزه (با هر استفاده تازه می‌شود). نشست معتبر است اگر
`now < expires_at` **و** `now < last_seen_at + ۷ روز`.

رمز عبور با Argon2id هش می‌شود؛ هش‌های قدیمی bcrypt یا `sha256(phone:password)` هنگام
ورود موفق به Argon2id ارتقا می‌یابند. حداقل طول ۸ کاراکتر فقط هنگام «تعیین» رمز اعمال
می‌شود (ثبت‌نام، پذیرش دعوت، تغییر رمز)، نه هنگام ورود.

قفل ضد brute-force متمرکز است: هر مسیر بررسی رمز/OTP از گِیت مشترک `attempts` می‌گذرد
(۱۰ خطا در ۱۵ دقیقه → `TOO_MANY_ATTEMPTS`). تلاش ناموفق پیش از خطا `commit` می‌شود تا
شمارش صرف‌نظر از اندپوینت پایدار بماند.

اندپوینت‌ها (پیشوند `/api/v1/auth`):

| متد و مسیر | نیاز به نشست | معادل RPC قدیمی |
|---|---|---|
| `GET /config` | خیر | get_public_config |
| `POST /otp/request` | خیر | request_otp_dev |
| `POST /check-password` | خیر | auth_check_password |
| `POST /pre-registered` | خیر | check_pre_registered |
| `POST /login` | خیر | auth_login |
| `POST /register` | خیر | auth_register |
| `GET /invite/{token}` | خیر | get_invite |
| `POST /accept-invite` | خیر | accept_invite |
| `GET /session` | بله | validate_session |
| `POST /logout` | بله | logout_session |
| `POST /logout-all` | بله | logout_all_sessions |
| `POST /change-password` | بله | change_password |
| `GET /family` | بله | get_family |
| `GET /members` | بله | get_members |
| `POST /members` | بله (مدیر) | add_member_by_manager |
| `DELETE /members/{id}` | بله (مدیر) | remove_member |
| `POST /invite` | بله (مدیر) | create_invite |

> **انجام شد در فاز ۹:** کلاینت اکنون همین اندپوینت‌ها را از طریق `RestClient` صدا
> می‌زند (نه RPCهای سوپابیس). کدهای خطا پایدارند (`INVALID_CREDENTIALS`،
> `SESSION_EXPIRED`، `TOO_MANY_ATTEMPTS`، `WEAK_PASSWORD`، `PHONE_EXISTS`، ...) و
> نگاشتِ خطای کلاینت کدـمحور است (کدِ `error` مقدم بر پیامِ فارسی).

## اندپوینت‌های خواندن (فاز ۶)

خواندنِ داده‌های خانواده‌محور زیر `/api/v1`. **همهٔ** این مسیرها وابستگی
`get_tenant_member` را می‌گیرند؛ یعنی `app.family_id` روی تراکنش نشانده می‌شود و
پالیسی‌های RLS ردیف‌ها را به همان خانواده محدود می‌کنند (fail-closed). علاوه بر RLS،
فیلترِ `family_id` در لایهٔ اپ هم اعمال می‌شود (کمربند و ساسپندر).

| متد و مسیر | معادل RPC قدیمی | نکته |
|---|---|---|
| `GET /transactions` | list_transactions | همراهِ آرایهٔ تودرتوی `photos`؛ نزولی بر `created_at` |
| `GET /accounts` | list_accounts | صعودی بر `created_at` |
| `GET /subcategories` | list_subcategories | ترتیب `category` سپس `created_at` |
| `GET /custom-categories` | list_custom_categories | صعودی بر `created_at` |
| `GET /category-budgets` | list_category_budgets | صعودی بر `created_at` |
| `GET /sms?status=` | list_sms | فیلترِ اختیاریِ `status` ∈ {pending, recorded, ignored}؛ نزولی |
| `GET /sms/bridge` | get_bridge | پلِ **فعالِ عضو جاری** یا `null` (عضو-محور، نه خانواده) |
| `GET /events` | list_events | ترتیب `date` سپس `created_at` (هر دو نزولی) |

مبالغ (`amount`، `initial_balance`، `balance`) مانند `budget` به‌صورت «عدد» سریال
می‌شوند تا با انتظار فعلی کلاینت (`+r.amount`) سازگار بمانند. نامِ فیلدها دقیقاً
snake_case ستون‌های دیتابیس است تا نگاشتِ فرانت در فاز ۹ بدون تغییر بماند.

> **انجام شد در فاز ۹:** مخازنِ خواندنِ کلاینت اکنون همین مسیرها را صدا می‌زنند. چون
> نامِ فیلدها دقیقاً snake_case ماند، `mappers.ts` بدون تغییر باقی ماند. مسیرهای نوشتن
> در فاز ۷ کنارِ همین منابع اضافه شده‌اند.

## اندپوینت‌های نوشتن (فاز ۷)

افزودن/ویرایش/حذف زیر `/api/v1`. قرارداد REST: `POST`=ساخت، `PATCH`=ویرایشِ جزئی/تنظیم،
`DELETE`=حذف؛ کنش‌های خاص (مثل رسیدگی به سررسید یا هم‌گام‌سازیِ تولد) `POST`اند. پاسخ‌ها
با نوعِ بازگشتِ RPCهای قدیمی یکی‌اند: ردیف→`*Out` (۲۰۰/۲۰۱)، void→۲۰۴، اسکالر→`int`/`str` خام.

**اعتبارسنجی دولایه (اصل کلیدی):** بدنه‌های ورودی عمداً «سهل‌گیر»‌اند (فیلدها `Optional`
با پیش‌فرضِ `None`)؛ **همهٔ** قواعد کسب‌وکار در لایهٔ سرویس با `AppError` و کدهای خطای
پایدار اعمال می‌شوند. اگر اعتبارسنجیِ سخت را در Pydantic می‌گذاشتیم، خطاها ۴۲۲ِ خام
می‌شدند و نگاشتِ خطای کلاینت (`RPC_ERROR_MAP`) می‌شکست.

روت‌های داده (تحتِ `get_tenant_member` و RLS):

| متد و مسیر | معادل RPC قدیمی |
|---|---|
| `POST /transactions` · `PATCH/DELETE /transactions/{id}` | add/update/delete_transaction |
| `POST /transactions/{id}/occurrences` | mark_recurring_occurrence |
| `POST /transactions/{id}/photos` · `PATCH/DELETE /photos/{id}` | add/update/delete_tx_photo |
| `POST /accounts` · `PATCH/DELETE /accounts/{id}` | add/update/delete_account |
| `POST/DELETE /subcategories[/{id}]` | add/delete_subcategory |
| `POST/DELETE /custom-categories[/{id}]` | add/delete_custom_category |
| `POST /category-budgets` · `DELETE /category-budgets/{category}` | set/delete_category_budget (فقط مدیر) |
| `POST /sms` · `PATCH /sms/{id}` · `POST /sms/bridge` | add_sms_messages / set_sms_status / create_bridge |
| `POST /events` · `DELETE /events/{id}` · `POST /events/sync-birthdays` | add/delete_event / sync_birthday_events |

روت‌های هویتی (`members.py` — **بیرون از RLS**، تحتِ `get_current_member`/`require_owner`):

| متد و مسیر | معادل RPC | گارد |
|---|---|---|
| `PATCH /family/settings` | update_family_settings | فقط مدیر (بودجه؛ currency/dark نادیده) |
| `PATCH /members/me` | update_member_profile | خودِ عضو |
| `PATCH /members/me/theme` | set_member_theme | خودِ عضو |
| `PATCH /members/me/currency` | set_member_currency | خودِ عضو |
| `PATCH /members/{id}/relation` | set_member_relation | مدیر↔هرکس / عضو↔خودش؛ نسبتِ مدیر ثابت |

> **چرا members بیرون از RLS است:** روی جدول‌های هویتیِ `families`/`members` کار می‌کند
> که از RLS مستثنا هستند (بخش فاز ۵)؛ پس مرزِ مستأجر را «لایهٔ اپ» می‌گذارد — هر نوشتن یا
> به خودِ actor محدود است یا `family_id` عضوِ هدف صریحاً با actor سنجیده می‌شود.

**دو یافتهٔ فاز ۷ که در فاز ۹ اعمال شد (اتصال فرانت):**

1. **قالبِ سیمِ خطا:** بک‌اند `{"error": <code>, "message": <پیام فارسی>}` می‌فرستد. seamِ
   قدیمی ابتدا `message` را می‌خواند و رجکس‌های خطا را روی آن می‌سنجید (کدها انگلیسی،
   پیام فارسی → عدمِ تطبیق، سقوط به `SERVER`). در فاز ۹ `mapError`ِ `RestClient` **کدِ
   `error` را مقدم بر `message`** می‌خواند (به‌ویژه `SESSION_EXPIRED` که ورودِ دوباره را
   راه می‌اندازد).
2. **کدهای تازه:** `INVALID_STATUS` (پیامک)، `INVALID_EVENT` (رویداد)،
   `INVALID_THEME`/`INVALID_CURRENCY` (پروفایل) و `INVALID_NAME` به `REST_ERROR_MAP`
   افزوده شدند. (`INVALID_TYPE/AMOUNT/CATEGORY/DATE/MEMBER/RELATION`،
   `EMPTY_RELATION`، `OWNER_RELATION_FIXED`، `CATEGORY_IN_USE`، `EVENT_DUPLICATE`،
   `PHONE_EXISTS`، `CANNOT_REMOVE_OWNER`، `NOT_FOUND`، `FORBIDDEN` از پیش نگاشت داشتند.)

راستی‌آزماییِ ایستا: `outputs/verify_phase7.py` پوششِ RPC، مرزِ وابستگی و گاردِ مدیر را
بررسی می‌کند (بدونِ دیتابیس/شبکه).

## پیامک و فایل سمت‌سرور (فاز ۸)

فاز ۸ دو قابلیتِ باقی‌ماندهٔ سوپابیس را جایگزین می‌کند: خواندنِ پیامکِ بانکی و استوریجِ
فایل (آواتار/رسیدِ تراکنش). هیچ اندپوینتی هویت را از بدنه نمی‌گیرد، جز پلِ
ماشین‌به‌ماشین که عمداً با «توکنِ پل» احراز می‌شود.

### ingestِ پیامک

| متد و مسیر | احراز | نکته |
|---|---|---|
| `POST /sms/ingest` | نشست (`get_tenant_member`، RLS) | ثبتِ دسته‌ایِ متنِ خامِ پیامک از اپِ خودِ کاربر؛ سرور پارس و «در انتظار» می‌کند |
| `POST /sms/bridge-ingest` | **توکنِ پل در بدنه** (بدونِ Bearer) | وب‌هوکِ فورواردر؛ تنها روتِ بی‌نشستِ سامانه |

`bridge-ingest` تنها استثنای «هویت فقط از Bearer» است: فورواردرِ پیامک نمی‌تواند هدرِ
نشست بفرستد، پس با توکنِ پل (`sms_bridges`) احراز می‌شود. آن جدول در مهاجرتِ `0003`
عمداً از RLS خارج شد تا جست‌وجوی توکن پیش از داشتنِ زمینهٔ خانواده ممکن باشد؛ سپس سرویس
دستی `app.family_id` را ست و در `finally` ریست می‌کند. توکنِ نبود/نامعتبر →
`UNAUTHORIZED` (fail-closed). این فایل (`webhooks.py`) از روت‌های داده جداست تا مرزِ فاز ۷ نشکند.

### آپلود و سروِ فایل

| متد و مسیر | احراز | نکته |
|---|---|---|
| `POST /uploads/avatar` | Bearer (`get_current_member`) | آواتارِ عضو؛ خارج از RLS چون هویتی است |
| `POST /uploads/photo` | Bearer (`get_current_member`) | رسیدِ تراکنش؛ نامِ فایلْ یکتا |
| `GET /files/{path}` | **بدونِ احراز — مجوز در امضای HMAC** | سروِ فایلِ خصوصی؛ کشِ ۱ ساله |

فایل‌ها به‌صورتِ data-URL در بدنه می‌آیند، روی دیسکِ خصوصی ذخیره می‌شوند و با یک **URLِ
ظرفیتیِ امضاشده با HMAC** (پارامترِ `sig`) سرو می‌شوند — نه Bearer، چون تگِ `<img>`
نمی‌تواند هدر بفرستد. امضا بی‌انقضاست ولی به همان مسیر گره خورده؛ امضای نبود/نادرست →
`FORBIDDEN` (fail-closed).

متغیرهای محیطیِ تازهٔ فاز ۸ (نام‌ها؛ مقدار فقط در `.env`):

| متغیر | نقش |
|---|---|
| `FILE_SIGNING_SECRET` | کلیدِ HMACِ URLِ ظرفیتی. **اگر ست نشود، آپلود و سرو هر دو بسته می‌مانند.** |
| `STORAGE_DIR` | ریشهٔ دیسکِ فایل‌های خصوصی |
| `FILES_BASE_URL` | پیشوندِ URLِ عمومیِ سروِ فایل (برای ساختِ لینکِ امضاشده) |
| `UPLOAD_MAX_BYTES` | سقفِ حجمِ هر آپلود |

(`STORAGE_BUCKET_AVATARS`/`STORAGE_BUCKET_PHOTOS` و کلیدهای `STORAGE_ENDPOINT/ACCESS_KEY/SECRET_KEY`
برای مسیرِ آبجکت‌استوریجِ اختیاریِ فاز ۱۱ رزرو شده‌اند.)

### خواندنِ نیتیوِ پیامک روی اندروید

اپِ اندروید (بازار) پیامکِ بانکی را با پلاگینِ Capacitor مستقیم می‌خواند و از مسیرِ
`ingestRawSms` به مخزن می‌فرستد؛ وب/iOS بی‌صدا رد می‌شود و پلِ فورواردر فالبک است.

- پلاگین به **Java** نوشته شده (نه Kotlin): پروژهٔ اندروید افزونهٔ gradleِ Kotlin ندارد،
  پس Java صفر-اصطکاکِ بیلد و هم‌خوان با `MainActivity.java` است.
- نسخهٔ ۱ فقط **پیش‌زمینه/گرم** می‌خواند (BroadcastReceiverِ زمانِ اجرا)؛ خواندنِ
  پس‌زمینه به receiverِ مانیفست نیاز دارد (مسیرِ آینده). فالبکِ وب/iOS = ثبتِ دستی + پل.
- مجوزِ `RECEIVE_SMS`/`READ_SMS` یک‌بار پرسیده می‌شود؛ ردِ کاربر = صرفِ نظرِ بی‌صدا.
- **بیلد و تستِ APK با کاربر است.**

راستی‌آزماییِ ایستا: `outputs/verify_phase8.py` سیم‌کشیِ روتر، مرزِ نشست‌در‌برابرِ‌پل،
دست‌نخوردگیِ مرزِ فاز ۷، امضای HMAC و fail-closedِ پل را بررسی می‌کند (بدونِ دیتابیس/شبکه).

## اتصال فرانت (فاز ۹)

سوییچِ کامل و تمیز: کلِ فرانت از سوپابیس جدا و به همین بک‌اند وصل شد — بدون حالتِ دومسیرهٔ
هم‌زمان. یک `RestClient` واحد (`src/infrastructure/api/restClient.ts`) تنها seamِ شبکه است
و مبدأ از یک متغیرِ واحد `VITE_API_URL` می‌آید (`src/shared/config/apiUrl.ts`؛ پیشوندِ
`/api/v1`). توکن با `Authorization: Bearer` از `SessionRepository` (نقشِ `TokenProvider`)
به‌صورتِ خودکار افزوده می‌شود؛ تنها استثنا وب‌هوکِ `bridge-ingest` است که توکن در بدنه دارد.

- **۱۰ مخزن** بازسیم‌کشی شدند (auth، family، transactions، sms، accounts، bridges،
  subcategories، customCategories، events، categoryBudgets) — همه بدنه‌ها snake_case،
  و پارامترهای مسیرِ فارسی (مثلِ `category` در حذفِ بودجه) با `encodeURIComponent`.
- **ingestِ سمت‌سرور:** `IngestRawSmsUseCase` دیگر متن را در کلاینت پارس نمی‌کند؛ خامِ پیامک
  را به `POST /sms/ingest` می‌فرستد و سرور پارس/ذخیره می‌کند. مسیرِ چسباندنِ دستی
  (`parseSmsImport` + `addSmsBatch`) دست‌نخورده ماند.
- **نگاشتِ خطا کدـمحور شد** و کدهای تازه افزوده شدند (بخشِ «دو یافتهٔ فاز ۷» بالا).
- **بازنشسته (حذف نشد، طبقِ قاعدهٔ پروژه):** `infrastructure/api/httpClient.ts` (seamِ
  دومسیرهٔ `rpc`)، `shared/config/apiBase.ts` (`API_BASE`)، `shared/config/supabase.ts`
  (`supabaseConfig`) — هر سه به یادداشتِ فارسی + `export {}` تقلیل یافتند؛ بدنهٔ قدیمی در
  تاریخچهٔ گیت می‌ماند. هیچ کدِ زنده‌ای دیگر آن‌ها را import نمی‌کند.
- **ورودِ اجباریِ دوباره در لحظهٔ سوییچ خودکار است:** توکنِ قدیمیِ سوپابیس →
  `UNAUTHORIZED` از بک‌اند → نگاشت به `SESSION_EXPIRED` → پاک‌شدنِ نشست → صفحهٔ ورود.

> **پیش‌نیازِ کارکرد:** این فاز فقط «کدِ» فرانت را سوییچ می‌کند. تا بک‌اند دپلوی و
> دادهٔ کاربران در فاز ۱۰ وارد نشود، اپ روی این بک‌اند دادهٔ واقعی نشان نمی‌دهد.
> `VITE_SUPABASE_*` هنوز باید از محیط حذف و کلیدها چرخانده شوند (فاز ۱ — سمتِ کاربر).

## اصول ثابت

- هویت خانواده **همیشه** از توکن سمت سرور استخراج می‌شود، هرگز از بدنهٔ درخواست کلاینت.
- اسرار فقط از متغیرهای محیطی؛ هیچ‌گاه در کد یا لاگ ظاهر نمی‌شوند.
- CORS بسته (فهرست منشأ مشخص، بدون `*`).
