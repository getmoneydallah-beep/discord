"use client";

import { ApiError } from "@majlis/api-client";
import { LockedPanel } from "../pay/shared";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseVideoEmbed, type Lesson } from "@majlis/shared";
import { actions, api, errorMessage, useApp, useT } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cx } from "../ui";
import { EmbedFrame, FileCard } from "../media";
import { CourseOutline, ProgressBar, useNum } from "./CourseOutline";

/**
 * Watching a lesson: the video first, then notes and files, then one big
 * "I finished — next" button. The video resumes where you stopped and
 * completes the lesson automatically when it ends.
 */
export function LessonView({ serverId, courseId, lessonId }: { serverId: string; courseId: string; lessonId: string }) {
  const t = useT();
  const num = useNum();
  const router = useRouter();
  const course = useApp((s) => s.courses[courseId]);
  const setNav = useUi((s) => s.setNav);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const accessVersion = useApp((s) => s.accessVersion[serverId] ?? 0);
  const [showOutline, setShowOutline] = useState(false);
  const [justFinished, setJustFinished] = useState(false);

  useEffect(() => {
    setLesson(null);
    setJustFinished(false);
    setLocked(false);
    setError(null);
    api.getLesson(lessonId).then(setLesson, (e) => {
      if (e instanceof ApiError && e.code === "locked") setLocked(true);
      else setError(errorMessage(e));
    });
    if (!course) void actions.loadCourse(courseId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, courseId, accessVersion]);

  // Keep the completion state in sync with the course (e.g. toggled elsewhere).
  const summary = course?.sections.flatMap((s) => s.lessons).find((l) => l.id === lessonId);
  const completed = summary?.completed ?? lesson?.completed ?? false;
  const flat = course?.sections.flatMap((s) => s.lessons) ?? [];
  const index = flat.findIndex((l) => l.id === lessonId);

  const complete = useCallback(
    async (value = true) => {
      await actions.setLessonCompleted(courseId, lessonId, value).catch(() => undefined);
    },
    [courseId, lessonId],
  );

  async function finishAndNext() {
    if (!completed) await complete(true);
    if (lesson?.nextLessonId) router.push(`/s/${serverId}/${courseId}/${lesson.nextLessonId}`);
    else router.push(`/s/${serverId}/${courseId}`);
  }

  if (error) return <div className="p-8 text-danger">{error}</div>;
  if (locked)
    return (
      <div className="scroll-thin flex-1 overflow-y-auto p-4 md:p-10">
        <Link href={`/s/${serverId}/${courseId}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <span className="flip-rtl inline-block">←</span> {course?.name ?? t("course.back")}
        </Link>
        <LockedPanel serverId={serverId} channelId={courseId} />
      </div>
    );

  const embed = lesson?.videoUrl ? parseVideoEmbed(lesson.videoUrl) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <button onClick={() => setNav(true)} className="p-1 text-xl text-muted md:hidden" aria-label="menu">
          ☰
        </button>
        <Link href={`/s/${serverId}/${courseId}`} className="flex min-w-0 items-center gap-1 text-muted hover:text-fg">
          <span className="flip-rtl inline-block">←</span>
          <span className="truncate text-sm">{course?.name ?? t("course.back")}</span>
        </Link>
        <div className="flex-1" />
        {course && (
          <button onClick={() => setShowOutline((v) => !v)} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-surface lg:hidden">
            ☰ {t("course.content")}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          {!lesson ? (
            <div className="p-8 text-muted">{t("common.loading")}</div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
              {lesson.video ? (
                <ResumableVideo lesson={lesson} onEnded={() => (void complete(true), setJustFinished(true))} />
              ) : embed ? (
                <EmbedFrame embed={embed} />
              ) : null}

              {justFinished && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/10 p-4">
                  <span className="font-medium text-success">{t("course.done")}</span>
                  <button onClick={finishAndNext} className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-hover">
                    {lesson.nextLessonId ? <>{t("course.next")} <Next /></> : t("course.finishCourse")}
                  </button>
                </div>
              )}

              <div>
                {index >= 0 && (
                  <p className="text-sm text-muted">
                    {num(index + 1)} / {num(flat.length)}
                  </p>
                )}
                <h1 className="text-2xl font-bold" dir="auto">
                  {lesson.title}
                </h1>
              </div>

              {lesson.body && (
                <section className="space-y-2">
                  <h2 className="text-sm font-semibold text-muted">{t("course.notes")}</h2>
                  <div className="bidi rounded-xl bg-sidebar p-4 leading-relaxed" dir="auto">
                    {lesson.body}
                  </div>
                </section>
              )}

              {lesson.attachments.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-sm font-semibold text-muted">
                    📎 {t("course.files")} ({num(lesson.attachments.length)})
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {lesson.attachments.map((a) => (
                      <FileCard key={a.id} file={a} />
                    ))}
                  </div>
                </section>
              )}

              {/* One primary action, previous as a quiet secondary. */}
              <nav className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center">
                {lesson.prevLessonId ? (
                  <Link
                    href={`/s/${serverId}/${courseId}/${lesson.prevLessonId}`}
                    className="rounded-lg px-4 py-3 text-center text-muted hover:bg-surface hover:text-fg"
                  >
                    <span className="flip-rtl inline-block">←</span> {t("course.prev")}
                  </Link>
                ) : (
                  <span />
                )}
                <div className="flex-1" />
                {completed && (
                  <button onClick={() => void complete(false)} className="text-sm text-muted hover:text-fg">
                    {t("course.markUndone")}
                  </button>
                )}
                <button
                  onClick={finishAndNext}
                  className={cx(
                    "rounded-xl px-6 py-3 text-lg font-bold text-white transition",
                    completed ? "bg-brand hover:bg-brand-hover" : "bg-success hover:opacity-90",
                  )}
                >
                  {!completed ? (
                    lesson.nextLessonId ? (
                      <>
                        {t("course.markDone")} <Next />
                      </>
                    ) : (
                      t("course.finishCourse")
                    )
                  ) : lesson.nextLessonId ? (
                    <>
                      {t("course.next")} <Next />
                    </>
                  ) : (
                    t("course.back")
                  )}
                </button>
              </nav>
            </div>
          )}
        </div>

        {course && (
          <aside
            className={cx(
              "scroll-thin w-80 shrink-0 overflow-y-auto border-s border-line bg-sidebar p-3",
              showOutline ? "fixed inset-y-12 end-0 z-20 shadow-2xl lg:static" : "hidden lg:block",
            )}
          >
            <div className="mb-3 space-y-1 px-1">
              <div className="flex justify-between text-xs text-muted">
                <span>{t("course.progress", { done: num(course.progress.completed), total: num(course.progress.total) })}</span>
              </div>
              <ProgressBar done={course.progress.completed} total={course.progress.total} />
            </div>
            <CourseOutline course={course} serverId={serverId} currentLessonId={lessonId} dense />
          </aside>
        )}
      </div>
    </div>
  );
}

/** Points forward in the reading direction (→ in English, ← in Arabic). */
const Next = () => <span className="flip-rtl ms-1 inline-block">→</span>;

/** Uploaded (R2) video that resumes from the saved position and reports progress. */
function ResumableVideo({ lesson, onEnded }: { lesson: Lesson; onEnded: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0);

  const save = (extra: { durationSeconds?: number } = {}) => {
    const v = ref.current;
    if (!v) return;
    lastSaved.current = Date.now();
    void api.saveProgress(lesson.id, { positionSeconds: Math.floor(v.currentTime), ...extra }).catch(() => undefined);
  };

  useEffect(() => {
    const v = ref.current;
    return () => {
      if (v && v.currentTime > 0) void api.saveProgress(lesson.id, { positionSeconds: Math.floor(v.currentTime) }).catch(() => undefined);
    };
  }, [lesson.id]);

  return (
    <video
      ref={ref}
      key={lesson.id}
      src={lesson.video!.url}
      controls
      playsInline
      preload="metadata"
      className="aspect-video w-full rounded-xl bg-black"
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        // Resume, unless they were basically at the end.
        if (lesson.positionSeconds > 5 && lesson.positionSeconds < v.duration - 10) v.currentTime = lesson.positionSeconds;
        if (!lesson.durationSeconds && Number.isFinite(v.duration)) save({ durationSeconds: Math.round(v.duration) });
      }}
      onTimeUpdate={() => {
        if (Date.now() - lastSaved.current > 10_000) save();
      }}
      onPause={() => save()}
      onEnded={() => {
        save();
        onEnded();
      }}
    />
  );
}
