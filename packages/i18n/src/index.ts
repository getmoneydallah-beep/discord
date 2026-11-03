import type { Locale } from "@majlis/shared";
import { toEasternDigits } from "@majlis/shared";
import { ar } from "./ar";
import { en } from "./en";

export const dictionaries = { ar, en } as const;
export type Dictionary = typeof ar;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type TranslationKey = Leaves<Dictionary>;

export const isRtl = (locale: Locale) => locale === "ar";
export const dirOf = (locale: Locale): "rtl" | "ltr" => (isRtl(locale) ? "rtl" : "ltr");

/** Look up a key like "message.placeholder" and fill {placeholders}. */
export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: Record<string, string | number>,
): string {
  let node: unknown = dictionaries[locale];
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  let str = typeof node === "string" ? node : key;
  if (vars) str = str.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
  return str;
}

export function createT(locale: Locale) {
  return (key: TranslationKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

/** Translate an API error code, falling back to the generic error message. */
export function translateError(locale: Locale, code: string | undefined): string {
  const errors = dictionaries[locale].errors as Record<string, string>;
  return (code && errors[code]) || dictionaries[locale].common.error;
}

export interface FormatOptions {
  easternDigits?: boolean;
}

export function formatTime(iso: string, locale: Locale, opts: FormatOptions = {}): string {
  // "ar-SA" defaults to the Hijri calendar; use Gregorian with Latin digits and
  // let the user opt into Eastern Arabic digits.
  const s = new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
  return opts.easternDigits ? toEasternDigits(s) : s;
}

export function formatDate(iso: string, locale: Locale, opts: FormatOptions & { hijri?: boolean } = {}): string {
  const cal = opts.hijri ? "islamic-umalqura" : "gregory";
  const s = new Intl.DateTimeFormat(
    locale === "ar" ? `ar-SA-u-ca-${cal}-nu-latn` : `en-GB-u-ca-${cal}`,
    { year: "numeric", month: "long", day: "numeric" },
  ).format(new Date(iso));
  return opts.easternDigits ? toEasternDigits(s) : s;
}

export { ar, en };
