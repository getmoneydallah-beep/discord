"use client";

import { memo, useState } from "react";
import { can, toEasternDigits, type Message } from "@majlis/shared";
import type { PendingMessage } from "@majlis/api-client/store";
import { formatDate, formatTime } from "@majlis/i18n";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { Avatar, cx } from "./ui";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🤲", "🔥", "✅"];

export const MessageItem = memo(function MessageItem(props: {
  message: PendingMessage;
  grouped: boolean;
  serverId: string;
  replyTarget?: Message;
  onReply: () => void;
}) {
  const { message: m, grouped, serverId, replyTarget, onReply } = props;
  const t = useT();
  const locale = useApp((s) => s.prefs.locale);
  const eastern = useApp((s) => s.prefs.easternDigits);
  const meId = useApp((s) => s.me?.id);
  const myRole = useApp((s) => s.serverState[serverId]?.myRole ?? "member");
  const online = useApp((s) => Boolean(s.online[m.author.id]));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [picker, setPicker] = useState(false);

  const mine = m.author.id === meId;
  const canDelete = mine || can(myRole, "message.deleteOthers");
  const time = formatTime(m.createdAt, locale, { easternDigits: eastern });

  async function saveEdit() {
    const content = draft.trim();
    setEditing(false);
    if (!content || content === m.content) return;
    try {
      await actions.editMessage(m, content);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function remove() {
    if (!confirm(t("message.deleteConfirm"))) return;
    try {
      await actions.deleteMessage(m);
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  async function report() {
    const reason = prompt(t("message.reportReason"));
    if (!reason?.trim()) return;
    try {
      await api.reportMessage(m.id, reason.trim());
      alert(t("message.reported"));
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  return (
    <div
      className={cx(
        "group relative flex gap-3 px-4 hover:bg-surface/50",
        grouped ? "py-0.5" : "mt-3 py-1",
        m.pending && "opacity-60",
      )}
    >
      <div className="w-10 shrink-0">
        {!grouped ? (
          <Avatar name={m.author.displayName} online={online} />
        ) : (
          <span className="invisible text-[10px] text-muted group-hover:visible">{time}</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {replyTarget && (
          <div className="mb-0.5 flex items-center gap-1 text-xs text-muted">
            <span className="flip-rtl">↱</span>
            <span className="font-medium">{replyTarget.author.displayName}</span>
            <span className="bidi truncate">{replyTarget.content.slice(0, 80)}</span>
          </div>
        )}
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="font-medium" dir="auto">
              {m.author.displayName}
            </span>
            <time className="text-xs text-muted" title={formatDate(m.createdAt, locale)} dateTime={m.createdAt}>
              {time}
            </time>
          </div>
        )}

        {editing ? (
          <div className="space-y-1">
            <textarea
              autoFocus
              dir="auto"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-full resize-none rounded-lg bg-surface p-2 outline-none"
              rows={Math.min(6, draft.split("\n").length)}
            />
            <div className="text-xs text-muted">Enter ↵ {t("common.save")} · Esc {t("common.cancel")}</div>
          </div>
        ) : (
          // dir="auto" + unicode-bidi: plaintext → each message/paragraph picks its own direction.
          <div dir="auto" className={cx("bidi", m.failed && "text-danger")}>
            {eastern ? toEasternDigits(m.content) : m.content}
            {m.editedAt && <span className="ms-1 text-[10px] text-muted">{t("message.edited")}</span>}
          </div>
        )}

        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => void actions.toggleReaction(m, r.emoji)}
                className={cx(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm",
                  r.me ? "border-brand bg-brand/15" : "border-line bg-surface hover:border-muted",
                )}
              >
                <span>{r.emoji}</span>
                <span className="text-xs">{eastern ? toEasternDigits(String(r.count)) : r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!m.pending && !editing && (
        <div className="absolute -top-4 end-4 hidden items-center rounded-lg border border-line bg-sidebar shadow group-hover:flex">
          <ToolButton title="+" onClick={() => setPicker((p) => !p)}>
            😊
          </ToolButton>
          {!m.failed && (
            <ToolButton title={t("message.reply")} onClick={onReply}>
              <span className="flip-rtl inline-block">↩</span>
            </ToolButton>
          )}
          {mine && !m.failed && (
            <ToolButton title={t("message.edit")} onClick={() => (setDraft(m.content), setEditing(true))}>
              ✏️
            </ToolButton>
          )}
          {!mine && (
            <ToolButton title={t("message.report")} onClick={() => void report()}>
              🚩
            </ToolButton>
          )}
          {canDelete && (
            <ToolButton title={t("message.delete")} onClick={() => void remove()}>
              🗑️
            </ToolButton>
          )}
          {picker && (
            <div className="absolute end-0 top-9 z-10 flex gap-1 rounded-lg border border-line bg-sidebar p-1 shadow-lg">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  className="rounded p-1 text-lg hover:bg-surface-hover"
                  onClick={() => {
                    setPicker(false);
                    void actions.toggleReaction(m, e);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function ToolButton({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} className="px-2 py-1 text-sm hover:bg-surface-hover">
      {children}
    </button>
  );
}
