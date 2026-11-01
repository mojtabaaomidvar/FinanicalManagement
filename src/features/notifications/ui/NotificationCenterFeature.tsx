/* §۷ — مرکزِ اعلان (زنگ + فهرست).

   ── متن کجا ساخته می‌شود و چرا این‌جا ──
   `deriveNotifications` عمداً هیچ رشتهٔ آماده‌ای نمی‌دهد (دلیلش در
   notification.types.ts): قالب‌بندیِ مبلغ به واحدِ پولِ عضو وابسته است و §۷.۵
   هم می‌گوید اعلان نباید دادهٔ غیرمجاز را *در خودش* جا دهد. پس برچسب‌ها
   این‌جا از `ref` و دادهٔ از‌قبل‌بارگذاری‌شده ساخته می‌شوند.

   ── هر مورد باید جایی برود ──
   سررسید → فرمِ تراکنش برای همان رخداد · درخواستِ عضویت → همان زیرصفحهٔ
   تنظیمات (نه فهرستِ تنظیمات) · رویداد → فقط «نادیده بگیر»، چون کنشی ندارد.
   اعلانی که جایی نمی‌برد، فقط نگرانی تولید می‌کند. */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Icon, Modal } from "@/shared/ui";
import { buildCategoryResolver } from "@/domain/category/resolve";
import type { AppNotification } from "@/domain/notification/notification.types";
import { DOMAIN_LABELS } from "@/domain/notification/notification.types";
import type { JoinRequest } from "@/domain/family/family.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { FamilyEvent } from "@/domain/event/event.types";
import type { Bill } from "@/domain/bill/bill.types";
import { BILL_KINDS } from "@/domain/bill/bill.types";
import type { InventoryItem } from "@/domain/shopping/shopping.types";
import { formatQty } from "@/domain/shopping/shopping.rules";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import type { TxFormModel } from "@/features/transaction-form";
import type { NotificationsModel } from "../model/useNotificationsModel";

/* آیکونِ هر دامنه — همان مجموعهٔ اسپریتِ index.html */
const DOMAIN_ICON = {
  recurring: "i-repeat",
  bills: "i-bill",
  event: "i-gift",
  membership: "i-users",
  inventory: "i-cart",
} as const;

