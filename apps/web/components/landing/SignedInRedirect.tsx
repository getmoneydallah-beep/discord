"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/store";

/** Signed-in visitors skip the landing page and go straight to their majlises. */
export function SignedInRedirect() {
  const status = useApp((s) => s.status);
  const router = useRouter();
  useEffect(() => {
    if (status === "ready") router.replace("/s");
  }, [status, router]);
  return null;
}
