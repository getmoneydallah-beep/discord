"use client";

import { actions, useLocale } from "@/lib/store";

export function LanguageToggle() {
  const locale = useLocale();
  return (
    <button
      type="button"
      onClick={() => void actions.setPrefs({ locale: locale === "ar" ? "en" : "ar" })}
      className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-fg"
    >
      {locale === "ar" ? "English" : "العربية"}
    </button>
  );
}
