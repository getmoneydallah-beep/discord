"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApp, useT } from "@/lib/store";
import { ServerRail } from "@/components/ServerRail";
import { Modals } from "@/components/Modals";
import { Splash } from "@/components/ui";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const status = useApp((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();

  useEffect(() => {
    if (status === "signedOut") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== "ready") return <Splash label={t("common.loading")} />;

  return (
    <div className="flex h-dvh overflow-hidden">
      <ServerRail />
      <div className="flex min-w-0 flex-1">{children}</div>
      <Modals />
    </div>
  );
}
