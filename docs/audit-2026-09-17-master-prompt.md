# ممیزی پیش از پیاده‌سازی — بند ۰ پرامپت مادر

تاریخ: ۱۴۰۵/۰۶/۲۶ · دامنهٔ ممیزی: کلِ مخزن `personal-finance-pwa` + دیتابیس موجود
قاعدهٔ حاکم: Rule 22 — تا تأییدِ این گزارش هیچ کدی نوشته/تغییر/مهاجرت نمی‌شود.

---

## CURRENT STATE

**Existing architecture** — مونولیتِ ماژولار، دقیقاً همان چیزی که پرامپت می‌خواهد.
بک‌اند FastAPI با چهار لایهٔ واقعی: `api/v1/routes` (نازک) → `services` (یوزکیس) →
`models` (SQLAlchemy) → `db` (اتصال + RLS). فرانت React/TS با تفکیکِ
`domain / application / infrastructure / features / pages / widgets`.
قواعدِ کسب‌وکار در `src/domain/*.rules.ts` است و تستِ واحد دارد. اپ اندروید
کپاسیتور است و همان PWA را بار می‌زند، پس Rule 4.11 (منطق مشترک) از قبل رعایت شده.

**Existing database** — پستگرس، ۵ مهاجرتِ Alembic (`0001`…`0005`)، ۲۰ جدول:

```
families · members
sessions · otp_codes · auth_attempts · lookup_attempts · family_invites
accounts · card_bins
transactions · transaction_photos
subcategories · custom_categories · category_budgets
category… · family_events · holdings
sms_messages · sms_bridges · sms_senders · sms_numbers
app_settings
```

**Existing relevant features** — مالی کامل (حساب، تراکنش، انتقال، دسته، بودجه،
تراکنش تکرارشونده، گزارش)، دارایی/بازار، پیامکِ بانکی با رضایتِ حساب‌به‌حساب،
رویدادهای خانواده، دعوت با لینک، تنظیماتِ عضو و خانواده.

**Existing entities** — `Family` (= Household)، `Member`، `Account`، `Transaction`،
`TransactionPhoto`، `Subcategory`، `CustomCategory`، `CategoryBudget`،
`FamilyEvent`، `Holding`، `SmsMessage/Bridge/Sender/Number`، `Session`، `OtpCode`،
`FamilyInvite`، `AppSetting`، `CardBin`.

**Existing relationships** — همهٔ جدول‌های دادهٔ خانواده ستونِ `family_id` دارند
(NOT NULL + FK + index). مالکیتِ فردی با `member_id`. ارجاع‌های بین‌دامنه‌ای
صریح‌اند (`transactions.account_id`, `transactions.to_account_id`,
`transactions.subcategory_id`, `sms_messages.account_id`) — هیچ ارجاعِ
پلی‌مورفیکِ `target_type/target_id` در مخزن نیست. یعنی §7.6 از قبل رعایت شده.

**Existing Finance implementation** — یک دفترِ مالیِ واحد و سالم:
`accounts` (bank/wallet + `initial_balance`) · `transactions`
(expense/income/transfer + `repeat` + `handled_occurrences`) · دسته‌بندیِ دولایه
(`custom_categories` + `subcategories`) · `category_budgets` + سقفِ ماهانه روی
`families.budget` · `holdings` برای دارایی. **دفترِ مالیِ دومی وجود ندارد.**

**Existing authentication** — شماره‌موبایل + رمز، هشِ Argon2id با ارتقای خودکار
از bcrypt/sha256، OTP اختیاری، نشستِ سمت‌سرور (`sessions.token`) با انقضا و
`last_seen_at`، قفلِ ضدِ brute-force (`auth_attempts` + `lookup_attempts`).
**هویتِ خانواده فقط از توکنِ نشست خوانده می‌شود، هرگز از بدنه/کوئریِ کلاینت**
(`app/api/deps.py`). این دقیقاً خواستهٔ §2.7 و §5.2 است.

**Existing household model** — `families` مستأجرِ اصلی است و **RLS واقعیِ پستگرس**
روی ۱۲ جدول فعال است با محمولِ
`family_id = current_setting('app.family_id')::uuid` و `FORCE ROW LEVEL SECURITY`.
یعنی ایزولهٔ خانواده در خودِ دیتابیس هم اجرا می‌شود، نه فقط در کد.
(`sms_bridges` عمداً بیرون است چون توکنِ پل پیش از برقراریِ زمینهٔ خانواده اعتبارسنجی می‌شود.)

