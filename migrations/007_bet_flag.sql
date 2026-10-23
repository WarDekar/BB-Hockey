-- A paper bet placed on a quote that was never live (2026-10-23): 'stale_feed' = a donbest_live copy of a book
-- OddsLogic carries (BetOnline 1393 beside 713). Flagged bets stay in the ledger but leave the summary and results.
ALTER TABLE paper_bets ADD COLUMN IF NOT EXISTS flag text;
