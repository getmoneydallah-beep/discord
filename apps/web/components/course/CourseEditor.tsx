"use client";

import { useRef, useState } from "react";
import { formatDuration, type Course, type CourseSection, type LessonSummary } from "@majlis/shared";
import { actions, api, errorMessage, useT } from "@/lib/store";
import { Button, Input } from "../ui";
import { useNum } from "./CourseOutline";
import { setCover } from "./CourseView";
import { LessonEditor } from "./LessonEditor";

type EditTarget = { sectionId: string; lessonId?: string } | null;

/**
 * Admin view of a course: details, cover, sections and lessons with simple
 * up/down ordering. Every change saves immediately; there is no separate
 * "publish" step to forget.
 */
export function CourseEditor({ course, serverId, onDeleted }: { course: Course; serverId: string; onDeleted: () => void }) {
  const t = useT();
  const num = useNum();
  const [name, setName] = useState(course.name);
  const [description, setDescription] = useState(course.description);
  const [savingDetails, setSavingDetails] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [newSection, setNewSection] = useState("");
  const [lessonTarget, setLessonTarget] = useState<EditTarget>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const dirty = name.trim() !== course.name || description !== course.description;

  async function run<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (err) {
      alert(errorMessage(err));
    }
  }

  const order = (sections: CourseSection[]) =>
    run(async () => {
      await api.reorderCourse(
        course.id,
        sections.map((s) => ({ id: s.id, lessonIds: s.lessons.map((l) => l.id) })),
      );
      await actions.loadCourse(course.id);
    });

  function moveSection(i: number, dir: -1 | 1) {
    const s = [...course.sections];
    const j = i + dir;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j]!, s[i]!];
    void order(s);
  }

  /** Moves a lesson within its section, or into the neighbouring section at the edges. */
  function moveLesson(si: number, li: number, dir: -1 | 1) {
    const s = course.sections.map((x) => ({ ...x, lessons: [...x.lessons] }));
    const lessons = s[si]!.lessons;
    const j = li + dir;
    if (j >= 0 && j < lessons.length) {
      [lessons[li], lessons[j]] = [lessons[j]!, lessons[li]!];
    } else {
      const target = s[si + dir];
      if (!target) return;
      const [l] = lessons.splice(li, 1);
      if (dir === -1) target.lessons.push(l!);
      else target.lessons.unshift(l!);
    }
    void order(s);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      {/* Details */}
      <section className="space-y-4 rounded-2xl border border-line bg-sidebar p-5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => coverInput.current?.click()}
            className="relative aspect-[3/1] w-40 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-brand to-[#0b4f38] text-xs text-white"
            title={t("course.changeCover")}
          >
            {course.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={course.cover.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="text-3xl">🎓</span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5">{coverBusy ? "…" : t("course.changeCover")}</span>
          </button>
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setCoverBusy(true);
              await run(() => setCover(course, f));
              setCoverBusy(false);
            }}
          />
          <div className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} label={t("course.name")} maxLength={100} dir="auto" />
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("course.description")}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            dir="auto"
            rows={3}
            maxLength={5000}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-brand"
          />
        </label>
        {dirty && (
          <div className="flex justify-end">
            <Button
              disabled={savingDetails || !name.trim()}
              onClick={async () => {
                setSavingDetails(true);
                await run(async () => {
                  await api.updateCourse(course.id, { name: name.trim(), description });
                  await actions.loadCourse(course.id);
                });
                setSavingDetails(false);
              }}
            >
              {savingDetails ? t("course.saving") : t("common.save")}
            </Button>
          </div>
        )}
      </section>

      {/* Sections & lessons */}
      {course.sections.map((section, si) => (
        <section key={section.id} className="overflow-hidden rounded-2xl border border-line bg-sidebar">
          <SectionHeader
            section={section}
            index={si}
            first={si === 0}
            last={si === course.sections.length - 1}
            onMove={(d) => moveSection(si, d)}
            onRename={(title) =>
              run(async () => {
                await api.renameSection(section.id, title);
                await actions.loadCourse(course.id);
              })
            }
            onDelete={() =>
              confirm(t("course.confirmDelete")) &&
              run(async () => {
                await api.deleteSection(section.id);
                await actions.loadCourse(course.id);
              })
            }
          />
          <ol>
            {section.lessons.map((lesson, li) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                canUp={li > 0 || si > 0}
                canDown={li < section.lessons.length - 1 || si < course.sections.length - 1}
                onMove={(d) => moveLesson(si, li, d)}
                onEdit={() => setLessonTarget({ sectionId: section.id, lessonId: lesson.id })}
                onDelete={() =>
                  confirm(t("course.confirmDelete")) &&
                  run(async () => {
                    await api.deleteLesson(lesson.id);
                    await actions.loadCourse(course.id);
                  })
                }
                duration={lesson.durationSeconds ? num(formatDuration(lesson.durationSeconds)) : null}
              />
            ))}
          </ol>
          <button
            onClick={() => setLessonTarget({ sectionId: section.id })}
            className="w-full border-t border-line px-4 py-3 text-start text-brand hover:bg-brand/10"
          >
            + {t("course.addLesson")}
          </button>
        </section>
      ))}

      <form
        className="flex gap-2 rounded-2xl border border-dashed border-line p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newSection.trim()) return;
          await run(async () => {
            await api.createSection(course.id, newSection.trim());
            await actions.loadCourse(course.id);
          });
          setNewSection("");
        }}
      >
        <Input value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder={t("course.sectionTitle")} maxLength={200} dir="auto" />
        <Button disabled={!newSection.trim()} className="shrink-0">
          + {t("course.addSection")}
        </Button>
      </form>
      {course.sections.length === 0 && <p className="text-center text-sm text-muted">{t("course.emptyAdmin")}</p>}

      <div className="border-t border-line pt-6">
        <Button
          variant="ghost"
          className="text-danger"
          onClick={() =>
            confirm(t("course.confirmDelete")) &&
            run(async () => {
              await api.deleteChannel(course.id);
              onDeleted();
            })
          }
        >
          🗑️ {t("course.deleteCourse")}
        </Button>
      </div>

      {lessonTarget && (
        <LessonEditor
          course={course}
          serverId={serverId}
          sectionId={lessonTarget.sectionId}
          lessonId={lessonTarget.lessonId}
          onClose={() => setLessonTarget(null)}
        />
      )}
    </div>
  );
}

