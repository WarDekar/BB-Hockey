import { useEffect, useMemo, useState } from "react";
import type { ResultRow } from "../lib/api";
import { fmtTime, money, num, pct, signedPct } from "../lib/format";
import { Matchup } from "./TeamMark";
import { Empty, Panel, Stat, Td, Th } from "./Primitives";
import { ChipGroup, DATE_OPTS, Divider, Select, dateRange, inputClass, teamMatch } from "./Filters";

// Same bar as Bets / Edges, over finals: how the game ended, whether the desk
// had bets on it, the sign of its P&L, the game date and a team search. The
// tiles compare realised rates on the filtered set to the closing model's.
interface Filters { end: string; bets: string; pnl: string; date: string; from: string; to: string; team: string }
const DEFAULT: Filters = { end: "all", bets: "all", pnl: "all", date: "all", from: "", to: "", team: "" };
const KEY = "bbh_results_filters_v1";
const load = (): Filters => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || "{}"), team: "" }; } catch { return DEFAULT; } };

const endOf = (g: ResultRow) => (g.went_so ? "so" : g.went_ot ? "ot" : "reg");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const delta = (real: number | null, model: number | null) => (real === null || model === null ? undefined : <span className={Math.abs(real - model) < 0.03 ? "text-slate-500" : "text-amber-300"}>model {pct(model, 0)} · {signedPct(real - model, 1)}</span>);

