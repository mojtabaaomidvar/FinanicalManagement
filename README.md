# مالی من — مدیریت مالی خانواده (PWA)

اپلیکیشن وب مدیریت مالی خانواده، مختص موبایل (iPhone/Android)، فارسی و راست‌به‌چپ.
نسخه ۲.۰.۰ — داده‌ها روی **Supabase**، بدون نیاز به بک‌اند اختصاصی.

## ✨ امکانات

- 👨‍👩‍👧‍👦 **خانواده مشترک** — ساخت خانواده با کد دعوت ۶ رقمی؛ هر عضو با کد وارد می‌شود
- 💳 **تراکنش‌ها** — ثبت/ویرایش/حذف درآمد و هزینه با ۱۴ دسته‌بندی
- 📅 **تقویم جلالی** — الگوریتم دقیق سال کبیسه (چرخه ۳۳ ساله)
- 📊 **گزارش‌ها** — نمودار حلقه‌ای، ستونی روزانه، روند ۶ ماهه (Canvas خالص)
- 📱 **پیامک بانکی** — چسباندن (Paste) متن پیامک واریز/برداشت؛ پارس خودکار بانک، مبلغ، موجودی و تاریخ
- 🔔 **پیامک‌های ثبت‌نشده** — هنگام باز شدن اپ، مودالی پیامک‌های رسیدگی‌نشده را یکی‌یکی برای ثبت نشان می‌دهد
- 🌙 تم تیره/روشن، بودجه ماهانه، خروجی JSON، نصب به‌عنوان اپ (PWA)

## 🗂 ساختار پروژه

```
personal-finance-pwa/
├── index.html            # شل اپ (auth، اعضا، داشبورد، تراکنش‌ها، گزارش‌ها، تنظیمات)
├── manifest.json         # مانیفست PWA
├── sw.js                 # Service Worker (cache-first)
├── deploy.bat            # 🚀 ارسال به GitHub + انتشار Vercel (ویندوز)
├── css/style.css         # دیزاین توکن‌ها + تم iOS تیره/روشن (RTL)
├── js/
│   ├── config.js         # ⚙️ تنظیمات Supabase (اینجا را پر کنید)
│   ├── jalali.js         # تقویم جلالی
│   ├── sms-parser.js     # پارسر پیامک بانکی ایرانی
│   ├── db.js             # لایه Supabase (PostgREST با fetch خالص)
│   ├── charts.js         # نمودارهای Canvas
│   └── app.js            # منطق اصلی
├── supabase/schema.sql   # اسکیمای دیتابیس
├── icons/                # آیکون‌های PWA
└── tools/                # اسکریپت‌های کمکی Node
```

## 🚀 راه‌اندازی

### ۱) ساخت پروژه Supabase

