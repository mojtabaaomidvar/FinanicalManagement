# استقرار خانه‌یار روی «سرور ابری» (VPS) — راهنمای گام‌به‌گام

مسیرِ ارزان: یک سرورِ کوچک، همه‌چیز رویش (اپ + Postgres + فایل) با `docker-compose`،
و nginx برای دامنه و SSL. **بکاپ به عهدهٔ توست** — بخشِ ۹ را جدی بگیر.

فایل‌های این پوشه: `docker-compose.yml`، `nginx/khaneyar.conf`، `backup.sh`،
`restore.sh`. ایمیجِ اپ از `../Dockerfile` ساخته می‌شود.

> این سند فقط **نامِ** متغیرها را می‌گوید؛ هیچ مقدارِ محرمانه‌ای اینجا نیست.

نقشه: `api.khaanehyar.ir` → اپ · `khaanehyar.ir`/`www` → PWA (اختیاری، همین سرور).

---

## ۰) پیش‌نیاز

- یک سرور ابری، **اوبونتو ۲۲/۲۴**، حدود **۲ گیگ رم / ۱-۲ هسته / ۲۵ گیگ SSD** (برای
  بارِ سبکِ ۱۰۰-۲۰۰ کاربرِ غیرهم‌زمان کافی است). روی پارس‌پک یا آروان یکسان است.
- دسترسیِ SSH به سرور و دامنهٔ `khaanehyar.ir` (در پنلِ پارس‌پک).

---

## ۱) نصبِ Docker + nginx + certbot (روی سرور)

```bash
# Docker + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # سپس یک‌بار logout/login

# nginx + certbot (برای SSL)
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## ۲) آوردنِ کد روی سرور

کلِ پوشهٔ `backend/` را زیرِ `/opt/khaneyar/backend` بگذار (git clone یا rsync):

```bash
sudo mkdir -p /opt/khaneyar && sudo chown "$USER" /opt/khaneyar
cd /opt/khaneyar
git clone <آدرسِ-ریپوی-تو> .        # یا rsync از لپ‌تاپ
cd backend/deploy
```

---

## ۳) ساختِ فایلِ `.env` (فقط روی سرور، در git نره)

داخلِ `backend/deploy/` یک فایلِ `.env` بساز با این **نام‌ها**:

```
# Postgres (کانتینرِ db)
POSTGRES_USER=...
POSTGRES_PASSWORD=...            # رمزِ قوی
POSTGRES_DB=khaneyar

# اپ — نکته: هاستِ دیتابیس همان نامِ سرویس یعنی «db» است
DATABASE_URL=postgresql+psycopg://POSTGRES_USER:POSTGRES_PASSWORD@db:5432/khaneyar
APP_ENV=production
DEBUG=false
CORS_ORIGINS=https://khaanehyar.ir,https://www.khaanehyar.ir

# فایل‌ها
FILE_SIGNING_SECRET=...          # بساز: openssl rand -hex 32
FILES_BASE_URL=https://api.khaanehyar.ir
STORAGE_DIR=/app/var/uploads     # حالتِ دیسک (پیش‌فرض)

# (اختیاری) حالتِ S3 به‌جای دیسک — اگر فضای ابری خریدی:
# STORAGE_ENDPOINT=...
# STORAGE_BUCKET=...
# STORAGE_ACCESS_KEY=...
# STORAGE_SECRET_KEY=...

# پیامک فعلاً خالی (حالتِ توسعه)
SMS_PROVIDER=
SMS_API_KEY=
SMS_SENDER=
```

نکته‌ها:
- مقدارِ `DATABASE_URL` باید همان `POSTGRES_USER/PASSWORD/DB` را داشته باشد و پیشوندش
  حتماً `postgresql+psycopg://` و هاستش `db` باشد.
- مطمئن شو `.env` در `.gitignore` هست (نباید کامیت شود).

پوشهٔ آپلود را برای کاربرِ کانتینر (uid `10001`) قابلِ نوشتن کن (حالتِ دیسک):

```bash
mkdir -p uploads
sudo chown -R 10001:10001 uploads
```

---

## ۴) بالا آوردنِ سرویس‌ها

```bash
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:8000/api/v1/healthz    # باید سالم جواب دهد
```

---

## ۵) مهاجرت دیتابیس — ترتیبِ حیاتی (فاز ۱۰)

روی ۹ جدولِ داده RLS با FORCE فعال است؛ پس داده باید **پیش از** `0002` بار شود:

```
alembic upgrade 0001   →   بار داده   →   alembic upgrade head
```

**گام ۵.۱ — اسکیمای پایه (روی سرور):**

```bash
docker compose run --rm api alembic upgrade 0001
```

**گام ۵.۲ — بار دادن داده از Supabase (از کامپیوترِ خودت):**
Supabase از داخلِ ایران/سرور در دسترس نیست، پس بار دادن را از لپ‌تاپِ خودت انجام بده و
با **تونلِ SSH** به دیتابیسِ سرور وصل شو (بدونِ باز کردنِ Postgres به اینترنت):

