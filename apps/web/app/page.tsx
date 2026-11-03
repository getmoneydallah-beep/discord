"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp, useT } from "@/lib/store";
import { Splash } from "@/components/ui";

export default function Home() {
  const status = useApp((s) => s.status);
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
    if (status === "ready") router.replace("/s");
  }, [status, router]);

  return <Splash label={t("common.loading")} />;
}
