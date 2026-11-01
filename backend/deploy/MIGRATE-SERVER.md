# کوچ به سرورِ تازه — چک‌لیستِ قدم‌به‌قدم

نوشته‌شده برای کوچِ ۱۴۰۵/۰۷/۱۸: پارس‌پک، از `109.122.254.221` به
`94.184.41.197`. دفعهٔ بعد هم همین ترتیب کار می‌کند؛ فقط IP را عوض کن.

> **ترتیب مهم است.** گامِ ۰ را پیش از هر کارِ دیگری انجام بده و سرورِ قدیم را
> تا پایانِ گامِ ۱۰ **خاموش نکن**.

## چیزهایی که با `git pull` نمی‌آیند

این سه تا در گیت نیستند و اگر فراموش شوند، سرورِ تازه بالا نمی‌آید یا داده
گم می‌شود:

| چه چیزی | چرا در گیت نیست | از کجا بیاید |
| --- | --- | --- |
| `backend/deploy/.env` | راز دارد (gitignore) | **کپی از سرورِ قدیم** |
| `backend/deploy/uploads/` | فایلِ کاربر است | بکاپِ گامِ ۰ |
| دیتابیس | — | بکاپِ گامِ ۰ |

⚠️ **`.env` را دستی بازنویسی نکن — کپی کن.** مخصوصاً
`FILE_SIGNING_SECRET`: آدرسِ عکس‌ها با آن امضا می‌شود و بعضی از این آدرس‌ها
در دیتابیس ذخیره شده‌اند (`avatar_url`). عوض‌کردنش یعنی عکس‌های موجود
۴۰۳ می‌گیرند.

---

## ۰) بکاپ از سرورِ **قدیم** (پیش از هر کاری)

```bash
ssh root@109.122.254.221
cd /opt/khaneyar/backend/deploy
./backup.sh
ls -lh /var/backups/khaneyar/ | tail -5
```

بعد روی **لپ‌تاپ خودت** بکش بیرون (سه فایل):

```bash
scp root@109.122.254.221:/var/backups/khaneyar/db-*.sql.gz      .
scp root@109.122.254.221:/var/backups/khaneyar/uploads-*.tar.gz .
scp root@109.122.254.221:/opt/khaneyar/backend/deploy/.env      ./env-backup
```

> اگر به سرورِ قدیم دسترسی نداری، با آخرین بکاپِ شبانه‌ای که جای دیگری
> داری ادامه بده. اگر هیچ بکاپی نداری، **این‌جا بایست** — داده از دست
> می‌رود و باید تصمیم بگیری.

---

## ۱) سرورِ تازه: نصبِ پیش‌نیازها

```bash
ssh root@94.184.41.197

curl -fsSL https://get.docker.com | sudo sh
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx git
```

## ۲) آوردنِ کد

```bash
sudo mkdir -p /opt/khaneyar && sudo chown "$USER" /opt/khaneyar
cd /opt/khaneyar
git clone <آدرس-ریپوی-تو> .
```

## ۳) برگرداندنِ `.env` و `uploads`

از لپ‌تاپ:

```bash
scp ./env-backup          root@94.184.41.197:/opt/khaneyar/backend/deploy/.env
scp ./uploads-*.tar.gz    root@94.184.41.197:/tmp/
scp ./db-*.sql.gz         root@94.184.41.197:/tmp/
```

روی سرورِ تازه:

```bash
cd /opt/khaneyar/backend/deploy
tar -xzf /tmp/uploads-*.tar.gz -C .      # پوشهٔ uploads را می‌سازد
sudo chown -R 10001:10001 uploads        # uid کاربرِ کانتینر
```

## ۴) بالا آوردنِ سرویس‌ها (دیتابیسِ خالی)

```bash
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:8000/api/v1/healthz
```

## ۵) برگرداندنِ دیتابیس

```bash
mkdir -p /var/backups/khaneyar
cp /tmp/db-*.sql.gz /var/backups/khaneyar/
./restore.sh /var/backups/khaneyar/db-XXXXXXXX-XXXXXX.sql.gz
```

> ترتیبِ «۰۰۰۱ → داده → head»ِ فاز ۱۰ این‌جا **موضوعی ندارد**: آن برای
> مهاجرت از Supabase بود. بکاپ خودش اسکیمای کامل را دارد.

## ۶) مهاجرت‌های تازه

```bash
docker compose run --rm api alembic upgrade head
docker compose run --rm api alembic current   # باید 0011 را نشان دهد
```

(`0009` اعلان‌ها · `0010` قبوض · `0011` خرید و انبار.)

