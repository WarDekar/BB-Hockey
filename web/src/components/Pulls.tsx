import { useEffect, useMemo, useState } from "react";
import type { PullEpisode, PullSituation, Pulls as PullsData } from "../lib/api";
import { pct } from "../lib/format";
import { Empty, Panel, Stat, Td, Th } from "./Primitives";
import { ChipGroup, Divider, MultiSelect, inputClass } from "./Filters";

// Goalie-pull desk. A "situation" is a team-game where the team was down by the
// focus deficit at some point inside the last three minutes of regulation; the
// coach table says how often that coach pulled, how early, and what came of it.
interface Filters { season: string; type: string; deficit: string; venue: string; teams: string[] | null; coaches: string[] | null; minN: number; search: string; kind: string }
const DEFAULT: Filters = { season: "all", type: "all", deficit: "1", venue: "all", teams: null, coaches: null, minN: 5, search: "", kind: "pull" };
const KEY = "bbh_pulls_filters_v1";
const load = (): Filters => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || "{}"), search: "" }; } catch { return DEFAULT; } };

const seasonLabel = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6)}`;
const mmss = (s: number | null) => { if (s === null || !isFinite(s)) return "—"; const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const quantile = (xs: number[], q: number) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); const i = (a.length - 1) * q; const lo = Math.floor(i); return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo); };
const inDeficit = (s: PullSituation, k: number) => (k >= 3 ? s.late_deficits.some((d) => d >= 3) : s.late_deficits.includes(k));
const pullsAt = (s: PullSituation, k: number) => s.pulls.filter((p) => (k >= 3 ? p.deficit >= 3 : p.deficit === k));
const tiedIt = (s: PullSituation) => s.pulls.some((p) => p.goals_for > 0 && p.deficit - p.goals_for + p.goals_against <= 0);

function aggregate(rows: PullSituation[], k: number) {
  const pulled = rows.filter((s) => pullsAt(s, k).length > 0);
  const times = pulled.map((s) => Math.max(...pullsAt(s, k).map((p) => p.remaining_s)));
  return {
    n: rows.length, pulled: pulled.length, pull_rate: rows.length ? pulled.length / rows.length : null,
    median: quantile(times, 0.5), p25: quantile(times, 0.25), p75: quantile(times, 0.75), earliest: times.length ? Math.max(...times) : null,
    scored: pulled.length ? pulled.filter((s) => pullsAt(s, k).some((p) => p.goals_for > 0)).length / pulled.length : null,
    tied: pulled.length ? pulled.filter(tiedIt).length / pulled.length : null,
    en: pulled.length ? pulled.filter((s) => pullsAt(s, k).some((p) => p.goals_against > 0)).length / pulled.length : null,
    points: rows.length ? rows.filter((s) => s.reg_for >= s.reg_against).length / rows.length : null,
  };
}
type Agg = ReturnType<typeof aggregate>;
type SortKey = "n" | "pull_rate" | "median" | "earliest" | "tied" | "en" | "points";

export default function Pulls({ data }: { data: PullsData }) {
  const [f, setF] = useState<Filters>(load);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "n", dir: -1 });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ ...f, search: "" })); } catch { /* private mode */ } }, [f]);
  const set = (patch: Partial<Filters>) => setF((p) => ({ ...p, ...patch }));
  const k = Number(f.deficit);

  const teams = useMemo(() => [...new Set(data.situations.map((s) => s.team))].sort().map((t) => ({ key: t, label: t })), [data]);
  const coaches = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of data.situations) if (s.coach) counts.set(s.coach, (counts.get(s.coach) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, n]) => ({ key: c, label: c, sub: String(n) }));
  }, [data]);

  const base = useMemo(() => {
    const teamSet = f.teams && new Set(f.teams); const coachSet = f.coaches && new Set(f.coaches);
    const q = f.search.trim().toLowerCase();
    return data.situations.filter((s) =>
      (f.season === "all" || String(s.season) === f.season)
      && (f.type === "all" || (f.type === "playoffs") === (s.game_type === 3))
      && (f.venue === "all" || (f.venue === "home") === s.is_home)
      && (!teamSet || teamSet.has(s.team)) && (!coachSet || (s.coach !== null && coachSet.has(s.coach)))
      && (!q || s.team.toLowerCase().includes(q) || (s.coach ?? "").toLowerCase().includes(q)));
  }, [data, f]);
  const situations = useMemo(() => base.filter((s) => inDeficit(s, k)), [base, k]);
  const league = useMemo(() => aggregate(situations, k), [situations, k]);

  const byCoach = useMemo(() => {
    const groups = new Map<string, PullSituation[]>();
    for (const s of situations) groups.set(s.coach ?? "?", [...(groups.get(s.coach ?? "?") ?? []), s]);
    const rows = [...groups.entries()].map(([coach, rows]) => ({ coach, teams: [...new Set(rows.map((r) => r.team))].join(" "), games: base.filter((b) => (b.coach ?? "?") === coach).length, ...aggregate(rows, k) }));
    const val = (r: Agg) => { const v = r[sort.key]; return v === null ? (sort.dir === -1 ? -Infinity : Infinity) : v; };
    return rows.filter((r) => r.n >= f.minN).sort((a, b) => (val(a) - val(b)) * sort.dir || b.n - a.n);
  }, [situations, base, k, f.minN, sort]);

  const episodes = useMemo(() => {
    const keep = new Set(base.map((s) => `${s.game_id}:${s.team}`));
    return data.episodes.filter((e) => keep.has(`${e.game_id}:${e.team_abbr}`) && (f.kind === "all" || e.kind === f.kind) && (f.kind !== "pull" || (k >= 3 ? e.deficit >= 3 : e.deficit === k)))
      .sort((a, b) => b.game_date.localeCompare(a.game_date) || b.game_id - a.game_id);
  }, [data, base, f.kind, k]);
  const active = JSON.stringify({ ...f, search: "" }) !== JSON.stringify(DEFAULT) || f.search.trim() !== "";
  const head = (label: string, key: SortKey, right = true) => (
    <Th right={right} className="cursor-pointer select-none hover:text-slate-300" ><span onClick={() => setSort((p) => ({ key, dir: p.key === key ? (p.dir === -1 ? 1 : -1) : -1 }))}>{label}{sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : ""}</span></Th>
  );
  const deficitWord = k >= 3 ? "3+" : String(k);
  const ingest = data.ingest;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label={`Down ${deficitWord} late`} value={league.n} sub={`team-games · ${base.length} in view`} />
        <Stat label="Pulled" value={league.pull_rate === null ? "—" : pct(league.pull_rate, 0)} sub={`${league.pulled} of ${league.n}`} />
        <Stat label="Median time left" value={mmss(league.median)} sub={league.p25 === null ? undefined : `IQR ${mmss(league.p25)}–${mmss(league.p75)}`} />
        <Stat label="Scored 6v5" value={league.scored === null ? "—" : pct(league.scored, 0)} sub="of pulls, any goal for" />
        <Stat label="Tied it" value={league.tied === null ? "—" : pct(league.tied, 0)} sub="of pulls, got level" />
        <Stat label="Empty-netter" value={league.en === null ? "—" : pct(league.en, 0)} sub="of pulls, conceded" tone="text-rose-300" />
        <Stat label="Got to OT or won" value={league.points === null ? "—" : pct(league.points, 0)} sub="of situations" />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <ChipGroup value={f.deficit} onChange={(deficit) => set({ deficit: deficit === "all" ? "1" : deficit })} options={[["1", "Down 1"], ["2", "Down 2"], ["3", "Down 3+"]]} />
        <Divider />
        <ChipGroup value={f.season} onChange={(season) => set({ season })} options={data.seasons.map((s) => [String(s), seasonLabel(s)])} />
        <Divider />
        <ChipGroup value={f.type} onChange={(type) => set({ type })} options={[["regular", "Regular"], ["playoffs", "Playoffs"]]} />
        <Divider />
        <ChipGroup value={f.venue} onChange={(venue) => set({ venue })} options={[["home", "Home"], ["away", "Away"]]} />
        <Divider />
        <MultiSelect options={teams} value={f.teams} onChange={(teams) => set({ teams })} noun="teams" />
        <MultiSelect options={coaches} value={f.coaches} onChange={(coaches) => set({ coaches })} noun="coaches" />
        <Divider />
        <label className="flex items-center gap-1 text-[11px] text-slate-500">min <input type="number" min={1} value={f.minN} onChange={(e) => set({ minN: Math.max(1, Number(e.target.value) || 1) })} className={`${inputClass} w-12 text-right font-mono`} /> situations</label>
        <Divider />
        <input value={f.search} onChange={(e) => set({ search: e.target.value })} placeholder="coach or team…" className={`${inputClass} w-32`} />
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span><span className="font-mono text-slate-300">{byCoach.length}</span> coaches</span>
          {active && <button onClick={() => setF(DEFAULT)} className="text-accent hover:underline">clear</button>}
        </span>
      </div>

      <Panel className="flex min-h-0 flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col p-3" title={`By coach · down ${deficitWord} inside 3:00`} right={<span>{ingest.map((i) => `${seasonLabel(i.season)} ${i.games}${i.errors ? ` (${i.errors} err)` : ""}`).join(" · ")}</span>}>
        {!byCoach.length ? <Empty>No coach has {f.minN}+ situations under these filters.</Empty> : (
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[1] bg-slate-900 shadow-[0_1px_0_0_var(--color-slate-800)]"><tr>
                <Th>Coach</Th><Th>Teams</Th><Th right>Games</Th>{head("Situations", "n")}{head("Pulled", "pull_rate")}{head("Median left", "median")}<Th right>IQR</Th>{head("Earliest", "earliest")}<Th right>Scored</Th>{head("Tied", "tied")}{head("EN conceded", "en")}{head("OT or won", "points")}
              </tr></thead>
              <tbody>
                {byCoach.map((r) => (
                  <tr key={r.coach} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                    <Td className="cursor-pointer font-medium text-slate-100" onClick={() => set({ coaches: [r.coach] })}>{r.coach}</Td>
                    <Td className="font-mono text-slate-400">{r.teams}</Td><Td right mono className="text-slate-500">{r.games}</Td>
                    <Td right mono>{r.n}</Td>
                    <Td right mono className={r.pull_rate !== null && league.pull_rate !== null ? (r.pull_rate >= league.pull_rate ? "text-emerald-300" : "text-amber-300") : ""}>{r.pull_rate === null ? "—" : pct(r.pull_rate, 0)}</Td>
                    <Td right mono className={r.median !== null && league.median !== null ? (r.median >= league.median ? "text-emerald-300" : "text-amber-300") : ""}>{mmss(r.median)}</Td>
                    <Td right mono className="text-slate-500">{r.p25 === null ? "—" : `${mmss(r.p25)}–${mmss(r.p75)}`}</Td>
                    <Td right mono className="text-slate-400">{mmss(r.earliest)}</Td>
                    <Td right mono className="text-slate-400">{r.scored === null ? "—" : pct(r.scored, 0)}</Td>
                    <Td right mono>{r.tied === null ? "—" : pct(r.tied, 0)}</Td>
                    <Td right mono className="text-rose-300/80">{r.en === null ? "—" : pct(r.en, 0)}</Td>
                    <Td right mono>{r.points === null ? "—" : pct(r.points, 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <details className="shrink-0 rounded-lg border border-slate-800 bg-slate-900">
        <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Episodes <span className="ml-2 font-mono normal-case tracking-normal text-slate-400">{episodes.length}</span></summary>
        <div className="border-t border-slate-800 p-3">
          <div className="mb-2 flex items-center gap-3">
            <ChipGroup value={f.kind} onChange={(kind) => set({ kind: kind === "all" ? "all" : kind })} options={[["pull", "Pulls"], ["ot", "OT 6v5"], ["delayed_penalty", "Delayed penalty"], ["other", "Other"]]} />
            <span className="text-[11px] text-slate-500">{f.kind === "pull" ? `pulls down ${deficitWord} only` : "every episode in view"}</span>
          </div>
          <div className="max-h-[50vh] overflow-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[1] bg-slate-900 shadow-[0_1px_0_0_var(--color-slate-800)]"><tr><Th>Date</Th><Th>Team</Th><Th>Coach</Th><Th>Opp</Th><Th>P</Th><Th right>Time left</Th><Th right>Score</Th><Th right>Down</Th><Th right>For</Th><Th right>Against</Th><Th>Ended</Th><Th right>Final</Th><Th>Src</Th></tr></thead>
              <tbody>
                {episodes.slice(0, 1000).map((e: PullEpisode) => (
                  <tr key={e.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                    <Td className="text-slate-500">{e.game_date}</Td><Td className="font-medium text-slate-100">{e.team_abbr}{e.is_home ? "" : " @"}</Td><Td className="text-slate-300">{e.coach ?? "—"}</Td><Td className="text-slate-400">{e.opp_abbr}</Td>
                    <Td mono>{e.period_type === "OT" ? "OT" : e.period}</Td><Td right mono>{mmss(e.pull_remaining_s)}<span className="text-slate-600"> · {e.duration_s}s</span></Td>
                    <Td right mono className="text-slate-400">{e.score_for}–{e.score_against}</Td><Td right mono>{e.deficit}</Td>
                    <Td right mono className={e.goals_for ? "text-emerald-300" : "text-slate-600"}>{e.goals_for}</Td><Td right mono className={e.goals_against ? "text-rose-300" : "text-slate-600"}>{e.goals_against}</Td>
                    <Td className="text-slate-400">{e.ended_by.replace("_", " ")}</Td><Td right mono className="text-slate-400">{e.final_for}–{e.final_against}{e.went_ot ? " OT" : ""}</Td><Td className="text-slate-600">{e.source}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
