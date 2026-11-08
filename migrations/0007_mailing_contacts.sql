ALTER TABLE managed_guests ADD COLUMN recipient TEXT NOT NULL DEFAULT '' CHECK (length(recipient) <= 80);
ALTER TABLE managed_guests ADD COLUMN phone TEXT NOT NULL DEFAULT '' CHECK (length(phone) <= 60);
