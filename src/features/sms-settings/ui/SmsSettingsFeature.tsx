/* زیرصفحه‌ی «تشخیص تراکنش از پیامک» — همه‌ی اجازه‌ها یک‌جا.

   چهار بخش، به همین ترتیب:
     ۱) این دستگاه چه می‌تواند و چه نمی‌تواند (بند ۴ — صداقت)
     ۲) حساب‌های زیر نظر + فرستنده‌های مجاز هر حساب (بند ۵ و ۱۰)
     ۳) شماره‌های مجاز، همه با برچسب «تأیید نشده» (بند ۷ و ۸)
     ۴) پل فورواردر اندروید (کارت قدیمی، دست‌نخورده مانده)

   نکته‌ی طراحی: کلید هر حساب همان کلید داخل فرم ویرایش همان حساب است؛
   اینجا فقط «فهرست خلاصه» است تا کاربر مجبور نباشد حساب‌ها را یکی‌یکی باز
   کند. هر دو یک یوزکیس را صدا می‌زنند.

   قاعده‌ی متن‌ها (بند ۴): هر جمله‌ی این صفحه باید با رفتار واقعیِ
   backend/app/services/messaging.py بخواند. جایی که رفتار واقعی از اسپک
   عقب است، همان عقب‌بودن نوشته می‌شود — نه وعده‌ی چیزی که انجام نمی‌شود. */

import { Card, Field, Modal, TextInput } from "@/shared/ui";
import { maskCardNumber } from "@/domain/account/account.rules";
import { toFa } from "@/shared/lib/digits";
import { isSmsReaderAvailable } from "@/shared/native/smsReader";
import { useSmsSettingsModel } from "../model/useSmsSettingsModel";

