PRAGMA foreign_keys = ON;
CREATE TABLE invitations (
  token_hash TEXT PRIMARY KEY NOT NULL,
  max_party_size INTEGER NOT NULL CHECK (max_party_size BETWEEN 1 AND 20),
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
);
CREATE TABLE rsvps (
  invitation_hash TEXT PRIMARY KEY REFERENCES invitations(token_hash) ON DELETE CASCADE,
  guest_name TEXT NOT NULL CHECK (length(guest_name) BETWEEN 1 AND 80),
  attendance TEXT NOT NULL CHECK (attendance IN ('yes', 'no')),
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 0 AND 20),
  updated_at INTEGER NOT NULL,
  CHECK ((attendance = 'yes' AND party_size >= 1) OR (attendance = 'no' AND party_size = 0))
);
CREATE TABLE submission_limits (
  invitation_hash TEXT PRIMARY KEY REFERENCES invitations(token_hash) ON DELETE CASCADE,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
