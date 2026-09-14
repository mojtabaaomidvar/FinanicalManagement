/* خودآزمای «فیلتر سرشماره روی گوشی» — سه لایه باید یک‌زبان باشند:

     ۱) سرور  : backend/app/services/sms_settings.py → normalize_sender()
     ۲) وب    : src/app/useNativeSmsReader.ts        → nativeSenderNeedle()
     ۳) اندروید: android/.../SmsReaderPlugin.java     → senderAllowed()

   لایهٔ ۱ فرستنده را می‌شوید (حذف فاصله/خط‌تیره/«+»، تبدیل ۹۸۹… به ۰۹…)
   ولی لایهٔ ۳ آدرسِ خامِ اپراتور را فقط حروف‌کوچک می‌کند و contains می‌زند.
   پس مقدارِ ذخیره‌شده همیشه زیررشتهٔ آدرسِ واقعی نیست — و اگر نباشد، پیامکِ
   بانکی بی‌صدا حذف می‌شود. لایهٔ ۲ همین شکاف را پر می‌کند.

   اجرا:  node scripts/selftest-sms-sender-filter.mjs
   (vitest/build در این محیط اجرا نمی‌شوند؛ این فایل عمداً نودِ خالص است.) */

/** معادلِ nativeSenderNeedle در src/app/useNativeSmsReader.ts */
const needle = (s) => (/^09\d{9}$/.test(s) ? s.slice(1) : s);

/** معادلِ senderAllowed در SmsReaderPlugin.java */
const javaAllowed = (addr, filter) => {
  if (filter.length === 0) return true; // فیلتر خالی = همه به پارسر می‌رسند
  if (addr == null) return false;
  const s = addr.toLowerCase();
  return filter.some((f) => s.includes(f));
};

/** معادلِ normalize_sender در backend/app/services/sms_settings.py */
const norm = (raw) => {
  let s = raw.trim().replace(/[\s\-()+]/g, "");
  if (s.length === 12 && s.startsWith("989") && /^\d+$/.test(s)) {
    s = "0" + s.slice(2);
  }
  return s.toLowerCase();
};

let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

/* [آدرسی که اپراتور تحویل می‌دهد, چیزی که کاربر در فرم تایپ کرده] */
const mustPass = [
  ["6037", "6037"],
  ["+986037", "6037"],
  ["BANKMELLAT", "BANKMELLAT"],
  ["bankmellat", "BANKMELLAT"],
  ["9820001234", "9820001234"],
  ["+989123456789", "+98 912 345 6789"],
  ["09123456789", "+989123456789"],
  ["+989123456789", "09123456789"],
];

for (const [addr, typed] of mustPass) {
  const stored = norm(typed);
  check(
    javaAllowed(addr, [needle(stored)]),
    `addr=${addr} typed=${typed} stored=${stored} needle=${needle(stored)}`,
  );
}

/* پیامک شخصی نباید از فیلترِ سرشماره عبور کند */
check(
  !javaAllowed("+989350000000", [needle(norm("6037"))]),
  "پیامک شخصی با فیلترِ سرشماره حذف می‌شود",
);

/* فیلترِ خالی = عبورِ همه؛ لازم است چون حسابِ بی‌سرشماره با نام بانک تشخیص
   داده می‌شود و فیلترِ سرشماره‌ای پیامکش را بی‌صدا حذف می‌کرد */
check(javaAllowed("+989350000000", []), "فیلتر خالی = عبور همه");

/* فرستندهٔ ناشناس (null) وقتی فیلتر هست، رد می‌شود — رفتار جاوا */
check(!javaAllowed(null, ["6037"]), "فرستندهٔ نامعلوم با فیلتر رد می‌شود");

console.log(failed === 0 ? "\nALL OK" : `\nFAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
