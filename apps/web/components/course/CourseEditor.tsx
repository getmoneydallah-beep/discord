"use client";

import { useRef, useState } from "react";
import { formatDuration, type Course, type CourseSection, type LessonSummary } from "@majlis/shared";
import { actions, api, errorMessage, useT } from "@/lib/store";
import { Button, FieldLabel, Input, cx } from "../ui";
import { useNum } from "./CourseOutline";
import { setCover } from "./CourseView";
import { LessonEditor } from "./LessonEditor";

type EditTarget = { sectionId: string; lessonId?: string } | null;

/**
 * Admin view of a course. Content (sections and lessons) comes first; the
 * course details are a collapsible card. Every change saves immediately.
 */
export function CourseEditor({ course, serverId, onDeleted }: { course: Course; serverId: string; onDeleted: () => void }) {
  const t = useT();
  const num = useNum();
  const [lessonTarget, setLessonTarget] = useState<EditTarget>(null);
  const [addingSection, setAddingSection] = useState(course.sections.length === 0);
  const [newSection, setNewSection] = useState("");
  const lessonCount = course.sections.reduce((n, s) => n + s.lessons.length, 0);

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

  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    if (!newSection.trim()) return;
    await run(async () => {
      await api.createSection(course.id, newSection.trim());
      await actions.loadCourse(course.id);
    });
    setNewSection("");
    setAddingSection(false);
  }

  let counter = 0;
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-8">
      <p className="flex items-center justify-between gap-3 text-sm text-muted">
        <span>
          {t("course.lessons", { count: num(lessonCount) })} · {num(course.sections.length)} {t("course.sectionsLabel")}
        </span>
        <span>✓ {t("course.autosave")}</span>
      </p>

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
          <ol className="divide-y divide-line/60">
            {section.lessons.map((lesson, li) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                number={num(++counter)}
                paidCourse={course.access === "paid"}
                canUp={li > 0 || si > 0}
                canDown={li < section.lessons.length - 1 || si < course.sections.length - 1}
                onMove={(d) => moveLesson(si, li, d)}
                onEdit={() => setLessonTarget({ sectionId: section.id, lessonId: lesson.id })}
                duration={lesson.durationSeconds ? num(formatDuration(lesson.durationSeconds)) : null}
              />
            ))}
          </ol>
          <div className="p-3">
            <button
              onClick={() => setLessonTarget({ sectionId: section.id })}
              className="w-full rounded-xl border-2 border-dashed border-line px-4 py-3 font-medium text-brand hover:border-brand hover:bg-brand/5"
            >
              + {t("course.addLesson")}
            </button>
          </div>
        </section>
      ))}

      {addingSection ? (
        <form onSubmit={addSection} className="space-y-3 rounded-2xl border-2 border-dashed border-brand/50 bg-brand/5 p-4">
          {course.sections.length === 0 && <p className="text-sm">{t("course.emptyAdmin")}</p>}
          <div className="flex gap-2">
            <Input
              value={newSection}
              onChange={(e) => setNewSection(e.target.value)}
              placeholder={t("course.sectionPlaceholder")}
              maxLength={200}
              dir="auto"
              autoFocus
            />
            <Button disabled={!newSection.trim()} className="shrink-0">
              {t("course.addSection")}
            </Button>
            {course.sections.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setAddingSection(false)}>
                ✕
              </Button>
            )}
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAddingSection(true)}
          className="w-full rounded-2xl border-2 border-dashed border-line px-4 py-4 font-medium text-muted hover:border-brand hover:text-brand"
        >
          + {t("course.addSection")}
        </button>
      )}

      <CourseDetails course={course} onDeleted={onDeleted} run={run} />

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

