"use client";

import { useRef, useState } from "react";
import type { Message } from "@majlis/shared";
import { actions, errorMessage, useT } from "@/lib/store";
import { UploadChips, useUploader } from "./media";

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
  const [dragging, setDragging] = useState(false);
  const lastTyping = useRef(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useUploader(serverId, "attachment");

  const canSend = (text.trim() || uploads.ready.length > 0) && !uploads.busy;

  async function send() {
    const content = text.trim();
    if (!canSend) return;
    const attachments = uploads.ready;
    setText("");
    setError(null);
    uploads.clear();
    lastTyping.current = 0;
    onSent();
    try {
      await actions.sendMessage(channelId, serverId, content, replyTo?.id, attachments);
    } catch (err) {
      setError(errorMessage(err));
    }
    ref.current?.focus();
  }

  return (
    <div
      className="relative px-4 pb-4"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void uploads.add(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 top-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-brand bg-brand/10 text-brand">
          {t("files.dropHere")}
        </div>
      )}
      {replyTo && (
        <div className="flex items-center justify-between rounded-t-lg bg-surface/60 px-3 py-1.5 text-xs text-muted">
          <span>{t("message.replyingTo", { name: replyTo.author.displayName })}</span>
          <button onClick={onCancelReply} className="hover:text-fg">
            ✕
          </button>
        </div>
      )}
      <div className={`bg-surface px-3 pt-2 ${replyTo ? "rounded-b-lg" : "rounded-lg"}`}>
        <UploadChips items={uploads.items} onRemove={uploads.remove} />
        <div className="flex items-end gap-2 pb-2">
          <button
            onClick={() => fileInput.current?.click()}
            title={t("files.attach")}
            aria-label={t("files.attach")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/30 text-lg leading-none text-fg hover:bg-brand hover:text-white"
          >
            +
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void uploads.add(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            ref={ref}
            dir="auto"
            rows={1}
            value={text}
            maxLength={4000}
            placeholder={t("message.placeholder", { channel: channelName })}
            onPaste={(e) => {
              // Paste screenshots straight into the chat.
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void uploads.add(e.clipboardData.files);
              }
            }}
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
            disabled={!canSend}
            className="rounded-md px-2 py-1 text-brand disabled:opacity-30"
            aria-label="send"
          >
            {/* Paper plane points toward reading direction. */}
            <span className="flip-rtl inline-block text-lg">➤</span>
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
