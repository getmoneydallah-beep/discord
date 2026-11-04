"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { can, type Channel } from "@majlis/shared";
import { actions, errorMessage, useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { Avatar, cx } from "./ui";

export function ChannelSidebar({ serverId }: { serverId: string }) {
  const t = useT();
  const { channelId } = useParams<{ channelId?: string }>();
  const pathname = usePathname();
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
  const onManage = pathname.endsWith("/manage");
  const onHome = pathname === `/s/${serverId}`;
  // On phones the sidebar is a drawer whenever a page (home, channel or dashboard) is open.
  const pageOpen = Boolean(channelId) || onManage || onHome;

  return (
    <aside className={cx("w-60 shrink-0 flex-col bg-sidebar", pageOpen && !navOpen ? "hidden md:flex" : "flex flex-1 md:flex-none")}>
      <header className="flex h-12 items-center gap-2 border-b border-line px-3">
        <span className="min-w-0 flex-1 truncate font-bold" dir="auto">
          {server.name}
        </span>
        <button
          onClick={() => openModal("invite")}
          className="shrink-0 whitespace-nowrap rounded-md bg-brand/10 px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/20"
          title={t("server.invite")}
        >
          + {t("server.invite")}
        </button>
        <ServerMenu serverId={serverId} />
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
        <Link
          href={`/s/${serverId}`}
          onClick={() => setNav(false)}
          className={cx(
            "mb-1 flex items-center gap-2 rounded-md px-2 py-1.5",
            onHome ? "bg-surface-hover font-semibold text-fg" : "text-muted hover:bg-surface hover:text-fg",
          )}
        >
          <span className="w-5 text-center">🏠</span> <span>{t("home.title")}</span>
        </Link>
        {canManage && (
          <Link
            href={`/s/${serverId}/manage`}
            onClick={() => setNav(false)}
            className={cx(
              "mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold",
              onManage ? "bg-brand text-white" : "bg-brand/10 text-brand hover:bg-brand/20",
            )}
          >
            🧭 <span>{t("manage.open")}</span>
          </Link>
        )}

        <SectionTitle title={t("channel.textChannels")} onAdd={canManage ? () => openModal("createChannel") : undefined} addLabel={t("channel.new")} />
        {textChannels.map((c) => (
          <ChannelRow key={c.id} channel={c} active={c.id === channelId} canManage={canManage} />
        ))}

        {(courses.length > 0 || canManage) && (
          <SectionTitle title={t("course.courses")} onAdd={canManage ? () => openModal("createCourse") : undefined} addLabel={t("course.create")} className="pt-4" />
        )}
        {courses.map((c) => (
          <ChannelRow key={c.id} channel={c} active={c.id === channelId} canManage={canManage} />
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
          <Link href="/s/settings" className="text-muted hover:text-fg" title={t("common.settings")}>
            ⚙
          </Link>
        </footer>
      )}
    </aside>
  );
}

/** ⋯ menu next to the server name: leave (members and admins) or delete (owner). */
function ServerMenu({ serverId }: { serverId: string }) {
  const t = useT();
  const router = useRouter();
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const myRole = useApp((s) => s.serverState[serverId]?.myRole);
  const [open, setOpen] = useState(false);
  if (!server || !myRole) return null;
  const isOwner = myRole === "owner";

  async function act() {
    setOpen(false);
    const msg = isOwner ? `${t("server.delete")}: ${server!.name}?` : t("serverMenu.leaveConfirm", { name: server!.name });
    if (!confirm(msg)) return;
    try {
      if (isOwner) await actions.deleteServer(serverId);
      else await actions.leaveServer(serverId);
      router.push("/s");
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("serverMenu.menu")}
        title={t("serverMenu.menu")}
        aria-expanded={open}
        className="rounded-md px-1.5 py-1 text-muted hover:bg-surface hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-hidden onClick={() => setOpen(false)} tabIndex={-1} />
          <div className="absolute end-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-line bg-sidebar py-1 shadow-xl">
            <button onClick={act} className="block w-full px-3 py-2 text-start text-sm text-danger hover:bg-danger/10">
              {isOwner ? `🗑️ ${t("server.delete")}` : `🚪 ${t("serverMenu.leave")}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SectionTitle({ title, onAdd, addLabel, className }: { title: string; onAdd?: () => void; addLabel: string; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between px-2 pb-1 text-xs font-semibold uppercase text-muted", className)}>
      <span>{title}</span>
      {onAdd && (
        <button onClick={onAdd} title={addLabel} aria-label={addLabel} className="rounded px-1 text-base hover:bg-surface hover:text-fg">
          +
        </button>
      )}
    </div>
  );
}

function ChannelRow({ channel: c, active, canManage }: { channel: Channel; active: boolean; canManage: boolean }) {
  const t = useT();
  const setNav = useUi((s) => s.setNav);
  const openModal = useUi((s) => s.openModal);
  const icon = c.type === "course" ? "🎓" : c.postPolicy === "staff" ? "📢" : "#";
  return (
    <div
      className={cx(
        "group flex items-center rounded-md",
        active ? "bg-surface-hover text-fg" : "text-muted hover:bg-surface hover:text-fg",
      )}
    >
      <Link href={`/s/${c.serverId}/${c.id}`} onClick={() => setNav(false)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5">
        <span className={cx("w-5 shrink-0 text-center", icon === "#" && "text-lg opacity-60")}>{icon}</span>
        <span className="flex-1 truncate" dir="auto">
          {c.name}
        </span>
        {c.access === "paid" && <span className={cx("text-xs", !c.locked && "opacity-50")}>🔒</span>}
      </Link>
      {canManage && (
        <button
          onClick={() => openModal("channelSettings", c.id)}
          title={t("channel.settings")}
          aria-label={t("channel.settings")}
          className="me-1 rounded px-1.5 py-1 text-sm hover:bg-surface-hover focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          ⚙
        </button>
      )}
    </div>
  );
}
