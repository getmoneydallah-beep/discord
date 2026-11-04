"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { useApp } from "@/lib/store";
import { ChatView } from "@/components/ChatView";
import { CourseView } from "@/components/course/CourseView";

export default function ChannelPage() {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>();
  const type = useApp((s) => s.serverState[serverId]?.channels.find((c) => c.id === channelId)?.type);
  if (!type) return null;
  if (type === "course")
    return (
      <Suspense>
        <CourseView key={channelId} serverId={serverId} courseId={channelId} />
      </Suspense>
    );
  return <ChatView key={channelId} serverId={serverId} channelId={channelId} />;
}
