import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthResponse, Course, Invite, Lesson, Message, ServerDetail, Upload, UploadTicket } from "@majlis/shared";
import { buildApp } from "../src/app";
import { createBus } from "../src/bus";
import { createDb } from "../src/db";
import { migrate } from "../src/migrate";
import { localStorage, r2Storage } from "../src/storage";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://majlis:majlis@localhost:5432/majlis_test";
const sql = createDb(DB_URL);
let app: Awaited<ReturnType<typeof buildApp>>;
let base = "";
let dir = "";

async function api<T = any>(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

const uniq = () => Math.random().toString(36).slice(2, 8);
async function register(name: string) {
  const u = uniq();
  const r = await api<AuthResponse>("POST", "/auth/register", undefined, {
    email: `${u}@ex.com`,
    username: `u_${u}`,
    displayName: name,
    password: "password123",
  });
  return r.body;
}

/** Full client upload flow: ticket → PUT bytes → complete. */
async function upload(token: string, serverId: string, filename: string, contentType: string, bytes: Buffer, purpose: string) {
  const t = await api<UploadTicket>("POST", `/servers/${serverId}/uploads`, token, {
    filename,
    contentType,
    size: bytes.length,
    purpose,
  });
  expect(t.status).toBe(201);
  const put = await fetch(t.body.put.url, { method: "PUT", headers: t.body.put.headers, body: bytes });
  expect(put.status).toBe(200);
  const done = await api<Upload>("POST", `/uploads/${t.body.upload.id}/complete`, token);
  expect(done.status).toBe(200);
  expect(done.body.status).toBe("ready");
  return done.body;
}

let owner: AuthResponse;
let student: AuthResponse;
let serverId: string;
let chatChannel: string;

beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await migrate(sql, () => {});
  dir = await mkdtemp(join(tmpdir(), "majlis-uploads-"));
  const storage = localStorage({ dir, secret: "test-secret", baseUrl: "http://placeholder" });
  app = await buildApp({ sql, bus: createBus(null), storage, logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  storage.setBaseUrl(base);

  owner = await register("المعلم");
  student = await register("الطالب");
  const s = await api<ServerDetail>("POST", "/servers", owner.token, { name: "أكاديمية" });
  serverId = s.body.server.id;
  chatChannel = s.body.channels[0]!.id;
  const inv = await api<Invite>("POST", `/servers/${serverId}/invites`, owner.token, {});
  await api("POST", `/invites/${inv.body.code}`, student.token);
});

afterAll(async () => {
  await app.close();
  await sql.end();
  await rm(dir, { recursive: true, force: true });
});

describe("file sharing in chat", () => {
  it("uploads a file, attaches it to a message and serves it with Range support", async () => {
    const bytes = Buffer.from("%PDF-1.4 hello world ".repeat(100));
    const file = await upload(student.token, serverId, "ملخص الدرس.pdf", "application/pdf", bytes, "attachment");
    expect(file.kind).toBe("file");
    expect(file.size).toBe(bytes.length);

    const msg = await api<Message>("POST", `/channels/${chatChannel}/messages`, student.token, { attachmentIds: [file.id] });
    expect(msg.status).toBe(201);
    expect(msg.body.content).toBe("");
    expect(msg.body.attachments).toHaveLength(1);
    const att = msg.body.attachments[0]!;
    expect(att.filename).toBe("ملخص الدرس.pdf");

    const got = await fetch(att.url);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("application/pdf");
    expect(got.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await got.arrayBuffer()).equals(bytes)).toBe(true);

    const partial = await fetch(att.url, { headers: { range: "bytes=0-3" } });
    expect(partial.status).toBe(206);
    expect(await partial.text()).toBe("%PDF");

    // Tampered signature is rejected.
    expect((await fetch(att.url.replace(/sig=[^&]+/, "sig=bad"))).status).toBe(403);

    // History includes attachments for other members.
    const history = await api<Message[]>("GET", `/channels/${chatChannel}/messages`, owner.token);
    expect(history.body.at(-1)!.attachments[0]!.id).toBe(file.id);

    // An upload can't be attached twice.
    const again = await api("POST", `/channels/${chatChannel}/messages`, student.token, { attachmentIds: [file.id] });
    expect(again.body.error).toBe("invalid_upload");
  });

  it("rejects other people's uploads, empty messages and oversized files", async () => {
    const mine = await upload(owner.token, serverId, "a.png", "image/png", Buffer.from("png"), "attachment");
    expect(mine.kind).toBe("image");
    const steal = await api("POST", `/channels/${chatChannel}/messages`, student.token, { attachmentIds: [mine.id] });
    expect(steal.body.error).toBe("invalid_upload");

    expect((await api("POST", `/channels/${chatChannel}/messages`, student.token, { content: "  " })).body.error).toBe("empty_message");

    const big = await api("POST", `/servers/${serverId}/uploads`, student.token, {
      filename: "big.mp4",
      contentType: "video/mp4",
      size: 200 * 1024 * 1024,
      purpose: "attachment",
    });
    expect(big.status).toBe(413);

    // Students can't upload course content.
    const lessonVid = await api("POST", `/servers/${serverId}/uploads`, student.token, {
      filename: "x.mp4",
      contentType: "video/mp4",
      size: 10,
      purpose: "lesson_video",
    });
    expect(lessonVid.status).toBe(403);
  });

  it("refuses to complete an upload whose bytes never arrived", async () => {
    const t = await api<UploadTicket>("POST", `/servers/${serverId}/uploads`, student.token, {
      filename: "ghost.txt",
      contentType: "text/plain",
      size: 5,
      purpose: "attachment",
    });
    const done = await api("POST", `/uploads/${t.body.upload.id}/complete`, student.token);
    expect(done.body.error).toBe("upload_missing");
  });
});

