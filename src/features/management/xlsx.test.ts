import { describe, expect, it } from "vitest";
import { createExcel, type ExcelSheet } from "./xlsx";

describe("xlsx package creation", () => {
  it("creates a valid OpenXML workbook with safe inline strings and distinct empty and zero rows", () => {
    const sheets: ExcelSheet[] = [
      { name: "گزارش/یک", columns: ["شاخص", "مقدار"], rows: [["=1+1 & <x>", 0], ["ناموجود", "اندازه‌گیری‌نشده"]] },
      { name: "گزارش یک", columns: ["شاخص", "مقدار"], rows: [["بدون داده", null]] },
    ];
    const bytes = new Uint8Array(createExcel(sheets));
    const xml = new TextDecoder().decode(bytes);
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(xml).toContain("xl/workbook.xml");
    expect(xml).toContain('name="گزارش یک"');
    expect(xml).toContain('name="گزارش یک (2)"');
    expect(xml).toContain("&lt;x&gt;");
    expect(xml).not.toContain("<f>");
    expect(() => createExcel([])).toThrow();
    expect(() => createExcel([{ name: "اکسل", columns: ["شاخص"], rows: [["متن".repeat(33000)]] }]))
      .toThrow(/بیش از حد بلند/);
  });
});
