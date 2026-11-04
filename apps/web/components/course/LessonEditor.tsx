"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes, parseVideoEmbed, UPLOAD_LIMITS, type Attachment, type Course } from "@majlis/shared";
import { actions, api, errorMessage, useT } from "@/lib/store";
import { Button, Input, Modal, cx } from "../ui";
import { EmbedFrame, readVideoDuration, UploadChips, useUploader } from "../media";

type VideoMode = "upload" | "link" | "none";

/** Create or edit one lesson: title, video (upload to R2 or a YouTube/Vimeo link), notes, files. */
export function LessonEditor(props: {
  course: Course;
  serverId: string;
  sectionId: string;
  lessonId?: string;
  onClose: () => void;
}) {
  const { course, serverId, sectionId, lessonId, onClose } = props;
  const t = useT();
  const [loaded, setLoaded] = useState(!lessonId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<VideoMode>("upload");
  const [link, setLink] = useState("");
  const [video, setVideo] = useState<Attachment | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [freePreview, setFreePreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileUploads = useUploader(serverId, "lesson_file");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!lessonId) return;
    api.getLesson(lessonId).then((l) => {
      setTitle(l.title);
      setBody(l.body);
      setVideo(l.video);
      setLink(l.videoUrl ?? "");
      setDuration(l.durationSeconds);
      setMode(l.video ? "upload" : l.videoUrl ? "link" : "none");
      setFiles(l.attachments);
      setFreePreview(l.freePreview);
      setLoaded(true);
    }, (e) => setError(errorMessage(e)));
    return () => abort.current?.abort();
  }, [lessonId]);

  async function pickVideo(file: File) {
    setVideoError(null);
    if (file.size > UPLOAD_LIMITS.lesson_video) {
      setVideoError(t("files.tooLarge", { max: formatBytes(UPLOAD_LIMITS.lesson_video) }));
      return;
    }
    setDuration(await readVideoDuration(file));
    setVideoProgress(0);
    abort.current = new AbortController();
    try {
      const up = await api.uploadFile(serverId, { name: file.name, type: file.type || "video/mp4", size: file.size, body: file }, "lesson_video", {
        onProgress: setVideoProgress,
        signal: abort.current.signal,
      });
      setVideo(up);
    } catch (err) {
      setVideoError(errorMessage(err));
    } finally {
      setVideoProgress(null);
    }
  }

  const embed = mode === "link" && link ? parseVideoEmbed(link) : null;
  const uploading = videoProgress !== null || fileUploads.busy;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (uploading) return setError(t("course.waitUpload"));
    if (mode === "link" && link && !embed) return setError(t("errors.invalid_video_url"));
    setSaving(true);
    setError(null);
    const payload = {
      sectionId,
      title: title.trim(),
      body,
      videoUploadId: mode === "upload" ? (video?.id ?? null) : null,
      videoUrl: mode === "link" && link ? link.trim() : null,
      durationSeconds: mode === "upload" && video ? duration : null,
      attachmentIds: [...files, ...fileUploads.ready].map((f) => f.id),
    };
    try {
      const saved = lessonId ? await api.updateLesson(lessonId, payload) : await api.createLesson(course.id, payload);
      if (saved.freePreview !== freePreview) await api.setLessonPreview(saved.id, freePreview);
      await actions.loadCourse(course.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={() => !uploading && onClose()} title={lessonId ? t("course.editLesson") : t("course.addLesson")}>
      {!loaded ? (
        <p className="text-muted">{error ?? t("common.loading")}</p>
      ) : (
        <form onSubmit={save} className="max-h-[75vh] space-y-5 overflow-y-auto pe-1">
          <Input label={t("course.lessonTitle")} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus dir="auto" />

          {course.access === "paid" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={freePreview} onChange={(e) => setFreePreview(e.target.checked)} />
              👁 {t("pay.freePreview")}
            </label>
          )}

          {/* Video: three clear choices */}
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("course.video")}</span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg p-1 text-sm">
              {(["upload", "link", "none"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cx("rounded-md py-1.5", mode === m ? "bg-brand text-white" : "text-muted hover:text-fg")}
                >
                  {m === "upload" ? `⬆ ${t("course.uploadVideo")}` : m === "link" ? "🔗 YouTube" : t("course.noVideo")}
                </button>
              ))}
            </div>

            {mode === "upload" && (
              <div className="rounded-lg border border-dashed border-line p-4 text-center">
                {videoProgress !== null ? (
                  <div className="space-y-2">
                    <div className="text-sm">{t("files.uploading", { percent: Math.round(videoProgress * 100) })}</div>
                    <div className="h-2 overflow-hidden rounded-full bg-line">
                      <div className="h-full bg-brand transition-all" style={{ width: `${videoProgress * 100}%` }} />
                    </div>
                    <button type="button" onClick={() => abort.current?.abort()} className="text-xs text-muted hover:text-danger">
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : video ? (
                  <div className="space-y-2">
                    <video src={video.url} controls preload="metadata" className="w-full rounded-lg bg-black" />
                    <button type="button" onClick={() => videoInput.current?.click()} className="text-sm text-brand hover:underline">
                      {t("course.replaceVideo")}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => videoInput.current?.click()} className="w-full py-4 text-brand">
                    <span className="block text-3xl">🎬</span>
                    {t("course.uploadVideo")}
                    <span className="block text-xs text-muted" dir="ltr">
                      MP4 · ≤ {formatBytes(UPLOAD_LIMITS.lesson_video)}
                    </span>
                  </button>
                )}
                {videoError && <p className="mt-2 text-sm text-danger">{videoError}</p>}
                <input
                  ref={videoInput}
                  type="file"
                  accept="video/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void pickVideo(f);
                  }}
                />
              </div>
            )}

            {mode === "link" && (
              <div className="space-y-2">
                <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/…" dir="ltr" aria-label={t("course.orLink")} />
                {embed && <EmbedFrame embed={embed} />}
              </div>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("course.notes")}</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("course.lessonBody")}
              dir="auto"
              rows={4}
              maxLength={20000}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-brand"
            />
          </label>

          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("course.files")}</span>
            {files.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span>📄</span>
                <bdi className="flex-1 truncate">{f.filename}</bdi>
                <span className="text-xs text-muted" dir="ltr">
                  {formatBytes(f.size)}
                </span>
                <button type="button" onClick={() => setFiles((l) => l.filter((x) => x.id !== f.id))} className="text-muted hover:text-danger">
                  ✕
                </button>
              </div>
            ))}
            <UploadChips items={fileUploads.items} onRemove={fileUploads.remove} />
            <button type="button" onClick={() => fileInput.current?.click()} className="text-sm text-brand hover:underline">
              + {t("course.addFiles")}
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void fileUploads.add(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-sidebar pt-3">
            {lessonId && (
              <Button
                type="button"
                variant="ghost"
                className="text-danger"
                disabled={saving || uploading}
                onClick={async () => {
                  if (!confirm(t("course.confirmDelete"))) return;
                  try {
                    await api.deleteLesson(lessonId);
                    await actions.loadCourse(course.id);
                    onClose();
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                🗑️ {t("course.deleteLesson")}
              </Button>
            )}
            <div className="flex-1" />
            <Button type="button" variant="ghost" onClick={onClose} disabled={uploading}>
              {t("common.cancel")}
            </Button>
            <Button disabled={saving || uploading || !title.trim()}>
              {uploading ? t("course.waitUpload") : saving ? t("course.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
