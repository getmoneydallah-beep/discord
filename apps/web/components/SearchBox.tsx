"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Message } from "@majlis/shared";
import { formatDate } from "@majlis/i18n";
import { api, useApp, useT } from "@/lib/store";

/** Arabic-aware server search (normalisation happens server-side). */
export function SearchBox({ serverId }: { serverId: string }) {
  const t = useT();
  const locale = useApp((s) => s.prefs.locale);
  const channels = useApp((s) => s.serverState[serverId]?.channels ?? []);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return setResults(null);
    setResults(await api.search(serverId, q).catch(() => []));
  }

  return (
    <div className="relative">
      <form onSubmit={run}>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value) setResults(null);
          }}
          placeholder={t("message.search")}
          dir="auto"
          className="w-28 rounded-md bg-rail px-2 py-1 text-sm outline-none transition-all focus:w-48 md:w-36 md:focus:w-60"
        />
      </form>
      {results && (
        <div className="scroll-thin absolute end-0 top-9 z-20 max-h-96 w-80 overflow-y-auto rounded-lg border border-line bg-sidebar p-2 shadow-xl">
          {results.length === 0 && <div className="p-2 text-sm text-muted">—</div>}
          {results.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setResults(null);
                router.push(`/s/${serverId}/${m.channelId}`);
              }}
              className="block w-full rounded p-2 text-start hover:bg-surface"
            >
              <div className="flex justify-between text-xs text-muted">
                <span>
                  {m.author.displayName} · #{channels.find((c) => c.id === m.channelId)?.name}
                </span>
                <span>{formatDate(m.createdAt, locale)}</span>
              </div>
              <div dir="auto" className="bidi line-clamp-2 text-sm">
                {m.content}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