**Existing onboarding** — قیفِ **پیش‌از‌ورود** با سه گام
(`welcome` → `value` → `questions`) که علاقه‌مندی‌ها را می‌پرسد و فرمِ ثبت‌نام را
پیش‌پر می‌کند. مسیرِ «ساختِ خانواده» از دلِ ثبت‌نام می‌آید؛ مسیرِ «پیوستن» فقط از
طریقِ **لینکِ دعوت** است.

---

## FEATURE GAP ANALYSIS

**REUSE — دست نخورَد**

- دفترِ مالی (حساب/تراکنش/دسته/بودجه/انتقال) — §6.9 و §8.9 کاملاً برآورده است.
- زیرساختِ احراز هویت و نشست — §5.7 برآورده است.
- الگوی `family_id` + RLS — قراردادِ الزامیِ هر جدولِ جدید.
- `holdings`، `sms_*`، `card_bins`، `app_settings`.

**EXTEND — همان جدول، ستون/قابلیتِ بیشتر**

- `family_events` → پایهٔ دامنهٔ «تقویم خانواده». **جدولِ رویدادِ دوم ساخته نشود**
  (کاشیِ «تقویم و مناسبت‌ها» در `SOON_MODULES` هست و وسوسهٔ ساختِ جدولِ تازه دارد).
- `families` → جداکردنِ تنظیمات از هویتِ خانواده (`budget`/`currency`/`dark` الان
  داخلِ `families` است؛ §2.2 و Rule 17 می‌گویند مالی نباید مرکزِ Household باشد).
- `members.relation` → همان `Person.family_role` است (§6.4). فقط باید از
  متنِ آزادِ فارسی به مجموعهٔ کنترل‌شده تبدیل شود.
- `transaction_photos` → کاندیدِ تبدیل به `attachments`ِ کانونی (§6.15).

**IMPROVE**

- نقشِ `owner` → مدلِ `ADMIN/MEMBER` + مفهومِ جداگانهٔ Creator (§2.3/§2.4).
- `accept_invite` → افزودنِ گامِ تأییدِ مدیر (§2.6).
- سرویس‌دهیِ فایل با URLِ امضاشده → تأییدِ عضویت در لحظهٔ درخواست (§5.5).

**CREATE — واقعاً وجود ندارد**

- توانمندی‌های میان‌برشی: `tasks`، `reminders`، `notifications`، `audit_entries`،
  `maintenance_records` (§4.6 و §6.16).
- دامنه‌های محصول: Children · Pets · Vehicles · Home & Equipment ·
  Shopping & Inventory · Bills & Subscriptions · Entertainment ·
  Goals & Wish Lists · Documents.

**CONSOLIDATE — نیاز به تأیید (§0.3)**

- `transaction_photos` در برابرِ `attachments`ِ آینده.
- `family_events` در برابرِ `CalendarEvent`ِ بخش ۶.۱۲.
- و از همه مهم‌تر: `members` که هم‌زمان User و Person است (تعارضِ C1 پایین).

---

## DATABASE IMPACT

**Existing tables affected** — `families`, `members`, `sessions`,
`family_invites`, `transaction_photos`, `family_events`.

**New tables required** — بسته به تصمیمِ C1 و ترتیبِ دامنه‌ها؛ در بدترین حالت
`users`, `household_memberships`, `join_requests`, `household_settings`,
`tasks`, `reminders`, `notifications`, `audit_entries`, `attachments`,
`document_records`, `maintenance_records` + یک جدول به‌ازای هر دامنهٔ محصول.

**Existing columns affected** — `members.role`, `members.status`,
`members.relation`, `members.phone` (ایندکسِ یکتا)، `families.budget/currency/dark`.

**New columns required** — `members.user_id` (nullable)، `members.family_role`،
و روی هر جدولِ جدید `family_id` + `id` + `created_at` طبقِ قرارداد.

**Relationships affected** — همهٔ FKهای `member_id` (۱۰ مورد: sessions, accounts,
transactions, transaction_photos, holdings, family_events ×۲, sms_messages,
sms_bridges, sms_numbers, family_invites) اگر C1 با گزینهٔ کامل حل شود.

**Migrations required** — از `0006` به بعد، کوچک و مرحله‌ای (§8.6). هر جدولِ
خانواده‌محورِ جدید **باید** در همان مهاجرت RLS بگیرد وگرنه ایزوله می‌شکند.

**Data migration required** — بله، فقط اگر C1 انتخاب شود: ساختِ یک `users` به‌ازای
هر `members.phone` غیرتکراری و پرکردنِ `members.user_id`. دادهٔ واقعیِ خانواده روی
سرور هست، پس باید برگشت‌پذیر و آزمایش‌شده باشد.

