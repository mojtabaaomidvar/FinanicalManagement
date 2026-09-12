#!/usr/bin/env bash
# تشخیصِ ۴۰۳ِ BrsApi — کلید را از deploy/.env می‌خواند و هرگز چاپ نمی‌کند.
#
# چرا لازم شد: لاگِ سرور نشان داد هر دو فراخوانیِ بالادست «403 Forbidden»
# می‌گیرند. علت (تأییدشده از مستندِ خودِ BrsApi): یوزرایجنتِ کتابخانه‌های
# پایتون توسط «فایروال ۶جی» مسدود می‌شود. این اسکریپت همان را اثبات می‌کند:
# یک فراخوان با UAِ پایتون، یکی با UAِ مرورگر، و یکی با کلیدِ عمداً غلط تا
# پاسخِ «کلیدِ بد» از پاسخِ «UAِ بد» قابلِ تفکیک باشد.
# خروجی فقط کدِ وضعیت + ۲۰۰ کاراکترِ اولِ بدنه است.
#
# اجرا:  bash /opt/khaneyar/backend/deploy/diagnose-brsapi.sh

set -u

ENV_FILE="$(dirname "$0")/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "خطا: $ENV_FILE پیدا نشد."
  exit 1
fi

KEY="$(grep -E '^BRSAPI_KEY=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r\n' | tr -d '"' | tr -d "'")"
if [ -z "$KEY" ]; then
  echo "خطا: BRSAPI_KEY در .env خالی است."
  exit 1
fi
echo "کلید خوانده شد — طول: ${#KEY} کاراکتر (مقدارش چاپ نمی‌شود)"
echo

UA_BROWSER="Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/106.0.0.0"
URL="https://api.brsapi.ir/Market/Gold_Currency.php"

probe() {
  local label="$1"; shift
  # -s بی‌صدا، بدنه در فایلِ موقت، کدِ وضعیت جدا. کلید در خروجی نمی‌آید.
  local body_file; body_file="$(mktemp)"
  local code
  code="$(curl -s -o "$body_file" -w '%{http_code}' --max-time 15 "$@" "${URL}?key=${KEY}" 2>/dev/null)"
  # کلید را از بدنه هم پاک می‌کنیم (اگر سرویس آدرس را بازتاب دهد)
  local body
  body="$(head -c 200 "$body_file" | sed "s/${KEY}/***/g")"
  rm -f "$body_file"
  printf '%-28s → HTTP %s\n' "$label" "$code"
  printf '    بدنه: %s\n\n' "${body:-<خالی>}"
}

echo "=== آزمونِ ۱: بدونِ هدرِ خاص (مثلِ httpx پیش‌فرض) ==="
probe "بدون User-Agent" -H 'User-Agent: python-httpx/0.27'

echo "=== آزمونِ ۲: با User-Agentِ مرورگر ==="
probe "با UA مرورگر" -H "User-Agent: ${UA_BROWSER}" -H 'Accept: application/json'

echo "=== آزمونِ ۳: کلیدِ عمداً غلط (برای مقایسه) ==="
bad_body="$(mktemp)"
: > "$bad_body"   # تضمینِ وجودِ فایل حتی اگر curl شکست بخورد
code="$(curl -s -o "$bad_body" -w '%{http_code}' --max-time 15 \
  -H "User-Agent: ${UA_BROWSER}" \
  "${URL}?key=definitely_not_a_real_key_000" 2>/dev/null)"
printf '%-28s → HTTP %s\n' "کلیدِ غلط" "$code"
printf '    بدنه: %s\n\n' "$(head -c 200 "$bad_body")"
rm -f "$bad_body"

echo "=== تفسیر ==="
echo "• انتظارِ اصلی: ۱ = 403 و ۲ = 200 ⇒ علت فقط User-Agent است."
echo "  مستندِ خودِ BrsApi می‌گوید UAِ پایتون را «فایروال ۶جی» مسدود می‌کند."
echo "• اگر ۲ هم 403 داد ⇒ این بار پای کلید/پلن است، نه هدر؛ بدنه را بخوان."
echo "• اگر بدنه از «پلن» یا «اشتراک» حرف زد ⇒ اندپوینت در پلنِ فعلی نیست."
