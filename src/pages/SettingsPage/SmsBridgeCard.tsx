/* کارت تنظیمات پل پیامک — کلید اتصال اپ فوروادر اندروید */

import { useEffect, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card } from "@/shared/ui";
import { API_BASE } from "@/shared/config/apiBase";

export function SmsBridgeCard() {
  const { useCases } = useApp();
  const { show } = useToast();

  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    useCases
      ?.getBridge.execute()
      .then((b) => {
        if (alive) setToken(b?.token ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [useCases]);

  async function generate() {
    if (token && !confirm("کلید قبلی بی‌درنگ باطل می‌شود و باید اپ فوروادر را با کلید جدید تنظیم کنید. ادامه؟")) {
      return;
    }
    setBusy(true);
    try {
      const t = await useCases!.createBridge.execute();
      setToken(t);
      show("کلید اتصال ساخته شد");
    } catch (e) {
      show((e as Error).message || "خطا در ساخت کلید");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      show(label + " کپی شد");
    } catch {
      show("کپی ناموفق بود");
    }
  }

  /* در اپ نیتیو location.origin همان localhost است — آدرس واقعی سرور نمایش داده شود */
  const webhookUrl = `${API_BASE || location.origin}/api/sms-webhook`;
  const bodyTemplate = token
    ? `{"token":"${token}","text":"متن پیامک","sender":"شماره فرستنده"}`
    : "";

  return (
    <Card
      title="پیامک خودکار (اندروید)"
      action={<span className="badge">آزمایشی</span>}
    >
      <p className="modal-sub" style={{ textAlign: "right" }}>
        پیامک‌های بانکی گوشی اندرویدی، بدون کپی‌کردن، خودکار وارد اپ می‌شوند.
        آیفون این امکان را ندارد (محدودیت اپل) و همان حالت دستی را دارد.
      </p>

      {token ? (
        <>
          <div className="bridge-row">
            <span className="bridge-label">آدرس اتصال:</span>
            <div className="invite-link-row">
              <input
                type="text"
                className="text-input"
                readOnly
                dir="ltr"
                value={webhookUrl}
              />
              <button
                className="action-btn"
                onClick={() => copy(webhookUrl, "آدرس اتصال")}
              >
                کپی
              </button>
            </div>
          </div>

          <div className="bridge-row">
            <span className="bridge-label">بدنه JSON (آماده):</span>
            <div className="invite-link-row">
              <input
                type="text"
                className="text-input"
                readOnly
                dir="ltr"
                value={bodyTemplate}
              />
              <button
                className="action-btn"
                onClick={() => copy(bodyTemplate, "بدنه JSON")}
              >
                کپی
              </button>
            </div>
          </div>

          <button
            className="btn-ghost btn-block"
            disabled={busy}
            onClick={generate}
          >
            کلید جدید (باطل‌کردن فعلی)
          </button>

          <details className="bridge-guide">
            <summary>راهنمای نصب (۳ دقیقه)</summary>
            <ol>
              <li>
                روی گوشی اندرویدی یکی از اپ‌های «SMS Forwarder» یا
                «MacroDroid» یا «Tasker» را نصب کنید (کافه‌بازار/گوگل‌پلی).
              </li>
              <li>
                یک قانون جدید بسازید: <b>دریافت پیامک</b> ← <b>ارسال HTTP POST</b> به
                «آدرس اتصال» بالا، با بدنه JSON بالا (جای «متن پیامک» و «شماره
                فرستنده» متغیرهای پیامک اپ را بگذارید).
              </li>
              <li>
                برای ارسال فقط پیامک‌های بانکی، در فیلتر قانون، فرستنده را روی
                شماره‌های بانک خودتان محدود کنید.
              </li>
              <li>
                پیامک‌ها با وضعیت «ثبت‌نشده» در اپ ظاهر می‌شوند و هنگام باز
                کردن اپ، یکی‌یکی برای ثبت پیشنهاد می‌شوند.
              </li>
            </ol>
          </details>
        </>
      ) : loaded ? (
        <>
          <p className="modal-sub" style={{ textAlign: "right" }}>
            هنوز کلیدی نساخته‌اید. با ساخت کلید، آدرس اتصال برای تنظیم اپ
            فوروادر ساخته می‌شود.
          </p>
          <button
            className="btn-primary btn-block"
            disabled={busy}
            onClick={generate}
          >
            ساخت کلید اتصال
          </button>
        </>
      ) : null}
    </Card>
  );
}
