export const fmtAmerican = (a: number | null | undefined): string => {
  if (a === null || a === undefined || !isFinite(a)) return "—";
  const r = Math.round(a);
  return r > 0 ? `+${r}` : `${r}`;
};
export const pct = (p: number | null | undefined, d = 1): string => (p === null || p === undefined || !isFinite(p) ? "—" : `${(p * 100).toFixed(d)}%`);
export const signedPct = (p: number | null | undefined, d = 1): string => {
  if (p === null || p === undefined || !isFinite(p)) return "—";
  const s = (p * 100).toFixed(d);
  return p > 0 ? `+${s}%` : `${s}%`;
};
export const money = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const s = Math.abs(v).toFixed(0);
  return v < 0 ? `−$${s}` : `$${s}`;
};
export const num = (v: number | null | undefined, d = 2): string => (v === null || v === undefined || !isFinite(v) ? "—" : v.toFixed(d));
export const fmtPoint = (pt: number | null | undefined): string => {
  if (pt === null || pt === undefined) return "";
  return pt > 0 ? `+${pt}` : `${pt}`;
};
export const fmtTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
export const fmtClock = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—");
export const ago = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${(s / 3600).toFixed(1)}h ago`;
};

export const MARKET_LABEL: Record<string, string> = {
  ml: "Moneyline", "3way": "60-min 3-way", puck: "Puck line", total: "Total", reg_total: "Regulation total",
  team_total_home: "Home team total", team_total_away: "Away team total",
  p1_ml: "P1 moneyline", p1_3way: "P1 3-way", p1_spread: "P1 spread", p1_total: "P1 total",
  p2_ml: "P2 moneyline", p2_3way: "P2 3-way", p2_spread: "P2 spread", p2_total: "P2 total",
  p3_ml: "P3 moneyline", p3_3way: "P3 3-way", p3_spread: "P3 spread", p3_total: "P3 total",
};
export const marketLabel = (m: string) => MARKET_LABEL[m] ?? m;

export function sideLabel(side: string, point: number | null | undefined, homeAbbr?: string | null, awayAbbr?: string | null): string {
  const pt = point === null || point === undefined ? "" : ` ${fmtPoint(point)}`;
  if (side === "home") return `${homeAbbr ?? "Home"}${pt}`;
  if (side === "away") return `${awayAbbr ?? "Away"}${pt}`;
  if (side === "draw") return "Draw";
  if (side === "over") return `Over ${point ?? ""}`;
  if (side === "under") return `Under ${point ?? ""}`;
  return side;
}

export const evClass = (ev: number): string => (ev >= 0.05 ? "text-emerald-300" : ev >= 0.02 ? "text-emerald-400/80" : ev >= 0 ? "text-slate-300" : "text-rose-400/80");
export const matchup = (g: { home_abbr?: string | null; away_abbr?: string | null; home_name: string; away_name: string }) =>
  `${g.away_abbr ?? g.away_name} @ ${g.home_abbr ?? g.home_name}`;
