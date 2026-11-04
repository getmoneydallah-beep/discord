"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { can } from "@majlis/shared";
import { useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { Avatar, cx } from "./ui";

export function ChannelSidebar({ serverId }: { serverId: string }) {
  const t = useT();
  const { channelId } = useParams<{ channelId?: string }>();
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const st = useApp((s) => s.serverState[serverId]);
  const me = useApp((s) => s.me);
  const connection = useApp((s) => s.connection);
  const navOpen = useUi((s) => s.navOpen);
  const setNav = useUi((s) => s.setNav);
  const openModal = useUi((s) => s.openModal);

  if (!st || !server) return null;
  const textChannels = st.channels.filter((c) => c.type === "text");
  const courses = st.channels.filter((c) => c.type === "course");
  const canManage = can(st.myRole, "channel.manage");

  return (
    <aside
      className={cx(
        "w-60 shrink-0 flex-col bg-sidebar",
        // On phones the sidebar is a full-height drawer when a channel is open.
        channelId && !navOpen ? "hidden md:flex" : "flex flex-1 md:flex-none",
      )}
    >
      <header className="flex h-12 items-center justify-between border-b border-line px-4 font-bold">
        <span className="truncate">{server.name}</span>
        <button onClick={() => openModal("invite")} className="text-sm text-brand hover:underline" title={t("server.invite")}>
          {t("server.invite")}
        </button>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
        <div className="flex items-center justify-between px-2 pb-1 text-xs font-semibold uppercase text-muted">
          <span>{t("channel.textChannels")}</span>
          {can(st.myRole, "channel.manage") && (
            <button onClick={() => openModal("createChannel")} title={t("channel.create")} className="text-base hover:text-fg">
              +
            </button>
          )}
        </div>
        {textChannels.map((c) => (
          <Link
            key={c.id}
            href={`/s/${serverId}/${c.id}`}
            onClick={() => setNav(false)}
            className={cx(
              "flex items-center gap-1.5 rounded-md px-2 py-1.5",
              c.id === channelId ? "bg-surface-hover text-fg" : "text-muted hover:bg-surface hover:text-fg",
            )}
          >
            <span className="text-lg opacity-60">#</span>
            <span className="truncate" dir="auto">
              {c.name}
            </span>
          </Link>
        ))}

        {(courses.length > 0 || canManage) && (
          <div className="flex items-center justify-between px-2 pb-1 pt-4 text-xs font-semibold uppercase text-muted">
            <span>{t("course.courses")}</span>
            {canManage && (
              <button onClick={() => openModal("createCourse")} title={t("course.create")} className="text-base hover:text-fg">
                +
              </button>
            )}
          </div>
        )}
        {courses.map((c) => (
          <Link
            key={c.id}
            href={`/s/${serverId}/${c.id}`}
            onClick={() => setNav(false)}
            className={cx(
              "flex items-center gap-1.5 rounded-md px-2 py-1.5",
              c.id === channelId ? "bg-surface-hover text-fg" : "text-muted hover:bg-surface hover:text-fg",
            )}
          >
            <span className="text-base">🎓</span>
            <span className="truncate" dir="auto">
              {c.name}
            </span>
          </Link>
        ))}
        {canManage && courses.length === 0 && (
          <button
            onClick={() => openModal("createCourse")}
            className="mx-2 mt-1 w-[calc(100%-1rem)] rounded-md border border-dashed border-line px-2 py-2 text-start text-sm text-muted hover:border-brand hover:text-brand"
          >
            + {t("course.create")}
          </button>
        )}
      </div>

      {me && (
        <footer className="flex items-center gap-2 bg-rail/60 px-3 py-2">
          <Avatar name={me.displayName} size={32} online={connection === "open"} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{me.displayName}</div>
            <div className="truncate text-xs text-muted" dir="ltr">
              @{me.username}
            </div>
          </div>
          <button onClick={() => openModal("settings")} className="text-muted hover:text-fg" title={t("common.settings")}>
            ⚙
          </button>
        </footer>
      )}
    </aside>
  );
}
