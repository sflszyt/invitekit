CREATE TABLE managed_guests_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  invitation_hash TEXT NOT NULL UNIQUE REFERENCES invitations(token_hash) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  locale TEXT NOT NULL DEFAULT 'zh-CN' CHECK (locale IN ('zh-CN', 'zh-TW')),
  category TEXT NOT NULL DEFAULT '' CHECK (category IN ('','新郎朋友','新娘朋友','新郎家人','新娘家人','新郎父母朋友','新娘父母朋友')),
  address TEXT NOT NULL DEFAULT '' CHECK (length(address) <= 600),
  rooms INTEGER NOT NULL DEFAULT 0 CHECK (typeof(rooms)='integer' AND rooms BETWEEN 0 AND 20),
  nights INTEGER NOT NULL DEFAULT 1 CHECK (typeof(nights)='integer' AND nights BETWEEN 1 AND 30),
  flight_tickets INTEGER DEFAULT NULL CHECK (flight_tickets IS NULL OR (typeof(flight_tickets)='integer' AND flight_tickets BETWEEN 0 AND 20)),
  attendance TEXT NOT NULL DEFAULT 'pending' CHECK (attendance IN ('pending','yes','no')),
  party_size INTEGER NOT NULL DEFAULT 1 CHECK (typeof(party_size)='integer' AND party_size BETWEEN 0 AND 20),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_request_id TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT 'admin' CHECK (updated_by IN ('admin','guest')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  link_cipher TEXT NOT NULL,
  create_hash TEXT NOT NULL,
  CHECK ((attendance IN ('yes','pending') AND party_size >= 1) OR (attendance='no' AND party_size=0))
);
INSERT INTO managed_guests_v2 (id,invitation_hash,display_name,note,locale,attendance,party_size,revision,last_request_id,updated_by,created_at,updated_at,link_cipher,create_hash)
SELECT id,invitation_hash,display_name,note,locale,attendance,CASE WHEN attendance='pending' THEN max(1,party_size) ELSE party_size END,revision,last_request_id,updated_by,created_at,updated_at,link_cipher,create_hash FROM managed_guests;
DROP TABLE managed_guests;
ALTER TABLE managed_guests_v2 RENAME TO managed_guests;
CREATE INDEX managed_guests_created ON managed_guests(deleted_at,created_at,id);
