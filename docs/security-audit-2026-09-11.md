# گزارش ممیزی امنیتی خانه‌یار — معادل پنتست Strix

**تاریخ:** ۱۴۰۵/۰۶/۲۰ (2026-09-11)
**دامنه:** کل سورس — `backend/` (FastAPI)، `api/` + `supabase/` (زیرساخت قدیمی Vercel/Supabase)، `src/` (فرانت React)، کانفیگهای nginx، android و deploy
**روش:** بازبینی کد به سبک پنتست خودکار (کلاسهای آسیبپذیری Strix: OWASP Top 10 — کنترل دسترسی/IDOR، تزریق، احراز هویت و نشست، XSS، افشای اسرار، پیکربندی نادرست، منطق کسبوکار)
**نتیجه کلی:** بکاند جدید FastAPI به‌طور غیرمعمولی محکم است (Argon2id، توکنهای هششده، RLS با fail-closed، کوئریهای پارامتری در همهجا، دفاع از path traversal). خطرات جدی **در زیرساخت قدیمی هنوز-deploy-شده** و **یک پوشه خروجی داده واقعی داخل ریپو** متمرکزند، نه در کد جدید.

---

## خلاصه مدیریتی

| شدت | تعداد | مهم‌ترینها |
|---|---|---|
| 🔴 بحرانی | 1 | نشت قریب‌الوقوع داده واقعی کاربران به گیت‌هاب |
| 🟠 بالا | 3 | تصاحب حساب عضو pending؛ باکت‌های عمومی قابل شمارش؛ OTP fail-open |
| 🟡 متوسط | 11 | سطح حمله قدیمی زنده، devCode، بدون CSP، RLS غایب روی card_bins و… |
| 🔵 پایین | ~20 | هدرها، rate-limit، کوتا آپلود، هشهای قدیمی و… |

**سه اقدام فوری:**
1. `backend/migration/export/` را gitignore/حذف کن — **قبل از اجرای بعدی `deploy.bat`** (این اسکریپت `git add -A` میزند و این پوشه ignore نشده).
2. زیرساخت قدیمی را خاموش کن: پروژه Vercel قدیمی + پروژه Supabase قدیمی (پایان یافتن سطح حمله H-2/H-3/M-1 قدیمی).
3. فعال‌سازی عضو pending را مشروط به توکن دعوت کن (رفع تصاحب حساب).

---

## 🔴 بحرانی

### C-1. خروجی داده واقعی کاربران (PII مالی) داخل پوشه ریپو — یک `deploy.bat` با گیت‌هاب فاصله دارد

- **فایلها:** `backend/migration/export/members.json`، `accounts.json`، `families.json` و… + `deploy.bat` (خط `git add -A`) + `.gitignore` (این مسیر را پوشش نمیدهد)
- **شواهد:** `members.json` شامل نام واقعی، شماره موبایل کامل، و **bcrypt password_hash** (با فایل، آفلاین قابل کرک). `accounts.json` شامل **شماره کارت ۱۶ رقمی کامل**، نام بانک و موجودی.
- **سناریوی حمله:** این فایلها الان untracked ولی **نه ignored** هستند. `deploy.bat` روال رسمی انتشار است و `git add -A` میزند — یک deploy معمولی کل هویت مالی کاربران را به ریپو گیت‌هاب (بالقوه عمومی) پوش میکند. حتی بدون پوش، `backup-mirror.git` (که خودش داخل ریپو track شده) آن را دو نسخه میکند.
- **راهحل:**
  1. همین حالا `backend/migration/export/` و خروجیهای `export_supabase.mjs` را به `.gitignore` اضافه کن.
  2. فایلها را از پوشه ریپو خارج کن (یا رمزنگاری کن) و نسخههای plaintext را پاک کن.
  3. `deploy.bat` را از `git add -A` به allowlist صریح تغییر بده.

---

## 🟠 بالا

### H-1. تصاحب حساب عضوِ pending — مالکیت شماره موبایل هیچ‌جا تأیید نمیشود

