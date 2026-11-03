"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { actions, useApp } from "@/lib/store";
import { ChannelSidebar } from "@/components/ChannelSidebar";
import { MemberList } from "@/components/MemberList";
import { useUi } from "@/lib/ui";

export default function ServerLayout({ children }: { children: React.ReactNode }) {
  const { serverId } = useParams<{ serverId: string }>();
  const loaded = useApp((s) => Boolean(s.serverState[serverId]));
  const isMember = useApp((s) => s.servers.some((x) => x.id === serverId));
  const membersOpen = useUi((s) => s.membersOpen);
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    localStorage.setItem("majlis.lastServer", serverId);
    actions.loadServer(serverId).catch(() => setFailed(true));
  }, [serverId]);

  // Kicked / server deleted while viewing it.
  useEffect(() => {
    if (failed || (loaded && !isMember)) router.replace("/s");
  }, [failed, loaded, isMember, router]);

  if (!loaded) return <div className="flex-1" />;

  return (
    <>
      <ChannelSidebar serverId={serverId} />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">{children}</main>
      {membersOpen && <MemberList serverId={serverId} />}
    </>
  );
}
