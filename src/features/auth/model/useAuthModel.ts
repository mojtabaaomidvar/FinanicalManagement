/* مدل فیچر احراز هویت — state machine ورود/ثبت‌نام/OTP/دعوت
   OTP روی سرور قابل روشن/خاموش است (app_settings.otp_enabled)؛
   در حالت خاموش همه مسیرها مستقیم و بدون کد پیامکی انجام می‌شوند */

import { useEffect, useRef, useState } from "react";
import type { UseCases } from "@/application/useCases";
import type { OtpFlowMode } from "@/domain/auth/auth.types";
import {
  normalizePhone,
  isValidPassword,
  isValidOtpCode,
  cleanOtpCode,
  cleanFamilyCode,
  isValidFamilyCode,
} from "@/domain/auth/auth.rules";
import { toEn } from "@/shared/lib/digits";
import { AppError } from "@/shared/lib/appError";

export interface OtpFlow {
  mode: OtpFlowMode;
  phone: string;
  password: string;
  familyName?: string;
  memberName?: string;
  inviteToken?: string;
  /** کدِ ۶ رقمیِ خانواده — فقط در جریانِ «پیوستن با کد» (mode === "join").
      عمداً جدا از inviteToken نگه داشته می‌شود: لینکِ دعوت تک‌مصرف است و
      کدِ خانواده نیست، پس اندپوینتشان و معنایشان یکی نیست. */
  familyCode?: string;
  /** نسبت با مدیر خانواده — در جریان دعوت لازم است */
  relation?: string;
}

/** مقادیر آغازین فرم — قیف آغازین (onboarding) نام خانواده را از پیش
    جمع کرده و کاربر را مستقیم به حالت ثبت‌نام می‌فرستد. فقط «مقدار اولیه»
    است؛ کاربر می‌تواند هر دو را عوض کند. */
export interface AuthPrefill {
  mode?: "login" | "register";
  familyName?: string;
}

