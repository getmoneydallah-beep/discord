"use client";

import { useParams } from "next/navigation";
import { ChatView } from "@/components/ChatView";

export default function ChannelPage() {
  const { serverId, channelId } = useParams<{ serverId: string; channelId: string }>();
  return <ChatView key={channelId} serverId={serverId} channelId={channelId} />;
}