function SectionHeader(props: {
  section: CourseSection;
  index: number;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const num = useNum();
  const [title, setTitle] = useState(props.section.title);
  return (
    <header className="flex items-center gap-2 border-b border-line px-4 py-3">
      <span className="font-bold text-muted">{num(props.index + 1)}.</span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== props.section.title && props.onRename(title.trim())}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        dir="auto"
        maxLength={200}
        className="min-w-0 flex-1 rounded bg-transparent px-1 font-bold outline-none focus:bg-bg"
        aria-label={t("course.sectionTitle")}
      />
      <IconBtn title={t("course.moveUp")} disabled={props.first} onClick={() => props.onMove(-1)}>
        ↑
      </IconBtn>
      <IconBtn title={t("course.moveDown")} disabled={props.last} onClick={() => props.onMove(1)}>
        ↓
      </IconBtn>
      <IconBtn title={t("course.deleteSection")} onClick={props.onDelete}>
        🗑️
      </IconBtn>
    </header>
  );
}

function LessonRow(props: {
  lesson: LessonSummary;
  canUp: boolean;
  canDown: boolean;
  duration: string | null;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { lesson } = props;
  return (
    <li className="flex items-center gap-2 px-4 py-2 hover:bg-surface-hover">
      <span className="w-6 text-center text-muted">{lesson.hasVideo ? "▶" : "📝"}</span>
      <button onClick={props.onEdit} className="min-w-0 flex-1 text-start">
        <bdi className="block truncate">{lesson.title}</bdi>
        <span className="text-xs text-muted" dir="ltr">
          {props.duration}
          {lesson.attachmentCount > 0 && ` · 📎 ${lesson.attachmentCount}`}
        </span>
      </button>
      <IconBtn title={t("course.editLesson")} onClick={props.onEdit}>
        ✏️
      </IconBtn>
      <IconBtn title={t("course.moveUp")} disabled={!props.canUp} onClick={() => props.onMove(-1)}>
        ↑
      </IconBtn>
      <IconBtn title={t("course.moveDown")} disabled={!props.canDown} onClick={() => props.onMove(1)}>
        ↓
      </IconBtn>
      <IconBtn title={t("course.deleteLesson")} onClick={props.onDelete}>
        🗑️
      </IconBtn>
    </li>
  );
}

function IconBtn({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 shrink-0 rounded-md text-muted hover:bg-surface hover:text-fg disabled:opacity-25"
    >
      {children}
    </button>
  );
}
