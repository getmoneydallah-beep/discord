/** File and video helpers shared by the API and both clients. */

export type FileKind = "image" | "video" | "audio" | "file";
export type UploadPurpose = "attachment" | "lesson_video" | "lesson_file" | "course_cover";

export const MB = 1024 * 1024;
export const GB = 1024 * MB;

/** Max size per upload purpose. R2 accepts up to 5 GiB in a single PUT. */
export const UPLOAD_LIMITS: Record<UploadPurpose, number> = {
  attachment: 100 * MB,
  lesson_video: 4 * GB,
  lesson_file: 200 * MB,
  course_cover: 10 * MB,
};

/** Max attachments on a single chat message. */
export const MAX_ATTACHMENTS = 10;

export function fileKind(contentType: string): FileKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "file";
}

/** Purposes that must be a specific kind of file. */
export function purposeAccepts(purpose: UploadPurpose, contentType: string): boolean {
  if (purpose === "lesson_video") return fileKind(contentType) === "video";
  if (purpose === "course_cover") return fileKind(contentType) === "image";
  return true;
}

/** "1.4 MB", "820 KB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(2)} GB`;
}

/** "1:05:09" or "4:07" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export interface VideoEmbed {
  provider: "youtube" | "vimeo";
  id: string;
  /** URL for an <iframe> / WebView. */
  embedUrl: string;
  /** Original page URL. */
  url: string;
  thumbnailUrl?: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Recognises YouTube (watch, youtu.be, shorts, embed, live) and Vimeo links. */
export function parseVideoEmbed(raw: string): VideoEmbed | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, "");

  let ytId: string | null = null;
  if (host === "youtu.be") ytId = url.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") ytId = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      ytId = m?.[1] ?? null;
    }
  }
  if (ytId && YT_ID.test(ytId)) {
    return {
      provider: "youtube",
      id: ytId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}?rel=0`,
      url: `https://www.youtube.com/watch?v=${ytId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
    };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = url.pathname.match(/(?:\/video)?\/(\d{6,12})/);
    if (m) {
      return { provider: "vimeo", id: m[1]!, embedUrl: `https://player.vimeo.com/video/${m[1]}`, url: `https://vimeo.com/${m[1]}` };
    }
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s<>"'()]+/g;

/** All video embeds found in a message (deduplicated, max 3). */
export function findVideoEmbeds(text: string): VideoEmbed[] {
  const seen = new Set<string>();
  const out: VideoEmbed[] = [];
  for (const m of text.match(URL_RE) ?? []) {
    const e = parseVideoEmbed(m);
    if (e && !seen.has(e.embedUrl)) {
      seen.add(e.embedUrl);
      out.push(e);
      if (out.length === 3) break;
    }
  }
  return out;
}
