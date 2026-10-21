// BASE_URL is "/hockey/" (vite base). The API and Socket.IO live under the same
// prefix (fleet path-routing contract), so this works through the gateway, the
// vite proxy and the single-port :5018 alike.
export const BASE = import.meta.env.BASE_URL;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handle<T>(resp: Response, path: string): Promise<T> {
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText} for ${path}`;
    try {
      const body = await resp.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* keep status text */ }
    throw new ApiError(resp.status, detail);
  }
  return (await resp.json()) as T;
}

export const getJson = <T,>(path: string) => fetch(`${BASE}api${path}`).then((r) => handle<T>(r, path));
export const sendJson = <T,>(method: "POST" | "PUT", path: string, body?: unknown) =>
  fetch(`${BASE}api${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then((r) => handle<T>(r, path));

export interface MarketCheck { point: number | null; market: number; model: number; diff: number }
export interface Summary {
  lambda_home: number; lambda_away: number; p_home: number; p_reg_home: number; p_draw: number; p_reg_away: number;
  p_tie_home: number; exp_total: number; exp_reg_total: number; converged?: boolean; market_check?: Record<string, MarketCheck>;
}
export interface Inputs { p_home: number; total_point: number; p_over: number; total_assumed: boolean; consensus_at: string | null; market: Record<string, { point: number | null; prob: number }>; source?: string }
export interface Game {
  id: number; espn_game_id: number | null; game_time: string; home_name: string; away_name: string; home_abbr: string | null; away_abbr: string | null;
  home_rotation: number | null; away_rotation: number | null; status: string; final_home: number | null; final_away: number | null;
  reg_home: number | null; reg_away: number | null; periods: number[][] | null; went_ot: boolean | null; went_so: boolean | null; settled_at: string | null;
}
export interface SlateRow extends Game { snapshot_id: number | null; priced_at: string | null; inputs: Inputs | null; summary: Summary | null; n_edges: number; best_ev: number | null; n_bets: number; pnl: number }
export interface BoardRow { market: string; side: string; point: number | null; prob: number; push: number; fair_price: number | null }
export interface QuoteRow { game_id: number; market: string; side: string; point: number | null; period_src: string; sportsbook_id: number; sportsbook: string; book_group: string | null; price: number; quoted_at: string | null; fair_prob: number; push_prob: number; fair_price: number | null; ev: number; kelly: number }
export interface Edge extends QuoteRow { id: number; home_name: string; away_name: string; home_abbr: string | null; away_abbr: string | null; game_time: string; status: string; papered: boolean }
export interface Snapshot { id: number; game_id: number; computed_at: string; kind: string; inputs: Inputs; params: Record<string, unknown>; summary: Summary; board: BoardRow[] }
export interface GameDetail { game: Game; snapshot: Snapshot | null; closing: Snapshot | null; quotes: QuoteRow[]; best: Record<string, QuoteRow>; edges: QuoteRow[]; bets: Bet[]; markets: string[] }
export interface Bet {
  id: number; game_id: number; market: string; side: string; point: number | null; sportsbook: string; price: number; stake: number; fair_prob: number; push_prob: number;
  ev: number; kelly: number | null; source: string; placed_at: string; status: string; pnl: number | null; settled_at: string | null; closing_fair_prob: number | null;
  closing_price: number | null; clv_model: number | null; clv_price: number | null; note: string | null;
  home_name?: string; away_name?: string; home_abbr?: string | null; away_abbr?: string | null; game_time?: string; final_home?: number | null; final_away?: number | null; game_status?: string;
}
export interface BetSummary {
  pending: number; settled: number; won: number; lost: number; pushed: number; staked: number; pnl: number; roi: number | null;
  avg_clv_model: number | null; avg_clv_price: number | null; clv_model_pos: number; clv_model_n: number; avg_ev: number | null;
  by_market: { market: string; n: number; won: number; lost: number; staked: number; pnl: number; avg_clv_model: number | null; avg_ev: number | null }[];
}
export interface Health { status: string; version: string; heartbeats: Record<string, { job: string; last_run_at: string; ok: boolean; note: string }>; counts: { games: number; finals: number; pending_bets: number; snapshots: number }; paper: { auto: boolean; min_edge: number; kelly_fraction: number } }
export interface Calibration {
  buckets: { b: number; n: number; mean_prob: number; hit: number; brier: number }[];
  by_family: { family: string; n: number; mean_prob: number; hit: number; brier: number; bias: number }[];
  diagnostics: Record<string, number | null>;
  families: string[];
}
export interface ResultRow extends Game { closing_summary: Summary | null; closing_inputs: Inputs | null; n_bets: number; pnl: number }
export interface Params { params: Record<string, number | number[]>; defaults: Record<string, number | number[]> }

export interface PullEpisode {
  id: number; game_id: number; season: number; game_type: number; game_date: string; team_abbr: string; is_home: boolean; coach: string | null;
  opp_abbr: string; opp_coach: string | null; episode_no: number; kind: string; source: string; period: number; period_type: string;
  pull_elapsed_s: number; pull_remaining_s: number; end_elapsed_s: number; duration_s: number; ended_by: string;
  score_for: number; score_against: number; deficit: number; goals_for: number; goals_against: number;
  final_for: number; final_against: number; reg_for: number; reg_against: number; went_ot: boolean;
}
export interface PullSituation {
  game_id: number; season: number; game_type: number; game_date: string; team: string; is_home: boolean; coach: string | null; opp: string; opp_coach: string | null;
  late_deficits: number[]; max_late_deficit: number | null; final_for: number; final_against: number; reg_for: number; reg_against: number;
  went_ot: boolean; went_so: boolean; source: string | null;
  pulls: { deficit: number; remaining_s: number; duration_s: number; goals_for: number; goals_against: number; ended_by: string; period: number }[];
}
export interface Pulls {
  situations: PullSituation[]; episodes: PullEpisode[]; seasons: number[];
  coaches: { league: string; team: string; coach: string; start_date: string; end_date: string | null; games: number }[];
  ingest: { season: number; games: number; errors: number; pbp_only: number; last_date: string }[];
}