---

## SECURITY IMPACT

- **نقاطِ قوتِ موجود:** RLS اجباریِ پستگرس، زمینهٔ خانواده فقط از توکن، Argon2id،
  قفلِ brute-force، `_member_public` برای نشت‌ندادنِ هش و دادهٔ حساس.
- **New sensitive data:** اسناد هویتی، پروندهٔ پزشکیِ کودک/حیوان، لیستِ آرزوی شخصی،
  مدارکِ خودرو. طبقِ §5.1 در ردهٔ SENSITIVE/HIGHLY_SENSITIVE و طبقِ §5.3
  «خصوصی به‌صورت پیش‌فرض».
- **Ownership/Household scope/Visibility:** هر جدولِ جدید باید `family_id` داشته
  باشد؛ داده‌های شخصی علاوه بر آن `member_id` + ستونِ `visibility`.
- **Authorization changes:** §5.3 می‌گوید «مدیر به‌طور خودکار دادهٔ خصوصیِ شخصی را
  نمی‌بیند» — این با منطقِ فعلی که `role != "owner"` را در ۱۷ نقطه چک می‌کند
  ناسازگار است و باید به سیاستِ منبع‌محور تبدیل شود.
- **شکافِ جدی (§5.10):** هیچ تستِ اجازه‌دهی/ایزولهٔ خانواده در مخزن نیست. الان
  فقط ۱۱ تستِ واحدِ دامنهٔ فرانت و ۳ اسکریپتِ selftest پایتون داریم؛ نه تستِ API،
  نه تستِ مهاجرت.
- **متوسط (§5.5):** `GET /files/{path}` با امضای کوئری کار می‌کند نه با نشست؛
  لینکِ لو‌رفته تا انقضا معتبر است.
- **شکاف (§2.8):** جدول/مکانیزمِ Audit وجود ندارد.

---

## CONFLICTS / AMBIGUITIES

> طبقِ §0.5 و Rule 21 روی این‌ها **توقف** می‌کنم و منتظر تصمیم می‌مانم.

**C1 — (بحرانی) User و Person یکی‌اند و خانواده تک‌عضوی قفل است.**
`members` هم‌زمان حسابِ کاربری است (`phone` + `password_hash` +
`sessions.member_id`) و هم شخصِ داخلِ خانواده. ستونِ `family_id` آن `NOT NULL`
است و روی `phone` **ایندکسِ یکتای سراسری** (`uq_members_phone`) نشسته. نتیجه:
یک شماره فقط می‌تواند عضوِ **یک** خانواده باشد. این مستقیماً با §2.1 و Rule 12
تضاد دارد. حلش یعنی دست‌زدن به ۱۰ کلیدِ خارجی و دادهٔ واقعیِ روی سرور.

**C2 — نقش‌ها `owner`/`member` است نه `ADMIN`/`MEMBER`، و Creator جدا نیست.**
§2.3 دو مدیرِ حداکثری و تفکیکِ سازنده از مدیر می‌خواهد؛ الان دقیقاً یک `owner`
وجود دارد و در ۱۷ نقطهٔ بک‌اند `role != "owner"` هارد-کد شده.

**C3 — معنیِ `status = 'pending'` از قبل اشغال شده.**
الان یعنی «مدیر او را معرفی کرده ولی هنوز ثبت‌نام نکرده»، نه «منتظرِ تأیید».
اگر شش حالتِ §2.5 را روی همین ستون بنشانیم، معنیِ دادهٔ موجود خراب می‌شود.

**C4 — پیوستن با لینکِ دعوت بدونِ تأییدِ مدیر است.**
`accept_invite` عضو را بی‌درنگ `active` می‌کند و نشست می‌دهد. §2.6 زنجیرهٔ
`Join Request → PENDING → Admin Approval → ACTIVE` می‌خواهد. ضمناً `families.code`
وجود دارد ولی فقط نمایشی است و هیچ مسیرِ «پیوستن با کد» در UI نیست.

**C5 — تنشِ درونیِ خودِ پرامپت: §4.6 در برابر §7.6.**
§4.6 می‌گوید یک `Task` مشترک به ۱۰ دامنه سرویس بدهد؛ §7.6 می‌گوید ارجاعِ
پلی‌مورفیکِ `target_type/target_id` نساز. این دو با هم جمع نمی‌شوند مگر با
راهِ سوم. **پیشنهادِ من:** یک جدولِ `tasks` با چند ستونِ FKِ صریحِ nullable
(`vehicle_id`, `pet_id`, `equipment_id`, …) و یک `CHECK` که حداکثر یکی پر باشد —
هم یکتا می‌ماند، هم یکپارچگیِ ارجاعی حفظ می‌شود، هم پلی‌مورفیک نیست.

