import { describe, expect, it } from "vitest";
import { budgetStatus } from "./budget.rules";

describe("budgetStatus", () => {
  it("بدون بودجه → غیرفعال", () => {
    const s = budgetStatus(0, 500_000);
    expect(s.active).toBe(false);
    expect(s.percent).toBe(0);
  });

  it("زیر ۸۰٪ → ok", () => {
    expect(budgetStatus(1_000_000, 500_000).level).toBe("ok");
  });

  it("بین ۸۰ تا ۱۰۰ → warn", () => {
    const s = budgetStatus(1_000_000, 850_000);
    expect(s.level).toBe("warn");
    expect(s.percent).toBe(85);
  });

  it("بالای ۱۰۰ → over با درصد واقعی", () => {
    const s = budgetStatus(1_000_000, 1_400_000);
    expect(s.level).toBe("over");
    expect(s.percent).toBe(140);
  });

  it("سقف ۹۹۹٪", () => {
    expect(budgetStatus(1, 1_000_000).percent).toBe(999);
  });
});
