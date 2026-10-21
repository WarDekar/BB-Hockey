import { useEffect, useMemo, useState } from "react";
import type { Edge } from "../lib/api";
import { ago, evClass, fmtAmerican, fmtClock, marketLabel, matchup, pct, sideLabel, signedPct } from "../lib/format";
import { Empty, Panel, Pill, Td, Th } from "./Primitives";
import { ChipGroup, Divider, LINE_OPTS, MultiSelect, PERIOD_OPTS, inputClass, lineOf, periodOf, teamMatch } from "./Filters";

// Same composable bar as the Bets tab. Edges are pregame-only by construction
// (the API drops started games), so the date group is just today / tomorrow / later.
interface Filters { line: string; period: string; side: string; papered: string; books: string[] | null; day: string; team: string; min: number | null; source: string }
const DEFAULT: Filters = { line: "all", period: "all", side: "all", papered: "all", books: null, day: "all", team: "", min: null, source: "all" };
const KEY = "bbh_edges_filters_v1";
const load = (): Filters => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || "{}"), team: "" }; } catch { return DEFAULT; } };

const dayOf = (iso: string) => {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const days = Math.floor((new Date(iso).getTime() - d0.getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : "later";
};
const sideOf = (s: string) => (s === "over" || s === "under" ? s : s === "draw" ? "draw" : "team");
/** Where the edge comes from: the benches (only above threshold after the coach adjustment), the market alone (above
 *  threshold at the league baseline too), or the adjustment cuts against it (baseline EV higher than ours). */
const sourceOf = (e: Edge, min: number) => (e.base_ev === null || e.base_ev === undefined ? "unknown" : e.base_ev >= min ? "market" : e.ev >= min ? "coach" : "none");
const adjOf = (e: Edge) => (e.base_prob === null || e.base_prob === undefined ? null : e.fair_prob - e.base_prob);

export default function Edges({ rows, minEdge, onOpen }: { rows: Edge[]; minEdge: number; onOpen: (id: number) => void }) {
  const [f, setF] = useState<Filters>(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ ...f, team: "" })); } catch { /* private mode */ } }, [f]);
  const set = (patch: Partial<Filters>) => setF((p) => ({ ...p, ...patch }));
  const min = f.min ?? minEdge;

  const books = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.sportsbook, (counts.get(r.sportsbook) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => ({ key: k, label: k, sub: String(n) }));
  }, [rows]);

  const shown = useMemo(() => {
    const bookSet = f.books === null ? null : new Set(f.books);
    const team = f.team.trim().toLowerCase();
    return rows.filter((r) =>
      r.ev >= min
      && (f.line === "all" || lineOf(r.market) === f.line)
      && (f.period === "all" || periodOf(r.market) === f.period)
      && (f.side === "all" || sideOf(r.side) === f.side)
      && (f.papered === "all" || (f.papered === "papered") === r.papered)
      && (f.source === "all" || (f.source === "against" ? (adjOf(r) ?? 0) < -0.005 : sourceOf(r, min) === f.source))
      && (!bookSet || bookSet.has(r.sportsbook))
      && (f.day === "all" || dayOf(r.game_time) === f.day)
      && teamMatch(team, r));
  }, [rows, f, min]);
  const active = JSON.stringify({ ...f, team: "" }) !== JSON.stringify(DEFAULT) || f.team.trim() !== "";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <label className="flex items-center gap-1 text-[11px] text-slate-500">min EV
          <input type="number" step="0.5" min={-50} value={(min * 100).toFixed(1)} onChange={(e) => set({ min: Number(e.target.value) / 100 })} className={`${inputClass} w-16 text-right font-mono`} title="negative shows every quote on the board, including -EV ones" />%
        </label>
        <Divider />
        <ChipGroup value={f.line} onChange={(line) => set({ line })} options={LINE_OPTS} />
        <Divider />
        <ChipGroup value={f.period} onChange={(period) => set({ period })} options={PERIOD_OPTS} />
        <Divider />
        <ChipGroup value={f.side} onChange={(side) => set({ side })} options={[["team", "Team"], ["over", "Over"], ["under", "Under"]]} />
        <Divider />
        <ChipGroup value={f.papered} onChange={(papered) => set({ papered })} options={[["papered", "Papered"], ["open", "Open"]]} />
        <Divider />
        <ChipGroup value={f.source} onChange={(source) => set({ source })} options={[["coach", "Bench-driven"], ["market", "At baseline too"], ["against", "Adj. against"]]} />
        <Divider />
        <MultiSelect options={books} value={f.books} onChange={(books) => set({ books })} />
        <Divider />
        <ChipGroup value={f.day} onChange={(day) => set({ day })} options={[["today", "Today"], ["tomorrow", "Tomorrow"], ["later", "Later"]]} />
        <Divider />
        <input value={f.team} onChange={(e) => set({ team: e.target.value })} placeholder="team…" className={`${inputClass} w-24`} />
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span><span className="font-mono text-slate-300">{shown.length}</span> of {rows.length}</span>
          {active && <button onClick={() => setF(DEFAULT)} className="text-accent hover:underline">clear</button>}
        </span>
      </div>

      <Panel className="flex min-h-0 flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col p-3" title="Edges" right={active ? <span className="text-accent">filtered</span> : undefined}>
        {!shown.length ? <Empty>{rows.length ? `No quotes match these filters above ${pct(min)} EV. Lower min EV (it can go negative) to see the whole board.` : "No pregame quotes evaluated yet."}</Empty> : (
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[1] bg-slate-900 shadow-[0_1px_0_0_var(--color-slate-800)]"><tr><Th>Game</Th><Th>Start</Th><Th>Market</Th><Th>Side</Th><Th>Book</Th><Th right>Price</Th><Th right>Fair</Th><Th right>Fair prob</Th><Th right>Base prob</Th><Th right>Bench adj</Th><Th right>EV</Th><Th right>Base EV</Th><Th right>¼ Kelly</Th><Th right>Quoted</Th><Th></Th></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="border-t border-slate-800/60 hover:bg-slate-800/40">
                    <Td className="cursor-pointer font-medium text-slate-100" onClick={() => onOpen(e.game_id)}>{matchup(e)}</Td><Td mono className="text-slate-400">{fmtClock(e.game_time)}</Td>
                    <Td>{marketLabel(e.market)}</Td><Td>{sideLabel(e.side, e.point, e.home_abbr, e.away_abbr)}</Td>
                    <Td className="cursor-pointer text-slate-400 hover:text-slate-200" title="filter to this book" onClick={() => set({ books: [e.sportsbook] })}>{e.sportsbook}</Td>
                    <Td right mono title={e.price_basis && e.price_basis !== "book" ? `${e.price_basis === "ask" ? "Polymarket ask" : "exchange mid less a haircut"} · quoted mid ${fmtAmerican(e.price_quoted)}` : undefined}>{fmtAmerican(e.price)}{e.price_basis && e.price_basis !== "book" ? <span className="text-slate-500">{e.price_basis === "ask" ? " ask" : " ~"}</span> : null}</Td><Td right mono className="text-slate-400">{fmtAmerican(e.fair_price)}</Td>
                    <Td right mono title={e.push_prob ? `push ${pct(e.push_prob)}` : undefined}>{pct(e.fair_prob)}</Td>
                    <Td right mono className="text-slate-400" title="league-average benches, same ML and total">{e.base_prob === null || e.base_prob === undefined ? "—" : pct(e.base_prob)}</Td>
                    <Td right mono className={(adjOf(e) ?? 0) > 0.005 ? "text-ice" : (adjOf(e) ?? 0) < -0.005 ? "text-amber-300" : "text-slate-500"} title="fair prob minus baseline: what the two benches add">{adjOf(e) === null ? "—" : signedPct(adjOf(e))}</Td>
                    <Td right mono className={evClass(e.ev)}>{signedPct(e.ev)}</Td>
                    <Td right mono className={e.base_ev === null || e.base_ev === undefined ? "text-slate-600" : e.base_ev >= min ? "text-emerald-400/70" : "text-slate-500"}>{e.base_ev === null || e.base_ev === undefined ? "—" : signedPct(e.base_ev)}</Td>
                    <Td right mono className="text-slate-400">{pct(e.kelly * 0.25)}</Td>
                    <Td right className="text-slate-500">{ago(e.quoted_at)}</Td><Td>{e.papered && <Pill tone="blue">papered</Pill>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