**C6 — ترتیب و دامنهٔ کار مشخص نیست.**
۱۳ دامنه × (مدل + مهاجرت + RLS + سرویس + روت + اسکیما + مخزن + یوزکیس + هوک +
صفحه + تست) در یک مرحله شدنی نیست و با §14 «برای تکامل طراحی کن، نه مقیاسِ فرضی»
هم نمی‌خوانَد. باید ترتیب بدهیم.

**C7 — تعارض با کارِ در جریان.**
تسکِ #85 (چرخشِ کلید و پاک‌سازیِ تاریخچهٔ گیت) هنوز باز است و مخزن عمومی است.
تسکِ #233 (وصل‌کردنِ «شماره‌های مجاز» به تشخیصِ پیامک) هم باز است.

---

## IMPLEMENTATION PLAN

پیشنهادِ من مرحله‌بندیِ زیر است — هر مرحله مستقل، مهاجرتِ کوچک، برگشت‌پذیر:

**مرحلهٔ A — پایهٔ امنیت و تست (بدونِ تغییرِ اسکیما).**
ساختِ مجموعهٔ تستِ اجازه‌دهیِ §5.10 روی همین سیستمِ فعلی: کاربر A → خانوادهٔ B
باید DENIED شود، عضوِ ساده → عملیاتِ مدیر DENIED، و راستی‌آزماییِ RLS. این کار
هیچ ریسکِ داده‌ای ندارد و شبکهٔ ایمنیِ همهٔ مراحلِ بعدی است.

**مرحلهٔ B — مدلِ هویت و عضویت (پس از تصمیمِ C1/C2/C3/C4).**
`users` + `household_memberships` + `join_requests`، نقش‌ها، حالت‌های عضویت،
تأییدِ مدیر، پیوستن با کد. بزرگ‌ترین و پرریسک‌ترین مرحله؛ عمداً بعد از A.

**مرحلهٔ C — توانمندی‌های میان‌برشی.**
`tasks` + `reminders` + `attachments` + `audit_entries` با الگوی C5.
این‌ها زیرساختِ همهٔ دامنه‌های بعدی‌اند، پس قبل از دامنه‌ها ساخته می‌شوند تا
هر دامنه نسخهٔ خودش را نسازد (Rule 10).

**مرحلهٔ D — دامنه‌ها، یکی‌یکی.**
هر دامنه: مدل + مهاجرت با RLS + سرویس + روت + تستِ ایزوله + صفحه + فعال‌کردنِ
کاشیِ هاب. ترتیبِ پیشنهادی بر پایهٔ کاشی‌های «به‌زودی» که خودتان قبلاً انتخاب
کرده‌اید: قبوض و اشتراک → لیست خرید و انبار → تقویم (توسعهٔ `family_events`) →
کارهای خانه → اسناد → خودرو → تجهیزاتِ خانه → کودکان → حیوانات → اهداف و
آرزوها → سرگرمی.

**مرحلهٔ E — یکپارچه‌سازیِ میان‌دامنه‌ای.**
قبض ↔ مالی ↔ تقویم ↔ یادآور، و خودرو ↔ نگهداری ↔ مالی ↔ اسناد — همه با
موجودیت‌های کانونی، بدونِ کپی‌سازی (Rule 18).

---

## تصمیم‌های لازم پیش از شروع

۱. C1 — مدلِ هویت: تفکیکِ کاملِ User/Person، تفکیکِ مرحله‌ای، یا فعلاً تک‌خانواده بماند؟
۲. C2/C3/C4 — نقش‌ها و مسیرِ پیوستن الان بازسازی شود یا با دامنه‌ها؟
۳. C5 — الگوی پیشنهادیِ «FKِ صریحِ nullable + CHECK» برای Task/Reminder تأیید می‌شود؟
۴. C6 — از کدام مرحله شروع کنیم؟

---

## تصمیم‌های مالک — ۱۴۰۵/۰۶/۲۶

