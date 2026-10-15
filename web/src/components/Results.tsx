import type { ResultRow } from "../lib/api";
import { fmtTime, matchup, money, num, pct } from "../lib/format";
import { Empty, Panel, Td, Th } from "./Primitives";

export default function Results({ rows, onOpen }: { rows: ResultRow[]; onOpen: (id: number) => void }) {
  if (!rows.length) return <Empty>No finals settled yet. Settlement runs every five minutes once a game is ~2h40 old and ESPN has it final.</Empty>;
  return (
    <Panel title="Finals" right={`${rows.length} games`}>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs">
          <thead><tr><Th>Start</Th><Th>Game</Th><Th right>Final</Th><Th right>Periods (away-home)</Th><Th>End</Th><Th right>Close home</Th><Th right>Close total</Th><Th right>Model draw</Th><Th right>Bets</Th><Th right>P&L</Th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} onClick={() => onOpen(g.id)} className="cursor-pointer border-t border-slate-800/60 hover:bg-slate-800/40">
                <Td className="text-slate-500">{fmtTime(g.game_time)}</Td>
                <Td className="font-medium text-slate-100">{matchup(g)}</Td>
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
    </Panel>
  );
}
