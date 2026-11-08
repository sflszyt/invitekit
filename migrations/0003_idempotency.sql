CREATE TABLE rsvp_requests (
  invitation_hash TEXT NOT NULL REFERENCES invitations(token_hash) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (invitation_hash, request_id)
);