| # | تعارض | تصمیم |
|---|---|---|
| ۱ | C1 هویت | **دست نزن.** `members` همان‌طور می‌ماند؛ هر شماره فقط در یک خانواده. |
| ۲ | C2/C3/C4 | **مرحلهٔ B** — نقش‌ها، حالت‌های عضویت و تأییدِ مدیر با هم. |
| ۳ | C5 | **FKِ صریحِ nullable + CHECK** تأیید شد. |
| ۴ | C6 شروع | **مرحلهٔ A** — تستِ اجازه‌دهی و ایزوله، پیش از هر تغییرِ اسکیما. |

### پیامدهای تصمیم ۱ (مهم)

چون `users` و `household_memberships` ساخته نمی‌شوند، مرحلهٔ B کوچک‌تر و
کم‌ریسک‌تر می‌شود، ولی سه نکته از آن نتیجه می‌گیرد و باید در آغازِ B رعایت شود:

- **Rule 12 به تعویق افتاد، نه لغو.** پس هیچ کدِ تازه‌ای نباید فرض کند
  «عضو = کاربر». هر جای تازه که به هویتِ ورود نیاز دارد از `Member` عبور کند،
  نه از `phone`، تا روزِ تفکیک نقطهٔ لمس کم باشد.
- **C3 با ستونِ تازه حل می‌شود، نه با بازمعناکردنِ `status`.** معنیِ فعلیِ
  `status='pending'` («مدیر معرفی کرده، خودش ثبت‌نام نکرده») دستِ سالمِ دادهٔ
  موجود است و عوض نمی‌شود؛ شش حالتِ §2.5 روی یک ستونِ **جدید** می‌نشیند.
- **Creator با `families.created_by` نگه داشته می‌شود**، نه با نقش — چون §2.4
  می‌گوید سازنده و مدیر دو چیزند.

### دامنهٔ مرحلهٔ A (کارِ جاری)

فقط تست؛ **صفر تغییرِ اسکیما، صفر مهاجرت، صفر تغییرِ رفتار**. اگر تستی شکافی را
نشان داد، شکاف گزارش می‌شود و رفعش کارِ مرحلهٔ بعد است — نه همین‌جا.

---

## نتیجهٔ مرحلهٔ A — ۱۴۰۵/۰۶/۲۸

پنج فایل تست در `backend/tests/` (۴۴ تابع → ۸۷ تست). رانبوکِ اجرا و شرحِ خروجی در
`backend/tests/README.md`. هیچ فایلِ اپ/اسکیما/مهاجرتی لمس نشد؛ تنها تغییرِ بیرون
از `tests/`، افزودنِ `-rxX` به `addopts` در `pyproject.toml` است تا گزارشِ
xfail/xpass دیده شود.

| فایل | پوشش |
|---|---|
| `test_tenant_isolation.py` | خانوادهٔ الف ↔ ب روی همهٔ روت‌ها |
| `test_role_authorization.py` | عضو ≠ مدیر |
| `test_session_boundary.py` | بی‌توکن / جعلی / خروج / خروج از همه |
| `test_rls_database.py` | کاتالوگِ پستگرس: ENABLE+FORCE+پالیسیِ fail-closed |
| `test_known_gaps.py` | پنج شکاف به‌شکلِ xfail |

### شش شکافِ ثبت‌شده (xfailed، رفع در مرحلهٔ بعد)

