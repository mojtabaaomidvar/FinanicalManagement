/* §۸.۶ — وضعیت اتصال دستگاه

   navigator.onLine فقط یک چیز را درست می‌گوید: «false» یعنی قطعاً هیچ شبکه‌ای
   در دسترس نیست. اما «true» هیچ تضمینی نمی‌دهد؛ گوشیِ وصل‌به‌وای‌فایِ بی‌اینترنت
   هم true است. پس این هوک برای *ادعای آنلاین بودن* به کار نمی‌آید و هیچ‌جا
   نباید با آن تصمیمِ «حالا می‌شود درخواست فرستاد» گرفته شود — فقط برای
   نشان‌دادنِ حالتِ قطعیِ «آفلاین» است.

   به همین دلیل مقدارِ اولیه و حالتِ محیطِ بی‌navigator هم «آنلاین» گرفته
   می‌شود: اگر ندانیم، سکوت می‌کنیم. نوارِ هشدار فقط وقتی بالا می‌آید که
   مرورگر صریحاً بگوید شبکه‌ای نیست، وگرنه کاربر هشداری می‌دید که راست نبود. */

import { useEffect, useState } from "react";

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    /* هر دو رویداد یک کار می‌کنند: از خودِ navigator می‌خوانند نه از نامِ
       رویداد. اگر "online" را مستقیم به true نگاشت می‌کردیم، در حالتِ
       لبه‌ایِ «online بیاید و بی‌درنگ قطع شود» حالتِ کهنه می‌ماند. */
    const sync = () => setOnline(readOnline());
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    /* یک بار همین اول هم هم‌گام می‌شویم: بین رندرِ اول و نصبِ شنونده‌ها
       ممکن است اتصال عوض شده باشد. */
    sync();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}
