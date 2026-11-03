"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cx } from "./ui";

/** Vertical list of servers on the start edge (right side in Arabic). */
export function ServerRail() {
  const servers = useApp((s) => s.servers);
  const { serverId } = useParams<{ serverId?: string }>();
  const navOpen = useUi((s) => s.navOpen);
  const openModal = useUi((s) => s.openModal);
  const t = useT();

  return (
    <nav
      className={cx(
        "scroll-thin w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-3",
        serverId && !navOpen ? "hidden md:flex" : "flex",
      )}
    >
      {servers.map((s) => {
        const active = s.id === serverId;
        return (
          <Link
            key={s.id}
            href={`/s/${s.id}`}
            title={s.name}
            className={cx(
              "flex h-12 w-12 items-center justify-center text-lg font-bold transition-all",
              active ? "rounded-2xl bg-brand text-white" : "rounded-3xl bg-surface text-fg hover:rounded-2xl hover:bg-brand hover:text-white",
            )}
          >
            {[...s.name.trim()][0]}
          </Link>
        );
      })}
      <div className="my-1 h-px w-8 bg-line" />
      <button
        onClick={() => openModal("createServer")}
        title={t("server.create")}
        className="flex h-12 w-12 items-center justify-center rounded-3xl bg-surface text-2xl text-success transition-all hover:rounded-2xl hover:bg-success hover:text-white"
      >
        +
      </button>
      <button
        onClick={() => openModal("joinServer")}
        title={t("server.join")}
        className="flex h-12 w-12 items-center justify-center rounded-3xl bg-surface text-xl text-success transition-all hover:rounded-2xl hover:bg-success hover:text-white"
      >
        ⤵
      </button>
      <div className="flex-1" />
      <button
        onClick={() => openModal("settings")}
        title={t("common.settings")}
        className="flex h-12 w-12 items-center justify-center rounded-3xl bg-surface text-xl text-muted hover:text-fg"
      >
        ⚙
      </button>
    </nav>
  );
}
