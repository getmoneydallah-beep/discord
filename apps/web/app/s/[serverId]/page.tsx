"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatTime } from "@majlis/i18n";
import type { Course, Message } from "@majlis/shared";
import { actions, api, useApp, useLocale, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cx } from "@/components/ui";
import { OfferCard, useOffers } from "@/components/pay/shared";
import { ProgressBar, useNum } from "@/components/course/CourseOutline";

/**
 * The home of a majlis: what's here, what's new, where to continue.
 * Students land here after joining.
 */
export default function ServerHome() {
  const t = useT();
  const num = useNum();
  const locale = useLocale();
  const { serverId } = useParams<{ serverId: string }>();
  const server = useApp((s) => s.servers.find((x) => x.id === serverId));
  const st = useApp((s) => s.serverState[serverId]);
  const courses = useApp((s) => s.courses);
  const setNav = useUi((s) => s.setNav);
  const offers = useOffers(serverId);
  const [announcement, setAnnouncement] = useState<{ channelId: string; message: Message | null } | null>(null);

  const courseChannels = st?.channels.filter((c) => c.type === "course") ?? [];
  const chats = st?.channels.filter((c) => c.type === "text" && c.postPolicy !== "staff") ?? [];
  const announcementChannel = st?.channels.find((c) => c.type === "text" && c.postPolicy === "staff" && !c.locked);
  const courseIds = courseChannels.map((c) => c.id).join(",");

  useEffect(() => {
    for (const id of courseIds.split(",").filter(Boolean)) void actions.loadCourse(id).catch(() => undefined);
  }, [courseIds]);

  useEffect(() => {
    if (!announcementChannel) return setAnnouncement(null);
    api
      .listMessages(announcementChannel.id, { limit: 1 })
      .then((m) => setAnnouncement({ channelId: announcementChannel.id, message: m.at(-1) ?? null }), () => undefined);
  }, [announcementChannel?.id]);

  if (!server || !st) return null;
  const toBuy = (offers ?? []).filter((o) => o.active && !o.owned);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <button onClick={() => setNav(true)} className="p-1 text-xl text-muted md:hidden" aria-label="menu">
          ☰
        </button>
        <span>🏠</span>
        <h1 className="truncate font-bold">{t("home.title")}</h1>
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
          {/* Welcome */}
          <section className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-brand to-[#0b4f38] p-5 text-white">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-2xl font-bold">{[...server.name][0]}</span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold md:text-2xl" dir="auto">
                {t("home.welcome", { name: server.name })}
              </h2>
              <p className="text-sm opacity-90">👥 {t("home.members", { n: num(st.members.length) })}</p>
            </div>
          </section>

          {/* Latest announcement */}
          {announcement?.message && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-bold">📢 {t("home.latestAnnouncement")}</h3>
                <Link href={`/s/${serverId}/${announcement.channelId}`} className="text-sm text-brand hover:underline">
                  {t("home.allAnnouncements")}
                </Link>
              </div>
              <Link
                href={`/s/${serverId}/${announcement.channelId}`}
                className="block rounded-2xl border border-line bg-sidebar p-4 hover:border-brand/50"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                  <bdi className="font-semibold text-fg">{announcement.message.author.displayName}</bdi>
                  <span>{formatTime(announcement.message.createdAt, locale)}</span>
                </div>
                <p className="bidi line-clamp-3 whitespace-pre-wrap" dir="auto">
                  {announcement.message.content}
                </p>
              </Link>
            </section>
          )}

          {/* Courses */}
          <section className="space-y-3">
            <h3 className="font-bold">🎓 {t("home.continue")}</h3>
            {courseChannels.length === 0 && <p className="text-sm text-muted">{t("home.noCourses")}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {courseChannels.map((c) => (
                <CourseCard key={c.id} serverId={serverId} channelId={c.id} name={c.name} course={courses[c.id]} locked={c.locked} />
              ))}
            </div>
          </section>

          {/* Chats */}
          {chats.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-bold">💬 {t("home.talk")}</h3>
              <div className="flex flex-wrap gap-2">
                {chats.map((c) => (
                  <Link
                    key={c.id}
                    href={`/s/${serverId}/${c.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-sidebar px-3 py-1.5 text-sm hover:border-brand hover:text-brand"
                  >
                    <span className="opacity-60">#</span>
                    <bdi>{c.name}</bdi>
                    {c.locked && <span className="text-xs">🔒</span>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Offers */}
          {toBuy.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-bold">✨ {t("home.unlockMore")}</h3>
              {toBuy.map((o) => (
                <OfferCard key={o.id} offer={o} />
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function CourseCard({ serverId, channelId, name, course, locked }: { serverId: string; channelId: string; name: string; course?: Course; locked: boolean }) {
  const t = useT();
  const num = useNum();
  const total = course?.progress.total ?? 0;
  const done = course?.progress.completed ?? 0;
  const finished = total > 0 && done === total;
  const firstOpen = course?.sections.flatMap((s) => s.lessons).find((l) => !l.locked);
  const target = locked ? firstOpen?.id : finished ? undefined : (course?.progress.nextLessonId ?? undefined);
  const href = target ? `/s/${serverId}/${channelId}/${target}` : `/s/${serverId}/${channelId}`;
  return (
    <Link href={href} className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-sidebar hover:border-brand/60">
      <div className="relative aspect-[3/1] bg-gradient-to-br from-brand to-[#0b4f38]">
        {course?.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.cover.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-3xl opacity-80">🎓</span>
        )}
        {locked && <span className="absolute start-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">🔒 {t("home.locked")}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <bdi className="font-bold">{name}</bdi>
        <span className="text-xs text-muted">{t("home.lessons", { n: num(total) })}</span>
        {!locked && total > 0 && <ProgressBar done={done} total={total} />}
        <span
          className={cx(
            "mt-auto self-start rounded-lg px-3 py-1.5 text-sm font-medium",
            locked ? "border border-line text-muted" : "bg-brand text-white group-hover:bg-brand-hover",
          )}
        >
          {locked ? (firstOpen ? `👁 ${t("home.preview")}` : `🔒 ${t("home.locked")}`) : finished ? t("home.review") : done > 0 ? t("home.continue") : t("home.start")}
        </span>
      </div>
    </Link>
  );
}
