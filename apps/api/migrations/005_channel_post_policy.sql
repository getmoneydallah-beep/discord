-- Announcement channels: only the owner and admins can post; members read and react.
ALTER TABLE channels ADD COLUMN post_policy text NOT NULL DEFAULT 'everyone' CHECK (post_policy IN ('everyone', 'staff'));