- **فایلها:** `backend/app/services/auth.py:90-108` (شاخه pending)، `services/otp.py:82-86` (`consume_otp` وقتی OTP خاموش است no-op است — و در بکاند جدید مسیر ارسال SMS اصلاً وجود ندارد پس `otp_enabled` در عمل همیشه خاموش است). همین الگو در زیرساخت قدیمی: `supabase/schema.sql` (`auth_register` شاخه pending خط 608-624).
- **سناریوی حمله:** مدیر، عضوی را با شماره قربانی pre-register میکند (`status=pending`). هرکسی که فقط **شماره را بداند** (داخل خانواده، لو رفته از دفترچه مخاطبین، مهندسی اجتماعی) با `POST /auth/register` برای همان شماره رمز ست میکند، حساب `active` میشود و توکن نشست میگیرد → خواندن همه تراکنشها، شماره کارتها و پیامکهای بانکی خانواده. مالک واقعی دیگر هیچ راهی برای پسگرفتن حساب ندارد (نه register نه reset).
- **راهحل (با حفظ ورود فقط شماره+رمز):** فعال‌سازی عضو pending را مشروط به **توکن دعوت یکبارمصرف** یا **کد فعالسازی تکی از طریق SMS** کن؛ مسیر reset رمز اضافه کن.

### H-2. عکس رسیدها و آواتارها در Supabase قدیمی عمومی و قابل شمارش است

- **فایلها:** `supabase/schema.sql:2462-2484` — policy ثبت `tx_photos_public_read` **بدون بند `TO`** (شامل نقش anon) روی هر دو باکت `tx-photos` و `avatars` که `public=true` ساخته شدهاند.
- **سناریوی حمله:** با anon key (که در `legacy/js/config.js` کامیت شده!)任何人 میتواند `POST /storage/v1/object/list/tx-photos` بزند و **نام همه فایلهای همه خانوادهها** را بگیرد و تک‌تک دانلود کند. رسیدها حاوی مبلغ، شماره کارت و موجودی هستند؛ آواتارها عکس شخصی اعضا (از جمله کودکان).
- **راهحل:** باکتها را private کن، policyهای select از storage.objects را حذف کن، و بهجای URL عمومی **signed URL کوتاه‌عمر** برگردان.

### H-3. `send-otp` قدیمی کد OTP را در پاسخ HTTP برمیگرداند (fail-open)

- **فایل:** `api/send-otp.js:88-101` — هر وقت `SMS_PROVIDER` تنظیم نباشد (خطای پیکربندی، نه انتخاب صریح)، کد در JSON برمیگردد؛ فیلد `dev_mode` دیتابیس **اصلاً چک نمیشود**؛ CORS هم `*` است.
- **نکته:** بکاند جدید همین باگ را صریحاً رفع کرده (`backend/.env.example`: «کد در پاسخ برنمی‌گردد — رفع D-2») ولی تابع قدیمی Vercel زنده است.
- **راهحل:** fail-closed کن (بدون provider → خطای 503) و کل پروژه Vercel قدیمی را تعطیل کن.

---

## 🟡 متوسط

