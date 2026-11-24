import { useEffect, useId, useRef, useState } from "react";
import type { UnsupportedReason } from "@/domain/assistant/assistant.types";
import type { Member } from "@/domain/family/family.types";
import type { ShoppingList } from "@/domain/shopping/shopping.types";
import type { ActionReceipt } from "@/domain/assistant/contextual.types";
import type { HouseholdAssistantModel } from "../model/useHouseholdAssistant";
import { Modal } from "@/shared/ui";
import { ContextSources, GroundedFinding } from "./ContextReport";
import { ACTION_LABELS, ActionReview, PreparedSummary } from "./ActionReview";
import "./HouseholdAssistant.css";

const UNSUPPORTED_LABELS: Record<UnsupportedReason, string> = {
  scope_mismatch: "این بخش از درخواست باید جدا بررسی شود.",
  unsupported_action: "این تغییر اجرای مستقیم ندارد؛ از بخش مربوط برنامه ادامه بده.",
  unsupported_question: "برای این پرسش، شاهد کافی در اطلاعات بررسی‌شده نداریم.",
  manual_field_required: "این انتخاب را خودت در فرم مشخص کن؛ دستیار خودکار تعیین نمی‌کند.",
  unsupported_schedule: "ساعت، تکرار یا ارسال قطعی یادآور با این پیشنهاد تنظیم نمی‌شود.",
};

