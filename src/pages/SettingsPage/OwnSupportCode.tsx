import { useEffect, useState } from "react";
import { getContainer } from "@/infrastructure/repositories/container";
import { RestClient } from "@/infrastructure/api/restClient";

export function OwnSupportCode({ providedCode }: { providedCode?: string } = {}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true; setError(""); setCode("");
    if (providedCode) { setCode(providedCode); return; }
    void getContainer().then(container => new RestClient(container.session).get<{ support_code: string }>(
      "/members/me/support-code", { cache: "no-store" })).then(result => { if (current) setCode(result.support_code); })
      .catch(() => { if (current) setError("دریافت کد پشتیبانی انجام نشد."); });
    return () => { current = false; };
  }, [retry, providedCode]);
  return <section className="own-support-code"><h3>کد پشتیبانی من</h3>
    <p>برای پیگیری وضعیت ثبت‌نام، فقط این کد را به پشتیبانی بدهید.</p>
    {error ? <div role="alert"><p>{error}</p><button onClick={() => setRetry(n => n+1)}>تلاش دوباره</button></div>
      : !code ? <p role="status">در حال دریافت کد…</p>
        : <div><code dir="ltr">{code}</code><button onClick={async () => {
          try { await navigator.clipboard.writeText(code); setMessage("کد پشتیبانی کپی شد."); }
          catch { setMessage("کپی انجام نشد؛ کد را انتخاب و کپی کنید."); }
        }}>کپی کد پشتیبانی</button></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
