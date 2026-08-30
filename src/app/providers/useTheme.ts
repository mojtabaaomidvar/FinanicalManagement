/* Theme — تم تیره/روشن بر اساس تنظیم خانواده */

import { useEffect } from "react";
import type { Family } from "@/domain/family/family.types";

export function useTheme(family: Family | null): void {
  useEffect(() => {
    const dark = family ? family.dark : true;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0b0d12" : "#f4f5f8");
  }, [family]);
}
