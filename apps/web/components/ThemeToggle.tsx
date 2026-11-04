"use client";

import { useEffect, useState } from "react";
import { cx } from "./ui";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "majlis.theme";

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode */
  }
}

/** The theme in effect right now (the saved choice, or the system setting). */
function resolved(): "light" | "dark" {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [current, setCurrent] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem(KEY);
      } catch {
        return null;
      }
    })();
    setChoice(saved === "light" || saved === "dark" ? saved : "system");
    setCurrent(resolved());
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setCurrent(resolved());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const set = (c: ThemeChoice) => {
    apply(c);
    setChoice(c);
    setCurrent(resolved());
  };
  return { choice, current, set };
}

/** One button: switches between light and dark. */
export function ThemeToggle({ className, labels }: { className?: string; labels: { light: string; dark: string } }) {
  const { current, set } = useTheme();
  const next = current === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => set(next)}
      aria-label={next === "light" ? labels.light : labels.dark}
      title={next === "light" ? labels.light : labels.dark}
      className={cx(
        "relative flex h-9 w-9 items-center justify-center rounded-full border border-line text-base transition hover:bg-surface-hover",
        className,
      )}
    >
      {current === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** Light / dark / system, for the Settings page. */
export function ThemeSegmented({ labels }: { labels: { light: string; dark: string; system: string } }) {
  const { choice, set } = useTheme();
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg p-1 text-sm" role="radiogroup">
      {(["light", "dark", "system"] as const).map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={choice === c}
          onClick={() => set(c)}
          className={cx("whitespace-nowrap rounded-md px-3 py-1.5", choice === c ? "bg-brand text-white" : "text-muted hover:text-fg")}
        >
          {c === "light" ? "☀️" : c === "dark" ? "🌙" : "💻"} {labels[c]}
        </button>
      ))}
    </div>
  );
}

export function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
