"use client";

import Link from "next/link";
import { useT } from "@/lib/store";

/** Full-width page inside the app shell (billing, Whop connection, sales). */
export function PageShell({ title, icon, children, actions }: { title: string; icon: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const t = useT();
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Link href="/s" className="flex items-center gap-1 text-sm text-muted hover:text-fg">
          <span className="flip-rtl inline-block">←</span> {t("pay.back")}
        </Link>
        <span className="ms-2">{icon}</span>
        <h1 className="font-bold">{title}</h1>
        <div className="flex-1" />
        {actions}
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">{children}</div>
      </div>
    </main>
  );
}
