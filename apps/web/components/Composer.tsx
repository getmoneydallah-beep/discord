"use client";

import { useRef, useState } from "react";
import type { Message } from "@majlis/shared";
import { actions, errorMessage, useT } from "@/lib/store";

export function Composer(props: {
  channelId: string;
  serverId: string;
  channelName: string;
  replyTo: Message | null;
  onCancelReply: () => void;
  onSent: () => void;
}) {
  const { channelId, serverId, channelName, replyTo, onCancelReply, onSent } = props;
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastTyping = useRef(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const content = text.trim();
    if (!content) return;
    setText("");
    setError(null);
    lastTyping.current = 0;
    onSent();
    try {
      await actions.sendMessage(channelId, serverId, content, replyTo?.id);
    } catch (err) {
      setError(errorMessage(err));
    }
    ref.current?.focus();
  }

  return (
    <div className="px-4 pb-4">
      {replyTo && (
        <div className="flex items-center justify-between rounded-t-lg bg-surface/60 px-3 py-1.5 text-xs text-muted">
          <span>{t("message.replyingTo", { name: replyTo.author.displayName })}</span>
          <button onClick={onCancelReply} className="hover:text-fg">
            ✕
          </button>
        </div>
      )}
      <div className={`flex items-end gap-2 bg-surface px-3 py-2 ${replyTo ? "rounded-b-lg" : "rounded-lg"}`}>
        <textarea
          ref={ref}
          dir="auto"
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={t("message.placeholder", { channel: channelName })}
          onChange={(e) => {
            setText(e.target.value);
            const now = Date.now();
            if (e.target.value && now - lastTyping.current > 3000) {
              lastTyping.current = now;
              actions.sendTyping(channelId);
            }
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter adds a new line. Skip while an IME is composing.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
            if (e.key === "Escape" && replyTo) onCancelReply();
          }}
          className="max-h-48 min-h-[1.6em] flex-1 resize-none bg-transparent outline-none placeholder:text-muted [field-sizing:content]"
        />
        <button
          onClick={() => void send()}
          disabled={!text.trim()}
          className="rounded-md px-2 py-1 text-brand disabled:opacity-30"
          aria-label="send"
        >
          {/* Paper plane points toward reading direction. */}
          <span className="flip-rtl inline-block text-lg">➤</span>
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
