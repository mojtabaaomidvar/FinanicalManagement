/* Theme — تم تیره/روشن بر اساس تنظیم خانواده (پیش‌فرض برند: روشن) */

import { useEffect } from "react";
import type { Family } from "@/domain/family/family.types";

export function useTheme(family: Family | null): void {
  useEffect(() => {
    const dark = family ? family.dark : false;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0d1b2a" : "#f9fafb");
  }, [family]);
}
