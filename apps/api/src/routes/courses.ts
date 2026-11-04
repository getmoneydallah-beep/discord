import type { FastifyInstance } from "fastify";
import {
  can,
  courseOrderSchema,
  lessonSchema,
  lessonPreviewSchema,
  newId,
  parseVideoEmbed,
  progressSchema,
  sectionSchema,
  updateCourseSchema,
  updateLessonSchema,
  type Course,
  type CourseSection,
  type Lesson,
  type LessonSummary,
} from "@majlis/shared";
import { requireAuth } from "../auth";
import type { Ctx } from "../context";
import { badRequest, forbidden, HttpError, notFound } from "../errors";
import { uploadJson, type UploadRow } from "../files";
import { toChannel } from "../repo";

/**
 * Courses are channels of type "course". A course has ordered sections, each
 * with ordered lessons. A lesson has a video (an uploaded file in R2, or a
 * YouTube/Vimeo link), notes, and downloadable files. Progress is per user.
 */
export function courseRoutes(app: FastifyInstance, ctx: Ctx) {
  const { sql, repo, files, emit } = ctx;
  app.addHook("preHandler", requireAuth);

  async function courseAccess(courseId: string, userId: string, manage = false) {
    const { channel, role } = await repo.channelAccess(courseId, userId);
    if (channel.type !== "course") throw notFound("course_not_found");
    if (manage && !can(role, "channel.manage")) throw forbidden();
    // The outline of a paid course stays visible (it's what's for sale); lessons are locked.
    const locked = !(await repo.canAccessChannel(channel, userId, role));
    return { channel, role, locked };
  }

  async function lessonAccess(lessonId: string, userId: string, manage = false) {
    const [row] = await sql`SELECT * FROM lessons WHERE id = ${lessonId}`;
    if (!row) throw notFound("lesson_not_found");
    const access = await courseAccess(row.courseId, userId, manage);
    return { lesson: row, ...access, lessonLocked: access.locked && !row.freePreview };
  }

  async function sectionAccess(sectionId: string, userId: string) {
    const [row] = await sql`SELECT * FROM course_sections WHERE id = ${sectionId}`;
    if (!row) throw notFound("section_not_found");
    const access = await courseAccess(row.courseId, userId, true);
    return { section: row, ...access };
  }

  const changed = (courseId: string, serverId: string) => emit({ serverIds: [serverId] }, { t: "COURSE_UPDATE", d: { courseId, serverId } });

  /** Ordered lessons of a course with the viewer's progress. */
  async function lessonList(courseId: string, userId: string) {
    return sql<(LessonSummary & { progressAt: Date | null })[]>`
      SELECT l.id, l.section_id, l.title, l.position, l.duration_seconds, l.free_preview,
             (l.video_upload_id IS NOT NULL OR l.video_url IS NOT NULL) AS has_video,
             (SELECT count(*)::int FROM lesson_attachments a WHERE a.lesson_id = l.id) AS attachment_count,
             (p.completed_at IS NOT NULL) AS completed,
             p.updated_at AS progress_at
      FROM lessons l
      JOIN course_sections s ON s.id = l.section_id
      LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = ${userId}
      WHERE l.course_id = ${courseId}
      ORDER BY s.position, s.created_at, l.position, l.created_at`;
  }

  async function buildCourse(courseId: string, userId: string): Promise<Course> {
    const { channel, locked } = await courseAccess(courseId, userId);
    const [meta] = await sql`
      SELECT c.description, CASE WHEN u.id IS NULL THEN NULL ELSE ${sql.unsafe(uploadJson)} END AS cover
      FROM courses c LEFT JOIN uploads u ON u.id = c.cover_upload_id
      WHERE c.id = ${courseId}`;
    const sectionRows = await sql`SELECT * FROM course_sections WHERE course_id = ${courseId} ORDER BY position, created_at`;
    const lessons = await lessonList(courseId, userId);

    const sections: CourseSection[] = sectionRows.map((s) => ({
      id: s.id,
      title: s.title,
      position: s.position,
      lessons: lessons
        .filter((l) => l.sectionId === s.id)
        .map(({ progressAt: _, ...l }) => ({
          ...l,
          durationSeconds: l.durationSeconds ?? null,
          locked: locked && !l.freePreview,
        })),
    }));
    const last = lessons
      .filter((l) => l.progressAt)
      .sort((a, b) => b.progressAt!.getTime() - a.progressAt!.getTime())[0];

    return {
      id: channel.id,
      serverId: channel.serverId,
      name: channel.name,
      description: meta?.description ?? "",
      cover: meta?.cover ? await files.toAttachment(meta.cover as UploadRow) : null,
      totalDurationSeconds: lessons.reduce((sum, l) => sum + (l.durationSeconds ?? 0), 0),
      sections,
      progress: {
        completed: lessons.filter((l) => l.completed).length,
        total: lessons.length,
        nextLessonId: (lessons.find((l) => !l.completed) ?? lessons[0])?.id ?? null,
        lastLessonId: last?.id ?? null,
      },
      access: channel.access,
      locked,
    };
  }

  async function buildLesson(lessonId: string, userId: string): Promise<Lesson> {
    const { lesson, channel, lessonLocked } = await lessonAccess(lessonId, userId);
    // No signed file links are issued without access.
    if (lessonLocked) throw new HttpError(403, "locked");
    const [video] = lesson.videoUploadId
      ? await sql<UploadRow[]>`SELECT * FROM uploads WHERE id = ${lesson.videoUploadId}`
      : [];
    const attachments = await sql<UploadRow[]>`
      SELECT u.* FROM lesson_attachments a JOIN uploads u ON u.id = a.upload_id
      WHERE a.lesson_id = ${lessonId} ORDER BY a.position`;
    const [progress] = await sql`SELECT * FROM lesson_progress WHERE lesson_id = ${lessonId} AND user_id = ${userId}`;
    const order = (await lessonList(lesson.courseId, userId)).map((l) => l.id);
    const i = order.indexOf(lessonId);
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      serverId: channel.serverId,
      sectionId: lesson.sectionId,
      title: lesson.title,
      body: lesson.body,
      video: video ? await files.toAttachment(video) : null,
      videoUrl: lesson.videoUrl ?? null,
      durationSeconds: lesson.durationSeconds ?? null,
      attachments: await Promise.all(attachments.map(files.toAttachment)),
      completed: Boolean(progress?.completedAt),
      positionSeconds: progress?.positionSeconds ?? 0,
      prevLessonId: order[i - 1] ?? null,
      nextLessonId: order[i + 1] ?? null,
      freePreview: lesson.freePreview,
    };
  }

  /** Validates the video fields of a lesson create/update. */
  async function resolveVideo(serverId: string, input: { videoUploadId?: string | null; videoUrl?: string | null }) {
    if (input.videoUploadId && input.videoUrl) throw badRequest("one_video_only");
    if (input.videoUrl && !parseVideoEmbed(input.videoUrl)) throw badRequest("invalid_video_url");
    if (input.videoUploadId) await files.requireUploads([input.videoUploadId], { serverId, purposes: ["lesson_video"] });
  }

  async function setLessonAttachments(tx: import("postgres").TransactionSql<{}>, lessonId: string, serverId: string, ids: string[]) {
    await files.requireUploads(ids, { serverId, purposes: ["lesson_file", "attachment"] });
    await tx`DELETE FROM lesson_attachments WHERE lesson_id = ${lessonId}`;
    for (const [position, id] of ids.entries()) {
      await tx`INSERT INTO lesson_attachments (lesson_id, upload_id, position) VALUES (${lessonId}, ${id}, ${position})`;
    }
  }

  /* -------------------------------- courses -------------------------------- */

  app.get<{ Params: { id: string } }>("/courses/:id", async (req) => buildCourse(req.params.id, req.userId));

  app.patch<{ Params: { id: string } }>("/courses/:id", async (req) => {
    const { channel } = await courseAccess(req.params.id, req.userId, true);
    const input = updateCourseSchema.parse(req.body);
    if (input.coverUploadId) {
      await files.requireUploads([input.coverUploadId], { serverId: channel.serverId, purposes: ["course_cover"] });
    }
    await sql.begin(async (tx) => {
      if (input.name) {
        const [row] = await tx`UPDATE channels SET name = ${input.name} WHERE id = ${channel.id} RETURNING *`;
        await emit({ serverIds: [channel.serverId] }, { t: "CHANNEL_UPDATE", d: toChannel(row!) });
      }
      if (input.description !== undefined) await tx`UPDATE courses SET description = ${input.description} WHERE id = ${channel.id}`;
      if (input.coverUploadId !== undefined) await tx`UPDATE courses SET cover_upload_id = ${input.coverUploadId} WHERE id = ${channel.id}`;
    });
    await changed(channel.id, channel.serverId);
    return buildCourse(channel.id, req.userId);
  });

  /* -------------------------------- sections ------------------------------- */

  app.post<{ Params: { id: string } }>("/courses/:id/sections", async (req, reply) => {
    const { channel } = await courseAccess(req.params.id, req.userId, true);
    const { title } = sectionSchema.parse(req.body);
    const [{ next } = { next: 0 }] = await sql<{ next: number }[]>`
      SELECT COALESCE(MAX(position) + 1, 0)::int AS next FROM course_sections WHERE course_id = ${channel.id}`;
    const id = newId();
    await sql`INSERT INTO course_sections (id, course_id, title, position) VALUES (${id}, ${channel.id}, ${title}, ${next})`;
    await changed(channel.id, channel.serverId);
    reply.code(201);
    return { id, title, position: next, lessons: [] } satisfies CourseSection;
  });

  app.patch<{ Params: { id: string } }>("/sections/:id", async (req) => {
    const { section, channel } = await sectionAccess(req.params.id, req.userId);
    const { title } = sectionSchema.parse(req.body);
    await sql`UPDATE course_sections SET title = ${title} WHERE id = ${section.id}`;
    await changed(channel.id, channel.serverId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/sections/:id", async (req, reply) => {
    const { section, channel } = await sectionAccess(req.params.id, req.userId);
    await sql`DELETE FROM course_sections WHERE id = ${section.id}`; // lessons cascade; files are GC'd
    await changed(channel.id, channel.serverId);
    reply.code(204);
  });

  /* -------------------------------- lessons -------------------------------- */

  app.post<{ Params: { id: string } }>("/courses/:id/lessons", async (req, reply) => {
    const { channel } = await courseAccess(req.params.id, req.userId, true);
    const input = lessonSchema.parse(req.body);
    const [section] = await sql`SELECT id FROM course_sections WHERE id = ${input.sectionId} AND course_id = ${channel.id}`;
    if (!section) throw badRequest("invalid_section");
    await resolveVideo(channel.serverId, input);

    const id = newId();
    await sql.begin(async (tx) => {
      const [{ next } = { next: 0 }] = await tx<{ next: number }[]>`
        SELECT COALESCE(MAX(position) + 1, 0)::int AS next FROM lessons WHERE section_id = ${input.sectionId}`;
      await tx`
        INSERT INTO lessons (id, course_id, section_id, title, body, video_upload_id, video_url, duration_seconds, position)
        VALUES (${id}, ${channel.id}, ${input.sectionId}, ${input.title}, ${input.body}, ${input.videoUploadId ?? null},
                ${input.videoUrl ?? null}, ${input.durationSeconds ?? null}, ${next})`;
      await setLessonAttachments(tx, id, channel.serverId, input.attachmentIds);
    });
    await changed(channel.id, channel.serverId);
    reply.code(201);
    return buildLesson(id, req.userId);
  });

  app.get<{ Params: { id: string } }>("/lessons/:id", async (req) => buildLesson(req.params.id, req.userId));

  app.patch<{ Params: { id: string } }>("/lessons/:id", async (req) => {
    const { lesson, channel } = await lessonAccess(req.params.id, req.userId, true);
    const input = updateLessonSchema.parse(req.body);
    if (input.sectionId) {
      const [s] = await sql`SELECT id FROM course_sections WHERE id = ${input.sectionId} AND course_id = ${channel.id}`;
      if (!s) throw badRequest("invalid_section");
    }
    // Setting one kind of video clears the other.
    const video =
      input.videoUploadId !== undefined || input.videoUrl !== undefined
        ? { videoUploadId: input.videoUploadId ?? null, videoUrl: input.videoUrl ?? null }
        : null;
    if (video) await resolveVideo(channel.serverId, video);

    await sql.begin(async (tx) => {
      await tx`
        UPDATE lessons SET
          title = COALESCE(${input.title ?? null}, title),
          body = COALESCE(${input.body ?? null}, body),
          section_id = COALESCE(${input.sectionId ?? null}, section_id),
          video_upload_id = ${video ? video.videoUploadId : sql`video_upload_id`},
          video_url = ${video ? video.videoUrl : sql`video_url`},
          duration_seconds = ${input.durationSeconds !== undefined ? input.durationSeconds : video ? null : sql`duration_seconds`},
          updated_at = now()
        WHERE id = ${lesson.id}`;
      if (input.attachmentIds) await setLessonAttachments(tx, lesson.id, channel.serverId, input.attachmentIds);
    });
    await changed(channel.id, channel.serverId);
    return buildLesson(lesson.id, req.userId);
  });

  app.delete<{ Params: { id: string } }>("/lessons/:id", async (req, reply) => {
    const { lesson, channel } = await lessonAccess(req.params.id, req.userId, true);
    await sql`DELETE FROM lessons WHERE id = ${lesson.id}`;
    await changed(channel.id, channel.serverId);
    reply.code(204);
  });

  /** Reorder sections and lessons in one call (also moves lessons between sections). */
  app.put<{ Params: { id: string } }>("/courses/:id/order", async (req) => {
    const { channel } = await courseAccess(req.params.id, req.userId, true);
    const { sections } = courseOrderSchema.parse(req.body);
    const own = await sql<{ id: string }[]>`SELECT id FROM course_sections WHERE course_id = ${channel.id}`;
    const ownLessons = await sql<{ id: string }[]>`SELECT id FROM lessons WHERE course_id = ${channel.id}`;
    const sectionIds = new Set(own.map((s) => s.id));
    const lessonIds = new Set(ownLessons.map((l) => l.id));
    const given = sections.flatMap((s) => s.lessonIds);
    // Must describe the whole course exactly once.
    if (
      sections.length !== sectionIds.size ||
      sections.some((s) => !sectionIds.has(s.id)) ||
      given.length !== lessonIds.size ||
      new Set(given).size !== given.length ||
      given.some((id) => !lessonIds.has(id))
    ) {
      throw badRequest("invalid_order");
    }
    await sql.begin(async (tx) => {
      for (const [si, s] of sections.entries()) {
        await tx`UPDATE course_sections SET position = ${si} WHERE id = ${s.id}`;
        for (const [li, lessonId] of s.lessonIds.entries()) {
          await tx`UPDATE lessons SET section_id = ${s.id}, position = ${li} WHERE id = ${lessonId}`;
        }
      }
    });
    await changed(channel.id, channel.serverId);
    return buildCourse(channel.id, req.userId);
  });

  /** Marks a lesson of a paid course as a free preview (or not). */
  app.put<{ Params: { id: string } }>("/lessons/:id/preview", async (req) => {
    const { lesson, channel } = await lessonAccess(req.params.id, req.userId, true);
    const { freePreview } = lessonPreviewSchema.parse(req.body);
    await sql`UPDATE lessons SET free_preview = ${freePreview}, updated_at = now() WHERE id = ${lesson.id}`;
    await changed(channel.id, channel.serverId);
    return buildLesson(lesson.id, req.userId);
  });

  /** Saves watch position / completion for the current user. */
  app.put<{ Params: { id: string } }>("/lessons/:id/progress", async (req, reply) => {
    const { lesson, lessonLocked } = await lessonAccess(req.params.id, req.userId);
    if (lessonLocked) throw new HttpError(403, "locked");
    const input = progressSchema.parse(req.body);
    const completed = input.completed;
    await sql`
      INSERT INTO lesson_progress (user_id, lesson_id, completed_at, position_seconds)
      VALUES (${req.userId}, ${lesson.id}, ${completed ? sql`now()` : null}, ${Math.round(input.positionSeconds ?? 0)})
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET
        completed_at = CASE
          WHEN ${completed === undefined} THEN lesson_progress.completed_at
          WHEN ${completed === true} THEN COALESCE(lesson_progress.completed_at, now())
          ELSE NULL END,
        position_seconds = COALESCE(${input.positionSeconds === undefined ? null : Math.round(input.positionSeconds)}, lesson_progress.position_seconds),
        updated_at = now()`;
    // The first viewer's player fills in a missing duration for uploaded videos.
    if (input.durationSeconds && !lesson.durationSeconds && lesson.videoUploadId) {
      await sql`UPDATE lessons SET duration_seconds = ${Math.round(input.durationSeconds)} WHERE id = ${lesson.id} AND duration_seconds IS NULL`;
    }
    reply.code(204);
  });
}
