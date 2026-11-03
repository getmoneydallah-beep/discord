CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            text PRIMARY KEY,
  email         citext NOT NULL UNIQUE,
  username      citext NOT NULL UNIQUE,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  avatar_url    text,
  locale        text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE servers (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  icon_url   text,
  owner_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE server_members (
  server_id text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  nickname  text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX server_members_user_idx ON server_members (user_id);

CREATE TABLE server_bans (
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by  text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE channels (
  id         text PRIMARY KEY,
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name       text NOT NULL,
  type       text NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'category')),
  parent_id  text REFERENCES channels(id) ON DELETE SET NULL,
  position   integer NOT NULL DEFAULT 0,
  topic      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channels_server_idx ON channels (server_id, position);

CREATE TABLE messages (
  id           text PRIMARY KEY,           -- ULID: sorts by creation time
  channel_id   text NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      text NOT NULL,
  content_norm text NOT NULL,              -- normalizeArabic(content), for search
  search       tsvector GENERATED ALWAYS AS (to_tsvector('simple', content_norm)) STORED,
  reply_to_id  text REFERENCES messages(id) ON DELETE SET NULL,
  edited_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_channel_idx ON messages (channel_id, id DESC);
CREATE INDEX messages_search_idx ON messages USING gin (search);

CREATE TABLE reactions (
  message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE invites (
  code       text PRIMARY KEY,
  server_id  text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  inviter_id text REFERENCES users(id) ON DELETE SET NULL,
  max_uses   integer,
  uses       integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id          text PRIMARY KEY,
  message_id  text REFERENCES messages(id) ON DELETE SET NULL,
  server_id   text REFERENCES servers(id) ON DELETE CASCADE,
  reporter_id text REFERENCES users(id) ON DELETE SET NULL,
  reported_user_id text REFERENCES users(id) ON DELETE SET NULL,
  content_snapshot text,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
