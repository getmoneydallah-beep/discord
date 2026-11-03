"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "@majlis/shared";
import type { PendingMessage } from "@majlis/api-client/store";
import { actions, useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { MessageItem } from "./MessageItem";
import { Composer } from "./Composer";
import { SearchBox } from "./SearchBox";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function ChatView({ serverId, channelId }: { serverId: string; channelId: string }) {
  const t = useT();
  const channel = useApp((s) => s.serverState[serverId]?.channels.find((c) => c.id === channelId));
  const data = useApp((s) => s.messages[channelId]);
  const typing = useApp((s) => s.typing[channelId]);
  const setNav = useUi((s) => s.setNav);
  const toggleMembers = useUi((s) => s.toggleMembers);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);

  useEffect(() => {
    void actions.loadMessages(channelId);
  }, [channelId]);

  // Keep pinned to the bottom for new messages; preserve position when loading older ones.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else if (prevHeight.current && el.scrollHeight > prevHeight.current && el.scrollTop < 50) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    }
    prevHeight.current = el.scrollHeight;
  }, [data?.items]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 100 && data?.hasMore && !data.loading) {
      prevHeight.current = el.scrollHeight;
      void actions.loadOlder(channelId);
    }
  }

  if (!channel) return null;
  const items = (data?.items ?? []) as PendingMessage[];
  const byId = new Map(items.map((m) => [m.id, m]));
  const typers = Object.values(typing ?? {});

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <button onClick={() => setNav(true)} className="p-1 text-xl text-muted md:hidden" aria-label="menu">
          ☰
        </button>
        <span className="text-xl text-muted">#</span>
        <h1 className="truncate font-bold" dir="auto">
          {channel.name}
        </h1>
        {channel.topic && <span className="hidden truncate text-sm text-muted md:inline">{channel.topic}</span>}
        <div className="flex-1" />
        <SearchBox serverId={serverId} />
        <button onClick={toggleMembers} className="hidden p-1 text-muted hover:text-fg lg:block" title={t("server.members")}>
          👥
        </button>
      </header>

      <div ref={scroller} onScroll={onScroll} className="scroll-thin flex-1 overflow-y-auto pb-2">
        {data && !data.hasMore && (
          <div className="px-4 pb-4 pt-10">
            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-surface text-3xl">#</div>
            <h2 className="text-2xl font-bold" dir="auto">
              {t("channel.welcome", { name: channel.name })}
            </h2>
            <p className="text-muted">{t("channel.welcomeSub")}</p>
          </div>
        )}
        {data?.loading && <div className="py-4 text-center text-sm text-muted">{t("common.loading")}</div>}
        {items.map((m, i) => {
          const prev = items[i - 1];
          const grouped =
            !!prev &&
            prev.author.id === m.author.id &&
            !m.replyToId &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
          return (
            <MessageItem
              key={m.nonce ?? m.id}
              message={m}
              grouped={grouped}
              serverId={serverId}
              replyTarget={m.replyToId ? byId.get(m.replyToId) : undefined}
              onReply={() => setReplyTo(m)}
            />
          );
        })}
      </div>

      <div className="h-6 px-4 text-xs text-muted">
        {typers.length === 1 && t("message.typingOne", { name: typers[0]!.name })}
        {typers.length > 1 && t("message.typingMany")}
      </div>

      <Composer
        channelId={channelId}
        serverId={serverId}
        channelName={channel.name}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => {
          stickToBottom.current = true;
          setReplyTo(null);
        }}
      />
    </>
  );
}