| ID | عنوان | مکان | راهحل |
|---|---|---|---|
| M-1 | **زیرساخت قدیمی هنوز deploy شده** — ۵ تابع Vercel با CORS `*`، توکن در body، باکت عمومی، service key در webhook؛ چکلیست DEPLOY.md خودش «چرخش کلید Supabase» را انجام‌نشده میداند | `api/*.js` | حذف `api/` یا غیرفعال کردن پروژه Vercel + چرخش کلیدها + توقف پروژه Supabase قدیمی |
| M-2 | **`card_bins` تنها جدول بدون RLS** — anon با anon key دسترسی CRUD کامل دارد (write بدون احراز هویت به دیتابیس تولیدی) | `supabase/schema.sql:1562-1600` | `enable row level security` + policy فقط-read + revoke نوشتن |
| M-3 | **`update_transaction` بدون چک مالکیت** — هر عضوی میتواند تراکنش بقیه اعضا (مبلغ/تاریخ/دسته/انتساب) را بازنویسی کند؛ `delete_transaction` درست است، اینجا جا افتاده | `schema.sql:1206-1219` | همان منطق delete: غیرمدیر فقط `member_id = خودش` |
| M-4 | **sms-webhook فقط bearer token** — بدون امضا/آنتی-replay/rate-limit؛ نشت توکن = تزریق بی‌نهایت پیامک جعلی بانکی + flood | `api/sms-webhook.js:40-78` | HMAC + timestamp + rate-limit + dedup (بکاند جدید: امضای HMAC و کپ متن دارد — قدیمی را ببند) |
| M-5 | **SMS-bombing** — send-otp برای هر شماره دلخواه (بدون چک عضویت، فقط ۶۰ثانیه/شماره) پیامک میفرستد؛ هزینه و آزار | `api/send-otp.js:40-77` | فقط برای شمارههای عضو + rate-limit بر IP |
| M-6 | **لولهکشی `devCode` در UI تولیدی** — اگر `dev_mode` دیتابیس روشن شود، کد OTP روی صفحه رندر میشود | `src/.../AuthFeature.tsx:42-45`، `authRepository.ts:75-83` | گیت روی `APP_ENV` نه ردیف DB؛ حذف مسیر devCode از build تولیدی |
| M-7 | **هیچ CSP/هدر امنیتی** در nginx، vercel.json و index.html — «یک XSS = تصاحب کامل حساب» بدون خط دفاعی دوم | `backend/deploy/nginx/khaneyar.conf`، `index.html` | HSTS + nosniff + frame-ancestors + CSP `script-src 'self'` |
| M-8 | **شمارش شماره تلفن + افشای نام خانواده** — `/auth/pre-registered` بدون احراز هویت نام خانواده (معمولاً نام فامیل واقعی) را برای هر شماره برمیگرداند؛ در UI با هر کلید تایپ شلیک میشود | `backend/app/services/auth.py:160-191`، `useAuthModel.ts:60-79` | فقط boolean برگردان؛ نام خانواده بعد از تأیید |
| M-9 | **اندروید: `allowBackup="true"`** و پلاگین SMS **همه** پیامکها را (حتی غیربانکی) به سرور میفرستد؛ `senderFilter` پلاگین استفاده نشده | `AndroidManifest.xml:5,37-39`، `useNativeSmsReader.ts:32-49` | `allowBackup=false` + فیلتر فرستنده بانکها |
| M-10 | **تزریق URL دلخواه در عکس تراکنش/آواتار** — فقط طول چک میشود؛ `javascript:`/`data:`/URL ردیاب عبور میکند | `backend/.../transactions.py:226-249`، `family.py:219-243` | اعتبارسنجی scheme/origin یا فقط مسیر امضاشده |
| M-11 | **هشهای قدیمی sha256 بدون salt** برای همیشه پذیرفته میشوند (قابل کرک GPU در صورت لو رفتن بکاپ) | `backend/app/core/security.py:77-84` | ددلاین مهاجرت + تبدیل به pending برای معطلیها |

---

## 🔵 پایین (خلاصه)

1. **L-1** شمارش شماره با timing (Argon2 فقط برای کاربر موجود اجرا میشود) → hash ساختگی ثابت.
2. **L-2** CORS wildcard بهصورت برنامه‌ای رد نمیشود → fail در production روی `*`.
3. **L-3** پاسخ فایل بدون `nosniff`/`Content-Disposition`؛ آپلود فقط با MIME ادعایی کلاینت (بدون magic bytes).
4. **L-4** توکنهای bridge/invite بهصورت plaintext ذخیره میشوند (برخلاف session که هش است)؛ امضای URL فایل منقضی نمیشود.
5. **L-5** توکن دعوت **چندبارمصرف** و بدون revoke است → لینک لو رفته = عضویت بی‌نهایت غریبه برای ۳۰ روز.
6. **L-6** قفل حساب per-phone بدون rate-limit بر IP → DoS روی قربانی شناختهشده + بروت‌فورس توزیعشده.
7. **L-7** حداقل رمز فقط طول ۸ → ۱۰+ و رد کردن رمزهای رایج.
8. **L-8** بکاپها با umask پیشفرض (world-readable) نوشته میشوند؛ حاوی هش رمزها و توکنها.
9. **L-9** فیلدهای بدون سقف (`UploadIn.image`، متن bridge-ingest) → وابسته به `client_max_body_size`.
10. **L-10** بدون کوتای آپلود per-member → پر کردن دیسک.
11. **L-11** nginx بدون HSTS (و CSP — با M-7 مشترک).
12. **L-12** OTP قدیمی با `Math.random()` (غیر CSPRNG).
13. **L-13** کلید publishable قدیمی + `backup-mirror.git` (کل تاریخ گیت) داخل ریپو → خروج از ریپو + چرخش کلید.
14. **L-14** `rpc.js` به service-role key fallback میکند → حذف fallback.
15. **L-15** آپلود قدیمی محتوا را verify نمیکند و باکت عمومی = هاست فایل رایگان عمومی.
16. **L-16** `add_sms_messages` بدون سقف آرایه/متن.
17. **L-17** جزئیات خطای داخلی به کلاینت لو میرود (`detail: e.message`).
18. **L-18** ثبت‌نام بدون rate-limit/captcha.
19. **L-19** `<a href>` عکس بدون اعتبارسنجی scheme (`javascript:`) — hardening ارزان.
20. **L-20** `<access origin="*" />` کوردوا در config.xml اندروید.
21. **L-21** شماره کارت کامل ۱۶ رقمی plaintext برای همه اعضا برگردانده میشود (داده‌کاهی: فقط ۴ رقم آخر کافی است).

