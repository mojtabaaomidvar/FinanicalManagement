import { describe, expect, it } from "vitest";
import {
  stepJalali,
  dueOccurrences,
  pendingOccurrences,
  pendingDueList,
  reminderDueList,
  occurrenceStatus,
  parseScheduledAmount,
  stoppedRecurringInput,
} from "./recurring.rules";
import { addDays, isoToJalali, jalaliToIso, type JDate } from "@/shared/lib/jalali";
import type { Transaction } from "./transaction.types";

describe("stepJalali", () => {
  it("ماهانه ساده — همان روز، ماه بعد", () => {
    expect(stepJalali([1404, 6, 15], "monthly", 1)).toEqual([1404, 7, 15]);
    expect(stepJalali([1404, 6, 15], "monthly", 3)).toEqual([1404, 9, 15]);
  });

  it("ماهانه با گذر از مرز سال", () => {
    expect(stepJalali([1404, 11, 10], "monthly", 2)).toEqual([1405, 1, 10]);
    expect(stepJalali([1404, 12, 5], "monthly", 1)).toEqual([1405, 1, 5]);
  });

  it("ماهانه با clamp روز — ۳۱ام در ماه ۳۰روزه", () => {
    /* شهریور ۳۱ روز، مهر ۳۰ روز → clamp به ۳۰ */
    expect(stepJalali([1404, 6, 31], "monthly", 1)).toEqual([1404, 7, 30]);
  });

  it("ماهانه بدون رانش — ۳۱ام همیشه از اصل clamp می‌شود", () => {
    /* مهر ۳۰ (clamp ۳۰) ولی آبان بعدش باید از ۳۱ اصل دوباره clamp شود، نه از ۳۰ */
    expect(stepJalali([1404, 6, 31], "monthly", 2)).toEqual([1404, 8, 30]);
    /* آذر هم ۳۰، ولی وقتی به ماهی ۳۱روزه برسیم دوباره ۳۱ برمی‌گردد
       (سال بعد فروردین ۳۱ روز) */
    expect(stepJalali([1404, 6, 31], "monthly", 7)).toEqual([1405, 1, 31]);
  });

  it("سالانه ساده", () => {
    expect(stepJalali([1404, 6, 15], "yearly", 1)).toEqual([1405, 6, 15]);
    expect(stepJalali([1404, 6, 15], "yearly", 2)).toEqual([1406, 6, 15]);
  });

  it("سالانه با clamp — ۳۰ اسفند کبیسه به سال عادی", () => {
    /* ۱۴۰۳ کبیسه (اسفند ۳۰)، ۱۴۰۴ عادی (اسفند ۲۹) */
    expect(stepJalali([1403, 12, 30], "yearly", 1)).toEqual([1404, 12, 29]);
  });

  it("هفتگی = ۷n روز", () => {
    expect(stepJalali([1404, 6, 1], "weekly", 1)).toEqual([1404, 6, 8]);
    expect(stepJalali([1404, 6, 1], "weekly", 5)).toEqual([1404, 7, 5]);
  });

  it("n صفر یا none → بدون تغییر", () => {
    expect(stepJalali([1404, 6, 15], "monthly", 0)).toEqual([1404, 6, 15]);
    expect(stepJalali([1404, 6, 15], "none", 3)).toEqual([1404, 6, 15]);
  });
});

/* ابزار: تاریخ جلالی → ISO میلادی */
const iso = (d: JDate) => jalaliToIso(d);

describe("dueOccurrences", () => {
  it("شروع خودش نمی‌آید — فقط سررسیدهای بعد از آن", () => {
    const start = iso([1404, 1, 15]);
    const end = iso([1404, 12, 15]);
    const today: JDate = [1404, 4, 20];
    const out = dueOccurrences(start, "monthly", end, today);
    /* بعد از فروردین: اردیبهشت، خرداد، تیر (۱۵ام‌ها تا امروز) */
    expect(out).toEqual([
      iso([1404, 2, 15]),
      iso([1404, 3, 15]),
      iso([1404, 4, 15]),
    ]);
  });

  it("سقف = امروز وقتی امروز زودتر از پایان است", () => {
    const start = iso([1404, 1, 15]);
    const end = iso([1410, 1, 15]);
    const today: JDate = [1404, 3, 20];
    const out = dueOccurrences(start, "monthly", end, today);
    /* فقط اردیبهشت و خرداد ۱۵ (تیر ۱۵ هنوز نرسیده — امروز ۲۰ خرداد است) */
    expect(out).toEqual([iso([1404, 2, 15]), iso([1404, 3, 15])]);
  });

  it("سقف = پایان تکرار وقتی پایان زودتر از امروز است", () => {
    const start = iso([1404, 1, 15]);
    const end = iso([1404, 3, 15]);
    const today: JDate = [1405, 1, 1];
    const out = dueOccurrences(start, "monthly", end, today);
    expect(out).toEqual([iso([1404, 2, 15]), iso([1404, 3, 15])]);
  });

  it("سررسیدی که دقیقاً روی امروز است، شامل می‌شود", () => {
    const start = iso([1404, 1, 10]);
    const end = iso([1405, 1, 10]);
    const today: JDate = [1404, 2, 10];
    const out = dueOccurrences(start, "monthly", end, today);
    expect(out).toEqual([iso([1404, 2, 10])]);
  });

  it("قبل از اولین سررسید → خالی", () => {
    const start = iso([1404, 1, 15]);
    const end = iso([1405, 1, 15]);
    const today: JDate = [1404, 1, 20];
    expect(dueOccurrences(start, "monthly", end, today)).toEqual([]);
  });

  it("none → خالی", () => {
    const start = iso([1404, 1, 15]);
    expect(dueOccurrences(start, "none", null, [1404, 6, 1])).toEqual([]);
  });

  it("بدون تاریخ پایان → سقف امروز است", () => {
    const start = iso([1404, 1, 1]);
    const today: JDate = [1404, 1, 22];
    const out = dueOccurrences(start, "weekly", null, today);
    /* ۸، ۱۵، ۲۲ فروردین */
    expect(out).toEqual([
      iso([1404, 1, 8]),
      iso([1404, 1, 15]),
      iso([1404, 1, 22]),
    ]);
  });
});