/** Cover, name and description, edited once: a collapsible card below the content. */
function CourseDetails({ course, onDeleted, run }: { course: Course; onDeleted: () => void; run: <T>(fn: () => Promise<T>) => Promise<T | undefined> }) {
  const t = useT();
  const [name, setName] = useState(course.name);
  const [description, setDescription] = useState(course.description);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const dirty = name.trim() !== course.name || description !== course.description;

  return (
    <details className="group rounded-2xl border border-line bg-sidebar" open={!course.description && !course.cover}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <span className="relative aspect-[3/1] w-24 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-brand to-[#0b4f38]">
          {course.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={course.cover.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center text-lg">🎓</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{t("course.details")}</span>
          <span className="block truncate text-sm text-muted" dir="auto">
            {course.description || t("course.description")}
          </span>
        </span>
        <span className="text-muted transition group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        <div className="flex flex-wrap items-end gap-4">
          <button
            onClick={() => coverInput.current?.click()}
            className="relative aspect-[3/1] w-48 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-brand to-[#0b4f38] text-xs text-white"
          >
            {course.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={course.cover.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <span className="text-3xl">🎓</span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-black/50 py-1">{coverBusy ? "…" : `📷 ${t("course.changeCover")}`}</span>
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
          <div className="min-w-48 flex-1">
            <Input value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} label={t("course.name")} maxLength={100} dir="auto" />
          </div>
        </div>
        <label className="block space-y-1">
          <FieldLabel>{t("course.description")}</FieldLabel>
          <textarea
            value={description}
            onChange={(e) => (setDescription(e.target.value), setSaved(false))}
            dir="auto"
            rows={3}
            maxLength={5000}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-brand"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
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
          <div className="flex-1" />
          {saved && <span className="text-sm text-success">{t("channel.saved")}</span>}
          <Button
            disabled={!dirty || saving || !name.trim()}
            onClick={async () => {
              setSaving(true);
              await run(async () => {
                await api.updateCourse(course.id, { name: name.trim(), description });
                await actions.loadCourse(course.id);
              });
              setSaving(false);
              setSaved(true);
            }}
          >
            {saving ? t("course.saving") : t("common.save")}
          </Button>
        </div>
      </div>
    </details>
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
    <header className="group flex items-center gap-2 border-b border-line bg-bg/40 px-4 py-3">
      <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">
        {t("course.sectionN", { n: num(props.index + 1) })}
      </span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== props.section.title && props.onRename(title.trim())}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        dir="auto"
        maxLength={200}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 font-bold outline-none hover:border-line focus:border-brand focus:bg-bg"
        aria-label={t("course.sectionTitle")}
        title={t("course.renameHint")}
      />
      <span className="flex items-center md:opacity-0 md:transition md:group-hover:opacity-100 md:focus-within:opacity-100">
        {!props.first && (
          <IconBtn title={t("course.moveUp")} onClick={() => props.onMove(-1)}>
            ↑
          </IconBtn>
        )}
        {!props.last && (
          <IconBtn title={t("course.moveDown")} onClick={() => props.onMove(1)}>
            ↓
          </IconBtn>
        )}
        <IconBtn title={t("course.deleteSection")} onClick={props.onDelete} danger>
          🗑
        </IconBtn>
      </span>
    </header>
  );
}

function LessonRow(props: {
  lesson: LessonSummary;
  number: string;
  paidCourse: boolean;
  canUp: boolean;
  canDown: boolean;
  duration: string | null;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
}) {
  const t = useT();
  const { lesson } = props;
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-line text-xs font-bold text-muted">{props.number}</span>
      <button onClick={props.onEdit} className="min-w-0 flex-1 text-start" title={t("course.editLesson")}>
        <bdi className="block truncate font-medium">{lesson.title}</bdi>
        <span className="mt-0.5 flex flex-wrap gap-1.5 text-xs">
          {lesson.hasVideo ? (
            <Badge tone="brand">▶ {t("course.video")}</Badge>
          ) : (
            <Badge>📝 {t("course.textLesson")}</Badge>
          )}
          {props.duration && <Badge>⏱ <span dir="ltr">{props.duration}</span></Badge>}
          {lesson.attachmentCount > 0 && <Badge>📎 {lesson.attachmentCount}</Badge>}
          {props.paidCourse && lesson.freePreview && <Badge tone="success">👁 {t("pay.freePreview")}</Badge>}
        </span>
      </button>
      <span className="flex items-center md:opacity-0 md:transition md:group-hover:opacity-100 md:focus-within:opacity-100">
        <IconBtn title={t("course.moveUp")} disabled={!props.canUp} onClick={() => props.onMove(-1)}>
          ↑
        </IconBtn>
        <IconBtn title={t("course.moveDown")} disabled={!props.canDown} onClick={() => props.onMove(1)}>
          ↓
        </IconBtn>
      </span>
      <button onClick={props.onEdit} className="shrink-0 rounded-lg border border-line px-3 py-1 text-sm hover:border-brand hover:text-brand">
        {t("course.editShort")}
      </button>
    </li>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "brand" | "success" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
        tone === "brand" ? "bg-brand/10 text-brand" : tone === "success" ? "bg-success/15 text-success" : "bg-surface text-muted",
      )}
    >
      {children}
    </span>
  );
}

function IconBtn({ children, title, onClick, disabled, danger }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "h-8 w-8 shrink-0 rounded-md text-muted hover:bg-surface disabled:invisible",
        danger ? "hover:text-danger" : "hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
