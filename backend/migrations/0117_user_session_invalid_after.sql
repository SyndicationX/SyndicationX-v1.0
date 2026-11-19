-- Access changes (role, company, status) invalidate sessions issued before this time.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "session_invalid_after" timestamptz;
