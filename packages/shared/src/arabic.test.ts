import { describe, expect, it } from "vitest";
import { detectDirection, normalizeArabic, toEasternDigits, toWesternDigits } from "./arabic";
import { idTimestamp, newId } from "./ids";
import { can, outranks } from "./permissions";

describe("normalizeArabic", () => {
  it("unifies alef forms", () => {
    expect(normalizeArabic("أحمد")).toBe(normalizeArabic("احمد"));
    expect(normalizeArabic("إسلام")).toBe("اسلام");
    expect(normalizeArabic("آمال")).toBe("امال");
  });
  it("unifies taa marbuta and alef maqsura", () => {
    expect(normalizeArabic("مدرسة")).toBe(normalizeArabic("مدرسه"));
    expect(normalizeArabic("مستشفى")).toBe(normalizeArabic("مستشفي"));
  });
  it("strips tashkeel and tatweel", () => {
    expect(normalizeArabic("مُحَمَّد")).toBe("محمد");
    expect(normalizeArabic("مرحـــبا")).toBe("مرحبا");
  });
  it("converts digits and lowercases latin", () => {
    expect(normalizeArabic("Hello ١٢٣")).toBe("hello 123");
  });
});

describe("digits", () => {
  it("round-trips", () => {
    expect(toEasternDigits("2026")).toBe("٢٠٢٦");
    expect(toWesternDigits("٢٠٢٦")).toBe("2026");
    expect(toWesternDigits("۱۲")).toBe("12");
  });
});

describe("detectDirection", () => {
  it("uses the first strong character", () => {
    expect(detectDirection("مرحبا hello")).toBe("rtl");
    expect(detectDirection("hello مرحبا")).toBe("ltr");
    expect(detectDirection("123 مرحبا")).toBe("rtl");
    expect(detectDirection("😀")).toBe("rtl");
  });
});

describe("ids", () => {
  it("are time-sortable", () => {
    const a = newId(1_000_000);
    const b = newId(2_000_000);
    expect(a < b).toBe(true);
    expect(a).toHaveLength(26);
    expect(idTimestamp(a)).toBe(1_000_000);
  });
});

describe("permissions", () => {
  it("enforces role ranks", () => {
    expect(can("member", "message.send")).toBe(true);
    expect(can("member", "member.kick")).toBe(false);
    expect(can("admin", "member.kick")).toBe(true);
    expect(can("admin", "member.setRole")).toBe(false);
    expect(outranks("admin", "member")).toBe(true);
    expect(outranks("admin", "admin")).toBe(false);
  });
});