export function useAuthModel(
  useCases: UseCases,
  notify: (m: string) => void,
  prefill?: AuthPrefill,
) {
  const [mode, setMode] = useState<"login" | "register">(
    prefill?.mode ?? "login",
  );
  const [step, setStep] = useState<
    "form" | "otp" | "pending" | "join" | "reset" | "reset-code"
  >("form");

  /* فرم ورود */
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  /* فرم ثبت‌نام */
  const [regFamily, setRegFamily] = useState(prefill?.familyName ?? "");
  const [regName, setRegName] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regRelation, setRegRelation] = useState("");

  /* OTP */
  const [otpCode, setOtpCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flow, setFlow] = useState<OtpFlow | null>(null);

  /* دعوت */
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteFamilyName, setInviteFamilyName] = useState("");
  const [invName, setInvName] = useState("");
  const [invPhone, setInvPhone] = useState("");
  const [invPassword, setInvPassword] = useState("");
  const [invRelation, setInvRelation] = useState("");

  /* §۲.۶ — «پیوستن با کدِ خانواده»، راهِ دومِ ورود به یک خانوادهٔ موجود.
     با دعوت یک تفاوتِ بنیادی دارد: لینکِ دعوت تک‌مصرف است و خودش گواهیِ
     «مدیر مرا خواسته» را با خود دارد، ولی کدِ خانواده ثابت است و دست‌به‌دست
     می‌چرخد. برای همین این مسیر با همان تأییدِ مدیر تمام می‌شود و نه نشست.
     حالتِ خودش را دارد و از متغیرهای inv* استفاده نمی‌کند: دو مسیرِ هم‌زمان
     روی یک state باعث می‌شد نیمهٔ پرشدهٔ یکی در دیگری دیده شود. */
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinPhone, setJoinPhone] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinRelation, setJoinRelation] = useState("");

  /* §۲.۶ — درخواست عضویت ثبت شد و منتظر تأیید مدیر است (بدون نشست).
     تا وقتی این مقدار پر است، صفحه دعوت به‌جای فرم، پیام انتظار را نشان می‌دهد. */
  const [joinPending, setJoinPending] = useState<{ familyName: string } | null>(
    null,
  );

  /* وضعیت OTP از تنظیمات سرور — null = هنوز نامشخص */
  const [otpEnabled, setOtpEnabled] = useState<boolean | null>(null);

  /* §۹.۵ — آیا سرور می‌تواند کد بازیابی بفرستد؟ پیش‌فرض false است تا روی سرورِ
     بی‌درگاهِ پیامک (یا وقتی خواندنِ پیکربندی شکست خورد) دکمهٔ «فراموشی رمز»
     اصلاً دیده نشود؛ دکمه‌ای که فقط ۵۰۳ می‌دهد بدتر از نبودنش است. */
  const [passwordResetEnabled, setPasswordResetEnabled] = useState(false);

  /* فراموشی رمز — شماره از فرم ورود پیش‌پر می‌شود */
  const [resetPhone, setResetPhone] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  /* ثانیه‌های ماندهٔ «ارسال مجدد» — هم‌اندازهٔ کول‌داونِ ۶۰ ثانیه‌ایِ سرور.
     سرور عمداً در کول‌داون خطا نمی‌دهد (وگرنه «۴۲۹ فقط برای شمارهٔ ثبت‌شده»
     خودش اوراکلِ شمارشِ حساب می‌شد)، پس بدون این شمارنده کاربر دکمه را می‌زند،
     پیام «ارسال شد» می‌بیند و هیچ پیامکی نمی‌آید. */
  const [resetWait, setResetWait] = useState(0);

  /* عضو پیش‌ثبت‌شده توسط مدیر — خانواده در فرم قفل می‌شود
     (سرور نام عضو را برنمی‌گرداند تا با پیمایش شماره‌ها قابل استخراج نباشد) */
  const [preReg, setPreReg] = useState<{ familyName: string } | null>(null);

  /** بررسی شماره در فرم ثبت‌نام — اگر عضو pending بود اطلاعات خانواده قفل می‌شود */
  async function checkPreRegistered(rawPhone: string) {
    const phone = normalizePhone(toEn(rawPhone));
    if (!phone || phone === preRegCheckRef.current) return;
    preRegCheckRef.current = phone;
    try {
      const r = await useCases.checkPreRegistered.execute(phone);
      if (r.preRegistered && r.familyName) {
        setPreReg({ familyName: r.familyName });
      } else {
        setPreReg(null);
      }
    } catch {
      /* بی‌صدا — سرور خودش هنگام ثبت‌نام عضو pending را تشخیص می‌دهد */
    }
  }
  const preRegCheckRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    useCases.getPublicConfig
      .execute()
      .then((c) => {
        if (!alive) return;
        setOtpEnabled(c.otpEnabled);
        setPasswordResetEnabled(c.passwordResetEnabled);
      })
      .catch(() => {
        if (!alive) return;
        setOtpEnabled(false);
        setPasswordResetEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [useCases]);

  /* شمارشِ معکوسِ «ارسال مجدد» — timeoutِ خودبازنشان (نه interval) تا با
     unmount خودش پاک شود و تیکِ سرگردان نماند. */
  useEffect(() => {
    if (resetWait <= 0) return;
    const t = window.setTimeout(() => setResetWait((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resetWait]);

  function resetOtp() {
    /* بازگشت به همان فرمی که از آن آمده‌ایم. اگر همیشه به "form" می‌رفت،
       کاربرِ جریانِ «پیوستن با کد» سر از فرمِ ورود درمی‌آورد و باید دوباره
       دنبالِ آن لینکِ کوچکِ پایینِ صفحه می‌گشت. */
    setStep(flow?.mode === "join" ? "join" : "form");
    setOtpCode("");
    setDevCode(null);
  }

  async function sendOtp(f: OtpFlow) {
    setBusy(true);
    try {
      const r = await useCases.requestOtp.execute(f.phone);
      setFlow(f);
      setStep("otp");
      setOtpCode("");
      if (r.devCode) {
        setDevCode(r.devCode);
      } else {
        setDevCode(null);
        notify("کد تأیید پیامک شد");
      }
    } catch (e) {
      const msg =
        e instanceof AppError && e.code === "TOO_SOON"
          ? "لطفاً یک دقیقه صبر کنید و دوباره تلاش کنید"
          : (e as Error).message || "خطا در ارسال کد";
      notify(msg);
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin(onDone: () => void | Promise<void>) {
    const phone = normalizePhone(toEn(loginPhone));
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!loginPassword) return notify("رمز عبور را وارد کنید");

    setBusy(true);
    try {
      const ok = await useCases.checkPassword.execute(phone, loginPassword);
      if (!ok) {
        notify("شماره موبایل یا رمز عبور اشتباه است");
        return;
      }

      /* OTP غیرفعال یا نامشخص → ورود مستقیم با شماره + رمز
         (اگر OTP روی سرور روشن باشد، INVALID_OTP برمی‌گردد و جریان کد ادامه می‌یابد) */
      if (otpEnabled !== true) {
        try {
          const r = await useCases.loginWithOtp.execute(
            phone,
            loginPassword,
            null,
          );
          await useCases.saveSession.execute(r);
          await onDone();
          return;
        } catch (e) {
          if (!(e instanceof AppError && e.code === "INVALID_OTP")) throw e;
          /* OTP روی سرور فعال است → ادامه با جریان کد */
        }
      }

      await sendOtp({ mode: "login", phone, password: loginPassword });
    } catch (e) {
      notify((e as Error).message || "خطا در ارتباط با سرور");
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(onDone: () => void | Promise<void>) {
    const phone = normalizePhone(toEn(regPhone));
    /* عضو پیش‌ثبت‌شده: نام خانواده لازم نیست (سرور خانواده موجود را می‌دهد) */
    if (!preReg && !regFamily.trim()) {
      return notify("نام خانواده را وارد کنید");
    }
    if (!regName.trim()) return notify("نام شما را وارد کنید");
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!isValidPassword(regPassword))
      return notify("رمز عبور حداقل ۸ کاراکتر باشد");
    if (preReg && !regRelation) {
      return notify("نسبت شما با مدیر خانواده را انتخاب کنید");
    }

    const input = {
      familyName: preReg ? preReg.familyName : regFamily.trim(),
      memberName: regName.trim(),
      phone,
      password: regPassword,
      relation: preReg ? regRelation : undefined,
    };

    /* OTP غیرفعال یا نامشخص → ثبت‌نام مستقیم */
    if (otpEnabled !== true) {
      setBusy(true);
      try {
        const r = await useCases.register.execute(input, null);
        notify(
          preReg
            ? "ثبت‌نام کامل شد — خوش آمدید"
            : "خانواده ساخته شد — خوش آمدید",
        );
        await useCases.saveSession.execute(r);
        await onDone();
        return;
      } catch (e) {
        if (!(e instanceof AppError && e.code === "INVALID_OTP")) {
          notify((e as Error).message || "خطا در ثبت‌نام");
          return;
        }
        /* OTP روی سرور فعال است → ادامه با جریان کد */
      } finally {
        setBusy(false);
      }
    }

    await sendOtp({
      mode: "register",
      phone,
      password: regPassword,
      familyName: input.familyName,
      memberName: input.memberName,
    });
  }

  /** §۲.۶ — پذیرش دعوت نشست نمی‌دهد، پس callback پایان ندارد. */
  async function submitInvite() {
    const phone = normalizePhone(toEn(invPhone));
    if (!invName.trim()) return notify("نام خود را وارد کنید");
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!isValidPassword(invPassword))
      return notify("رمز عبور حداقل ۸ کاراکتر باشد");
    if (!invRelation) return notify("نسبت خود با مدیر خانواده را انتخاب کنید");

    const input = {
      inviteToken: inviteToken ?? "",
      memberName: invName.trim(),
      phone,
      password: invPassword,
      relation: invRelation,
    };

    /* OTP غیرفعال یا نامشخص → ثبت مستقیم درخواست عضویت */
    if (otpEnabled !== true) {
      setBusy(true);
      try {
        const p = await useCases.acceptInvite.execute(input, null);
        markJoinPending(p.familyName);
        return;
      } catch (e) {
        if (!(e instanceof AppError && e.code === "INVALID_OTP")) {
          notify((e as Error).message || "خطا در ارسال درخواست عضویت");
          return;
        }
        /* OTP روی سرور فعال است → ادامه با جریان کد */
      } finally {
        setBusy(false);
      }
    }

    await sendOtp({
      mode: "invite",
      phone,
      password: invPassword,
      memberName: input.memberName,
      inviteToken: input.inviteToken,
      relation: input.relation,
    });
  }

  /** پایان مشترک مسیر دعوت: صفحه انتظار به‌جای نشست. */
  function markJoinPending(familyName: string) {
    setJoinPending({ familyName: familyName || inviteFamilyName });
    setStep("pending");
    notify("درخواست عضویت ثبت شد — منتظر تأیید مدیر خانواده");
  }

  /* ── §۲.۶ پیوستن با کدِ خانواده ────────────────────────────────
     دوقلوی submitInvite با یک تفاوت: به‌جای توکنِ لینک، کدِ ۶ رقمی می‌رود و
     نامِ خانواده را از پیش نمی‌دانیم (لینک آن را می‌داد، کد نمی‌دهد). پس
     نامِ خانواده فقط در پاسخِ سرور دیده می‌شود، و همین هم خوب است: اگر کاربر
     کدِ اشتباهی زده باشد، در صفحهٔ انتظار نامِ خانوادهٔ غریبه را می‌بیند. */

  function startJoinByCode() {
    /* شماره از فرمِ ورود می‌آید اگر پرش کرده باشد — کسی که اول «ورود» را
       امتحان کرده و نشده، شمارهٔ خودش را دوباره نمی‌نویسد. */
    if (!joinPhone && loginPhone) setJoinPhone(loginPhone);
    setStep("join");
  }

  function cancelJoinByCode() {
    /* رمز پاک می‌شود، بقیه نه: انصرافِ اتفاقی نباید فرمِ نیمه‌پرشده را از بین
       ببرد، ولی رمز در state ماندنی نیست. */
    setJoinPassword("");
    setStep("form");
  }

  async function submitJoinByCode() {
    const code = cleanFamilyCode(joinCode);
    const phone = normalizePhone(toEn(joinPhone));
    if (!isValidFamilyCode(code)) return notify("کد خانواده ۶ رقمی است");
    if (!joinName.trim()) return notify("نام خود را وارد کنید");
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!isValidPassword(joinPassword))
      return notify("رمز عبور حداقل ۸ کاراکتر باشد");
    if (!joinRelation) return notify("نسبت خود با مدیر خانواده را انتخاب کنید");

    const input = {
      code,
      memberName: joinName.trim(),
      phone,
      password: joinPassword,
      relation: joinRelation,
    };

    /* OTP غیرفعال یا نامشخص → ثبت مستقیم درخواست عضویت */
    if (otpEnabled !== true) {
      setBusy(true);
      try {
        const p = await useCases.joinByCode.execute(input, null);
        markJoinPending(p.familyName);
        return;
      } catch (e) {
        if (!(e instanceof AppError && e.code === "INVALID_OTP")) {
          notify((e as Error).message || "خطا در ارسال درخواست عضویت");
          return;
        }
        /* OTP روی سرور فعال است → ادامه با جریان کد */
      } finally {
        setBusy(false);
      }
    }

    await sendOtp({
      mode: "join",
      phone,
      password: joinPassword,
      memberName: input.memberName,
      familyCode: input.code,
      relation: input.relation,
    });
  }

  /** onDone فقط برای مسیرهای نشست‌دار (ورود/ثبت‌نام) صدا زده می‌شود؛
      مسیر دعوت نشست نمی‌سازد و به صفحه انتظار می‌رود. */
  async function verifyOtp(onDone?: () => void) {
    if (!flow) return resetOtp();
    const code = cleanOtpCode(otpCode);
    if (!isValidOtpCode(code)) return notify("کد ۶ رقمی را وارد کنید");

    setBusy(true);
    try {
      /* §۲.۶ — دعوت: خروجی «در انتظار تأیید» است، نه نشست. */
      if (flow.mode === "invite") {
        const p = await useCases.acceptInvite.execute(
          {
            inviteToken: flow.inviteToken!,
            memberName: flow.memberName!,
            phone: flow.phone,
            password: flow.password,
            relation: flow.relation,
          },
          code,
        );
        markJoinPending(p.familyName);
        return;
      }

      /* §۲.۶ — پیوستن با کد: همان پایانِ دعوت، اندپوینتِ دیگر. جدا نگه داشتن
         این شاخه لازم است، نه تزئینی: اگر با invite یکی گرفته می‌شد،
         inviteToken خالی به سرور می‌رفت و کاربر یک «لینکِ نامعتبر» می‌گرفت
         در حالی که هیچ لینکی در کار نبوده. */
      if (flow.mode === "join") {
        const p = await useCases.joinByCode.execute(
          {
            code: flow.familyCode!,
            memberName: flow.memberName!,
            phone: flow.phone,
            password: flow.password,
            relation: flow.relation,
          },
          code,
        );
        markJoinPending(p.familyName);
        return;
      }

      const result =
        flow.mode === "login"
          ? await useCases.loginWithOtp.execute(flow.phone, flow.password, code)
          : await useCases.register.execute(
              {
                familyName: flow.familyName!,
                memberName: flow.memberName!,
                phone: flow.phone,
                password: flow.password,
              },
              code,
            );
      if (flow.mode === "register") notify("خانواده ساخته شد — خوش آمدید");

      await useCases.saveSession.execute(result);
      onDone?.();
    } catch (e) {
      notify((e as Error).message || "خطا در تأیید کد");
    } finally {
      setBusy(false);
    }
  }

  /* ── §۹.۵ فراموشیِ رمز ────────────────────────────────────────
     دو گام: درخواستِ کد (بی‌هیچ خبری از وجود یا نبودِ شماره) → کد + رمزِ تازه.
     پایانِ موفق نشست نمی‌دهد: سرور همهٔ نشست‌های آن عضو را باطل می‌کند و کاربر
     از همان فرمِ ورود با رمزِ تازه می‌آید، تا گیتِ وضعیتِ عضویت (§۲.۶) هم سرِ
     جای خودش اعمال شود.

     نکتهٔ حالتِ توسعه: اینجا `devCode` نداریم. مسیرِ بازیابی عمداً کد را در
     پاسخ برنمی‌گرداند (همان چیزی که آن را از اوراکلِ شمارشِ حساب جدا می‌کند)؛
     روی سرورِ بی‌کلید کد در لاگِ سرور می‌نشیند. این را «کم‌بود» نبینید و با
     برگرداندنِ کد در پاسخ «درست» نکنید. */

  function startPasswordReset() {
    /* شمارهٔ فرمِ ورود پیش‌پر می‌شود — خامش را نگه می‌داریم تا کاربر بتواند
       اصلاحش کند؛ اعتبارسنجی در گامِ ارسال است، نه اینجا.
       `resetWait` عمداً صفر نمی‌شود: اگر تازه کدی گرفته باشد، شمارنده باید
       همان‌قدر که مانده بماند. */
    setResetPhone(loginPhone);
    setResetCode("");
    setResetPassword("");
    setStep("reset");
  }

  function cancelPasswordReset() {
    setStep("form");
    setResetCode("");
    /* رمزِ خام را بیش از نیازِ لحظه در حافظه نگه نمی‌داریم */
    setResetPassword("");
  }

  /** گامِ ۱ — درخواستِ کد. `resend` از صفحهٔ کد صدا زده می‌شود و به شمارنده
      مقید است؛ ارسالِ نخست مقید نیست تا کاربری که شماره را غلط زده بتواند
      بی‌معطلی با شمارهٔ درست دوباره تلاش کند (کول‌داونِ سرور per-phone است). */
  async function sendResetCode({ resend = false }: { resend?: boolean } = {}) {
    const phone = normalizePhone(toEn(resetPhone));
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (resend && resetWait > 0) return;

    setBusy(true);
    try {
      await useCases.requestPasswordReset.execute(phone);
      /* شمارهٔ نرمال‌شده را جای ورودیِ خام می‌نشانیم: صفحهٔ بعد همین را نشان
         می‌دهد و پس از موفقیت هم همین در فرمِ ورود پیش‌پر می‌شود. */
      setResetPhone(phone);
      setStep("reset-code");
      setResetWait(60);
      /* متن عمداً شرطی است: پاسخِ سرور برای شمارهٔ ثبت‌نشده هم همین است، پس
         حق نداریم چیزی بیش از این ادعا کنیم. */
      notify("اگر این شماره ثبت شده باشد، کد بازیابی برایش پیامک شد");
    } catch (e) {
      notify((e as Error).message || "خطا در ارسال کد بازیابی");
    } finally {
      setBusy(false);
    }
  }

  /** گامِ ۲ — کد + رمزِ تازه. موفقیت = بازگشت به فرمِ ورود با شمارهٔ پیش‌پر. */
  async function submitPasswordReset() {
    const phone = normalizePhone(toEn(resetPhone));
    const code = cleanOtpCode(resetCode);
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!isValidOtpCode(code)) return notify("کد ۶ رقمی را وارد کنید");
    /* طولِ رمز پیش از فرستادن بررسی می‌شود تا یک رمزِ کوتاه کدِ درست را
       نسوزاند — همان ترتیبی که سرور هم دارد. */
    if (!isValidPassword(resetPassword))
      return notify("رمز عبور حداقل ۸ کاراکتر باشد");

    setBusy(true);
    try {
      await useCases.confirmPasswordReset.execute(phone, code, resetPassword);
      setMode("login");
      setLoginPhone(phone);
      setLoginPassword("");
      setResetCode("");
      setResetPassword("");
      setResetWait(0);
      setStep("form");
      notify("رمز عبور عوض شد — با رمز تازه وارد شوید");
    } catch (e) {
      notify((e as Error).message || "خطا در تغییر رمز");
    } finally {
      setBusy(false);
    }
  }

  async function loadInvite(token: string): Promise<boolean> {
    try {
      const info = await useCases.getInvite.execute(token);
      setInviteFamilyName(info.familyName);
      setInviteToken(token);
      return true;
    } catch {
      notify("لینک دعوت نامعتبر یا منقضی شده است");
      return false;
    }
  }

  return {
    mode,
    setMode,
    step,
    otpEnabled,
    preReg,
    checkPreRegistered,
    loginPhone,
    setLoginPhone,
    loginPassword,
    setLoginPassword,
    regFamily,
    setRegFamily,
    regName,
    setRegName,
    regPhone,
    setRegPhone,
    regPassword,
    setRegPassword,
    regRelation,
    setRegRelation,
    otpCode,
    setOtpCode,
    devCode,
    busy,
    flow,
    inviteToken,
    inviteFamilyName,
    invName,
    setInvName,
    invPhone,
    setInvPhone,
    invPassword,
    setInvPassword,
    invRelation,
    setInvRelation,
    joinPending,
    joinCode,
    setJoinCode,
    joinName,
    setJoinName,
    joinPhone,
    setJoinPhone,
    joinPassword,
    setJoinPassword,
    joinRelation,
    setJoinRelation,
    startJoinByCode,
    cancelJoinByCode,
    submitJoinByCode,
    passwordResetEnabled,
    resetPhone,
    setResetPhone,
    resetCode,
    setResetCode,
    resetPassword,
    setResetPassword,
    resetWait,
    startPasswordReset,
    cancelPasswordReset,
    sendResetCode,
    submitPasswordReset,
    resetOtp,
    submitLogin,
    submitRegister,
    submitInvite,
    verifyOtp,
    loadInvite,
    resendOtp: () => flow && sendOtp(flow),
  };
}

export type AuthModel = ReturnType<typeof useAuthModel>;
