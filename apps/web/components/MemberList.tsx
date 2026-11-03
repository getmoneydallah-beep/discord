"use client";

import { useState } from "react";
import { can, outranks, type Member } from "@majlis/shared";
import { api, errorMessage, useApp, useT } from "@/lib/store";
import { Avatar } from "./ui";

export function MemberList({ serverId }: { serverId: string }) {
  const t = useT();
  const st = useApp((s) => s.serverState[serverId]);
  const online = useApp((s) => s.online);
  const meId = useApp((s) => s.me?.id);
  if (!st) return null;

  const on = st.members.filter((m) => online[m.user.id]);
  const off = st.members.filter((m) => !online[m.user.id]);

  return (
    <aside className="scroll-thin hidden w-60 shrink-0 overflow-y-auto bg-sidebar px-2 py-3 lg:block">
      <Section title={`${t("server.online")} — ${on.length}`} members={on} online myRole={st.myRole} meId={meId} serverId={serverId} />
      <Section title={`${t("server.offline")} — ${off.length}`} members={off} myRole={st.myRole} meId={meId} serverId={serverId} />
    </aside>
  );
}

function Section(props: {
  title: string;
  members: Member[];
  online?: boolean;
  myRole: Member["role"];
  meId?: string;
  serverId: string;
}) {
  const { title, members, online, myRole, meId, serverId } = props;
  const t = useT();
  const [menu, setMenu] = useState<string | null>(null);
  if (!members.length) return null;

  async function run(fn: () => Promise<unknown>) {
    setMenu(null);
    try {
      await fn();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  return (
    <div className="mb-4">
      <div className="px-2 pb-1 text-xs font-semibold uppercase text-muted">{title}</div>
      {members.map((m) => {
        const canModerate = m.user.id !== meId && can(myRole, "member.kick") && outranks(myRole, m.role);
        return (
          <div key={m.user.id} className="relative">
            <button
              onClick={() => setMenu(menu === m.user.id ? null : m.user.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-surface ${online ? "" : "opacity-50"}`}
            >
              <Avatar name={m.user.displayName} size={32} online={online} />
              <span className="min-w-0 flex-1 truncate text-sm">
                <bdi>{m.nickname ?? m.user.displayName}</bdi>
              </span>
              {m.role !== "member" && (
                <span className={`text-[10px] ${m.role === "owner" ? "text-accent" : "text-brand"}`}>{t(`roles.${m.role}`)}</span>
              )}
            </button>
            {menu === m.user.id && canModerate && (
              <div className="absolute end-2 top-10 z-10 w-40 rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
                {can(myRole, "member.setRole") && (
                  <MenuItem
                    onClick={() =>
                      run(() => api.setRole(serverId, m.user.id, m.role === "admin" ? "member" : "admin"))
                    }
                  >
                    {m.role === "admin" ? t("mod.removeAdmin") : t("mod.makeAdmin")}
                  </MenuItem>
                )}
                <MenuItem danger onClick={() => run(() => api.kick(serverId, m.user.id))}>
                  {t("mod.kick")}
                </MenuItem>
                <MenuItem danger onClick={() => run(() => api.ban(serverId, m.user.id))}>
                  {t("mod.ban")}
                </MenuItem>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded px-2 py-1.5 text-start hover:bg-surface-hover ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}
