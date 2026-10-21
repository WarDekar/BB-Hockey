import { useEffect, useMemo, useState } from "react";
import type { PullAgg, PullBin, PullCoach, PullEpisode, Pulls as PullsData } from "../lib/api";
import { useApi } from "../hooks";
import { pct } from "../lib/format";
import { Empty, ErrorBox, Panel, Stat, Td, Th } from "./Primitives";
import { ChipGroup, Divider, MultiSelect, inputClass } from "./Filters";
import PullNotes from "./PullNotes";

// Goalie-pull desk. Everything is aggregated server-side (GET /pulls) over the
// materialized situations view; the tab only sends its filters and draws.
interface Filters { deficit: string; season: string; type: string; venue: string; teams: string[] | null; coaches: string[] | null; minN: number; search: string }
const DEFAULT: Filters = { deficit: "1", season: "all", type: "all", venue: "all", teams: null, coaches: null, minN: 12, search: "" };
const KEY = "bbh_pulls_filters_v2";
const load = (): Filters => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || "{}"), search: "" }; } catch { return DEFAULT; } };

const seasonLabel = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6)}`;
const mmss = (s: number | null | undefined) => { if (s === null || s === undefined || !isFinite(s)) return "—"; const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
type SortKey = "situations" | "pull_rate" | "median_s" | "earliest_s" | "tied" | "en" | "ot_or_won";

function query(f: Filters): string {
  const q = new URLSearchParams({ deficit: f.deficit, min_n: String(Math.max(1, f.minN)) });
  if (f.season !== "all") q.set("season", f.season);
  if (f.type !== "all") q.set("game_type", f.type === "playoffs" ? "3" : "2");
  if (f.venue !== "all") q.set("venue", f.venue);
  if (f.teams) q.set("teams", f.teams.join(","));
  if (f.coaches) q.set("coaches", f.coaches.join(","));
  return `/pulls?${q.toString()}`;
}

/** Timing histogram with the empty-net and scoring rate per bin drawn as lines on a second panel (one scale each, never shared). */
function TimingChart({ bins, binS, median }: { bins: PullBin[]; binS: number; median: number | null }) {
  const W = 640, H = 170, L = 36, R = 12, T = 10, B = 24;
  const MAX = 300;                                                   // nearly every pull is inside 5:00; later bins are dropped from the drawing
  bins = bins.filter((b) => b.bin_s < MAX);
  const xs = (s: number) => L + ((MAX - s) / MAX) * (W - L - R);     // time left runs right-to-left: 5:00 on the left, 0:00 on the right
  const maxN = Math.max(1, ...bins.map((b) => b.pulls));
  const yN = (n: number) => T + (1 - n / maxN) * (H - T - B);
  const yR = (r: number) => T + (1 - r) * (H - T - B);
  const ticks = [300, 240, 180, 120, 60, 0];
  const line = (key: "en_rate" | "scored_rate") => bins.filter((b) => b.pulls >= 5).map((b, i) => `${i ? "L" : "M"}${xs(b.bin_s + binS / 2).toFixed(1)},${yR(b[key]).toFixed(1)}`).join(" ");
  const axis = (label: string) => (
    <>
      {ticks.map((t) => <text key={t} x={xs(t)} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[10px]">{mmss(t)}</text>)}
      <text x={W - R} y={T + 2} textAnchor="end" className="fill-slate-500 text-[10px]">{label}</text>
    </>
  );
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {axis("pulls by time left")}
        {bins.map((b) => (
          <rect key={b.bin_s} x={xs(b.bin_s + binS) + 1} width={Math.max(1, xs(b.bin_s) - xs(b.bin_s + binS) - 2)} y={yN(b.pulls)} height={yN(0) - yN(b.pulls)} rx={2} className="fill-accent/80">
            <title>{`${mmss(b.bin_s + binS)}–${mmss(b.bin_s)} left · ${b.pulls} pulls`}</title>
          </rect>
        ))}
        {median !== null && <line x1={xs(median)} x2={xs(median)} y1={T} y2={H - B} stroke="currentColor" strokeDasharray="4 3" className="text-slate-400" />}
        {median !== null && <text x={xs(median) + 4} y={T + 12} className="fill-slate-300 text-[10px]">median {mmss(median)}</text>}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="currentColor" className="text-slate-700" />
      </svg>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {axis("rate during the pull, bins with 5+ pulls")}
        {[0, 0.25, 0.5, 0.75].map((r) => <g key={r}><line x1={L} x2={W - R} y1={yR(r)} y2={yR(r)} stroke="currentColor" className="text-slate-800" /><text x={L - 4} y={yR(r) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">{pct(r, 0)}</text></g>)}
        <path d={line("en_rate")} fill="none" stroke="#fda4af" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={line("scored_rate")} fill="none" stroke="#6ee7b7" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {bins.filter((b) => b.pulls >= 5).map((b) => (
          <g key={b.bin_s}>
            <circle cx={xs(b.bin_s + binS / 2)} cy={yR(b.en_rate)} r={3} fill="#fda4af"><title>{`${mmss(b.bin_s + binS)}–${mmss(b.bin_s)} left · ${b.pulls} pulls · empty-netter ${pct(b.en_rate, 0)} · scored ${pct(b.scored_rate, 0)}`}</title></circle>
            <circle cx={xs(b.bin_s + binS / 2)} cy={yR(b.scored_rate)} r={3} fill="#6ee7b7" />
          </g>
        ))}
        <text x={L + 4} y={T + 12} className="text-[10px]" fill="#fda4af">conceded empty-netter</text>
        <text x={L + 4} y={T + 24} className="text-[10px]" fill="#6ee7b7">scored 6v5</text>
      </svg>
    </div>
  );
}

export default function Pulls() {
  const [view, setView] = useState<"notes" | "desk">(() => { try { return localStorage.getItem("bbh_pulls_view") === "desk" ? "desk" : "notes"; } catch { return "notes"; } });
  useEffect(() => { try { localStorage.setItem("bbh_pulls_view", view); } catch { /* private mode */ } }, [view]);
  const switcher = (
    <div className="flex shrink-0 items-center gap-2">
      <ChipGroup value={view} onChange={(v) => setView(v === "desk" ? "desk" : "notes")} options={[["notes", "Coach notes"], ["desk", "Pull desk"]]} />
      <span className="text-[11px] text-slate-500">{view === "notes" ? "who to bet on the puck line and the +2.5, by current bench" : "every coach, every pull, with filters"}</span>
    </div>
  );
  if (view === "notes") return <div className="flex h-full min-h-0 flex-col gap-3">{switcher}<PullNotes /></div>;
  return <div className="flex h-full min-h-0 flex-col gap-3">{switcher}<PullDesk /></div>;
}

function PullDesk() {
  const [f, setF] = useState<Filters>(load);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "situations", dir: -1 });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ ...f, search: "" })); } catch { /* private mode */ } }, [f]);
  const set = (patch: Partial<Filters>) => setF((p) => ({ ...p, ...patch }));
  const res = useApi<PullsData>(query(f), 0, false);
  const data = res.data;
  const k = Number(f.deficit);
  const deficitWord = k >= 3 ? "3+" : String(k);
  const L: PullAgg | null = data?.league ?? null;

  const rows = useMemo(() => {
    if (!data) return [] as PullCoach[];
    const q = f.search.trim().toLowerCase();
    const val = (r: PullCoach) => { const v = r[sort.key]; return v === null ? (sort.dir === -1 ? -Infinity : Infinity) : v; };
    return data.by_coach.filter((r) => !q || r.coach.toLowerCase().includes(q) || r.teams.toLowerCase().includes(q) || (r.current_team ?? "").toLowerCase().includes(q))
      .sort((a, b) => (val(a) - val(b)) * sort.dir || b.situations - a.situations);
  }, [data, f.search, sort]);
  const active = JSON.stringify({ ...f, search: "" }) !== JSON.stringify(DEFAULT) || f.search.trim() !== "";
  const head = (label: string, key: SortKey) => (
    <Th right className="cursor-pointer select-none hover:text-slate-300"><span onClick={() => setSort((p) => ({ key, dir: p.key === key ? (p.dir === -1 ? 1 : -1) : -1 }))}>{label}{sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}</span></Th>
  );
  const cmp = (v: number | null, ref: number | null | undefined) => (v !== null && ref !== null && ref !== undefined ? (v >= ref ? "text-emerald-300" : "text-amber-300") : "");
  const teamOpts = useMemo(() => (data?.options.teams ?? []).map((t) => ({ key: t.key, label: t.key, sub: String(t.n) })), [data]);
  const coachOpts = useMemo(() => (data?.options.coaches ?? []).map((c) => ({ key: c.key, label: c.key, sub: String(c.n) })), [data]);
  const seasons = data?.options.seasons ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label={`Down ${deficitWord} late`} value={L?.situations ?? "—"} sub="team-games inside 3:00" />
        <Stat label="Pulled" value={L?.pull_rate === null || !L ? "—" : pct(L.pull_rate, 0)} sub={L ? `${L.pulled} of ${L.situations}` : undefined} />
        <Stat label="Median time left" value={mmss(L?.median_s)} sub={L?.p25_s === null || !L ? undefined : `IQR ${mmss(L.p25_s)}–${mmss(L.p75_s)}`} />
        <Stat label="Scored 6v5" value={L?.scored === null || !L ? "—" : pct(L.scored, 0)} sub="of pulls, any goal for" />
        <Stat label="Tied it" value={L?.tied === null || !L ? "—" : pct(L.tied, 0)} sub="of pulls, got level" />
        <Stat label="Empty-netter" value={L?.en === null || !L ? "—" : pct(L.en, 0)} sub="of pulls, conceded" tone="text-rose-300" />
        <Stat label="Got to OT or won" value={L?.ot_or_won === null || !L ? "—" : pct(L.ot_or_won, 0)} sub="of situations" />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <ChipGroup value={f.deficit} onChange={(deficit) => set({ deficit: deficit === "all" ? "1" : deficit, minN: deficit === "1" ? 12 : 8 })} options={[["1", "Down 1"], ["2", "Down 2"], ["3", "Down 3+"]]} />
        <Divider />
        <ChipGroup value={f.season} onChange={(season) => set({ season })} options={seasons.map((s) => [String(s), seasonLabel(s)])} />
        <Divider />
        <ChipGroup value={f.type} onChange={(type) => set({ type })} options={[["regular", "Regular"], ["playoffs", "Playoffs"]]} />
        <Divider />
        <ChipGroup value={f.venue} onChange={(venue) => set({ venue })} options={[["home", "Home"], ["away", "Away"]]} />
        <Divider />
        <MultiSelect options={teamOpts} value={f.teams} onChange={(teams) => set({ teams })} noun="teams" />
        <MultiSelect options={coachOpts} value={f.coaches} onChange={(coaches) => set({ coaches })} noun="coaches" />
        <Divider />
        <label className="flex items-center gap-1 text-[11px] text-slate-500">min <input type="number" min={1} value={f.minN} onChange={(e) => set({ minN: Math.max(1, Number(e.target.value) || 1) })} className={`${inputClass} w-12 text-right font-mono`} /> situations</label>
        <Divider />
        <input value={f.search} onChange={(e) => set({ search: e.target.value })} placeholder="coach or team…" className={`${inputClass} w-32`} />
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          {res.loading && <span className="text-slate-600">loading…</span>}
          <span><span className="font-mono text-slate-300">{rows.length}</span> coaches</span>
          {active && <button onClick={() => setF(DEFAULT)} className="text-accent hover:underline">clear</button>}
        </span>
      </div>

      {res.error && <div className="shrink-0"><ErrorBox error={res.error} /></div>}

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="flex flex-col gap-3">
          <Panel title={`Timing and what it costs · down ${deficitWord}`} right={<span>{data?.bin_s ?? 30}-second bins · time left runs 5:00 → 0:00</span>}>
            {data && data.bins.length ? <TimingChart bins={data.bins} binS={data.bin_s} median={L?.median_s ?? null} /> : <Empty>No pulls match these filters.</Empty>}
          </Panel>

          <Panel title={`By coach · down ${deficitWord} inside 3:00`} right={<span>{(data?.ingest ?? []).map((i) => `${seasonLabel(i.season)} ${i.games}${i.errors ? ` (${i.errors} err)` : ""}`).join(" · ")}</span>}>
            {!rows.length ? <Empty>{data ? `No coach has ${f.minN}+ situations under these filters.` : "Loading…"}</Empty> : (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead><tr>
                    <Th>Coach</Th><Th>Now</Th><Th>In sample</Th><Th right>Games</Th>{head("Situations", "situations")}{head("Pulled", "pull_rate")}{head("Median left", "median_s")}<Th right>IQR</Th>{head("Earliest", "earliest_s")}<Th right>Scored</Th>{head("Tied", "tied")}{head("EN conceded", "en")}{head("OT or won", "ot_or_won")}
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.coach} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                        <Td className="cursor-pointer font-medium text-slate-100" onClick={() => set({ coaches: [r.coach] })}>{r.coach}</Td>
                        <Td className={`font-mono ${r.current_team ? "text-ice" : "text-slate-600"}`}>{r.current_team ?? "—"}</Td>
                        <Td className="font-mono text-slate-500">{r.teams}</Td><Td right mono className="text-slate-500">{r.games}</Td>
                        <Td right mono>{r.situations}</Td>
                        <Td right mono className={cmp(r.pull_rate, L?.pull_rate)}>{r.pull_rate === null ? "—" : pct(r.pull_rate, 0)}</Td>
                        <Td right mono className={cmp(r.median_s, L?.median_s)}>{mmss(r.median_s)}</Td>
                        <Td right mono className="text-slate-500">{r.p25_s === null ? "—" : `${mmss(r.p25_s)}–${mmss(r.p75_s)}`}</Td>
                        <Td right mono className="text-slate-400">{mmss(r.earliest_s)}</Td>
                        <Td right mono className="text-slate-400">{r.scored === null ? "—" : pct(r.scored, 0)}</Td>
                        <Td right mono>{r.tied === null ? "—" : pct(r.tied, 0)}</Td>
                        <Td right mono className="text-rose-300/80">{r.en === null ? "—" : pct(r.en, 0)}</Td>
                        <Td right mono>{r.ot_or_won === null ? "—" : pct(r.ot_or_won, 0)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <details className="rounded-lg border border-slate-800 bg-slate-900">
            <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Latest pulls down {deficitWord} <span className="ml-2 font-mono normal-case tracking-normal text-slate-400">{data?.episodes.length ?? 0}</span></summary>
            <div className="max-h-[50vh] overflow-auto border-t border-slate-800 p-3 scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-[1] bg-slate-900"><tr><Th>Date</Th><Th>Team</Th><Th>Coach</Th><Th>Opp</Th><Th right>Time left</Th><Th right>Score</Th><Th right>For</Th><Th right>Against</Th><Th>Ended</Th><Th right>Final</Th><Th>Src</Th></tr></thead>
                <tbody>
                  {(data?.episodes ?? []).map((e: PullEpisode) => (
                    <tr key={e.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                      <Td className="text-slate-500">{e.game_date}</Td><Td className="font-medium text-slate-100">{e.team_abbr}{e.is_home ? "" : " @"}</Td><Td className="text-slate-300">{e.coach ?? "—"}</Td><Td className="text-slate-400">{e.opp_abbr}</Td>
                      <Td right mono>{mmss(e.pull_remaining_s)}<span className="text-slate-600"> · {e.duration_s}s</span></Td>
                      <Td right mono className="text-slate-400">{e.score_for}–{e.score_against}</Td>
                      <Td right mono className={e.goals_for ? "text-emerald-300" : "text-slate-600"}>{e.goals_for}</Td><Td right mono className={e.goals_against ? "text-rose-300" : "text-slate-600"}>{e.goals_against}</Td>
                      <Td className="text-slate-400">{e.ended_by.replace("_", " ")}</Td><Td right mono className="text-slate-400">{e.final_for}–{e.final_against}{e.went_ot ? " OT" : ""}</Td><Td className="text-slate-600">{e.source}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
