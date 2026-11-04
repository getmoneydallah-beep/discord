-- Files (stored in Cloudflare R2) and courses.

ALTER TABLE channels DROP CONSTRAINT channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type IN ('text', 'category', 'course'));

CREATE TABLE uploads (
  id           text PRIMARY KEY,
  -- SET NULL (not CASCADE) so the GC can still delete the R2 object after a server is deleted.
  server_id    text REFERENCES servers(id) ON DELETE SET NULL,
  owner_id     text REFERENCES users(id) ON DELETE SET NULL,
  storage_key  text NOT NULL UNIQUE,
  filename     text NOT NULL,
  content_type text NOT NULL,
  size         bigint NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'file')),
  purpose      text NOT NULL CHECK (purpose IN ('attachment', 'lesson_video', 'lesson_file', 'course_cover')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX uploads_gc_idx ON uploads (created_at);

CREATE TABLE message_attachments (
  message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  upload_id  text NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, upload_id)
);
CREATE INDEX message_attachments_upload_idx ON message_attachments (upload_id);

-- One row per course channel (id = channels.id).
CREATE TABLE courses (
  id              text PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  description     text NOT NULL DEFAULT '',
  cover_upload_id text REFERENCES uploads(id) ON DELETE SET NULL
);

CREATE TABLE course_sections (
  id         text PRIMARY KEY,
  course_id  text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title      text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX course_sections_course_idx ON course_sections (course_id, position);

CREATE TABLE lessons (
  id               text PRIMARY KEY,
  course_id        text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  section_id       text NOT NULL REFERENCES course_sections(id) ON DELETE CASCADE,
  title            text NOT NULL,
  body             text NOT NULL DEFAULT '',
  video_upload_id  text REFERENCES uploads(id) ON DELETE SET NULL,
  video_url        text,
  duration_seconds integer,
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lessons_section_idx ON lessons (section_id, position);
CREATE INDEX lessons_course_idx ON lessons (course_id);

CREATE TABLE lesson_attachments (
  lesson_id text NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  upload_id text NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  position  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (lesson_id, upload_id)
);
CREATE INDEX lesson_attachments_upload_idx ON lesson_attachments (upload_id);

CREATE TABLE lesson_progress (
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id        text NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at     timestamptz,
  position_seconds integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);
