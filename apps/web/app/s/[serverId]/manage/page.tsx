"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { BillingInfo, ServerSummary, WhopConnectionInfo } from "@majlis/shared";
import { api, useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cx } from "@/components/ui";
import { SellingPanel } from "@/components/manage/Selling";
import { useNum } from "@/components/course/CourseOutline";

type Tab = "setup" | "channels" | "selling";

export default function ManagePage() {
  return (
    <Suspense>
      <Manage />
    </Suspense>
  );
}

/** Teacher dashboard: setup checklist, channel permissions, selling. Owners and admins only. */
function Manage() {
  const t = useT();
  const { serverId } = useParams<{ serverId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get("tab") as Tab) || "setup";
  const st = useApp((s) => s.serverState[serverId]);
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const setNav = useUi((s) => s.setNav);

  if (!st || !server) return null;
  if (st.myRole === "member") return <div className="p-8 text-muted">{t("errors.forbidden")}</div>;

  const tabs: [Tab, string, string][] = [
    ["setup", "🚀", t("manage.tabSetup")],
    ["channels", "#", t("manage.tabChannels")],
    ["selling", "💳", t("manage.tabSelling")],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <button onClick={() => setNav(true)} className="p-1 text-xl text-muted md:hidden" aria-label="menu">
          ☰
        </button>
        <span>🧭</span>
        <h1 className="truncate font-bold">{t("manage.title")}</h1>
      </header>
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3" role="tablist">
        {tabs.map(([id, icon, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => router.replace(`/s/${serverId}/manage?tab=${id}`)}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
              tab === id ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {icon} {label}
          </button>
        ))}
      </nav>
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
          {tab === "setup" && <Setup serverId={serverId} />}
          {tab === "channels" && <ChannelsPanel serverId={serverId} />}
          {tab === "selling" && <SellingPanel serverId={serverId} />}
        </div>
      </div>
    </div>
  );
}

