import { describe, expect, it } from "vitest";
import { safeNextPath } from "./ids";
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

import { findVideoEmbeds, fileKind, formatDuration, parseVideoEmbed } from "./media";

describe("video embeds", () => {
  it("parses YouTube variants", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(parseVideoEmbed(u)?.id).toBe("dQw4w9WgXcQ");
    }
  });
  it("parses Vimeo and rejects others", () => {
    expect(parseVideoEmbed("https://vimeo.com/76979871")?.provider).toBe("vimeo");
    expect(parseVideoEmbed("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoEmbed("not a url")).toBeNull();
  });
  it("finds embeds inside Arabic text", () => {
    const e = findVideoEmbeds("شاهد هذا الدرس https://youtu.be/dQw4w9WgXcQ وهذا https://youtu.be/dQw4w9WgXcQ");
    expect(e).toHaveLength(1);
  });
  it("formats", () => {
    expect(fileKind("video/mp4")).toBe("video");
    expect(fileKind("application/pdf")).toBe("file");
    expect(formatDuration(247)).toBe("4:07");
    expect(formatDuration(3909)).toBe("1:05:09");
  });
});

describe("safeNextPath (open redirect guard)", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/s")).toBe("/s");
    expect(safeNextPath("/invite/AbC123?join=1")).toBe("/invite/AbC123?join=1");
  });
  it("rejects external, protocol-relative and script URLs", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil", "", null, undefined, "/\tfoo", "/s\\..\\x"]) {
      expect(safeNextPath(bad as string)).toBe("/s");
    }
  });
});
