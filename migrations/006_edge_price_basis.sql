-- Exchange quotes: the price EV is computed on (ask, or mid less a haircut) beside the price as quoted (2026-10-20).
ALTER TABLE edges ADD COLUMN IF NOT EXISTS price_quoted double precision;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS price_basis text;   -- book | ask | mid-haircut
