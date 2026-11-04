"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { actions } from "@/lib/store";
import { cx } from "../ui";
import { ThemeToggle } from "../ThemeToggle";
import { landing, type LandingLang } from "./content";

/** Floating glass header: nav, language switch, light/dark toggle, mobile menu. */
export function LandingHeader({ lang }: { lang: LandingLang }) {
  const c = landing[lang].nav;
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links: [string, string][] = [
    ["#features", c.features],
    ["#pricing", c.pricing],
    ["#faq", c.faq],
  ];
  const brand = lang === "ar" ? "مجلس" : "Majlis";

  return (
    <header className="sticky top-0 z-40 px-3 pt-3">
      <nav
        className={cx(
          "mx-auto flex h-14 max-w-6xl items-center gap-3 rounded-2xl border px-3 transition-all duration-300 md:px-4",
          scrolled || open
            ? "border-line/80 bg-bg/75 shadow-lg shadow-black/5 backdrop-blur-xl"
            : "border-transparent bg-transparent",
        )}
      >
        <Link href={lang === "ar" ? "/" : "/?lang=en"} className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-[#0b4f38] text-sm font-bold text-white shadow-md shadow-brand/30">
            م
          </span>
          <span className="text-lg font-bold">{brand}</span>
        </Link>

        <div className="mx-auto hidden items-center gap-1 rounded-full bg-surface/60 p-1 md:flex">
          {links.map(([href, label]) => (
            <a key={href} href={href} className="rounded-full px-4 py-1.5 text-sm text-muted transition hover:bg-bg hover:text-fg">
              {label}
            </a>
          ))}
        </div>

        <div className="ms-auto flex items-center gap-2 md:ms-0">
          <LangSwitch lang={lang} label={c.language} />
          <ThemeToggle labels={{ light: c.themeLight, dark: c.themeDark }} />
          <Link href="/login" className="hidden rounded-full px-3 py-2 text-sm font-medium transition hover:bg-surface-hover lg:block">
            {c.login}
          </Link>
          <Link
            href="/register"
            className="hidden rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand/30 transition hover:bg-brand-hover sm:block"
          >
            {c.start}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={c.menu}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      <div
        className={cx(
          "mx-auto mt-2 max-w-6xl overflow-hidden rounded-2xl border border-line/80 bg-bg/90 shadow-xl backdrop-blur-xl transition-all duration-300 md:hidden",
          open ? "max-h-96 opacity-100" : "pointer-events-none max-h-0 border-transparent opacity-0",
        )}
      >
        <div className="flex flex-col p-2">
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 font-medium hover:bg-surface-hover">
              {label}
            </a>
          ))}
          <div className="my-1 h-px bg-line" />
          <Link href="/login" className="rounded-xl px-4 py-3 font-medium hover:bg-surface-hover">
            {c.login}
          </Link>
          <Link href="/register" className="m-1 rounded-xl bg-brand px-4 py-3 text-center font-semibold text-white">
            {c.start}
          </Link>
        </div>
      </div>
    </header>
  );
}

/** ع | EN pill. Also remembers the choice for the app after sign-up. */
function LangSwitch({ lang, label }: { lang: LandingLang; label: string }) {
  return (
    <div className="flex items-center rounded-full border border-line p-0.5 text-xs font-semibold" role="group" aria-label={label}>
      {(["ar", "en"] as const).map((l) => (
        <Link
          key={l}
          href={l === "ar" ? "/" : "/?lang=en"}
          onClick={() => void actions.setPrefs({ locale: l })}
          aria-current={lang === l ? "true" : undefined}
          lang={l}
          className={cx(
            "flex h-7 min-w-8 items-center justify-center rounded-full px-2 transition",
            lang === l ? "bg-fg text-bg" : "text-muted hover:text-fg",
          )}
        >
          {l === "ar" ? "ع" : "EN"}
        </Link>
      ))}
    </div>
  );
}
