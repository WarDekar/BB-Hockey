import type { Bench, BenchLean, SlateRow } from "../lib/api";
import { ago, fmtAmerican, fmtClock, money, num, pct } from "../lib/format";
import { TeamLogo } from "./TeamLogo";
import { Matchup } from "./TeamMark";
import { Empty, Panel, Pill, Td, Th } from "./Primitives";

const mmss = (s: number | null | undefined) => { if (s === null || s === undefined || !isFinite(s)) return "—"; const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const leanText = (l: BenchLean, team: string, opp: string) =>
  l.market === "opp -1.5" ? `${opp} −1.5` : l.market === "team +1.5" ? `${team} +1.5` : l.market === "avoid +2.5" ? `no ${team} +2.5` : l.market === "team +2.5" ? `${team} +2.5` : null;
const leanTone = (l: BenchLean) => (l.market === "team +1.5" || l.market === "team +2.5" ? "text-emerald-300" : "text-rose-300");

/** One bench's reads for this game: puck line, alt line and totals leans, with the numbers on hover. */
function BenchRead({ b, team, opp }: { b: Bench | null; team: string; opp: string }) {
  if (!b) return <span className="text-slate-600">{team}: no bench data</span>;
  const items: { text: string; cls: string }[] = [];
  for (const l of [b.lean1, b.lean2]) { const t = leanText(l, team, opp); if (t) items.push({ text: t + (l.strength === "strong" ? " ★" : ""), cls: leanTone(l) }); }
  for (const [l, k] of [[b.total1, 1], [b.total2, 2]] as [BenchLean, number][]) if (l.market) items.push({ text: `${l.market} if down ${k}${l.strength === "strong" ? " ★" : ""}`, cls: "text-amber-200" });
  const d1 = b.down1, d2 = b.down2;
  const title = [`${b.coach} (${team}, since ${b.since})`,
    d1 ? `Down 1 late (${d1.n}): loses by 2+ ${pct(d1.lose_big, 0)} · pulls ${pct(d1.pull_rate, 0)} at ${mmss(d1.median_s)} · EN ${pct(d1.en, 0)} · a goal after 17:00 ${pct(d1.late1, 0)}` : "Down 1 late: no sample",
    d2 ? `Down 2 late (${d2.n}): loses by 3+ ${pct(d2.lose_big, 0)} · pulls ${pct(d2.pull_rate, 0)} at ${mmss(d2.median_s)} · EN ${pct(d2.en, 0)} · a goal after 17:00 ${pct(d2.late1, 0)}` : "Down 2 late: no sample",
    b.tags.length ? b.tags.join(" · ") : ""].filter(Boolean).join("\n");
  return (
    <span className="whitespace-nowrap" title={title}>
      <span className="text-slate-400"><TeamLogo abbr={team} size={14} className="mr-1" />{team} {b.coach.split(" ").slice(1).join(" ")}:</span>{" "}
      {items.length ? items.map((it, i) => <span key={i} className={it.cls}>{i ? " · " : ""}{it.text}</span>) : <span className="text-slate-600">no lean{d1 && d1.n < 12 ? " (thin)" : ""}</span>}
    </span>
  );
}

/** "base → adj" for the favourite's −1.5 (key m15) or the underdog's +2.5 (key p25). */
function puckCell(s: SlateRow["summary"], i: SlateRow["inputs"], kind: "m15" | "p25") {
  if (!s?.puck || !s.baseline?.puck || !i) return "—";
  const fav = i.p_home >= 0.5 ? "home" : "away", dog = fav === "home" ? "away" : "home";
  const key = kind === "m15" ? `${fav}_m15` : `${dog}_p25`;
  const adj = s.puck[key], base = s.baseline.puck[key];
  if (adj === undefined || base === undefined) return "—";
  const d = adj - base;
  return <span><span className="text-slate-500">{pct(base)}</span> → <span className={d > 0.005 ? "text-ice" : d < -0.005 ? "text-amber-300" : "text-slate-200"}>{pct(adj)}</span></span>;
}

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
                  <Th right>Fav −1.5 base → adj</Th><Th right>Dog +2.5 base → adj</Th><Th right>Draw (60′)</Th>
                  <Th>Bench reads</Th>
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
                      <Td className="font-medium text-slate-100"><Matchup g={g} rotations /></Td>
                      <Td>{score ? <span className="font-mono text-slate-200">{score}</span> : <Pill tone={g.status === "live" ? "amber" : g.status === "pregame" ? "slate" : "blue"}>{g.status}</Pill>}</Td>
                      <Td right mono title={i ? `consensus home ${pct(i.p_home)} · ${i.consensus_at ?? ""}` : undefined}>{i ? `${fmtAmerican(probToAmerican(i.p_home))} / ${fmtAmerican(probToAmerican(1 - i.p_home))}` : "—"}</Td>
                      <Td right mono title={i ? `over ${pct(i.p_over)}${i.total_assumed ? " (assumed)" : ""}` : undefined}>{i ? `${i.total_point}${i.total_assumed ? "*" : ""}` : "—"}</Td>
                      <Td right mono className="text-slate-400">{s ? `${num(s.lambda_home)} / ${num(s.lambda_away)}` : "—"}</Td>
                      <Td right mono title="fair cover probability for the favourite −1.5: league-average benches → these benches">{puckCell(s, i, "m15")}</Td>
                      <Td right mono title="fair cover probability for the underdog +2.5: league-average benches → these benches">{puckCell(s, i, "p25")}</Td>
                      <Td right mono>{s ? pct(s.p_draw) : "—"}</Td>
                      <Td className="text-[11px] leading-4">
                        <div className="flex flex-col"><BenchRead b={g.away_bench} team={g.away_abbr ?? "AWAY"} opp={g.home_abbr ?? "HOME"} /><BenchRead b={g.home_bench} team={g.home_abbr ?? "HOME"} opp={g.away_abbr ?? "AWAY"} /></div>
                      </Td>
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
      <p className="px-1 text-[11px] text-slate-500">Fair ML and total are BB-Odds's Shin-devigged consensus (the model's inputs); everything else is the model. * = no total quoted, league default assumed. Bench reads are each coach's late-deficit record (Pulls tab): puck-line and +2.5 leans in green (back) or red (fade), totals leans in amber; hover for the numbers. Click a game for the full board.</p>
    </div>
  );
}

