/* مدلِ زیرصفحهٔ «درخواست‌های عضویت» — سمتِ مدیرِ جریانِ §۲.۶.

   این نیمهٔ گم‌شدهٔ جریان است: کسی که با لینکِ دعوت یا کدِ خانواده پیوسته،
   عضوی با membership_state='pending' دارد و تا مدیر تصمیم نگیرد نمی‌تواند
   وارد شود. پیش از این هیچ صفحه‌ای این درخواست‌ها را نشان نمی‌داد، پس هر
   کسی دعوتی را می‌پذیرفت برای همیشه بیرونِ در می‌ماند.

   قاعدهٔ اجازه: مجاز‌بودن سمتِ سرور بسته می‌شود (require_admin_tenant روی هر
   سه اندپوینت). گاردِ isOwner اینجا فقط برای این است که صفحه برای عضوِ عادی
   یک ۴۰۳ِ بی‌معنا نیاورد — جای امنیت نیست. */

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { JoinRequest } from "@/domain/family/family.types";

export function useJoinRequestsModel() {
  const { useCases, member, refreshData } = useApp();
  const { show } = useToast();

  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /* قفلِ سراسریِ نوشتن (همان قاعدهٔ useSmsSettingsModel): هر تصمیم refreshData
     را هم صدا می‌زند و دو تازه‌سازیِ هم‌زمان ترتیب را به‌هم می‌ریزد. مقدارش
     شناسهٔ درخواستِ درگیر است تا UI بتواند «کدام ردیف» را در حالِ کار بگوید. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const isOwner = member?.role === "owner";

  const load = useCallback(async () => {
    if (!useCases || !isOwner) return;
    try {
      const rows = await useCases.listJoinRequests.execute();
      setRequests(rows);
      /* فقط در مسیرِ موفق «بارگذاری‌شده» می‌شود. اگر در finally بود، خطای
         شبکه هم loaded=true می‌کرد و صفحه به‌دروغ «درخواستی نیست» نشان
         می‌داد — یعنی «کسی منتظر نیست» با «نتوانستیم بپرسیم» یکی می‌شد، و
         این بدترین دروغِ ممکن در همین صفحه است. */
      setLoadError(null);
      setLoaded(true);
    } catch (e) {
      setLoadError(
        (e as Error).message || "خطا در خواندن درخواست‌های عضویت",
      );
    }
  }, [useCases, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  /** تصمیمِ مشترکِ تأیید و رد — تفاوتشان فقط در یوزکیس و متن است.
   *
   *  پس از موفقیت ردیف بی‌درنگ از فهرست بیرون می‌رود (سرور فقط pendingها را
   *  می‌دهد، پس دفعهٔ بعد هم نخواهد بود) و بعد refreshData صدا می‌شود تا
   *  فهرستِ اعضا وضعیتِ تازه را نشان بدهد.
   *
   *  در هر خطا فهرست دوباره خوانده می‌شود، نه فقط پیام داده شود: محتمل‌ترین
   *  خطا اینجا «این درخواست قبلاً بررسی شده» است (مدیرِ دوم، یا همین مدیر از
   *  دستگاهِ دیگر). اگر فقط پیام می‌دادیم، ردیفِ مرده روی صفحه می‌ماند و
   *  کاربر دوباره و دوباره همان خطا را می‌گرفت. */
  async function decide(
    r: JoinRequest,
    kind: "approve" | "reject",
  ): Promise<void> {
    if (!useCases || busyId) return;
    const who = r.memberName?.trim() || "این متقاضی";
    if (
      kind === "reject" &&
      !confirm(
        `درخواستِ «${who}» رد شود؟ با رد‌شدن نمی‌تواند وارد شود. برای پیوستنِ دوباره باید از نو درخواست بدهد.`,
      )
    ) {
      return;
    }

    setBusyId(r.id);
    try {
      if (kind === "approve") {
        await useCases.approveJoinRequest.execute(r.id);
      } else {
        await useCases.rejectJoinRequest.execute(r.id);
      }
      setRequests((list) => list.filter((x) => x.id !== r.id));
      await refreshData();
      show(
        kind === "approve"
          ? `«${who}» به خانواده اضافه شد`
          : `درخواستِ «${who}» رد شد`,
      );
    } catch (e) {
      show((e as Error).message || "خطا در ثبت تصمیم");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return {
    isOwner,
    requests,
    loaded,
    loadError,
    busyId,
    reload: load,
    approve: (r: JoinRequest) => decide(r, "approve"),
    reject: (r: JoinRequest) => decide(r, "reject"),
  };
}

export type JoinRequestsModel = ReturnType<typeof useJoinRequestsModel>;
