# راه‌اندازی زیردامنه — سایت روی khaanehyar.ir، اپ روی app.khaanehyar.ir

از این به بعد دامنهٔ اصلی **سایت معرفی** را نشان می‌دهد و **خودِ برنامه** به
`app.khaanehyar.ir` منتقل می‌شود.

| آدرس | چه چیزی سرو می‌شود | پوشه روی سرور |
|---|---|---|
| `khaanehyar.ir` + `www` | سایت معرفی (`site/`) + فایل نصب | `/var/www/khaneyar-site` |
| `app.khaanehyar.ir` | خودِ برنامه (PWA) | `/var/www/khaneyar` |
| `api.khaanehyar.ir` | بک‌اند (بدون تغییر) | کانتینر داکر |

> **مهم:** تا وقتی گام‌های ۱ تا ۴ را انجام نداده‌اید، `deploy.bat` را اجرا نکنید.
> اگر سایت روی ریشه بنشیند ولی `app.khaanehyar.ir` هنوز بالا نیامده باشد،
> اپ‌های نصب‌شده روی گوشی‌ها به صفحهٔ تبلیغاتی می‌خورند.

---

## گام ۱ — رکورد DNS برای زیردامنه

در پنل پارس‌پک، بخش DNS دامنهٔ `khaanehyar.ir` (همان‌جایی که `api` را ساختید،
سرورهای نام `tree/comet.parspack.net` و حالت **فقط DNS**):

یک رکورد **A** بسازید:

```
Type: A        Name: app        Value: 109.122.254.221        TTL: 3600
```

چند دقیقه صبر کنید، بعد روی کامپیوتر خودتان چک کنید:

```
nslookup app.khaanehyar.ir
```

باید `109.122.254.221` را برگرداند. تا وقتی برنگردانده، گام بعد را شروع نکنید.

---

## گام ۲ — کانفیگ nginx

فایل `backend/deploy/nginx/khaneyar.conf` در مخزن به‌روز شده و حالا هر سه میزبان
را دارد. روی سرور:

```
sudo nano /etc/nginx/sites-available/khaneyar.conf
```

محتوای فایل مخزن را جایگزین کنید. اگر certbot قبلاً بلاک‌های ۴۴۳ را به فایل
فعلی اضافه کرده، **آن بلاک‌ها را دست نزنید**؛ فقط این دو تغییر را بدهید:

1. در بلاکِ `khaanehyar.ir www.khaanehyar.ir`:
   - `root` را به `/var/www/khaneyar-site` تغییر دهید
   - `try_files $uri $uri/ /index.html;` را به `try_files $uri $uri/ =404;` تغییر دهید
2. بلاکِ تازهٔ `app.khaanehyar.ir` را (از فایل مخزن) اضافه کنید؛ `root` آن
   `/var/www/khaneyar` می‌ماند و SPA fallback دارد.

پوشهٔ سایت را بسازید:

```
sudo mkdir -p /var/www/khaneyar-site && sudo chown -R www-data:www-data /var/www/khaneyar-site
```

تست بگیرید:

```
sudo nginx -t && sudo systemctl reload nginx
```

---

## گام ۳ — SSL برای زیردامنه

```
sudo certbot --nginx -d api.khaanehyar.ir -d khaanehyar.ir -d www.khaanehyar.ir -d app.khaanehyar.ir
```

certbot گواهی را گسترش می‌دهد و بلاکِ ۴۴۳ و ریدایرکت ۸۰→۴۴۳ را برای زیردامنهٔ
تازه هم می‌سازد. اگر پرسید «expand»، بله بزنید.

---

## گام ۴ — CORS بک‌اند

اپ حالا از `app.khaanehyar.ir` بالا می‌آید، پس درخواست‌هایش به API از این مبدأ
می‌آید. اگر این خط را اضافه نکنید، **همهٔ درخواست‌ها را مرورگر می‌بندد** و اپ
خالی بالا می‌آید:

```
sudo nano /opt/khaneyar/backend/deploy/.env
```

مقدار `CORS_ORIGINS` را این کنید:

```
CORS_ORIGINS=https://app.khaanehyar.ir,https://khaanehyar.ir,https://www.khaanehyar.ir
```

بعد بک‌اند را بالا بیاورید:

```
cd /opt/khaneyar/backend/deploy && sudo docker compose up -d
```

---

## گام ۵ — دیپلوی از ویندوز

اول تنظیمات را یک‌بار تازه کنید تا مسیر پوشهٔ سایت ذخیره شود:

```
deploy.bat config
```

سؤال‌ها را جواب دهید؛ برای مسیر سایت Enter بزنید تا پیش‌فرض
`/var/www/khaneyar-site` بماند.

بعد دیپلوی کنید:

```
deploy.bat frontend
```

این یک دستور حالا هر دو کار را می‌کند: `dist` را در `/var/www/khaneyar` می‌گذارد
(اپ) و `site/` را در `/var/www/khaneyar-site` (سایت). فایل APK هم اگر ساخته شده
باشد خودکار کنار سایت کپی می‌شود.

---

## گام ۶ — بازساخت APK (لازم است)

`capacitor.config.ts` عوض شده: `server.url` حالا `https://app.khaanehyar.ir`
است. **اپ‌های نصب‌شدهٔ فعلی هنوز به ریشه اشاره می‌کنند** و بعد از این تغییر
صفحهٔ معرفی را نشان می‌دهند. پس باید APK تازه بسازید و منتشر کنید:

```
npx cap sync android
```

بعد در Android Studio یک Signed APK بسازید و فایل را اینجا بگذارید:

```
android/app/release/app-release.apk
```

`deploy.bat` از همین مسیر برمی‌دارد و روی `khaanehyar.ir/khanehyar.apk`
می‌گذارد. اگر این فایل نباشد، دکمهٔ دانلود ۴۰۴ می‌دهد و اسکریپت هم هشدار
می‌دهد.

> نکتهٔ مهم برای کاربران فعلی: کسی که نسخهٔ قدیمی را نصب دارد، با به‌روزرسانی
> خودکار درست نمی‌شود — چون آدرسِ داخل APK عوض شده. باید فایل تازه را نصب کند.
> اگر کاربر واقعی دارید، اول به آن‌ها خبر دهید.

---

## گام ۷ — راستی‌آزمایی

به ترتیب باز کنید و ببینید:

- `https://khaanehyar.ir` → صفحهٔ معرفی
- `https://khaanehyar.ir/download/` → صفحهٔ دانلود، دکمه فایل را می‌دهد
- `https://khaanehyar.ir/web/` → صفحهٔ نسخهٔ وب
- `https://app.khaanehyar.ir` → خودِ برنامه، صفحهٔ ورود
- در برنامه یک‌بار وارد شوید (اگر ورود کار کرد یعنی CORS درست است)
- `https://khaanehyar.ir/یک-مسیر-الکی` → باید ۴۰۴ بدهد، نه صفحهٔ اصلی

اگر برنامه سفید بالا آمد: در مرورگر `F12` بزنید و تب Console را ببینید؛ خطای
CORS یعنی گام ۴ ناقص مانده.

---

## اگر خواستید برگردید

هر دو پوشه نسخهٔ قبلی را نگه می‌دارند:

```
sudo rm -rf /var/www/khaneyar && sudo mv /var/www/khaneyar.old /var/www/khaneyar
```

و برای سایت همین دستور با `khaneyar-site`.
