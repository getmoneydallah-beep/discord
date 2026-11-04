"use client";

import { useCallback, useState } from "react";
import { formatBytes, UPLOAD_LIMITS, type Attachment, type UploadPurpose, type VideoEmbed } from "@majlis/shared";
import { api, errorMessage, useT } from "@/lib/store";
import { cx } from "./ui";

/** Renders message/lesson attachments: images and videos inline, other files as download cards. */
export function Attachments({ items, compact }: { items: Attachment[]; compact?: boolean }) {
  if (!items.length) return null;
  const media = items.filter((a) => a.kind === "image" || a.kind === "video" || a.kind === "audio");
  const others = items.filter((a) => a.kind === "file");
  return (
    <div className="mt-1 space-y-2">
      {media.length > 0 && (
        <div className={cx("flex flex-wrap gap-2", compact && "max-w-md")}>
          {media.map((a) =>
            a.kind === "image" ? (
              <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.filename} loading="lazy" className="max-h-72 max-w-full object-contain sm:max-w-sm" />
              </a>
            ) : a.kind === "video" ? (
              <video key={a.id} src={a.url} controls preload="metadata" playsInline className="max-h-80 w-full max-w-lg rounded-lg bg-black" />
            ) : (
              <audio key={a.id} src={a.url} controls className="w-full max-w-sm" />
            ),
          )}
        </div>
      )}
      {others.map((a) => (
        <FileCard key={a.id} file={a} />
      ))}
    </div>
  );
}

const ICONS: Record<string, string> = { pdf: "📕", doc: "📘", docx: "📘", xls: "📗", xlsx: "📗", ppt: "📙", pptx: "📙", zip: "🗜️", rar: "🗜️" };

export function FileCard({ file }: { file: Attachment }) {
  const t = useT();
  const ext = file.filename.split(".").pop()?.toLowerCase() ?? "";
  return (
    <a
      href={file.url}
      download={file.filename}
      className="flex max-w-sm items-center gap-3 rounded-lg border border-line bg-surface p-3 hover:border-brand"
    >
      <span className="text-3xl">{ICONS[ext] ?? "📄"}</span>
      <span className="min-w-0 flex-1">
        <bdi className="block truncate text-sm font-medium">{file.filename}</bdi>
        <span className="text-xs text-muted" dir="ltr">
          {formatBytes(file.size)}
        </span>
      </span>
      <span className="text-sm text-brand">{t("files.download")} ↓</span>
    </a>
  );
}

/** Privacy-friendly embed (youtube-nocookie / player.vimeo.com). */
export function EmbedFrame({ embed, className }: { embed: VideoEmbed; className?: string }) {
  return (
    <div className={cx("relative aspect-video w-full overflow-hidden rounded-lg bg-black", className)}>
      <iframe
        src={embed.embedUrl}
        title={embed.provider}
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

export interface PendingUpload {
  key: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
  attachment?: Attachment;
}

/** Uploads files to R2 (via the API's signed URLs) and tracks progress for the UI. */
export function useUploader(serverId: string, purpose: UploadPurpose) {
  const t = useT();
  const [items, setItems] = useState<PendingUpload[]>([]);

  const patch = (key: string, p: Partial<PendingUpload>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const add = useCallback(
    async (files: FileList | File[]) => {
      const results: Attachment[] = [];
      await Promise.all(
        [...files].map(async (file) => {
          const key = `${file.name}-${file.size}-${Math.random()}`;
          const item: PendingUpload = { key, name: file.name, size: file.size, progress: 0 };
          if (file.size > UPLOAD_LIMITS[purpose]) {
            item.error = t("files.tooLarge", { max: formatBytes(UPLOAD_LIMITS[purpose]) });
            setItems((l) => [...l, item]);
            return;
          }
          setItems((l) => [...l, item]);
          try {
            const up = await api.uploadFile(
              serverId,
              { name: file.name, type: file.type, size: file.size, body: file },
              purpose,
              { onProgress: (p) => patch(key, { progress: p }) },
            );
            patch(key, { progress: 1, attachment: up });
            results.push(up);
          } catch (err) {
            patch(key, { error: errorMessage(err) });
          }
        }),
      );
      return results;
    },
    [serverId, purpose, t],
  );

  return {
    items,
    add,
    remove: (key: string) => setItems((l) => l.filter((i) => i.key !== key)),
    clear: () => setItems([]),
    busy: items.some((i) => !i.attachment && !i.error),
    ready: items.filter((i) => i.attachment).map((i) => i.attachment!),
  };
}

export function UploadChips({ items, onRemove }: { items: PendingUpload[]; onRemove: (key: string) => void }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pb-2">
      {items.map((i) => (
        <div key={i.key} className="relative w-44 overflow-hidden rounded-lg border border-line bg-bg p-2 text-xs">
          <div className="flex items-center gap-1">
            <bdi className="flex-1 truncate font-medium">{i.name}</bdi>
            <button onClick={() => onRemove(i.key)} className="text-muted hover:text-danger" title={t("files.remove")}>
              ✕
            </button>
          </div>
          {i.error ? (
            <div className="mt-1 text-danger">{i.error}</div>
          ) : i.attachment ? (
            <div className="mt-1 text-success" dir="ltr">
              ✓ {formatBytes(i.size)}
            </div>
          ) : (
            <>
              <div className="mt-1 text-muted">{t("files.uploading", { percent: Math.round(i.progress * 100) })}</div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-line">
                <div className="h-full bg-brand transition-all" style={{ width: `${i.progress * 100}%` }} />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Reads a local video file's duration in seconds (for course lessons). */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(Number.isFinite(v.duration) ? Math.round(v.duration) : null);
    };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}
