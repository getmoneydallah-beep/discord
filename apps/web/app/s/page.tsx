"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { Button } from "@/components/ui";

export default function ServersHome() {
  const servers = useApp((s) => s.servers);
  const router = useRouter();
  const t = useT();
  const openModal = useUi((s) => s.openModal);

  useEffect(() => {
    const last = typeof window !== "undefined" ? localStorage.getItem("majlis.lastServer") : null;
    const target = servers.find((s) => s.id === last) ?? servers[0];
    if (target) router.replace(`/s/${target.id}`);
  }, [servers, router]);

  if (servers.length) return null;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <div className="text-5xl">🏕️</div>
        <p className="text-muted">{t("server.empty")}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => openModal("createServer")}>{t("server.create")}</Button>
          <Button variant="ghost" onClick={() => openModal("joinServer")}>
            {t("server.join")}
          </Button>
        </div>
      </div>
    </div>
  );
}