describe("courses", () => {
  let courseId: string;
  let s1: string;
  let s2: string;
  const lessons: string[] = [];

  it("lets admins create a course; members cannot", async () => {
    const denied = await api("POST", `/servers/${serverId}/channels`, student.token, { name: "x", type: "course" });
    expect(denied.status).toBe(403);

    const c = await api("POST", `/servers/${serverId}/channels`, owner.token, {
      name: "أساسيات التصميم",
      type: "course",
      description: "تعلم التصميم من الصفر",
    });
    expect(c.status).toBe(201);
    expect(c.body.type).toBe("course");
    expect(c.body.name).toBe("أساسيات التصميم"); // spaces kept for courses
    courseId = c.body.id;

    // Unlimited: a second course in the same server.
    const c2 = await api("POST", `/servers/${serverId}/channels`, owner.token, { name: "دورة ثانية", type: "course" });
    expect(c2.status).toBe(201);

    // Chat messages can't be posted into a course.
    expect((await api("POST", `/channels/${courseId}/messages`, owner.token, { content: "hi" })).status).toBe(403);
  });

  it("builds sections and lessons with uploaded and embedded videos", async () => {
    s1 = (await api("POST", `/courses/${courseId}/sections`, owner.token, { title: "المقدمة" })).body.id;
    s2 = (await api("POST", `/courses/${courseId}/sections`, owner.token, { title: "التطبيق" })).body.id;
    expect((await api("POST", `/courses/${courseId}/sections`, student.token, { title: "x" })).status).toBe(403);

    const video = await upload(owner.token, serverId, "intro.mp4", "video/mp4", Buffer.alloc(4096, 1), "lesson_video");
    const pdf = await upload(owner.token, serverId, "شرح.pdf", "application/pdf", Buffer.from("pdf"), "lesson_file");
    const cover = await upload(owner.token, serverId, "cover.jpg", "image/jpeg", Buffer.from("jpg"), "course_cover");

    // A video upload must be a video.
    expect(
      (await api("POST", `/servers/${serverId}/uploads`, owner.token, { filename: "a.pdf", contentType: "application/pdf", size: 3, purpose: "lesson_video" }))
        .body.error,
    ).toBe("invalid_file_type");

    const l1 = await api<Lesson>("POST", `/courses/${courseId}/lessons`, owner.token, {
      sectionId: s1,
      title: "مرحباً بك",
      body: "في هذا الدرس نتعرف على الدورة",
      videoUploadId: video.id,
      durationSeconds: 120,
      attachmentIds: [pdf.id],
    });
    expect(l1.status).toBe(201);
    expect(l1.body.video?.kind).toBe("video");
    expect(l1.body.attachments.map((a) => a.filename)).toEqual(["شرح.pdf"]);
    lessons.push(l1.body.id);

    const l2 = await api<Lesson>("POST", `/courses/${courseId}/lessons`, owner.token, {
      sectionId: s1,
      title: "درس من يوتيوب",
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      durationSeconds: 300,
    });
    expect(l2.body.videoUrl).toBe("https://youtu.be/dQw4w9WgXcQ");
    lessons.push(l2.body.id);

    const l3 = await api<Lesson>("POST", `/courses/${courseId}/lessons`, owner.token, { sectionId: s2, title: "تمرين", body: "نص فقط" });
    lessons.push(l3.body.id);

    const bad = await api("POST", `/courses/${courseId}/lessons`, owner.token, { sectionId: s1, title: "x", videoUrl: "https://example.com/v" });
    expect(bad.body.error).toBe("invalid_video_url");

    const patched = await api<Course>("PATCH", `/courses/${courseId}`, owner.token, { coverUploadId: cover.id });
    expect(patched.body.cover?.kind).toBe("image");
  });

  it("shows students a clear course overview with progress", async () => {
    const c = await api<Course>("GET", `/courses/${courseId}`, student.token);
    expect(c.status).toBe(200);
    expect(c.body.description).toBe("تعلم التصميم من الصفر");
    expect(c.body.sections.map((s) => s.title)).toEqual(["المقدمة", "التطبيق"]);
    expect(c.body.sections[0]!.lessons.map((l) => l.title)).toEqual(["مرحباً بك", "درس من يوتيوب"]);
    expect(c.body.totalDurationSeconds).toBe(420);
    expect(c.body.progress).toEqual({ completed: 0, total: 3, nextLessonId: lessons[0], lastLessonId: null });
  });

  it("tracks lesson progress and prev/next navigation", async () => {
    const l1 = await api<Lesson>("GET", `/lessons/${lessons[0]}`, student.token);
    expect(l1.body.prevLessonId).toBeNull();
    expect(l1.body.nextLessonId).toBe(lessons[1]);
    expect((await fetch(l1.body.video!.url, { headers: { range: "bytes=0-9" } })).status).toBe(206);

    // Watching saves the position…
    expect((await api("PUT", `/lessons/${lessons[0]}/progress`, student.token, { positionSeconds: 42 })).status).toBe(204);
    expect((await api<Lesson>("GET", `/lessons/${lessons[0]}`, student.token)).body.positionSeconds).toBe(42);
    // …and finishing marks it complete.
    await api("PUT", `/lessons/${lessons[0]}/progress`, student.token, { completed: true });

    const c = await api<Course>("GET", `/courses/${courseId}`, student.token);
    expect(c.body.progress.completed).toBe(1);
    expect(c.body.progress.nextLessonId).toBe(lessons[1]);
    expect(c.body.progress.lastLessonId).toBe(lessons[0]);
    expect(c.body.sections[0]!.lessons[0]!.completed).toBe(true);

    // Progress is per user.
    expect((await api<Course>("GET", `/courses/${courseId}`, owner.token)).body.progress.completed).toBe(0);

    // Un-completing works too.
    await api("PUT", `/lessons/${lessons[0]}/progress`, student.token, { completed: false });
    expect((await api<Course>("GET", `/courses/${courseId}`, student.token)).body.progress.completed).toBe(0);
  });

  it("reorders lessons across sections and edits lessons", async () => {
    const order = await api<Course>("PUT", `/courses/${courseId}/order`, owner.token, {
      sections: [
        { id: s2, lessonIds: [lessons[2], lessons[1]] },
        { id: s1, lessonIds: [lessons[0]] },
      ],
    });
    expect(order.status).toBe(200);
    expect(order.body.sections.map((s) => s.lessons.map((l) => l.id))).toEqual([[lessons[2], lessons[1]], [lessons[0]]]);

    const incomplete = await api("PUT", `/courses/${courseId}/order`, owner.token, { sections: [{ id: s1, lessonIds: [] }] });
    expect(incomplete.body.error).toBe("invalid_order");

    // Switching a lesson from an upload to a YouTube link clears the upload.
    const edited = await api<Lesson>("PATCH", `/lessons/${lessons[0]}`, owner.token, {
      title: "مرحباً بك (محدث)",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(edited.body.title).toBe("مرحباً بك (محدث)");
    expect(edited.body.video).toBeNull();
    expect(edited.body.videoUrl).toContain("youtube.com");

    expect((await api("PATCH", `/lessons/${lessons[0]}`, student.token, { title: "x" })).status).toBe(403);
    expect((await api("DELETE", `/lessons/${lessons[2]}`, owner.token)).status).toBe(204);
    expect((await api<Course>("GET", `/courses/${courseId}`, student.token)).body.progress.total).toBe(2);
  });

  it("garbage-collects files nobody references", async () => {
    // Age every upload past the 24h grace period, then sweep.
    await sql`UPDATE uploads SET created_at = now() - interval '2 days'`;
    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM uploads`;
    const deleted = await app.uploadGc.sweep();
    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM uploads`;
    // The replaced lesson video, the never-completed ghost upload and the unused image go; attached ones stay.
    expect(deleted).toBeGreaterThanOrEqual(3);
    expect(after[0]!.n).toBe(before[0]!.n - deleted);
    const [att] = await sql`SELECT count(*)::int AS n FROM message_attachments`;
    expect(att!.n).toBe(1);
    const [cover] = await sql`SELECT u.id FROM courses c JOIN uploads u ON u.id = c.cover_upload_id WHERE c.id = ${courseId}`;
    expect(cover).toBeTruthy();
  });

  it("removes course data when the course channel is deleted", async () => {
    expect((await api("DELETE", `/channels/${courseId}`, owner.token)).status).toBe(204);
    expect((await api("GET", `/courses/${courseId}`, student.token)).status).toBe(404);
    const [n] = await sql`SELECT count(*)::int AS n FROM lessons WHERE course_id = ${courseId}`;
    expect(n!.n).toBe(0);
  });
});

describe("R2 presigning", () => {
  it("produces SigV4 query-signed URLs for the bucket", async () => {
    const r2 = r2Storage({ accountId: "acct123", accessKeyId: "AKID", secretAccessKey: "secret", bucket: "majlis-media" });
    const put = await r2.presignPut("srv/abc.mp4", "video/mp4");
    const u = new URL(put.url);
    expect(u.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(u.pathname).toBe("/majlis-media/srv/abc.mp4");
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(put.headers["content-type"]).toBe("video/mp4");

    // GET URLs are stable within the hour (cache-friendly) and carry the download filename.
    const a = await r2.presignGet("srv/abc.pdf", { filename: "ملف.pdf", download: true });
    const b = await r2.presignGet("srv/abc.pdf", { filename: "ملف.pdf", download: true });
    expect(a).toBe(b);
    expect(new URL(a).searchParams.get("response-content-disposition")).toContain("attachment");
  });
});

describe("announcement channels and channel settings", () => {
  it("lets only the owner and admins post in a staff-only channel; members can still react", async () => {
    const ch = await api<{ id: string; postPolicy: string }>("POST", `/servers/${serverId}/channels`, owner.token, { name: "إعلانات", postPolicy: "staff" });
    expect(ch.status).toBe(201);
    expect(ch.body.postPolicy).toBe("staff");
    const denied = await api("POST", `/channels/${ch.body.id}/messages`, student.token, { content: "مرحبا" });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("staff_only");
    const post = await api<Message>("POST", `/channels/${ch.body.id}/messages`, owner.token, { content: "الدرس القادم يوم الأحد" });
    expect(post.status).toBe(201);
    expect((await api("GET", `/channels/${ch.body.id}/messages`, student.token)).status).toBe(200);
    expect((await api("PUT", `/messages/${post.body.id}/reactions/${encodeURIComponent("👍")}`, student.token)).status).toBe(204);
  });

  it("renames, sets the topic and switches who can post; members can't", async () => {
    const r = await api<{ name: string; topic: string; postPolicy: string }>("PATCH", `/channels/${chatChannel}`, owner.token, {
      name: "النقاش العام", topic: "اسأل أي سؤال", postPolicy: "staff",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "النقاش-العام", topic: "اسأل أي سؤال", postPolicy: "staff" });
    expect((await api("POST", `/channels/${chatChannel}/messages`, student.token, { content: "x" })).status).toBe(403);
    expect((await api("PATCH", `/channels/${chatChannel}`, student.token, { postPolicy: "everyone" })).status).toBe(403);
    await api("PATCH", `/channels/${chatChannel}`, owner.token, { postPolicy: "everyone" });
    expect((await api("POST", `/channels/${chatChannel}/messages`, student.token, { content: "x" })).status).toBe(201);
  });
});
