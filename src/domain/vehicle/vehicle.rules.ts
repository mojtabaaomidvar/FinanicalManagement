import type { VehicleInput, VehicleServiceInput } from "./vehicle.types";
import { toEn } from "@/shared/lib/digits";
import { moneyFits, parseMoneyInput } from "@/shared/lib/money";
// Vehicle costs retain their existing integer-only API contract.
const MAX_AMOUNT = 999_999_999_999;

export const MAX_ODOMETER = 100_000_000;
export function isVehicleDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function vehicleToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function odometerValue(raw: string): number {
  const digits = toEn(raw).replace(/[\s,٬]/g, "");
  if (!/^\d+$/.test(digits)) return NaN;
  return Number(digits);
}
const validKm = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_ODOMETER;

/** Reuse Finance's display-currency parser and integer toman conversion. */
export function serviceCost(raw: string, currency: string | null | undefined): number | null {
  if (!raw.trim()) return null;
  const amount = parseMoneyInput(raw, currency ?? "تومان");
  if (amount === null) throw new Error("مبلغ هزینه را با عدد مثبت بنویسید.");
  if (!moneyFits(amount, { scale: 0, min: "1", max: String(MAX_AMOUNT) })) throw new Error("مبلغ هزینه باید مثبت و در محدودهٔ مجاز مالی باشد.");
  return Number(amount);
}
export function vehicleError(input: VehicleInput, previousOdometer = 0, todayIso = vehicleToday()): string {
  if (!input.title.trim()) return "نام خودرو را بنویسید.";
  if (input.title.trim().length > 120) return "نام خودرو باید حداکثر ۱۲۰ نویسه باشد.";
  if ((input.brand?.trim().length ?? 0) > 80 || (input.model?.trim().length ?? 0) > 80) return "برند و مدل باید حداکثر ۸۰ نویسه باشند.";
  if ((input.plate?.trim().length ?? 0) > 30) return "پلاک باید حداکثر ۳۰ نویسه باشد.";
  if (!validKm(input.odometer)) return "کیلومتر فعلی باید عدد صحیح از صفر تا ۱۰۰٬۰۰۰٬۰۰۰ باشد.";
  if (input.odometer < previousOdometer) return "کیلومتر فعلی نمی‌تواند کمتر از کیلومتر ثبت‌شده باشد.";
  if (input.serviceDueOdometer !== null && input.serviceDueOdometer !== undefined && !validKm(input.serviceDueOdometer)) return "موعد کیلومتری سرویس باید عدد صحیح از صفر تا ۱۰۰٬۰۰۰٬۰۰۰ باشد.";
  for (const date of [input.purchaseDate, input.insuranceUntil, input.inspectionUntil, input.serviceDueDate]) if (date && !isVehicleDay(date)) return "تاریخ را دوباره انتخاب کنید.";
  if (input.purchaseDate && input.purchaseDate > todayIso) return "تاریخ خرید نمی‌تواند بعد از امروز باشد.";
  return "";
}
export function vehicleServiceError(input: VehicleServiceInput, currentOdometer: number, todayIso = vehicleToday()): string {
  if (!isVehicleDay(input.performedOn)) return "تاریخ انجام سرویس را انتخاب کنید.";
  if (input.performedOn > todayIso) return "تاریخ انجام سرویس نمی‌تواند بعد از امروز باشد.";
  if (!input.description.trim()) return "شرح سرویس را بنویسید.";
  if (input.description.trim().length > 1000) return "شرح سرویس باید حداکثر ۱۰۰۰ نویسه باشد.";
  if (!validKm(input.performedOdometer) || input.performedOdometer < currentOdometer) return "کیلومتر انجام سرویس باید عدد صحیح و حداقل برابر کیلومتر فعلی باشد.";
  if (input.nextDueDate && (!isVehicleDay(input.nextDueDate) || input.nextDueDate <= input.performedOn)) return "تاریخ سرویس بعدی باید بعد از تاریخ انجام باشد.";
  if (input.nextDueOdometer !== null && input.nextDueOdometer !== undefined
    && (!validKm(input.nextDueOdometer) || input.nextDueOdometer <= input.performedOdometer)) return "کیلومتر سرویس بعدی باید بیشتر از کیلومتر انجام سرویس باشد.";
  if (input.costAmount !== null && input.costAmount !== undefined && (!Number.isSafeInteger(input.costAmount) || input.costAmount <= 0 || input.costAmount > MAX_AMOUNT)) return "مبلغ هزینه باید مثبت و در محدودهٔ مجاز مالی باشد.";
  if (input.accountId && (input.costAmount === null || input.costAmount === undefined)) return "انتخاب حساب فقط همراه هزینهٔ سرویس مجاز است.";
  return "";
}
