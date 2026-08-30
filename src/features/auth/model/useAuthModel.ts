/* مدل فیچر احراز هویت — state machine ورود/ثبت‌نام/OTP/دعوت */

import { useState } from "react";
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

  async function submitLogin() {
    const phone = normalizePhone(toEn(loginPhone));
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!loginPassword) return notify("رمز عبور را وارد کنید");

    setBusy(true);
    try {
      const ok = await useCases.checkPassword.execute(phone, loginPassword);
      if (!ok) return notify("شماره موبایل یا رمز عبور اشتباه است");
      await sendOtp({ mode: "login", phone, password: loginPassword });
    } catch (e) {
      notify((e as Error).message || "خطا در ارتباط با سرور");
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister() {
    const phone = normalizePhone(toEn(regPhone));
    if (!regFamily.trim() || !regName.trim())
      return notify("نام خانواده و نام شما را وارد کنید");
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!isValidPassword(regPassword))
      return notify("رمز عبور حداقل ۴ کاراکتر باشد");

    await sendOtp({
      mode: "register",
      phone,
      password: regPassword,
      familyName: regFamily.trim(),
      memberName: regName.trim(),
    });
  }

  async function submitInvite() {
    const phone = normalizePhone(toEn(invPhone));
    if (!invName.trim()) return notify("نام خود را وارد کنید");
    if (!phone) return notify("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
    if (!isValidPassword(invPassword))
      return notify("رمز عبور حداقل ۴ کاراکتر باشد");

    await sendOtp({
      mode: "invite",
      phone,
      password: invPassword,
      memberName: invName.trim(),
      inviteToken: inviteToken ?? "",
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
