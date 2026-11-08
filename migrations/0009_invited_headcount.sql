ALTER TABLE managed_guests ADD COLUMN invited_size INTEGER NOT NULL DEFAULT 1 CHECK (invited_size BETWEEN 1 AND 20);
UPDATE managed_guests SET invited_size=max(1,party_size);
