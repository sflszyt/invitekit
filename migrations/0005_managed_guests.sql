CREATE TABLE managed_guests (
  id TEXT PRIMARY KEY NOT NULL,
  invitation_hash TEXT NOT NULL UNIQUE REFERENCES invitations(token_hash) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  locale TEXT NOT NULL CHECK (locale IN ('zh-CN', 'zh-TW')),
  attendance TEXT NOT NULL DEFAULT 'pending' CHECK (attendance IN ('pending', 'yes', 'no')),
  party_size INTEGER NOT NULL DEFAULT 0 CHECK (party_size BETWEEN 0 AND 20),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_request_id TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT 'admin' CHECK (updated_by IN ('admin', 'guest')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  link_cipher TEXT NOT NULL,
  create_hash TEXT NOT NULL,
  CHECK ((attendance = 'yes' AND party_size >= 1) OR (attendance != 'yes' AND party_size = 0))
);
CREATE INDEX managed_guests_created ON managed_guests(created_at, id);
