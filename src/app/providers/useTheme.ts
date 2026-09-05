/* Theme — سه حالت: روشن | تیره | خودکار (بر اساس ساعت سیستم)
   auto: ۱۹ تا ۶ → تیره، بقیه → روشن؛ هر تغییر در سرور ذخیره می‌شود */

import { useEffect, useState } from "react";
import type { Member } from "@/domain/family/family.types";
import type { UseCases } from "@/application/useCases";

function resolveTheme(mode: Member["theme"]): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  const h = new Date().getHours();
  return h >= 19 || h < 6 ? "dark" : "light";
}

export function useTheme(member: Member | null, useCases: UseCases | null) {
  const [themeMode, setThemeMode] = useState<Member["theme"]>("auto");

  /* مقدار اولیه از پروفایل */
  useEffect(() => {
    if (member) setThemeMode(member.theme);
  }, [member]);

  /* اعمال تم + بازبینی دوره‌ای در حالت auto (هر ۱۵ دقیقه) */
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(themeMode);
      document.documentElement.dataset.theme = resolved;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", resolved === "dark" ? "#0d1b2a" : "#f5f7f4");
    };
    apply();
    if (themeMode !== "auto") return;

    const t = window.setInterval(apply, 15 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [themeMode]);

  /* تغییر + ذخیره خودکار در سرور */
  async function changeTheme(mode: Member["theme"]) {
    setThemeMode(mode);
    if (useCases && member) {
      try {
        await useCases.setTheme.execute(mode);
      } catch {
        /* بی‌صدا — تم محلی اعمال شده می‌ماند */
      }
    }
  }

  return { themeMode, changeTheme };
}
