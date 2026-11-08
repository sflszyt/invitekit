CREATE TABLE rsvps_v2 (
  invitation_hash TEXT PRIMARY KEY REFERENCES invitations(token_hash) ON DELETE CASCADE,
  guest_name TEXT NOT NULL CHECK (length(guest_name) BETWEEN 1 AND 80),
  attendance TEXT NOT NULL CHECK (attendance IN ('yes', 'no')),
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 0 AND 20),
  adult_count INTEGER NOT NULL CHECK (adult_count BETWEEN 0 AND 20),
  child_count INTEGER NOT NULL CHECK (child_count BETWEEN 0 AND 20),
  updated_at INTEGER NOT NULL,
  CHECK (party_size = adult_count + child_count),
  CHECK ((attendance = 'yes' AND party_size >= 1) OR (attendance = 'no' AND party_size = 0))
);
INSERT INTO rsvps_v2 SELECT invitation_hash, guest_name, attendance, party_size, party_size, 0, updated_at FROM rsvps;
DROP TABLE rsvps;
ALTER TABLE rsvps_v2 RENAME TO rsvps;
