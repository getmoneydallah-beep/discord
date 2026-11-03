/**
 * Arabic text utilities shared by the API (search indexing) and the clients
 * (display, input handling).
 */

// Harakat / tashkeel (U+064B–U+065F), superscript alef (U+0670), Quranic marks.
const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

/**
 * Normalise Arabic text for search so that common spelling variants match:
 * - strips tashkeel and tatweel (ـ)
 * - unifies alef forms أ إ آ ٱ → ا
 * - ى → ي, ة → ه, ؤ → و, ئ → ي
 * - Eastern Arabic / Persian digits → Western digits
 * - lowercases Latin text and collapses whitespace
 */
export function normalizeArabic(input: string): string {
  return toWesternDigits(input)
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const EASTERN = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = EASTERN.indexOf(d);
    return String(i >= 0 ? i : PERSIAN.indexOf(d));
  });
}

export function toEasternDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => EASTERN[Number(d)]!);
}

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏ]/;

/** Direction of the first strong character, like the HTML `dir="auto"` algorithm. */
export function detectDirection(text: string): "rtl" | "ltr" {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return "rtl";
    if (LTR_CHAR.test(ch)) return "ltr";
  }
  return "rtl"; // Arabic-first default for neutral text (numbers, emoji)
}

export function containsArabic(text: string): boolean {
  return RTL_CHAR.test(text);
}