## ۷) nginx

```bash
sudo cp nginx/khaneyar.conf /etc/nginx/sites-available/khaneyar.conf
sudo ln -sf /etc/nginx/sites-available/khaneyar.conf /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/khaneyar /var/www/khaneyar-site
sudo nginx -t && sudo systemctl reload nginx
```

## ۸) DNS — **چهار رکورد، نه یکی**

در پنلِ پارس‌پک → **CDN** → دامنهٔ `khaanehyar.ir` → رکوردها:

| نام | نوع | مقدار | حالت |
| --- | --- | --- | --- |
| `api` | A | `94.184.41.197` | **فقط DNS** |
| `@` | A | `94.184.41.197` | **فقط DNS** |
| `www` | CNAME | `khaanehyar.ir` | **فقط DNS** |
| `pwa` | A | `94.184.41.197` | **فقط DNS** |

سه تلهٔ ثبت‌شدهٔ این پنل:

1. **`pwa` را فراموش نکن.** اپِ اندرویدِ نصب‌شده همین آدرس را در WebView باز
   می‌کند (`capacitor server.url`). بی این رکورد، **همهٔ اپ‌های نصب‌شده
   می‌شکنند** — نه فقط سایت.
2. **حالت باید «فقط DNS» باشد، نه پروکسی.** پروکسیِ CDN هم certbot را
   می‌شکند (HTTP-01) و هم یک پرشِ اضافه می‌گذارد.
3. **نیم‌سرورها باید `tree.parspack.net` + `comet.parspack.net` بمانند.**
   `ns1/ns2.parspack.co` زونِ CDN را **رد می‌کنند** و هیچ‌چیز resolve نمی‌شود.

وارسی پیش از رفتن به گامِ بعد:

```bash
nslookup api.khaanehyar.ir tree.parspack.net
nslookup pwa.khaanehyar.ir tree.parspack.net
```

هر دو باید `94.184.41.197` بدهند.

## ۹) SSL — هر چهار دامنه با یک دستور

```bash
sudo certbot --nginx -d api.khaanehyar.ir -d khaanehyar.ir \
             -d www.khaanehyar.ir -d pwa.khaanehyar.ir
```

> گواهیِ قدیم روی سرورِ قبلی بود و منتقل نمی‌شود. certbot خودش بلاکِ ۴۴۳،
> ریدایرکتِ ۸۰→۴۴۳ و تمدیدِ خودکار را می‌سازد.

## ۱۰) فایروال

```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
sudo ufw status
```

پورتِ Postgres (۵۴۳۲) و اپ (۸۰۰۰) در `docker-compose.yml` از قبل فقط روی
`127.0.0.1` گوش می‌دهند — به اینترنت باز نیستند.

## ۱۱) بکاپِ شبانه (روی سرورِ تازه)

```bash
cd /opt/khaneyar/backend/deploy
chmod +x backup.sh restore.sh
crontab -e
# این خط:
0 3 * * * /opt/khaneyar/backend/deploy/backup.sh >> /var/log/khaneyar-backup.log 2>&1
```

## ۱۲) فرانت و سایت — از لپ‌تاپ

`deploy-config.bat` از قبل روی IP تازه تنظیم شده. فقط:

```
deploy.bat all
```

خودش این‌ها را می‌کند: push به گیت‌هاب · `git pull` + `docker compose up
--build` + `alembic upgrade head` + healthz روی سرور · build فرانت با
`VITE_API_URL` + آپلودِ PWA · آپلودِ سایتِ معرفی + APK.

---

## وارسیِ پایانی

```bash
curl -I https://api.khaanehyar.ir/api/v1/healthz   # باید ۲۰۰ بدهد
curl -I https://pwa.khaanehyar.ir                  # باید ۲۰۰ بدهد
curl -I https://khaanehyar.ir                      # باید ۲۰۰ بدهد
```

روی گوشی: یک‌بار اپِ نصب‌شده را باز کن و وارد شو. اگر داده‌ها سرِ جایشان
بودند و عکسِ پروفایل هم آمد، کوچ کامل است.

و آخر: `python -m pytest` از پوشهٔ `backend` روی **لپ‌تاپ** (نه سرور) — خطِ
تأییدشده **۲۲۴ passed + ۳ xfailed + ۰ skipped**. محیطش در
`backend/tests/README.md` آمده.

**تا این‌جا سرورِ قدیم را نگه دار.** بعد از وارسیِ موفق و یک‌دو روز
اطمینان، می‌توانی حذفش کنی.
