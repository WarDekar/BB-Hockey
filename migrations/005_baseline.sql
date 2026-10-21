-- Baseline (league-average empty-net) board beside the coach-adjusted one, so every edge can show
-- what the ML + total alone imply and what the bench adjustment adds (2026-10-20).
ALTER TABLE pricing_snapshots ADD COLUMN IF NOT EXISTS board_base jsonb;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS base_prob double precision;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS base_ev double precision;
