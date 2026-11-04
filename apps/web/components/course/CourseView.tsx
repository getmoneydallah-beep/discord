"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { can, formatDuration, type Course } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { Button, cx } from "../ui";
import { CourseOutline, ProgressBar, useNum } from "./CourseOutline";
import { CourseEditor } from "./CourseEditor";
import { ChannelHeaderTools, LockedPanel } from "../pay/shared";

/**
 * The course landing page. Learners see one obvious next step (Start /
 * Continue) and a checklist of lessons; admins can switch to edit mode.
 */
export function CourseView({ serverId, courseId }: { serverId: string; courseId: string }) {
  const t = useT();
  const num = useNum();
  const router = useRouter();
  const params = useSearchParams();
  const course = useApp((s) => s.courses[courseId]);
  const channel = useApp((s) => s.serverState[serverId]?.channels.find((c) => c.id === courseId));
  const myRole = useApp((s) => s.serverState[serverId]?.myRole ?? "member");
  const setNav = useUi((s) => s.setNav);
  const canEdit = can(myRole, "channel.manage");
  const [editing, setEditing] = useState(params.get("edit") === "1" && canEdit);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    actions.loadCourse(courseId).catch((e) => setError(errorMessage(e)));
  }, [courseId]);

  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (!course) return <div className="p-8 text-muted">{t("common.loading")}</div>;

  const { completed, total, nextLessonId, lastLessonId } = course.progress;
  const finished = total > 0 && completed === total;
  // One obvious next step: the first unfinished lesson, or the start when reviewing.
  const all = course.sections.flatMap((s) => s.lessons);
  // Locked course: the button goes to the first free preview, if any.
  const target = course.locked
    ? all.find((l) => !l.locked)?.id
    : finished
      ? all[0]?.id
      : nextLessonId;
  const cta = finished ? t("course.review") : completed > 0 || lastLessonId ? t("course.continue") : t("course.start");
  const nextTitle = course.sections.flatMap((s) => s.lessons).find((l) => l.id === target)?.title;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <button onClick={() => setNav(true)} className="p-1 text-xl text-muted md:hidden" aria-label="menu">
          ☰
        </button>
        <span>🎓</span>
        <h1 className="truncate font-bold" dir="auto">
          {course.name}
        </h1>
        <div className="flex-1" />
        {channel && <ChannelHeaderTools channel={channel} />}
        {canEdit && (
          <Button variant={editing ? "primary" : "ghost"} onClick={() => setEditing((e) => !e)} className="py-1">
            {editing ? `👁 ${t("course.studentView")}` : `✏️ ${t("course.edit")}`}
          </Button>
        )}
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        {editing ? (
          <CourseEditor course={course} serverId={serverId} onDeleted={() => router.replace(`/s/${serverId}`)} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
            {/* Hero */}
            <div className="overflow-hidden rounded-2xl border border-line bg-sidebar">
              <div className="relative aspect-[3/1] bg-gradient-to-br from-brand to-[#0b4f38]">
                {course.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={course.cover.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-6xl opacity-80">🎓</div>
                )}
              </div>
              <div className="space-y-4 p-5 md:p-6">
                <div>
                  <h2 className="text-2xl font-bold md:text-3xl" dir="auto">
                    {course.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {total === 1 ? t("course.lessonsOne") : t("course.lessons", { count: num(total) })}
                    {course.totalDurationSeconds > 0 && (
                      <>
                        {" · "}
                        <span dir="ltr">⏱ {num(formatDuration(course.totalDurationSeconds))}</span>
                      </>
                    )}
                  </p>
                </div>
                {course.description && (
                  <p className="bidi text-fg/90" dir="auto">
                    {course.description}
                  </p>
                )}

                {total > 0 && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className={cx(finished && "font-bold text-success")}>
                        {finished ? t("course.finished") : t("course.progress", { done: num(completed), total: num(total) })}
                      </span>
                      <span className="text-muted">{num(Math.round((completed / total) * 100))}٪</span>
                    </div>
                    <ProgressBar done={completed} total={total} />
                  </div>
                )}

                {course.locked && <LockedPanel serverId={serverId} channelId={course.id} className="bg-bg" />}
                {course.locked && !target ? null : target ? (
                  <Link
                    href={`/s/${serverId}/${course.id}/${target}`}
                    className="flex w-full items-center justify-between gap-3 rounded-xl bg-brand px-5 py-4 text-white transition hover:bg-brand-hover"
                  >
                    <span>
                      <span className="block text-lg font-bold">{course.locked ? `👁 ${t("pay.freePreview")}` : cta}</span>
                      {nextTitle && !finished && (
                        <bdi className="block truncate text-sm opacity-90">{nextTitle}</bdi>
                      )}
                    </span>
                    <span className="flip-rtl text-2xl">▶</span>
                  </Link>
                ) : (
                  <p className="rounded-xl border border-dashed border-line p-4 text-center text-muted">
                    {canEdit ? t("course.emptyAdmin") : t("course.empty")}
                  </p>
                )}
              </div>
            </div>

            {total > 0 && (
              <div className="space-y-3">
                <h3 className="text-lg font-bold">{t("course.content")}</h3>
                <CourseOutline course={course} serverId={serverId} currentLessonId={finished ? undefined : (target ?? undefined)} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Small helper so other components can await an upload-backed course update. */
export async function setCover(course: Course, file: File) {
  const up = await api.uploadFile(course.serverId, { name: file.name, type: file.type, size: file.size, body: file }, "course_cover");
  await api.updateCourse(course.id, { coverUploadId: up.id });
  await actions.loadCourse(course.id);
}

export function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t.current);
  }, [value, ms]);
  return v;
}
