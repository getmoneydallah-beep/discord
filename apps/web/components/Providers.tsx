"use client";

import { useEffect } from "react";
import { actions, useApp } from "@/lib/store";
import { dirOf } from "@majlis/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  const locale = useApp((s) => s.prefs.locale);

  useEffect(() => {
    void actions.boot();
    const t = setInterval(() => actions.pruneTyping(), 2000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
  }, [locale]);

  return <>{children}</>;
}
