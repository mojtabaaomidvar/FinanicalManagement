import { useEffect, useMemo, useState } from "react";
import { isoToJalali } from "./jalali";

/** The family's Tehran calendar day, including after midnight and when resuming the app. */
export const tehranTodayIso = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    calendar: "gregory", numberingSystem: "latn",
  }).formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const useTehranDay = () => {
  const [day, setDay] = useState(tehranTodayIso);
  useEffect(() => {
    const update = () => setDay(tehranTodayIso());
    const interval = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  return useMemo(() => ({ todayIso: day, todayJ: isoToJalali(day) }), [day]);
};
