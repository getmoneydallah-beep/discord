"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApp } from "@/lib/store";

export default function ServerIndex() {
  const { serverId } = useParams<{ serverId: string }>();
  const first = useApp((s) => s.serverState[serverId]?.channels.find((c) => c.type === "text"));
  const router = useRouter();

  useEffect(() => {
    if (first) router.replace(`/s/${serverId}/${first.id}`);
  }, [first, serverId, router]);

  return null;
}