export default function Results({ rows, onOpen }: { rows: ResultRow[]; onOpen: (id: number) => void }) {
  const [f, setF] = useState<Filters>(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ ...f, team: "" })); } catch { /* private mode */ } }, [f]);
  const set = (patch: Partial<Filters>) => setF((p) => ({ ...p, ...patch }));

  const shown = useMemo(() => {
    const [lo, hi] = dateRange(f.date, f.from, f.to);
    const team = f.team.trim().toLowerCase();
    return rows.filter((g) =>
      (f.end === "all" || endOf(g) === f.end)
      && (f.bets === "all" || (f.bets === "bets") === g.n_bets > 0)
      && (f.pnl === "all" || (f.pnl === "won" ? g.pnl > 0 : g.pnl < 0))
      && (!lo || new Date(g.game_time) >= lo) && (!hi || new Date(g.game_time) < hi)
      && teamMatch(team, g));
  }, [rows, f]);
  const active = JSON.stringify({ ...f, team: "" }) !== JSON.stringify(DEFAULT) || f.team.trim() !== "";

  const s = useMemo(() => {
    const n = shown.length;
    const modelled = shown.filter((g) => g.closing_summary && g.closing_inputs);
    return {
      n, ot: n ? shown.filter((g) => g.went_ot).length / n : null, so: n ? shown.filter((g) => g.went_so).length / n : null,
      goals: avg(shown.map((g) => (g.final_home ?? 0) + (g.final_away ?? 0))),
      home: n ? shown.filter((g) => (g.final_home ?? 0) > (g.final_away ?? 0)).length / n : null,
      m_draw: avg(modelled.map((g) => g.closing_summary!.p_draw)), m_goals: avg(modelled.map((g) => g.closing_summary!.exp_total)),
      m_home: avg(modelled.map((g) => g.closing_inputs!.p_home)), modelled: modelled.length,
      bets: shown.reduce((a, g) => a + g.n_bets, 0), pnl: shown.reduce((a, g) => a + g.pnl, 0),
    };
  }, [shown]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Finals" value={s.n} sub={s.modelled < s.n ? `${s.modelled} with a closing model` : "all with a closing model"} />
        <Stat label="Went OT" value={s.ot === null ? "—" : pct(s.ot, 0)} sub={delta(s.ot, s.m_draw) ?? (s.so !== null ? `${pct(s.so, 0)} to a shootout` : undefined)} />
        <Stat label="Goals / game" value={s.goals === null ? "—" : num(s.goals, 2)} sub={s.m_goals === null ? undefined : <span className={s.goals !== null && Math.abs(s.goals - s.m_goals) < 0.2 ? "text-slate-500" : "text-amber-300"}>model {num(s.m_goals, 2)} · {s.goals === null ? "" : (s.goals - s.m_goals >= 0 ? "+" : "") + num(s.goals - s.m_goals, 2)}</span>} />
        <Stat label="Home won" value={s.home === null ? "—" : pct(s.home, 0)} sub={delta(s.home, s.m_home)} />
        <Stat label="Bets" value={s.bets} />
        <Stat label="P&L" value={money(s.pnl)} tone={s.pnl > 0 ? "text-emerald-300" : s.pnl < 0 ? "text-rose-300" : undefined} />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <ChipGroup value={f.end} onChange={(end) => set({ end })} options={[["reg", "Regulation"], ["ot", "OT"], ["so", "Shootout"]]} />
        <Divider />
        <ChipGroup value={f.bets} onChange={(bets) => set({ bets })} options={[["bets", "With bets"], ["none", "No bets"]]} />
        <Divider />
        <ChipGroup value={f.pnl} onChange={(pnl) => set({ pnl })} options={[["won", "P&L +"], ["lost", "P&L −"]]} />
        <Divider />
        <div className="flex items-center gap-1.5">
          <Select value={f.date} options={DATE_OPTS} onChange={(date) => set({ date })} />
          {f.date === "custom" && (
            <>
              <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className={inputClass} style={{ colorScheme: "dark" }} />
              <span className="text-[11px] text-slate-600">to</span>
              <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className={inputClass} style={{ colorScheme: "dark" }} />
            </>
          )}
        </div>
        <Divider />
        <input value={f.team} onChange={(e) => set({ team: e.target.value })} placeholder="team…" className={`${inputClass} w-24`} />
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span><span className="font-mono text-slate-300">{shown.length}</span> of {rows.length}</span>
          {active && <button onClick={() => setF(DEFAULT)} className="text-accent hover:underline">clear</button>}
        </span>
      </div>

      <Panel className="flex min-h-0 flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col p-3" title="Finals" right={active ? <span className="text-accent">filtered</span> : undefined}>
        {!shown.length ? <Empty>{rows.length ? "No finals match these filters." : "No finals settled yet. Settlement runs every five minutes once a game is ~2h40 old and ESPN has it final."}</Empty> : (
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[1] bg-slate-900 shadow-[0_1px_0_0_var(--color-slate-800)]"><tr><Th>Start</Th><Th>Game</Th><Th right>Final</Th><Th right>Periods (away-home)</Th><Th>End</Th><Th right>Close home</Th><Th right>Close total</Th><Th right>Model draw</Th><Th right>Bets</Th><Th right>P&L</Th></tr></thead>
              <tbody>
                {shown.map((g) => (
                  <tr key={g.id} onClick={() => onOpen(g.id)} className="cursor-pointer border-t border-slate-800/60 hover:bg-slate-800/40">
                    <Td className="text-slate-500">{fmtTime(g.game_time)}</Td>
                    <Td className="font-medium text-slate-100"><Matchup g={g} /></Td>
                    <Td right mono className="text-slate-100">{g.final_away}–{g.final_home}</Td>
                    <Td right mono className="text-slate-400">{g.periods ? g.periods.map((p) => `${p[1]}-${p[0]}`).join(" · ") : "—"}</Td>
                    <Td className="text-slate-400">{g.went_so ? "SO" : g.went_ot ? "OT" : "REG"}</Td>
                    <Td right mono className="text-slate-400">{g.closing_inputs ? pct(g.closing_inputs.p_home) : "—"}</Td>
                    <Td right mono className="text-slate-400">{g.closing_inputs ? `${g.closing_inputs.total_point} (${pct(g.closing_inputs.p_over, 0)})` : "—"}</Td>
                    <Td right mono className="text-slate-400">{g.closing_summary ? `${pct(g.closing_summary.p_draw)} · exp ${num(g.closing_summary.exp_total, 1)}` : "—"}</Td>
                    <Td right mono>{g.n_bets || "—"}</Td>
                    <Td right mono className={g.pnl > 0 ? "text-emerald-300" : g.pnl < 0 ? "text-rose-300" : "text-slate-500"}>{g.n_bets ? money(g.pnl) : "—"}</Td>
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
