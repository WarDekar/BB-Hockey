import type { SlateRow } from "../lib/api";
import { ago, fmtAmerican, fmtClock, matchup, money, num, pct } from "../lib/format";
import { Empty, Panel, Pill, Td, Th } from "./Primitives";

const probToAmerican = (p: number | null | undefined) => (p === null || p === undefined ? null : p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p);

export default function Board({ rows, onOpen }: { rows: SlateRow[]; onOpen: (id: number) => void }) {
  if (!rows.length) return <Empty>No NHL games on the BB-Odds slate in the window.</Empty>;
  const byDay = new Map<string, SlateRow[]>();
  for (const r of rows) {
    const k = new Date(r.game_time).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    byDay.set(k, [...(byDay.get(k) ?? []), r]);
  }
  return (
    <div className="space-y-3">
      {[...byDay.entries()].map(([day, games]) => (
        <Panel key={day} title={day} right={`${games.length} games`}>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <Th>Time</Th><Th>Matchup</Th><Th>Status</Th>
                  <Th right>Fair ML</Th><Th right>Total</Th><Th right>λ home / away</Th>
                  <Th right>Home −1.5</Th><Th right>Draw (60′)</Th><Th right>P1 o1.5</Th><Th right>Home TT o2.5</Th>
                  <Th right>Edges</Th><Th right>Bets</Th><Th right>P&L</Th><Th right>Priced</Th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
                  const s = g.summary, i = g.inputs;
                  const score = g.status === "final" ? `${g.final_away}–${g.final_home}${g.went_so ? " SO" : g.went_ot ? " OT" : ""}` : null;
                  return (
                    <tr key={g.id} onClick={() => onOpen(g.id)} className="cursor-pointer border-t border-slate-800/70 hover:bg-slate-800/40">
                      <Td mono className="text-slate-400">{fmtClock(g.game_time)}</Td>
                      <Td className="font-medium text-slate-100" title={`${g.away_name} at ${g.home_name} · rot ${g.away_rotation ?? "?"}/${g.home_rotation ?? "?"}`}>{matchup(g)}</Td>
                      <Td>{score ? <span className="font-mono text-slate-200">{score}</span> : <Pill tone={g.status === "live" ? "amber" : g.status === "pregame" ? "slate" : "blue"}>{g.status}</Pill>}</Td>
                      <Td right mono title={i ? `consensus home ${pct(i.p_home)} · ${i.consensus_at ?? ""}` : undefined}>{i ? `${fmtAmerican(probToAmerican(i.p_home))} / ${fmtAmerican(probToAmerican(1 - i.p_home))}` : "—"}</Td>
                      <Td right mono title={i ? `over ${pct(i.p_over)}${i.total_assumed ? " (assumed)" : ""}` : undefined}>{i ? `${i.total_point}${i.total_assumed ? "*" : ""}` : "—"}</Td>
                      <Td right mono className="text-slate-400">{s ? `${num(s.lambda_home)} / ${num(s.lambda_away)}` : "—"}</Td>
                      <Td right mono>{s ? pct(puck(s)) : "—"}</Td>
                      <Td right mono>{s ? pct(s.p_draw) : "—"}</Td>
                      <Td right mono>{s?.market_check?.p1_total_over ? pct(s.market_check.p1_total_over.model) : "—"}</Td>
                      <Td right mono className="text-slate-500">{s ? "—" : "—"}</Td>
                      <Td right mono className={g.n_edges > 0 ? "text-emerald-300" : "text-slate-500"}>{g.n_edges}</Td>
                      <Td right mono>{g.n_bets || "—"}</Td>
                      <Td right mono className={g.pnl > 0 ? "text-emerald-300" : g.pnl < 0 ? "text-rose-300" : "text-slate-500"}>{g.n_bets ? money(g.pnl) : "—"}</Td>
                      <Td right className="text-slate-500">{ago(g.priced_at)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      <p className="px-1 text-[11px] text-slate-500">Fair ML and total are BB-Odds's Shin-devigged consensus (the model's inputs); everything else is the model. * = no total quoted, league default assumed. Click a game for the full board.</p>
    </div>
  );
}

// p(home −1.5) is not on the summary; the board carries it — approximate here from the snapshot summary via the closed form is
// not possible, so show nothing until the game page. Kept as a helper so the column can light up when the API adds it.
function puck(_s: unknown): number | null { return null; }