export function SmsSettingsFeature() {
  const m = useSmsSettingsModel();
  /* داخل بدنه صدا زده می‌شود، نه در سطح ماژول: پلِ کپاسیتور ممکن است هنگام
     ارزیابی چانک هنوز آماده نباشد و جوابِ «web» تا آخر عمرِ صفحه بماند. */
  const native = isSmsReaderAvailable();
  /* نگهبانِ مدل سراسری است (تا پاسخ یک درخواست نیامده هیچ تغییر دیگری شروع
     نمی‌شود)، پس همه‌ی کلیدها باید غیرفعال شوند. اگر فقط ردیفِ درگیر غیرفعال
     می‌شد، بقیه فعال دیده می‌شدند و لمسشان بی‌صدا هیچ نمی‌کرد. */
  const busy = m.busyId !== null;
  /* همان قاعده‌ی useNativeSmsReader: فیلترِ سرشماره روی گوشی فقط وقتی
     گذاشته می‌شود که «همه»ی حساب‌های روشن دست‌کم یک سرشماره داشته باشند.
     اینجا بازمحاسبه می‌شود تا متنِ صفحه با رفتار واقعیِ گوشی یکی بماند. */
  const enabled = m.bankAccounts.filter((a) => a.smsEnabled);
  const allCovered =
    enabled.length > 0 &&
    enabled.every((a) => (m.sendersOf.get(a.id)?.length ?? 0) > 0);

  return (
    <>
      {/* ── ۱) صداقت درباره‌ی توانِ همین دستگاه ── */}
      <Card title="چطور کار می‌کند">
        <p className="smss-note">
          {native
            ? "در اپ اندروید، خانه‌یار می‌تواند پیامک‌های بانکی همین گوشی را بخواند و تراکنش را «پیشنهاد» بدهد. تا وقتی هیچ حسابی را روشن نکرده‌اید، حتی اجازه‌ی خواندن پیامک هم از شما خواسته نمی‌شود."
            : "در نسخهٔ وب، خواندن خودکار پیامک ممکن نیست — مرورگر چنین اجازه‌ای نمی‌دهد. دو راه می‌ماند: متن پیامک را خودتان جای‌گذاری کنید، یا روی یک گوشی اندرویدی «پل فورواردر» را (پایین همین صفحه) تنظیم کنید."}
        </p>
        <p className="smss-note">
          تا وقتی هیچ حسابی را در فهرست پایین روشن نکرده‌اید، هیچ پیامکی که
          <b> خودکار </b>
          خوانده شده ذخیره نمی‌شود. در عوض پیامکی که خودتان جای‌گذاری می‌کنید
          همیشه ذخیره می‌شود، چون همان کار خودش رضایت است.
        </p>
        <p className="smss-note">
          شناختنِ سرشماره‌ی یک حساب هم به‌تنهایی کافی نیست: پیامک فقط وقتی
          «پیشنهاد»ی برای تراکنش می‌شود که هم مبلغ و هم نوعش (واریز یا برداشت)
          از متن پیدا شود. برای همین پیامکِ تبلیغاتی یا رمز یک‌بارمصرفِ همان
          سرشماره خودکار ثبت نمی‌شود.
        </p>
        {native && m.loaded && enabled.length > 0 ? (
          <p className="smss-note">
            {allCovered
              ? "برای هر حساب روشن سرشماره ثبت شده، پس فقط پیامکِ همین سرشماره‌ها از گوشی بیرون می‌رود و بقیه روی گوشی می‌ماند. اگر همین حالا سرشماره‌ای اضافه کردید، از اجرای بعدیِ برنامه اعمال می‌شود."
              : "دست‌کم یکی از حساب‌های روشن سرشماره ندارد و تشخیصش به نام بانک در متن تکیه دارد، پس فعلاً متن همه‌ی پیامک‌ها برای بررسی فرستاده می‌شود. اگر برای هر حساب سرشماره‌اش را اضافه کنید، بقیه‌ی پیامک‌ها روی گوشی می‌مانند."}
          </p>
        ) : null}
        <p className="smss-note">
          در هر دو حالت هیچ تراکنشی بدون تأیید شما ثبت نمی‌شود:{" "}
          <b>خانه‌یار پیشنهاد می‌دهد؛ شما تصمیم می‌گیرید.</b>
        </p>
      </Card>

      {/* ── ۲) حساب‌های زیر نظر ── */}
      <Card
        title="حساب‌های زیر نظر"
        action={
          <span className="badge">
            {toFa(m.enabledCount)} از {toFa(m.bankAccounts.length)}
          </span>
        }
      >
        {m.bankAccounts.length === 0 ? (
          <p className="smss-note">
            هنوز حساب بانکی یا کارتی ثبت نکرده‌اید. این صفحه حساب نمی‌سازد —
            اول از «کیف پول» یک حساب اضافه کنید، بعد اینجا روشنش کنید.
          </p>
        ) : (
          m.bankAccounts.map((acc) => {
            const list = m.sendersOf.get(acc.id) ?? [];
            /* سرشماره‌ای که روی حساب روشنِ دیگری هم ثبت شده: سرور پیامکش را
               می‌پذیرد ولی حساب را خالی می‌گذارد (مبهم). پس راهنما نباید
               بگوید «به همین حساب نسبت داده می‌شود». */
            const shared = list.filter((s) => m.sharedSenders.has(s.sender));
            return (
              <div className="smss-acc" key={acc.id}>
                <button
                  type="button"
                  className="smss-acc-head"
                  role="switch"
                  aria-checked={acc.smsEnabled}
                  aria-label={`تشخیص تراکنش از پیامک برای ${acc.title}`}
                  disabled={busy}
                  onClick={() => void m.toggleAccount(acc, !acc.smsEnabled)}
                >
                  {/* aria-hidden چون نامِ کلید از aria-label بالا می‌آید؛
                      وگرنه صفحه‌خوان شماره‌ی کارت را هم به‌عنوان نامِ کلید
                      می‌خواند. */}
                  <span className="smss-acc-body" aria-hidden="true">
                    <b>{acc.title}</b>
                    <span>
                      {[
                        acc.bank || "بانک نامشخص",
                        acc.cardNumber ? maskCardNumber(acc.cardNumber) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className={`set-switch${acc.smsEnabled ? " on" : ""}`}>
                    <span className="set-switch-knob" />
                  </span>
                </button>

                {/* فهرست فرستنده‌ها فقط بعد از آمدنِ داده نشان داده می‌شود،
                    وگرنه راهنمای «هیچ سرشماره‌ای ندارید» یک لحظه به‌دروغ
                    چشمک می‌زند. */}
                {acc.smsEnabled && m.loaded ? (
                  <div className="smss-senders">
                    <span className="smss-senders-title">
                      فرستنده‌های مجاز این حساب
                    </span>
                    <div className="smss-chips">
                      {list.map((s) => (
                        <span className="smss-chip" key={s.id}>
                          <bdi>{toFa(s.sender)}</bdi>
                          <button
                            type="button"
                            aria-label={`حذف فرستنده ${s.sender}`}
                            disabled={busy}
                            onClick={() => void m.removeSender(s)}
                          >
                            <svg>
                              <use href="#i-x" />
                            </svg>
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        className="smss-chip add"
                        disabled={busy}
                        onClick={() => m.openSenderForm(acc.id)}
                      >
                        <svg>
                          <use href="#i-plus" />
                        </svg>
                        افزودن سرشماره
                      </button>
                    </div>
                    <p className="smss-hint">
                      {list.length > 0
                        ? shared.length > 0
                          ? `سرشمارهٔ «${shared
                              .map((s) => toFa(s.sender))
                              .join("، ")}» روی بیش از یک حساب روشن هم ثبت شده (مثل دو کارت از یک بانک)، پس پیامکش ذخیره می‌شود ولی معلوم نیست مال کدام حساب است — هنگام تأیید خودتان حساب را انتخاب می‌کنید.`
                          : "هر پیامکی که از این سرشماره‌ها بیاید به همین حساب نسبت داده می‌شود، پس فقط سرشمارهٔ خودِ بانک را اضافه کنید."
                        : acc.bank
                          ? `بدون سرشماره هم کار می‌کند: خانه‌یار نام «${acc.bank}» را از متن پیامک پیدا می‌کند. افزودن سرشماره فقط تشخیص را دقیق‌تر می‌کند.`
                          : "این حساب نام بانک ندارد، پس بدون سرشماره تشخیص داده نمی‌شود. یا در ویرایش حساب نام بانک را بنویسید، یا سرشماره را همین‌جا اضافه کنید."}
                    </p>
                    <button
                      type="button"
                      className="smss-reset"
                      disabled={busy}
                      onClick={() => void m.resetAccount(acc)}
                    >
                      پاک‌کردن تنظیمات پیامک این حساب
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        {m.loadError ? (
          <p className="smss-hint">
            فهرست فرستنده‌ها نیامد: {m.loadError}{" "}
            <button
              type="button"
              className="smss-reset"
              onClick={() => void m.reload()}
            >
              تلاش دوباره
            </button>
          </p>
        ) : null}
      </Card>

      {/* ── ۳) شماره‌های مجاز ──
          صادقانه: این فهرست هنوز در تشخیص خوانده نمی‌شود (تسک بند ۷). تا آن
          موقع نباید وعده‌ی «محدودکردن منبع» داده شود. */}
      <Card
        title="شماره‌های مجاز"
        action={<span className="badge">هنوز اعمال نمی‌شود</span>}
      >
        <p className="smss-note">
          قرار است پیش‌فرض این باشد که فقط پیامک‌های شماره‌ی ثبت‌نام در نظر
          گرفته شود و گوشی دوم را خودتان اضافه کنید. این محدودیت هنوز پیاده
          نشده: فعلاً هرچه اضافه کنید فقط ثبت می‌شود و روی پیامک‌های
          بررسی‌شده اثری ندارد. آن را از حالا پر کنید تا وقتی فعال شد آماده
          باشد.
        </p>

        {m.primaryPhone ? (
          <div className="smss-num">
            <span className="smss-num-body">
              <b dir="ltr">{toFa(m.primaryPhone)}</b>
              <span>شماره‌ی ثبت‌نام · منبع پیش‌فرض</span>
            </span>
            <span className="badge">پیش‌فرض</span>
          </div>
        ) : null}

        {m.numbers.map((n) => (
          <div className="smss-num" key={n.id}>
            <span className="smss-num-body">
              <b dir="ltr">{toFa(n.phone)}</b>
              <span>
                {[n.label || null, n.verified ? "تأیید شده" : "تأیید نشده"]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <button
              type="button"
              className={`set-switch${n.active ? " on" : ""}`}
              role="switch"
              aria-checked={n.active}
              aria-label={`فعال بودن شماره ${n.phone}`}
              disabled={busy}
              onClick={() => void m.toggleNumber(n, !n.active)}
            >
              <span className="set-switch-knob" />
            </button>
            <button
              type="button"
              className="smss-num-del"
              aria-label={`حذف شماره ${n.phone}`}
              disabled={busy}
              onClick={() => void m.removeNumber(n)}
            >
              <svg>
                <use href="#i-trash" />
              </svg>
            </button>
          </div>
        ))}

        {m.loaded && m.numbers.length === 0 ? (
          <p className="smss-hint">شماره‌ی دیگری اضافه نشده است.</p>
        ) : null}

        {/* بدون آیکون، چون btn-ghost فلکس نیست و اندازه‌ی svg را هم تعیین
            نمی‌کند — همان الگوی دکمه‌های سراسریِ موجود دنبال می‌شود */}
        <button
          type="button"
          className="btn-ghost btn-block"
          disabled={busy}
          onClick={m.openNumberForm}
        >
          افزودن شماره‌ی مجاز
        </button>
      </Card>

      {/* افزودن سرشماره — مودال کوچک، چون به یک حساب مشخص بسته می‌شود */}
      <Modal
        open={m.senderFor !== null}
        onClose={m.closeSenderForm}
        title="افزودن سرشماره‌ی مجاز"
      >
        <p className="modal-sub" style={{ textAlign: "right" }}>
          سرشماره یا نام فرستنده‌ی پیامک بانک را همان‌طور که در پیامک‌ها می‌بینید
          وارد کنید (مثل ۹۸۲۰۰۰۱۲۳۴ یا BANKMELLI).
        </p>
        <Field label="سرشماره / نام فرستنده">
          <TextInput
            value={m.senderText}
            onChange={m.setSenderText}
            placeholder="مثال: ۹۸۲۰۰۰۱۲۳۴"
            dir="ltr"
            autoFocus
          />
        </Field>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={m.closeSenderForm}>
            انصراف
          </button>
          <button
            className="btn-primary"
            disabled={busy || !m.senderText.trim()}
            onClick={() => void m.addSender()}
          >
            افزودن
          </button>
        </div>
      </Modal>

      {/* افزودن شماره‌ی مجاز — بدون کد تأیید (تصمیم کاربر)، پس صریح گفته می‌شود */}
      <Modal
        open={m.numberOpen}
        onClose={m.closeNumberForm}
        title="افزودن شماره‌ی مجاز"
      >
        <Field label="شماره موبایل">
          <TextInput
            value={m.phone}
            onChange={m.setPhone}
            placeholder="۰۹۱۲۳۴۵۶۷۸۹"
            dir="ltr"
            inputMode="numeric"
            autoFocus
          />
        </Field>
        <Field label="برچسب (اختیاری)">
          <TextInput
            value={m.label}
            onChange={m.setLabel}
            placeholder="مثال: گوشی دوم"
          />
        </Field>
        <p className="modal-sub" style={{ textAlign: "right" }}>
          این شماره تأیید نمی‌شود و برایش کدی فرستاده نمی‌شود؛ در فهرست هم با
          برچسب «تأیید نشده» می‌ماند. فقط یعنی «پیامک‌های این منبع مجاز است».
        </p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={m.closeNumberForm}>
            انصراف
          </button>
          <button
            className="btn-primary"
            disabled={busy || !m.phone.trim()}
            onClick={() => void m.addNumber()}
          >
            افزودن
          </button>
        </div>
      </Modal>
    </>
  );
}