---

## ✅ موارد بررسی‌شده و امن (پوشش)

- **تزریق:** صفر SQL خام در مسیر درخواست بکاند جدید (همه bound params)؛ بدون `subprocess`/`eval`/`pickle`/SSTI؛ بدون SSRF (هیچ خروجی HTTP از ورودی کاربر).
- **IDOR در بکاند جدید:** همه endpointهای داده زیر `get_tenant_member` + RLS + فیلتر صریح `family_id`؛ delete/patch محدود به مدیر-یا-خودِ کاربر.
- **نشست:** توکن ۲۵۶ بیتی، فقط هش SHA-256 در DB، انقضای مطلق ۹۰ روز + سُرِشده ۷ روز، `change_password` همه نشستهای دیگر را باطل میکند.
- **XSS فرانت:** صفر `dangerouslySetInnerHTML`/`innerHTML`/`eval`؛ همه ورودیها بهصورت متن React رندر میشوند؛ QR محلی و بدون DOM access.
- **ذخیره توکن:** AES-GCM در IndexedDB با کلید non-extractable (نه localStorage)؛ توکن فقط در هدر Bearer؛ HTTPS سمت کلاینت اجباری.
- **توکنهای CSPRNG:** دعوت/bridge/نشست/OTP همگی با `secrets` (۱۶۰ بیت).
- **RLS:** ۱۷ جدول کسبوکار با policyهای deny-by-default؛ توابع SECURITY DEFINER با `search_path` پینشده.
- **اسرار:** در تاریخ گیت فقط publishable key (عمومی) لو رفته؛ service key هرگز commit نشده؛ `.env`ها ignore شدهاند؛ ایمیج داکر non-root.
- **لاگها:** فیلتر redaction توکن/رمز؛ خطای ۵۰۰ عمومی بدون stack trace.

---

## اولویت اجرا (نقشه راه پیشنهادی)

| فاز | اقدام | تلاش |
|---|---|---|
| الان | C-1: gitignore + جابهجایی پوشه export + اصلاح deploy.bat | ۱۵ دقیقه |
| این هفته | خاموشی Vercel/Supabase قدیمی + چرخش کلیدها (M-1, H-2, H-3, M-2..M-5 قدیمی) | ۲-۳ ساعت |
| این هفته | H-1: توکن دعوت برای فعالسازی عضو pending + مسیر reset رمز | نیمروز |
| هفته بعد | M-6 (حذف devCode از build)، M-7 (CSP/HSTS در nginx)، M-8 (فقط boolean) | چند ساعت |
| بعدی | دسته Low ها: nosniff + magic bytes، هش توکنهای bridge/invite، دعوت یکبارمصرف، rate-limit بر IP، کوتا آپلود، umask بکاپ | تدریجی |

---

*این گزارش معادل خروجی کلاسهای اسکن Strix (OWASP Top 10 + منطق کسبوکار) است که بهدلیل عدم دسترسی ادمین (Docker/WSL) بهصورت بازبینی دستی معادل انجام شد. اگر بعداً دسترسی ادمین گرفتید، strix-agent 1.6.2 از قبل نصب است و فقط Docker + کلید OpenRouter لازم است.*
