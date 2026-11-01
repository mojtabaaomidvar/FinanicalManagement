/* UIِ «درخواست‌های عضویت» — سمتِ مدیرِ §۲.۶.

   چیدمانِ هر ردیف مثل settings-member است تا با فهرستِ اعضا یک زبان داشته
   باشد؛ تفاوتش دو دکمهٔ تصمیم در انتهای ردیف است.

   قاعدهٔ «لمسِ ردیف = ویرایش» اینجا اعمال نمی‌شود و نباید هم بشود: ردیف
   چیزی برای ویرایش ندارد و هر دو کارِ ممکن تصمیمِ برگشت‌ناپذیرند، پس باید
   دکمهٔ صریح باشند نه لمسِ اتفاقیِ ردیف. */

import { Card } from "@/shared/ui";
import type { JoinRequest } from "@/domain/family/family.types";
import { toFa } from "@/shared/lib/digits";
import { formatLong, timestampToJalali } from "@/shared/lib/jalali";
import { useJoinRequestsModel } from "../model/useJoinRequestsModel";

/** «از راهِ لینکِ دعوت» / «با کدِ خانواده» — کاربر باید بداند این شخص چطور
    به درِ خانواده رسیده؛ اگر لینکی نفرستاده بوده، خودِ همین یک هشدار است. */
function viaLabel(r: JoinRequest): string {
  return r.via === "code" ? "با کد خانواده" : "از راه لینک دعوت";
}

function requestedLabel(r: JoinRequest): string {
  const j = timestampToJalali(r.requestedAt);
  return j ? formatLong(j) : "تاریخ نامعلوم";
}

export function JoinRequestsFeature() {
  const m = useJoinRequestsModel();
  /* نگهبان سراسری است: تا پاسخِ یک تصمیم نیامده همهٔ دکمه‌ها خاموش می‌شوند.
     اگر فقط ردیفِ درگیر خاموش می‌شد، بقیه روشن دیده می‌شدند و لمسشان
     بی‌صدا هیچ نمی‌کرد. */
  const busy = m.busyId !== null;

  if (!m.isOwner) {
    return (
      <Card title="درخواست‌های عضویت">
        <p className="smss-note">
          تصمیم‌گیری دربارهٔ عضوِ تازه فقط با مدیر خانواده است.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="درخواست‌های عضویت"
      action={
        m.loaded && m.requests.length > 0 ? (
          <span className="badge">{toFa(m.requests.length)} در انتظار</span>
        ) : null
      }
    >
      <p className="smss-note">
        کسی که با لینک دعوت یا کد خانواده درخواست داده، تا وقتی شما تأیید نکنید{" "}
        <b>نمی‌تواند وارد شود</b> و هیچ‌چیزی از داده‌های خانواده را نمی‌بیند.
      </p>

      {m.loadError ? (
        <>
          <p className="smss-note" role="alert">
            {/* «درخواستی نیست» گفته نمی‌شود، چون نمی‌دانیم؛ نپرسیدن با
                نبودن یکی نیست. */}
            فهرست درخواست‌ها خوانده نشد: {m.loadError}
          </p>
          <button
            type="button"
            className="btn-ghost btn-block"
            onClick={() => void m.reload()}
          >
            تلاش دوباره
          </button>
        </>
      ) : !m.loaded ? (
        <p className="smss-note">در حال خواندن…</p>
      ) : m.requests.length === 0 ? (
        <p className="smss-note">در این لحظه کسی منتظر تأیید نیست.</p>
      ) : (
        <div className="settings-members">
          {m.requests.map((r) => {
            const name = r.memberName?.trim() || "بی‌نام";
            return (
              <div className="settings-member" key={r.id}>
                <span className="member-avatar">{name.charAt(0)}</span>
                <div>
                  <h5>{name}</h5>
                  <p>
                    {r.relation?.trim() || "نسبت ثبت نشده"}
                    {r.phone ? ` · ${toFa(r.phone)}` : ""}
                  </p>
                  <p>
                    {viaLabel(r)} · {requestedLabel(r)}
                  </p>
                </div>
                <div className="jr-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void m.approve(r)}
                  >
                    {m.busyId === r.id ? "…" : "تأیید"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost danger-text"
                    disabled={busy}
                    onClick={() => void m.reject(r)}
                  >
                    رد
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
