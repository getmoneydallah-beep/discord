"use client";

import Link from "next/link";
import { formatDuration, toEasternDigits, type Course, type LessonSummary } from "@majlis/shared";
import { useApp, useT } from "@/lib/store";
import { cx } from "../ui";

export function useNum() {
  const eastern = useApp((s) => s.prefs.easternDigits);
  return (n: number | string) => (eastern ? toEasternDigits(String(n)) : String(n));
}

export function ProgressBar({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-line", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Green check when done, otherwise the lesson number. */
export function LessonStatus({ lesson, index, current }: { lesson: LessonSummary; index: number; current?: boolean }) {
  const num = useNum();
  return (
    <span
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
        lesson.completed ? "bg-success text-white" : current ? "bg-brand text-white" : "border-2 border-line text-muted",
      )}
    >
      {lesson.completed ? "✓" : num(index)}
    </span>
  );
}

/**
 * The list of sections and lessons. Used on the course page and as the
 * sidebar while watching a lesson.
 */
export function CourseOutline({
  course,
  serverId,
  currentLessonId,
  dense,
}: {
  course: Course;
  serverId: string;
  currentLessonId?: string;
  dense?: boolean;
}) {
  const t = useT();
  const num = useNum();
  let counter = 0;

  return (
    <div className={cx("space-y-4", dense && "space-y-2")}>
      {course.sections.map((section, si) => {
        const done = section.lessons.filter((l) => l.completed).length;
        return (
          <section key={section.id} className={cx("overflow-hidden rounded-xl border border-line", !dense && "bg-sidebar")}>
            <header className={cx("flex items-center justify-between gap-2 border-b border-line px-4", dense ? "py-2" : "py-3")}>
              <h3 className={cx("font-bold", dense && "text-sm")} dir="auto">
                <span className="text-muted">{num(si + 1)}. </span>
                {section.title}
              </h3>
              {section.lessons.length > 0 && (
                <span className="shrink-0 text-xs text-muted">
                  {num(done)}/{num(section.lessons.length)}
                </span>
              )}
            </header>
            <ol>
              {section.lessons.map((lesson) => {
                counter++;
                const current = lesson.id === currentLessonId;
                const Row = lesson.locked ? "div" : Link;
                return (
                  <li key={lesson.id}>
                    <Row
                      href={`/s/${serverId}/${course.id}/${lesson.id}`}
                      className={cx(
                        "flex items-center gap-3 px-4 transition-colors",
                        dense ? "py-2" : "py-3",
                        lesson.locked ? "cursor-default opacity-60" : current ? "bg-brand/10" : "hover:bg-surface-hover",
                      )}
                    >
                      <LessonStatus lesson={lesson} index={counter} current={current} />
                      <span className={cx("min-w-0 flex-1", dense && "text-sm")}>
                        <bdi className={cx("block truncate", current && "font-bold text-brand")}>{lesson.title}</bdi>
                        <span className="flex gap-2 text-xs text-muted">
                          {lesson.hasVideo && <span>▶ {t("course.video")}</span>}
                          {lesson.attachmentCount > 0 && <span>📎 {num(lesson.attachmentCount)}</span>}
                          {lesson.freePreview && course.access === "paid" && (
                            <span className="text-brand">👁 {t("pay.freePreview")}</span>
                          )}
                        </span>
                      </span>
                      {lesson.locked && <span className="shrink-0">🔒</span>}
                      {lesson.durationSeconds ? (
                        <span className="shrink-0 text-xs text-muted" dir="ltr">
                          {num(formatDuration(lesson.durationSeconds))}
                        </span>
                      ) : null}
                    </Row>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