export function NotificationCenterFeature({
  m,
  form,
  joinRequests,
  onOpenJoinRequests,
  onOpenBills,
  onOpenInventory,
}: {
  m: NotificationsModel;
  form: TxFormModel;
  joinRequests: JoinRequest[];
  onOpenJoinRequests: () => void;
  onOpenBills: () => void;
  onOpenInventory: () => void;
}) {
  const { txs, events, cur, customCategories, bills, inventory } = useApp();

  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );

  /* نگاشتِ شناسه→موجودیت یک‌بار ساخته می‌شود، نه find در هر ردیف.
     فهرست کوچک است، ولی این‌طور هزینه‌اش خطی می‌ماند نه درجه‌دو. */
  const txById = useMemo(() => {
    const map = new Map<string, Transaction>();
    for (const t of txs) map.set(t.id, t);
    return map;
  }, [txs]);

  const eventById = useMemo(() => {
    const map = new Map<string, FamilyEvent>();
    for (const e of events) map.set(e.id, e);
    return map;
  }, [events]);

  const billById = useMemo(() => {
    const map = new Map<string, Bill>();
    for (const b of bills) map.set(b.id, b);
    return map;
  }, [bills]);

  const requestById = useMemo(() => {
    const map = new Map<string, JoinRequest>();
    for (const r of joinRequests) map.set(r.id, r);
    return map;
  }, [joinRequests]);

  const stockById = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const i of inventory) map.set(i.id, i);
    return map;
  }, [inventory]);

  function label(n: AppNotification): { title: string; sub: string } | null {
    if (n.ref.kind === "recurring") {
      const tx = txById.get(n.ref.txId);
      /* اگر تراکنش بینِ مشتق‌سازی و رندر حذف شده باشد، ردیف حذف می‌شود نه
         اینکه با «نامشخص» نمایش داده شود — اعلانِ بی‌مرجع بی‌معناست. */
      if (!tx) return null;
      const cat = resolve(tx.category);
      const when = formatLong(isoToJalali(n.ref.dueIso));
      return {
        title: tx.note?.trim() || cat.name,
        sub: `${when} · ${formatAmount(toDisplay(tx.amount, cur))} ${cur}`,
      };
    }
    if (n.ref.kind === "event") {
      const ev = eventById.get(n.ref.eventId);
      if (!ev) return null;
      return {
        title: ev.title,
        sub: formatLong(isoToJalali(n.ref.dateIso)),
      };
    }
    if (n.ref.kind === "bills") {
      const bill = billById.get(n.ref.billId);
      if (!bill) return null;
      const kind = BILL_KINDS.find((k) => k.value === bill.kind);
      const when = formatLong(isoToJalali(n.ref.dueIso));
      /* نامِ نوع هم می‌آید چون عنوانِ کاربر می‌تواند «قبضِ خانه» باشد و از
         آن معلوم نشود برق است یا گاز. */
      return {
        title: bill.title,
        sub: `${kind?.label ?? "قبض"} · ${when} · ${formatAmount(
          toDisplay(bill.amount, cur),
        )} ${cur}`,
      };
    }
    if (n.ref.kind === "inventory") {
      const item = stockById.get(n.ref.itemId);
      if (!item) return null;
      const unit = item.unit ? ` ${item.unit}` : "";
      return {
        title: `${item.title} دارد تمام می‌شود`,
        sub: `مانده ${formatQty(item.quantity)}${unit} · آستانه ${formatQty(
          item.threshold,
        )}${unit}`,
      };
    }
    const req = requestById.get(n.ref.requestId);
    if (!req) return null;
    /* نام می‌تواند null باشد (ردیفِ عضو حذف شده و JOIN خالی برگشته) —
       یادداشتِ همین نکته در family.types.ts هست و با `!` ردش نمی‌کنیم. */
    const who = req.memberName?.trim() || req.phone || "متقاضی ناشناس";
    const via = req.via === "code" ? "با کد خانواده" : "با لینک دعوت";
    return { title: `${who} می‌خواهد عضو شود`, sub: via };
  }

  function act(n: AppNotification) {
    if (n.ref.kind === "recurring") {
      const tx = txById.get(n.ref.txId);
      if (!tx) return;
      m.setOpen(false);
      form.openForOccurrence(tx, n.ref.dueIso);
      return;
    }
    if (n.ref.kind === "membership") {
      m.setOpen(false);
      onOpenJoinRequests();
      return;
    }
    if (n.ref.kind === "bills") {
      /* به صفحهٔ قبوض می‌رود، نه به فرمِ پرداخت: پرداخت حسابِ مبدأ می‌خواهد
         و تصمیمش مالِ همان صفحه است. */
      m.setOpen(false);
      onOpenBills();
      return;
    }
    if (n.ref.kind === "inventory") {
      /* به صفحهٔ انبار می‌رود، نه مستقیم به لیستِ خرید: کنشِ درست
         «به لیست اضافه کن» است و دکمه‌اش همان‌جاست — و اگر چند لیست باشد،
         انتخابِ لیست هم همان‌جا پرسیده می‌شود. */
      m.setOpen(false);
      onOpenInventory();
    }
    /* رویداد: کنشی ندارد — دکمهٔ «نادیده بگیر» جداگانه است */
  }

  /* گروه‌بندی بر پایهٔ دامنه، با حفظِ ترتیبِ خودِ فهرست (که از قاعده‌های
     دامنه می‌آید: گذشته → منتظر → نزدیک). پس گروهی که فوری‌ترین موردش
     بالاتر است، خودش هم بالاتر می‌آید. */
  const groups = useMemo(() => {
    const out: { domain: AppNotification["domain"]; items: AppNotification[] }[] =
      [];
    for (const n of m.list) {
      const last = out.find((g) => g.domain === n.domain);
      if (last) last.items.push(n);
      else out.push({ domain: n.domain, items: [n] });
    }
    return out;
  }, [m.list]);

  return (
    <>
      <button
        type="button"
        className="hub-bell"
        aria-label={
          m.count ? `اعلان‌ها — ${toFa(m.count)} مورد` : "اعلان‌ها — خالی"
        }
        onClick={() => m.setOpen(true)}
      >
        <Icon name="i-bell" size={20} />
        {/* صفر چاپ نمی‌شود: همان قاعدهٔ شمارندهٔ ردیف‌های تنظیمات —
            «۰» روی نشانِ قرمز خبرِ دروغ است، نه اطلاع. */}
        {m.count > 0 ? (
          <span className="hub-bell-dot">{toFa(m.count)}</span>
        ) : null}
      </button>

      <Modal
        open={m.open}
        onClose={() => m.setOpen(false)}
        title="اعلان‌ها"
        dragToClose
      >
        {m.list.length === 0 ? (
          <p className="modal-sub">
            چیزی برای نشان دادن نیست. سررسیدِ تراکنش‌های تکرارشونده، قبض‌های
            پرداخت‌نشده، رویدادها و تولدهای نزدیک، اقلامی که دارد تمام می‌شود
            و درخواست‌های عضویت همین‌جا می‌آیند.
          </p>
        ) : (
          <div className="notif-list">
            {groups.map((g) => (
              <section key={g.domain} className="notif-group">
                <h4 className="notif-group-title">
                  {DOMAIN_LABELS[g.domain]}
                  <span>{toFa(g.items.length)}</span>
                </h4>
                {g.items.map((n) => {
                  const text = label(n);
                  if (!text) return null;
                  const clickable = n.ref.kind !== "event";
                  return (
                    <div
                      key={n.id}
                      className={`notif-item sev-${n.severity}`}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => act(n) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                act(n);
                              }
                            }
                          : undefined
                      }
                    >
                      <span className="notif-ic" aria-hidden="true">
                        <Icon name={DOMAIN_ICON[n.domain]} size={18} />
                      </span>
                      <div className="notif-txt">
                        <b>{text.title}</b>
                        <p>{text.sub}</p>
                      </div>
                      {n.dismissible ? (
                        <button
                          type="button"
                          className="notif-skip"
                          disabled={m.busy === n.id}
                          /* روی کارتِ غیرِقابل‌کلیک هم stopPropagation
                             می‌ماند: اگر فردا کارت کلیک‌پذیر شد، این دکمه
                             نباید ناخواسته کنشِ کارت را هم بزند. */
                          onClick={(e) => {
                            e.stopPropagation();
                            void m.dismiss(n);
                          }}
                        >
                          نادیده بگیر
                        </button>
                      ) : (
                        <Icon name="i-arrow-l" size={16} />
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