```bash
# ترمینالِ ۱ (لپ‌تاپ): تونل به Postgresِ سرور (که روی 127.0.0.1:5432 گوش می‌دهد)
ssh -L 15432:127.0.0.1:5432 USER@SERVER_IP

# ترمینالِ ۲ (لپ‌تاپ، داخلِ backend با محیطِ پایتون):
export SOURCE_DATABASE_URL='postgresql://…supabase…'                 # مبدأ (خواندن)
export TARGET_DATABASE_URL='postgresql+psycopg://POSTGRES_USER:POSTGRES_PASSWORD@127.0.0.1:15432/khaneyar'
python migration/migrate_essentials.py --dry-run    # اول آزمایشی
python migration/migrate_essentials.py              # سپس واقعی
```

**گام ۵.۳ — بقیهٔ مهاجرت (روی سرور):**

```bash
docker compose run --rm api alembic upgrade head
```

> جزئیات و پرچم‌ها (`--truncate`، `--skip-reference`) در `../migration/RUNBOOK.md`.

---

## ۶) nginx + دامنه

```bash
sudo cp nginx/khaneyar.conf /etc/nginx/sites-available/khaneyar.conf
sudo ln -s /etc/nginx/sites-available/khaneyar.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

DNS (در پنلِ دامنهٔ پارس‌پک): یک رکوردِ **A** برای `api` به **IPِ سرور**. اگر PWA را هم
همین‌جا می‌گذاری، `@` و `www` را هم به همان IP بزن.

---

## ۷) SSL (رایگان، تمدیدِ خودکار)

```bash
sudo certbot --nginx -d api.khaanehyar.ir
# اگر PWA هم اینجاست:
# sudo certbot --nginx -d api.khaanehyar.ir -d khaanehyar.ir -d www.khaanehyar.ir
```

certbot بلاکِ ۴۴۳ و ریدایرکتِ ۸۰→۴۴۳ را می‌سازد و تمدید را خودکار می‌کند. تست:

```bash
curl -I https://api.khaanehyar.ir/api/v1/healthz
```

---

## ۸) فرانت (PWA/اندروید)

هنگامِ بیلد، `VITE_API_URL=https://api.khaanehyar.ir` را ست کن (بدونِ `/api/v1` — کد
خودش می‌افزاید). اگر PWA را روی همین سرور می‌دهی، خروجیِ `dist` را در `/var/www/khaneyar`
بگذار و بلاکِ کامنت‌شدهٔ وب را در `nginx/khaneyar.conf` فعال کن.

---

## ۹) بکاپِ خودکار — مهم‌ترین قدمِ این مسیر

چون سرویسِ مدیریت‌شده نداری، بکاپ دستِ خودت است.

```bash
chmod +x backup.sh restore.sh
# مسیرِ COMPOSE_DIR داخلِ backup.sh را با مسیرِ واقعی هم‌خوان کن (پیش‌فرض /opt/khaneyar/backend/deploy)

crontab -e
# هر شب ۳ بامداد:
0 3 * * * /opt/khaneyar/backend/deploy/backup.sh >> /var/log/khaneyar-backup.log 2>&1
```

**حتماً یک‌بار بازگردانی را تست کن** (بکاپی که restore نشود، بکاپ نیست):

```bash
./restore.sh /var/backups/khaneyar/db-XXXXXXXX-XXXXXX.sql.gz
```

توصیهٔ جدی: کپیِ آفسایتِ بکاپ (بخشِ ۴ در `backup.sh`) را فعال کن تا اگر خودِ سرور از
بین رفت، بکاپ جای دیگری باشد (مثلاً فضای ابریِ S3).

---

## ۱۰) آپدیتِ بعدیِ کد

```bash
cd /opt/khaneyar/backend
git pull
cd deploy
docker compose up -d --build
# اگر مهاجرتِ جدیدی اضافه شده:
docker compose run --rm api alembic upgrade head
```

---

## ۱۱) چک‌لیستِ امنیت (قبل از عمومی‌کردن)

- [ ] فایروال: فقط ۲۲ (SSH)، ۸۰، ۴۴۳ باز باشد
      ```bash
      sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
      ```
- [ ] پورتِ Postgres (۵۴۳۲) و اپ (۸۰۰۰) فقط روی `127.0.0.1` باشند (در compose همین‌طور است) — به اینترنت باز نشوند
- [ ] `DEBUG=false` و `APP_ENV=production`
- [ ] `FILE_SIGNING_SECRET` ست شده و `.env` در git نیست
- [ ] بکاپِ شبانه کار می‌کند و `restore` تست شده
- [ ] آپدیتِ سیستم: `sudo apt update && sudo apt upgrade -y`
- [ ] فاز ۱ (چرخشِ کلیدهای Supabase + پاک‌سازیِ تاریخچهٔ گیت) — هنوز روی توست