function Setup({ serverId }: { serverId: string }) {
  const t = useT();
  const num = useNum();
  const me = useApp((s) => s.me);
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const openModal = useUi((s) => s.openModal);
  const accessVersion = useApp((s) => s.accessVersion[serverId] ?? 0);
  const channelCount = useApp((s) => s.serverState[serverId]?.channels.length ?? 0);
  const firstCourse = useApp((s) => s.serverState[serverId]?.channels.find((c) => c.type === "course"));
  const [summary, setSummary] = useState<ServerSummary | null>(null);
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [whop, setWhop] = useState<WhopConnectionInfo | null>(null);
  const isOwner = server?.ownerId === me?.id;

  useEffect(() => {
    api.serverSummary(serverId).then(setSummary, () => undefined);
    if (isOwner) {
      api.getBilling().then(setBilling, () => undefined);
      api.getWhopConnection().then(setWhop, () => undefined);
    }
  }, [serverId, isOwner, accessVersion, channelCount]);

  if (!summary) return <p className="text-muted">{t("common.loading")}</p>;

  type Step = { id: string; title: string; hint: string; done: boolean; action?: () => void; href?: string; ownerOnly?: boolean };
  const steps: Step[] = [
    { id: "course", title: t("manage.step_course"), hint: t("manage.step_course_hint"), done: summary.courses > 0, action: () => openModal("createCourse") },
    {
      id: "lessons",
      title: t("manage.step_lessons"),
      hint: t("manage.step_lessons_hint"),
      done: summary.lessons >= 3,
      href: firstCourse ? `/s/${serverId}/${firstCourse.id}?edit=1` : undefined,
      action: firstCourse ? undefined : () => openModal("createCourse"),
    },
    { id: "invite", title: t("manage.step_invite"), hint: t("manage.step_invite_hint"), done: summary.members > 1, action: () => openModal("invite") },
    { id: "plan", title: t("manage.step_plan"), hint: t("manage.step_plan_hint"), done: Boolean(billing?.limits.canSell), href: "/s/billing", ownerOnly: true },
    { id: "whop", title: t("manage.step_whop"), hint: t("manage.step_whop_hint"), done: whop?.connection?.status === "active", href: "/s/whop", ownerOnly: true },
    { id: "offer", title: t("manage.step_offer"), hint: t("manage.step_offer_hint"), done: summary.offers > 0, href: `/s/${serverId}/manage?tab=selling`, ownerOnly: true },
  ];
  const visible = isOwner ? steps : steps.filter((s) => !s.ownerOnly);
  const done = visible.filter((s) => s.done).length;
  // The first unfinished step is the one to do now.
  const current = visible.find((s) => !s.done)?.id;

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {[
          [t("manage.members"), summary.members],
          [t("manage.courses"), summary.courses],
          [t("manage.subscribers"), summary.subscribers],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-2xl border border-line bg-sidebar p-4 text-center">
            <div className="text-2xl font-bold">{num(value as number)}</div>
            <div className="text-xs text-muted">{label}</div>
          </div>
        ))}
      </div>

      <section className="space-y-3 rounded-2xl border border-line bg-sidebar p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{t("manage.setupTitle")}</h2>
          <span className="text-sm text-muted">{t("manage.progress", { done: num(done), total: num(visible.length) })}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(done / visible.length) * 100}%` }} />
        </div>
        {done === visible.length ? (
          <p className="rounded-xl bg-success/15 p-4 font-medium text-success">{t("manage.allDone")}</p>
        ) : null}
        <ol className="space-y-2">
          {visible.map((s, i) => {
            const isCurrent = s.id === current;
            const cta = (
              <span
                className={cx(
                  "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium",
                  isCurrent ? "bg-brand text-white" : "border border-line text-muted",
                )}
              >
                {t("manage.doIt")}
              </span>
            );
            return (
              <li
                key={s.id}
                className={cx("flex items-center gap-3 rounded-xl border p-3", isCurrent ? "border-brand bg-bg" : "border-transparent")}
              >
                <span
                  className={cx(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    s.done ? "bg-success text-white" : isCurrent ? "bg-brand text-white" : "border-2 border-line text-muted",
                  )}
                >
                  {s.done ? "✓" : num(i + 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block font-semibold", s.done && "text-muted line-through")}>{s.title}</span>
                  {!s.done && <span className="block text-sm text-muted">{s.hint}</span>}
                </span>
                {!s.done &&
                  (s.href ? (
                    <Link href={s.href}>{cta}</Link>
                  ) : (
                    <button onClick={s.action}>{cta}</button>
                  ))}
              </li>
            );
          })}
        </ol>
        {isOwner && done < 3 && <p className="text-xs text-muted">{t("manage.freeNote")}</p>}
      </section>
    </>
  );
}

function ChannelsPanel({ serverId }: { serverId: string }) {
  const t = useT();
  const channels = useApp((s) => s.serverState[serverId]?.channels ?? []);
  const openModal = useUi((s) => s.openModal);
  const list = channels.filter((c) => c.type !== "category");
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted">{t("manage.channelsHint")}</p>
        <button onClick={() => openModal("createChannel")} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          + {t("channel.new")}
        </button>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-sidebar">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="w-6 text-center text-lg">{c.type === "course" ? "🎓" : c.postPolicy === "staff" ? "📢" : "#"}</span>
            <Link href={`/s/${serverId}/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline" dir="auto">
              {c.name}
            </Link>
            <span className={cx("rounded-md px-2 py-0.5 text-xs", c.access === "paid" ? "bg-brand/10 text-brand" : "bg-surface text-muted")}>
              {c.access === "paid" ? `🔒 ${t("pay.paid")}` : `🟢 ${t("pay.free")}`}
            </span>
            {c.type === "text" && (
              <span className="rounded-md bg-surface px-2 py-0.5 text-xs text-muted">
                {c.postPolicy === "staff" ? `📢 ${t("channel.postStaff")}` : `💬 ${t("channel.postEveryone")}`}
              </span>
            )}
            <button
              onClick={() => openModal("channelSettings", c.id)}
              className="rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover"
              aria-label={t("channel.settings")}
              title={t("channel.settings")}
            >
              ⚙
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