describe("pendingOccurrences", () => {
  it("رسیدگی‌شده‌ها را کم می‌کند", () => {
    const all = [iso([1404, 2, 15]), iso([1404, 3, 15]), iso([1404, 4, 15])];
    const handled = new Set([iso([1404, 3, 15])]);
    expect(pendingOccurrences(all, handled)).toEqual([
      iso([1404, 2, 15]),
      iso([1404, 4, 15]),
    ]);
  });

  it("هیچ رسیدگی‌شده‌ای → همه معلق", () => {
    const all = [iso([1404, 2, 15])];
    expect(pendingOccurrences(all, new Set())).toEqual(all);
  });

  it("همه رسیدگی‌شده → خالی", () => {
    const all = [iso([1404, 2, 15]), iso([1404, 3, 15])];
    const handled = new Set(all);
    expect(pendingOccurrences(all, handled)).toEqual([]);
  });
});

const recurring: Transaction = { id: "schedule", familyId: "family", memberId: "member", type: "expense", amount: 1200.25,
  category: "bills", date: iso([1404, 6, 31]), time: "10:30", note: "My rent", accountId: "account", toAccountId: null,
  subcategoryId: "label", repeat: "monthly", repeatEnd: iso([1405, 6, 31]), handledOccurrences: [iso([1404, 7, 30])],
  photos: [{ id: "receipt", url: "/receipt.png", caption: "Keep" }], createdAt: "now" };

describe("scheduled finances", () => {
  it.each(["", "0", "-1200", "12abc", "12+", "12/0", "1e3", "1000000000000"])("does not reinterpret invalid amounts: %j", amount => {
    expect(parseScheduledAmount(amount, "تومان")).toBeNull();
  });
  it("preserves grouped Persian and Arabic amounts and currency fractions", () => {
    expect(parseScheduledAmount("۱٬۲۰۰٫۲۵", "تومان")).toBe(1200.25);
    expect(parseScheduledAmount("١٢٬٠٠٢٫٥", "ریال")).toBe(1200.25);
  });
  it("stops only repetition while preserving every input financial field", () => {
    const before = structuredClone(recurring), input = stoppedRecurringInput(recurring);
    expect(input).toEqual({ memberId: recurring.memberId, type: recurring.type, amount: recurring.amount, category: recurring.category,
      date: recurring.date, time: recurring.time, note: recurring.note, accountId: recurring.accountId, toAccountId: recurring.toAccountId,
      subcategoryId: recurring.subcategoryId, repeat: "none", repeatEnd: null });
    expect(recurring).toEqual(before);
  });
  it("distinguishes pending handled and invalid dates using the original monthly day", () => {
    expect(occurrenceStatus(recurring, iso([1404, 7, 30]))).toBe("handled");
    expect(occurrenceStatus(recurring, iso([1404, 8, 30]))).toBe("pending");
    expect(occurrenceStatus(recurring, recurring.date)).toBe("invalid");
    expect(occurrenceStatus(recurring, iso([1404, 8, 29]))).toBe("invalid");
    expect(occurrenceStatus(recurring, "2026-02-30")).toBe("invalid");
    expect(occurrenceStatus({ ...recurring, repeat: "none" }, iso([1404, 8, 30]))).toBe("invalid");
  });
  it("keeps list and notification ordering identical and excludes handled dates", () => {
    const rows = pendingDueList([recurring, { ...recurring, id: "a" }], [1404, 9, 1]);
    expect(rows.map(row => [row.tx.id, row.dueIso])).toEqual([["a", iso([1404, 8, 30])], ["schedule", iso([1404, 8, 30])]]);
  });
  it.each(["2026-11-30", "2026-12-31", "2027-03-20"])("reminds only today and tomorrow across calendar boundaries: %s", date => {
    const now = isoToJalali(date);
    const rows: Transaction[] = [-1, 0, 1, 2].map(offset => ({ ...recurring, id: String(offset), repeat: "weekly",
      date: iso(addDays(now, offset - 28)), repeatEnd: iso(addDays(now, 60)), handledOccurrences: [] }));
    const before = structuredClone(rows), reminders = reminderDueList(rows, now);
    expect(reminders.map(row => [row.tx.id, row.dueIso])).toEqual([["0", date], ["1", iso(addDays(now, 1))]]);
    expect(rows).toEqual(before);
    expect(pendingDueList(rows, now).length).toBeGreaterThan(reminders.length);
  });
  it("hides handled stopped and ended reminders without touching old financial entries", () => {
    const now: JDate = [1404, 8, 30];
    const tx = { ...recurring, handledOccurrences: [iso(now)] };
    expect(reminderDueList([tx, { ...recurring, repeat: "none" }, { ...recurring, repeatEnd: iso([1404, 7, 30]) }], now)).toEqual([]);
    expect(reminderDueList([recurring], now).map(row => row.dueIso)).toEqual([iso(now)]);
  });
});