export function AssistantSparkle() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function HouseholdAssistant({ model, offline, lists, members, onShopping, onChanged }: {
  model: HouseholdAssistantModel; offline: boolean; lists: ShoppingList[]; members: Member[];
  onShopping: () => void; onChanged: () => Promise<void>;
}) {
  const inputId = useId(), hintId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState("");
  const [option, setOption] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false), wasOpen = useRef(false);
  if (model.open && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null;
  wasOpen.current = model.open;
  useEffect(() => {
    if (model.open) document.getElementById(inputId)?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      const target = opener.current?.isConnected ? opener.current : document.querySelector<HTMLButtonElement>(".floating-assistant");
      target?.focus();
    }
  }, [model.open, inputId]);
  useEffect(() => { setSelected(""); setOption(null); setRefreshError(false); }, [model.result?.report_id]);
  const ready = model.capabilities?.status === "ready" && model.capabilities.protocol_version === 2;
  const locked = model.actionBusy || !!model.pendingAction;
  const close = () => { restoreFocus.current = true; model.close(); };
  async function refresh(receipt?: ActionReceipt) {
    if (!receipt) return;
    try { await onChanged(); setRefreshError(false); }
    catch { setRefreshError(true); }
  }
  const result = model.result;
  const visibleActions = result?.actions.filter(action => option === null || result.options[option]?.action_ids.includes(action.id)
    || action.kind === "shopping_list" && !lists.length) ?? [];
  return <Modal open={model.open} onClose={close} title="دستیار خانه‌یار" dragToClose sheetClassName="household-assistant-sheet">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="دستیار خانه‌یار"
      className={`household-assistant ${model.busy ? "is-analyzing" : ""}`} aria-busy={model.busy || model.actionBusy}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), summary") ?? [])]
          .filter(element => element.getClientRects().length > 0 && !element.closest("fieldset:disabled"));
        const target = event.shiftKey ? controls.at(-1) : controls[0];
        if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); target?.focus(); }
      }}>
      <div className="household-assistant-heading"><AssistantSparkle /><label htmlFor={inputId}>چه کاری برای خانه داری؟</label></div>
      <p id={hintId}>با ارسال، اطلاعات محدود و مرتبطِ بخش‌های مجاز خانه برای بررسی به DeepSeek فرستاده می‌شود. هیچ تغییری بدون تأیید مشخص تو ثبت نمی‌شود.</p>
      <textarea id={inputId} aria-describedby={hintId} value={model.text} onChange={event => model.change(event.target.value)}
        rows={4} maxLength={8000} dir="auto" disabled={locked} placeholder="نون نداریم برای صبحونه؛ چه گزینه‌هایی داریم؟" />
      <div className="home-assistant-actions">
        <button type="button" className="assistant-primary" disabled={!ready || offline || model.busy || locked || !model.text.trim()}
          onClick={() => void model.analyze()}>{model.busy ? "در حال بررسی…" : "ارسال"}</button>
        <button type="button" className="btn-ghost" disabled={model.busy || locked || !model.text}
          onClick={() => { if (confirm("متن و برنامهٔ تأییدنشدهٔ این درخواست پاک شوند؟")) model.change(""); }}>پاک‌کردن متن</button>
      </div>
      {model.busy ? <p role="status">شناخت درخواست، بررسی بخش‌های مرتبط و آماده‌سازی گزارش؛ هنوز هیچ تغییری ثبت نشده است.</p> : null}
      {model.actionBusy ? <p role="status">در حال بررسی تغییر یا دریافت نتیجهٔ ثبت…</p> : null}
      {model.checking ? <p role="status">در حال بررسی اتصال دستیار…</p> : null}
      {offline ? <p role="status">گزارش و متن باقی می‌مانند، اما بررسی و اجرای تازه به اینترنت نیاز دارد. پس از اتصال، خودکار ارسال یا اجرا نمی‌کنیم.</p> : null}
      {!ready && !offline && !model.checking ? <div className="assistant-unavailable" role="status">
        <p>{model.capabilities?.status === "upgrade_required" ? "برای بررسی اطلاعات خانه، درگاه دستیار باید به نسخهٔ جدید ارتقا پیدا کند." : "دستیار فعلاً در دسترس نیست؛ اتصال یا تنظیمات سرویس باید بررسی شود."}</p>
        <button type="button" className="btn-ghost" onClick={() => void model.checkCapabilities()}>بررسی دوبارهٔ اتصال</button>
      </div> : null}
      {model.storageError ? <p role="status" className="field-error">پیش‌نویس یا نتیجه در این مرورگر ماندگار نشد؛ متن را کپی کن. اجرای تازه به ذخیرهٔ امنِ اطلاعات بازیابی نیاز دارد.</p> : null}
      {model.error !== null ? <p role="alert" className="field-error">{model.error}</p> : null}
      <details className="assistant-privacy"><summary>حریم خصوصی دستیار</summary>
        <p>فقط متن درخواست و دادهٔ محدود، مرتبط و مجازِ خانه از سرور خانه‌یار به DeepSeek ارسال می‌شوند؛ نه تمام اطلاعات خانه. شماره‌های حساسِ قابل‌شناسایی پنهان می‌شوند. عکس، PDF، محتوای فایل، رمز و اطلاعات حساب عضو دیگر ارسال نمی‌شوند. اطلاعات شخصی غیرضروری را ننویس.</p>
        <p>متن و اطلاعات خام در درگاه نگهداری نمی‌شوند؛ این به معنی تضمین نگهداری‌نشدن نزد ارائه‌دهنده نیست. بازکردن پنجره، متن یا اطلاعات خانه را برای تحلیل ارسال نمی‌کند.</p>
      </details>
      {model.pendingAction ? <section className="assistant-proposal" aria-live="polite">
        <strong>نتیجهٔ این تغییر هنوز روشن نیست</strong>
        <PreparedSummary review={model.pendingAction.review} members={members} lists={lists} />
        <p>پیش از تغییر درخواست یا اقدام تازه، نتیجهٔ قبلی را بدون تحلیل دوباره بررسی کن.</p>
        <button type="button" className="assistant-primary" disabled={offline || model.actionBusy} onClick={() => void model.recover().then(refresh)}>بررسی نتیجهٔ قبلی</button>
        <button type="button" className="btn-ghost" disabled={offline || model.actionBusy} onClick={() => {
          if (confirm("همین تغییر با همین اطلاعات دوباره تأیید شود؟ اگر قبلاً ثبت شده باشد، رکورد دوم ساخته نمی‌شود.")) void model.resume().then(refresh);
        }}>تأیید دوبارهٔ همین تغییر</button>
      </section> : null}
      {refreshError ? <div role="status"><p>نتیجهٔ ثبت دریافت شد، اما تازه‌کردن بخش‌ها انجام نشد. تغییر را دوباره اجرا نکن.</p>
        <button type="button" className="btn-ghost" onClick={() => void onChanged().then(() => setRefreshError(false)).catch(() => setRefreshError(true))}>تازه‌کردن بخش‌ها</button>
      </div> : null}
      {result ? <div className="assistant-results" aria-live="polite">
        <ContextSources sections={result.sections} />
        <h4>گزارشِ اطلاعات ثبت‌شده</h4>
        {!result.facts.length ? <p>برای گزارش، شاهد کافی پیدا نشد؛ درخواست را روشن‌تر بنویس.</p> : result.facts.map(fact => <GroundedFinding key={fact.id} fact={fact} />)}
        {result.questions.length ? <section><h4>پیش از تصمیم روشن کنیم</h4><ul>{result.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></section> : null}
        {result.options.length ? <fieldset disabled={locked}><legend>کدام گزینه را می‌خواهی دنبال کنی؟</legend>
          {result.options.map((choice, index) => <label className="assistant-option" key={index}>
            <input type="radio" name="assistant-option" checked={option === index} onChange={() => { setOption(index); setSelected(""); model.cancelReview(); }} />
            <span>{choice.title}</span>
          </label>)}
          <button type="button" className="btn-ghost" onClick={() => { setOption(null); setSelected(""); model.cancelReview(); }}>بررسی تغییرهای دیگر</button>
        </fieldset> : null}
        <p>گزینه‌ها فقط پیشنهادند؛ هر تغییر را جدا بررسی و تأیید می‌کنی. انتخاب یک گزینه، اجرای خودکار نیست.</p>
        {visibleActions.map(action => <article className="assistant-proposal" key={action.id}>
          <strong>{ACTION_LABELS[action.kind]}</strong>{action.title ? <p>{action.title}</p> : null}
          {action.existing_in?.length ? <p>این قلم در لیست خرید باز دیده شد؛ در مقصد منتخب دوباره اضافه نمی‌شود.</p> : null}
          {model.receipts[action.id] ? <p role="status">{model.receipts[action.id].status === "existing" ? "از قبل در مقصد وجود داشت؛ مورد تازه‌ای ساخته نشد." : "این تغییر در سرور ثبت شد."}</p>
            : selected === action.id ? <ActionReview key={action.id} action={action} lists={lists} members={members}
              busy={model.actionBusy || !!model.pendingAction} offline={offline} review={model.review}
              onEdit={model.cancelReview} onCancel={() => { model.cancelReview(); setSelected(""); }}
              onPrepare={fields => void model.prepare(action.id, fields)} onExecute={() => void model.execute(action.id).then(refresh)} />
              : <button type="button" className="btn-ghost" disabled={offline || locked} onClick={() => { model.cancelReview(); setSelected(action.id); }}>بررسی همین تغییر</button>}
        </article>)}
        {!lists.length && result.actions.some(action => action.kind === "shopping_item") ? <button type="button" className="btn-ghost" disabled={locked} onClick={onShopping}>ادامه در بخش خرید</button> : null}
        {result.proposals.some(proposal => proposal.kind === "transaction") ? <p>دستیار در ثبت تراکنش مالی نقشی ندارد؛ از بخش تراکنش‌ها استفاده کنید.</p> : null}
        {result.unsupported.map((item, index) => <div className="assistant-unsupported" key={index}><blockquote>{item.source_text}</blockquote><p>{UNSUPPORTED_LABELS[item.reason]}</p></div>)}
      </div> : null}
      <button type="button" className="btn-ghost" onClick={close}>بستن دستیار</button>
    </section>
  </Modal>;
}
