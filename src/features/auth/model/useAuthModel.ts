/* مدل فیچر احراز هویت — state machine ورود/ثبت‌نام/OTP/دعوت
   OTP روی سرور قابل روشن/خاموش است (app_settings.otp_enabled)؛
   در حالت خاموش همه مسیرها مستقیم و بدون کد پیامکی انجام می‌شوند */

import { useEffect, useRef, useState } from "react";
import type { UseCases } from "@/application/useCases";
import type { OtpFlowMode } from "@/domain/auth/auth.types";
import { normalizePhone, isValidPassword, isValidOtpCode, cleanOtpCode } from "@/domain/auth/auth.rules";
import { toEn } from "@/shared/lib/digits";
import { AppError } from "@/shared/lib/appError";

export interface OtpFlow {
  mode: OtpFlowMode;
  phone: string;
  password: string;
  familyName?: string;
  memberName?: string;
  inviteToken?: string;
}

export function useAuthModel(useCases: UseCases, notify: (m: string) => void) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [step, setStep] = useState<"form" | "otp">("form");

  /* فرم ورود */
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  /* فرم ثبت‌نام */
  const [regFamily, setRegFamily] = useState("");
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

  /* وضعیت OTP از تنظیمات سرور — null = هنوز نامشخص */
  const [otpEnabled, setOtpEnabled] = useState<boolean | null>(null);

  /* عضو پیش‌ثبت‌شده توسط مدیر — خانواده در فرم قفل می‌شود */
  const [preReg, setPreReg] = useState<{
    familyName: string;
    memberName: string;
  } | null>(null);

  /** بررسی شماره در فرم ثبت‌نام — اگر عضو pending بود اطلاعات خانواده قفل می‌شود */
  async function checkPreRegistered(rawPhone: string) {
    const phone = normalizePhone(toEn(rawPhone));
    if (!phone || phone === preRegCheckRef.current) return;
    preRegCheckRef.current = phone;
    try {
      const r = await useCases.checkPreRegistered.execute(phone);
      if (r.preRegistered && r.familyName) {
        setPreReg({ familyName: r.familyName, memberName: r.memberName ?? "" });
        if (r.memberName && !regName.trim()) setRegName(r.memberName);
      } else {
        setPreReg(null);
      }
    } catch {
      /* بی‌صدا */
    }
  }
  const preRegCheckRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    useCases.getPublicConfig
      .execute()
      .then((c) => {
        if (alive) setOtpEnabled(c.otpEnabled);
      })
      .catch(() => {
        if (alive) setOtpEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [useCases]);

  function resetOtp() {
    setStep("form");
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

      /* OTP غیرفعال → ورود مستقیم */
      if (otpEnabled === false) {
        try {
          const r = await useCases.loginWithOtp.execute(phone, null);
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
      return notify("رمز عبور حداقل ۴ کاراکتر باشد");
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

    /* OTP غیرفعال → ثبت‌نام مستقیم */
    if (otpEnabled === false) {
      setBusy(true);
      try {
        const r = await useCases.register.execute(input, null);
        notify(preReg ? "ثبت‌نام کامل شد — خوش آمدید" : "خانواده ساخته شد — خوش آمدید");
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

  async function submitInvite(onDone: () => void | Promise<void>) {
    const phone = normalizePhone(toEn(invPhone));
    if (!invName.trim()) return notify("نام خود را وارد کنید");
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!isValidPassword(invPassword))
      return notify("رمز عبور حداقل ۴ کاراکتر باشد");

    const input = {
      inviteToken: inviteToken ?? "",
      memberName: invName.trim(),
      phone,
      password: invPassword,
    };

    /* OTP غیرفعال → عضویت مستقیم */
    if (otpEnabled === false) {
      setBusy(true);
      try {
        const r = await useCases.acceptInvite.execute(input, null);
        notify("به خانواده خوش آمدید");
        await useCases.saveSession.execute(r);
        await onDone();
        return;
      } catch (e) {
        if (!(e instanceof AppError && e.code === "INVALID_OTP")) {
          notify((e as Error).message || "خطا در عضویت");
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
    });
  }

  async function verifyOtp(onDone: () => void) {
    if (!flow) return resetOtp();
    const code = cleanOtpCode(otpCode);
    if (!isValidOtpCode(code)) return notify("کد ۶ رقمی را وارد کنید");

    setBusy(true);
    try {
      let result = null;
      if (flow.mode === "login") {
        result = await useCases.loginWithOtp.execute(flow.phone, code);
      } else if (flow.mode === "register") {
        result = await useCases.register.execute(
          {
            familyName: flow.familyName!,
            memberName: flow.memberName!,
            phone: flow.phone,
            password: flow.password,
          },
          code,
        );
        notify("خانواده ساخته شد — خوش آمدید");
      } else {
        result = await useCases.acceptInvite.execute(
          {
            inviteToken: flow.inviteToken!,
            memberName: flow.memberName!,
            phone: flow.phone,
            password: flow.password,
          },
          code,
        );
        notify("به خانواده خوش آمدید");
      }

      await useCases.saveSession.execute(result);
      onDone();
    } catch (e) {
      notify((e as Error).message || "خطا در تأیید کد");
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