| # | شکاف | سرنوشت |
|---|---|---|
| ۱ | §۵.۵ `GET /files/{path}?sig=` عضویت را نمی‌سنجد؛ امضا «قابلیتِ حامل» است | مرحلهٔ بعد |
| ۲ | §۲.۶ پذیرشِ دعوت بی‌درنگ نشست می‌سازد؛ تأییدِ مدیر ندارد | **مرحلهٔ B** (C2/C3/C4) |
| ۳ | §۲.۶ توکنِ دعوت مصرف نمی‌شود → لینکِ لو‌رفته بی‌نهایت بار کار می‌کند | **مرحلهٔ B** |
| ۴ | §۲.۸ هیچ جدولِ ممیزی/audit در اسکیما نیست | مرحلهٔ بعد |
| ۵ | `transactions.update` مهارِ per-member ندارد ولی `delete` دارد | مرحلهٔ بعد |
| ۶ | زمینهٔ RLS پس از `commit` گم می‌شود؛ دوباره‌خوانیِ ردیف در مسیرِ نوشتن ۵۰۰ می‌دهد | **مرحلهٔ B** (تسکِ #276) |

مورد ۳ تازه است و در فهرستِ اولیهٔ ممیزی نبود: `_active_invite` هرگز
`inv.active = False` نمی‌کند و `accept_invite` هم توکن را نمی‌سوزاند.

مورد ۶ در ممیزیِ ایستا دیده نمی‌شد و فقط در **اولین اجرای واقعی روی پستگرس**
(۱۴۰۵/۰۶/۳۰) رو شد؛ شرحِ کاملش پایین.

### نکتهٔ محیطی

`test_connection_role_is_not_exempt_from_rls` تنها تستی است که به **محیط** کار
دارد نه کد. اگر کاربرِ دیتابیس `superuser` یا `BYPASSRLS` باشد، RLS حتی با FORCE
دور زده می‌شود و کلِ لایه تزئینی است؛ در آن حالت سه سنجشِ رفتاریِ RLS عمداً
`skipped` می‌شوند تا خطای گمراه‌کننده ندهند.

---

## اولین اجرای واقعی روی پستگرس — ۱۴۰۵/۰۶/۳۰ (کشفِ شکافِ #۶)

مجموعه برای اولین‌بار روی پستگرسِ واقعی اجرا شد: داکر `postgres:16` + نقشِ
**غیر-superuser** (`apptest`، مالکِ `khaneyar_test`، واقعاً مشمولِ RLS). محیط سالم
بود: `test_connection_role_is_not_exempt_from_rls` سبز، همان xfailهای منتظر، هیچ
`skipped`. نتیجهٔ خام: **۱۹ failed / ۶۳ passed / ۵ xfailed**.

هر ۱۹ شکست **یک ریشه** داشتند و همه در قدمِ *دوباره‌خوانیِ ردیف پس از نوشتن*:
۱۸× `InvalidRequestError: Could not refresh instance` روی `db.refresh(row)`
(`accounts.py`، `transactions.py`، `events.py`، `sms_settings.py`) و ۱×
`NoResultFound` روی `.scalar_one()` در `add_subcategory` (`categories.py`). الگوی
مشترکِ همهٔ سرویس‌های نوشتن: `INSERT → db.commit() → refresh/scalar_one`.

**ریشه (از روی سورس، قطعی):** زمینهٔ خانواده با
`set_config('app.family_id', …, true)` گذاشته می‌شود، یعنی *transaction-local*.
`INSERT` روی تراکنشِ اول موفق است چون `get_tenant_member` →
`apply_to_transaction(db)` زمینه را صریح روی همان تراکنش نشانده. ولی `commit()`
تراکنش را می‌بندد و زمینه پاک می‌شود؛ دوباره‌خوانی روی تراکنشِ تازه است و تنها
مکانیزمِ بازنشاندن، شنوندهٔ `after_begin` (در `app/db/rls.py`) است که `_current_family`
(یک ContextVar) را می‌خواند — و آن ContextVar در زمینهٔ اجرای اندپوینت **دیده
نمی‌شود**: FastAPI وابستگیِ همگام و اندپوینتِ همگام را در دو زمینهٔ threadpoolِ جدا
اجرا می‌کند. پس دوباره‌خوانی زیرِ نقشِ واقعیِ RLS صفر ردیف می‌بیند → `refresh`
می‌ترکد / `scalar_one` خطا می‌دهد → هندلرِ خطای مدیریت‌نشده ۵۰۰ِ «INTERNAL» می‌دهد.

**استنتاج (اطمینانِ بالا، هنوز روی تولید تأییدنشده):** چون اپ در تولید زنده است و
داده نوشته می‌شود، نقشِ دیتابیسِ تولید تقریباً حتماً از RLS معاف است
(`superuser`/`BYPASSRLS`) — وگرنه هر نوشتن همان‌جا ۵۰۰ می‌داد. یعنی لایهٔ RLS در
تولید عملاً بی‌اثر است و ایزوله فقط با فیلترِ پایتونیِ `WHERE family_id=` برقرار
می‌ماند — دقیقاً همان «افتادنِ بی‌صدای شبکهٔ ایمنیِ دوم» که این مجموعه برای گرفتنش
نوشته شد. راهِ تأیید: همان سنجشِ `rolsuper/rolbypassrls` را روی نقشِ اتصالِ **تولید** بزن.

**چرا این ایرادِ تست نیست:** تست صادقانه اپِ واقعی را زیرِ نقشِ درست اجرا کرده.
رفعِ ریشه (نگه‌داشتنِ زمینه پس از commit + مشمول‌کردنِ نقشِ تولید) **تغییرِ رفتار**
است، پس طبقِ دامنهٔ مرحلهٔ A اینجا رفع نمی‌شود؛ فقط ثبت می‌شود (تسکِ #276، مرحلهٔ B).

**چطور ثبت شد (بدونِ تغییرِ رفتار):**

- در `conftest.py` یک مهارِ مشترک `expect_status()` افزوده شد که فقط پاسخِ دقیقِ
  ۵۰۰ِ «INTERNAL» را به `pytest.xfail()`ِ مستند برمی‌گرداند و هر کدِ دیگری را
  دست‌نخورده assert می‌کند. همهٔ سازنده‌های داده (`make_*`) و دو نوشتنِ درون‌خطی از
  آن عبور می‌کنند. نتیجه: ۱۹ شکستِ پراکنده به `xfailed`ِ معنادار تبدیل شد، نه پنهان.
- در `test_known_gaps.py` آزمونِ پذیرشِ سرراستِ
  `test_write_path_keeps_rls_context_after_commit` افزوده شد (POSTِ مستقیمِ ساختِ
  حساب؛ روزی که xpassed شد یعنی مرحلهٔ B ریشه را بست).

**خطِ پایهٔ سالمِ تازه:** **۶۳ passed / ۲۵ xfailed / ۰ failed** (۸۸ آزمون = ۸۷ +
آزمونِ تازهٔ شکافِ #۶). آن ۲۵ = ۵ شکافِ پیشین + ۱ شکافِ #۶ + ۱۹ آزمونِ داده‌محور
که تا رفعِ #۶ در مرحلهٔ B «مسدود»اند.

---

## نتیجهٔ مرحلهٔ B — ۱۴۰۵/۰۷/۰۱ (مدلِ عضویت + بستنِ #۲/#۳/#۶)

مرحلهٔ B طبقِ تصمیمِ ۲ (جدولِ بالا) اجرا شد: نقش‌ها، حالت‌های عضویت و تأییدِ مدیر با
هم. مطابقِ «پیامدهای تصمیم ۱»، `users`/`household_memberships` ساخته **نشد** و مدل
روی `members` ماند.

**مهاجرت `0006`** (کوچک، RLS-محور طبقِ §8.6):

- `families.created_by` (FK→`members.id` با `ON DELETE SET NULL`) — Creator جدا از
  نقش، طبقِ §2.4 و «پیامدِ تصمیم ۱». در `register` برای خانوادهٔ نو ست می‌شود.
- `members.membership_state` — ستونِ **جدید** برای شش حالتِ §2.5
  (`pending/active/rejected/expired/suspended/removed`)، تا معنیِ سالمِ
  `members.status` («مدیر معرفی کرده / خودش ثبت‌نام کرده») دست‌نخورده بماند (C3).
  ردیف‌های موجود به `active` backfill شدند.
- جدولِ **جدید و زیرِ RLS** `join_requests` — درخواستِ پیوستن (`via='code'|'link'`,
  `state`, `member_id`, `family_id`) با همان محمولِ fail-closedِ بقیه.
- تک‌مصرفه‌شدنِ دعوت: `family_invites.active/used_at/used_by` — پس از اولین پذیرش
  سوزانده می‌شود (#۳).

**نقش‌ها — بی‌ری‌مپ (تصمیمِ قفل‌شدهٔ مالک).** مقادیرِ `owner`/`member` **نگه داشته
شدند**؛ به‌جای remap به admin/member، اجازه‌دهی یک‌جا در `is_admin()` مرکزی شد
(owner و admin هر دو «مدیر»). مدیرِ دومِ اختیاری `role='admin'` می‌گیرد. سقفِ §2.3
(`_MAX_ADMINS=2`) و مصونیتِ Creator از تنزل و `MEMBER_NOT_ACTIVE`/`TOO_MANY_ADMINS`
در `promote_member`/`demote_member` پیاده شد. چند نقطهٔ عمداً هنوز `role=='owner'`
را چک می‌کنند (`CANNOT_REMOVE_OWNER`, `OWNER_RELATION_FIXED`).

**جریانِ پیوستن (§2.6).** `accept_invite` و `join_by_code` دیگر عضو را فعال
نمی‌کنند و **نشست نمی‌دهند**؛ `JoinPendingResult{family_name, state='pending'}`
برمی‌گردانند و یک `join_request` می‌سازند. `login` با گیتِ `_ensure_can_login`
حالت‌های `pending`/`rejected` را با `MEMBERSHIP_PENDING`/`MEMBERSHIP_REJECTED`
(۴۰۳) می‌بندد. مدیر از `/join-requests` تأیید/رد می‌کند (`approve`→`active`,
`reject`→`rejected`, تصمیمِ دوباره→`ALREADY_DECIDED`/۴۰۹).

### سه شکافِ بسته‌شده (xfail → قفلِ رگرسیون)

| # | چه شد |
|---|---|
| ۲ | پیوستن حالا منتظرِ تأییدِ مدیر می‌ماند؛ `test_accepted_invite_should_wait_for_admin_approval` سبز. |
| ۳ | توکنِ دعوت تک‌مصرفه شد؛ `test_invite_token_should_be_single_use` سبز. |
| ۶ | زمینهٔ خانواده روی `Session.info` می‌نشیند (پایدار پس از `commit`، مستقلِ از threadpool)؛ `test_write_path_keeps_rls_context_after_commit` سبز و مهارِ `expect_status` (۵۰۰→xfail) از `conftest.py` برداشته شد. |

شکاف‌های #۱ (§۵.۵ فایل)، #۴ (§۲.۸ ممیزی) و #۵ (عدم‌تقارنِ PATCH) خارج از دامنهٔ B
بودند و **هنوز `xfail`** می‌مانند.

### تست‌های تازهٔ B

`backend/tests/test_membership_flow.py` — ۱۳ آزمونِ اجازه‌دهی: پیوستن با کد →
تأیید → ورود، کدِ نامعتبر (`INVALID_CODE`/۴۰۴)، ردِ درخواست، تصمیمِ دوگانه،
ارتقا/تنزل، سقفِ دو مدیر، مصونیتِ Creator، ارتقای عضوِ pending، خاصیتِ idempotency،
گیتِ `require_admin` روی ارتقا/تنزل و فهرست، تأییدِ درخواست به‌دستِ **مدیرِ دوم**، و
ایزولهٔ چند-مستأجریِ `join_requests`. زیرساختِ `conftest.py` هم به قراردادِ تازهٔ
`accept-invite` کوچ کرد (`add_active_member` حالا مسیرِ کاملِ دعوت→pending→تأیید→ورود
را می‌رود؛ + کمک‌کارهای `create_invite_token/accept_invite/login_as/approve_join_request`).

### خطِ پایهٔ موردِ انتظارِ مرحلهٔ B

**۹۸ passed / ۳ xfailed / ۰ failed** — از دلتای مرحلهٔ A: ۱۹ آزمونِ داده‌محورِ
قبلاً-مسدود سبز شد + سه شکافِ #۲/#۳/#۶ سبز شد + ۱۳ آزمونِ تازه (۶۳+۱۹+۳+۱۳=۹۸)،
و xfailها به سه شکافِ باقی‌مانده رسید. **این VM پستگرس ندارد؛ فقط `py_compile` و
اسکنِ NUL روی سه فایلِ لمس‌شده اجرا شد (همه سالم).** شمارشِ دقیق را باید اجرای
`python -m pytest` روی پستگرسِ مالک تأیید کند.

### بازمانده‌ها (سمتِ مالک / مرحلهٔ بعد)

- **راستی‌آزماییِ نقشِ DBِ تولید (بخشِ مهمِ #۶).** رفعِ کد کافی نیست: اگر نقشِ
  اتصالِ تولید `superuser`/`BYPASSRLS` باشد، RLS دور می‌خورد. سنجش روی اتصالِ
  تولید: `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;`
  — هر دو باید `false` باشد. اپ باید با نقشِ کم‌امتیازِ مالکِ اسکیمای خودش کار کند.
- **اجرای کاملِ pytest روی پستگرس** برای تأییدِ خطِ پایهٔ ۹۸/۳/۰ (نیازمندِ محیطِ مالک).
- **تغییرِ قراردادِ فرانت‌اند.** `accept-invite` دیگر `AuthResult`+نشست نمی‌دهد؛
  `JoinPendingResult{family_name, state='pending'}` می‌دهد. کلاینت باید به جریانِ
  «پذیرش → صفحهٔ در‌انتظارِ تأیید → ورود پس از تأیید» سوییچ کند (وگرنه کاربرِ تازه
  پس از پذیرش، توکن نمی‌گیرد و گیر می‌کند).

### تعارضِ باز (خارج از دامنهٔ B، طبقِ §0/Rule 9)

§9.2 پرامپت مادر روشِ ورود را Google/Apple/Email می‌گوید، ولی سیستمِ زنده
شماره‌موبایل+رمز+OTP است. پیش از B علامت‌گذاری شد؛ مانعِ کارِ تست نبود ولی تعارضِ
حل‌نشدهٔ اسپک می‌ماند. §۶/§۷/§۸/§۹ پرامپت هم هنوز ممیزی نشده‌اند.
