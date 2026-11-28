/* §۸.۶ — وضعیت اتصال و مرز کنش‌های مجاز آفلاین.
   نوار لمس محتوا را نمی‌گیرد؛ وضعیت صف در صفحات خرید، انبار و کارهای خانه است. */

import { useOnline } from "@/shared/lib/useOnline";

export function OfflineBar({ onOpenReleaseHistory }: { onOpenReleaseHistory?: () => void } = {}) {
  const online = useOnline();
  if (online) return null;

  return (
    <div className="offline-bar" role="status" aria-live="polite">
      <svg aria-hidden="true">
        <use href="#i-alert" />
      </svg>
      <div>
        <b>اتصال اینترنت نیست</b>
        <p>
          خرید، انبار و کارهای خانهٔ ذخیره‌شده روی این دستگاه در دسترس‌اند. کارهای مالی،
          اسناد و مدیریت اعضا به اتصال نیاز دارند.
        </p>
        {onOpenReleaseHistory ? <button type="button" className="btn-ghost" onClick={onOpenReleaseHistory}>تاریخچهٔ نسخه‌ها</button> : null}
      </div>
    </div>
  );
}
