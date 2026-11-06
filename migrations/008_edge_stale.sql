-- A quote older than the consensus's last material move (2026-11-05): shown on the board, never auto-papered.
ALTER TABLE edges ADD COLUMN IF NOT EXISTS stale boolean NOT NULL DEFAULT false;
