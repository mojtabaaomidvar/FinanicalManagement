import { describe, expect, it } from "vitest";
import {
  stepJalali,
  dueOccurrences,
  pendingOccurrences,
} from "./recurring.rules";
import { jalaliToIso, type JDate } from "@/shared/lib/jalali";

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

  it("سالانه با clamp — ۳۰ اسفندِ کبیسه به سال عادی", () => {
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