1. به [supabase.com](https://supabase.com) بروید → **New Project**
2. نام و رمز دلخواه؛ منطقه (Region) را نزدیک انتخاب کنید (مثلاً Frankfurt)
3. پس از ساخت پروژه، به **SQL Editor** بروید
4. کل محتوای [`supabase/schema.sql`](supabase/schema.sql) را Paste و **Run** کنید

### ۲) تنظیمات اتصال

از **Settings → API** این دو مقدار را بردارید:

- **Project URL** — مثل `https://abcd1234.supabase.co`
- **anon public key** — کلید عمومی

سپس فایل [`js/config.js`](js/config.js) را ویرایش کنید:

```js
const SUPABASE_CONFIG = {
  url: "https://abcd1234.supabase.co", // ← Project URL شما
  anonKey: "eyJhbGciOi...", // ← anon key شما
};
```

### ۳) اجرای محلی

```bash
cd personal-finance-pwa
npx -y http-server -p 8090 -c-1
```

سپس در مرورگر: `http://localhost:8090`

> **نکته iOS:** برای نصب PWA روی آیفون، سایت باید **HTTPS** داشته باشد (مثل Vercel). روی localhost هم Service Worker کار می‌کند.

## 🧪 تست

```bash
node tools/integration-test.js   # تست بارگذاری همه اسکریپت‌ها + پارس پیامک
node tools/generate-icons.js     # بازتولید آیکون‌ها (در صورت نیاز)
```

## 📤 ارسال به GitHub

### روش سریع — فایل bat (ویندوز)

فایل [`deploy.bat`](deploy.bat) را اجرا کنید (دابل‌کلیک). این فایل:

1. مخزن git می‌سازد (اگر نباشد) + فایل `.gitignore`
2. اگر هویت git تنظیم نشده باشد، نام و ایمیل می‌پرسد
3. commit می‌سازد و به GitHub پوش می‌کند (آدرس مخزن را می‌پرسد)
4. Vercel CLI را نصب می‌کند (اگر نباشد) و با `vercel --prod --yes` منتشر می‌کند

منوی ساده دارد: **[1] GitHub + Vercel** (پیش‌فرض) / **[2] فقط GitHub** / **[3] فقط Vercel**

می‌توانید آدرس مخزن را هم از قبل بدهید تا نپرسد:

```bat
deploy.bat https://github.com/USERNAME/REPO.git
```

> پیش‌نیازها: `git` و `Node.js` نصب باشد. برای GitHub احتمالاً یک‌بار `git config --global` یا login لازم باشد؛ برای Vercel اولین بار مرورگر برای ورود باز می‌شود.

### روش دستی

در پوشه پروژه:

```bash
git init
git add .
git commit -m "مالی من — نسخه ۲ (Supabase + خانواده + پیامک)"
git branch -M main
git remote add origin https://github.com/mojtabaaomidvar/FinanicalManagement.git
git push -u origin main
```

> جای `USERNAME/REPO` نام کاربری و مخزن خودتان را بگذارید.
> اگر مخزن را از قبل در github.com ساخته‌اید (بدون README)، فقط دستورهای بالا را بزنید.

## 🌐 انتشار روی Vercel

### روش ۱ — از داشبورد (پیشنهادی)

1. به [vercel.com](https://vercel.com) بروید → **Sign up with GitHub**
2. **Add New → Project** → مخزع `personal-finance-pwa` را انتخاب کنید
3. تنظیمات را دست نزنید (استاتیک است، Build Command لازم ندارد) → **Deploy**
4. پس از چند ثانیه آدرس `https://your-app.vercel.app` آماده است

### روش ۲ — با CLI

```bash
npm i -g vercel
cd personal-finance-pwa
vercel          # اولین بار: سوالات را Enter بزنید
vercel --prod   # انتشار نهایی
```

### نصب روی آیفون

آدرس Vercel را در Safari باز کنید → **Share ← Add to Home Screen** — اپ تمام‌صفحه با آیکون نصب می‌شود.

## 🔄 جریان کار اپ

1. **ساخت خانواده** — نام خانواده + نام شما → کد ۶ رقمی می‌گیرید
2. **اشتراک کد** — کد را به اعضای خانواده بدهید؛ آن‌ها با «ورود با کد» وارد می‌شوند
3. **انتخاب عضو** — هر دستگاه عضو خودش را انتخاب می‌کند (در localStorage ذخیره می‌شود)
4. **ثبت تراکنش** — دکمه سبز پایین؛ نوع، مبلغ، دسته، عضو، تاریخ (جلالی)
5. **ورود پیامک** — آیکون پیامک در هدر داشبورد → متن را Paste کنید → پیش‌نمایش پارس → ذخیره
6. **پیامک‌های ثبت‌نشده** — در هر بار باز شدن اپ، مودال پیامک‌های pending را یکی‌یکی نشان می‌دهد: **ثبت** / **نادیده** / **بعداً**

## 🗄 دیتابیس (Supabase)

| جدول           | توضیح                                                 |
| -------------- | ----------------------------------------------------- |
| `families`     | خانواده‌ها + کد دعوت + تنظیمات (بودجه، واحد، تم)      |
| `members`      | اعضای هر خانواده (owner / member)                     |
| `transactions` | تراکنش‌ها — تاریخ میلادی ذخیره، جلالی نمایش           |
| `sms_messages` | پیامک‌های بانکی — وضعیت: pending / recorded / ignored |

> **امنیت:** این نسخه با سیاست‌های RLS باز کار می‌کند (اپ خانوادگی ساده). برای استفاده جدی‌تر، Supabase Auth را به `db.js` اضافه کنید.

## 🛠 تکنولوژی

- HTML/CSS/JS خالص — بدون فریم‌ورک، بدون بیلد
- Supabase PostgREST (fetch خالص، بدون SDK)
- Canvas 2D با پشتیبانی Retina (DPR)
- Vazirmatn (فونت فارسی) + iOS HIG الگوهای طراحی
