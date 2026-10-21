import { useMemo, useState } from "react";
import type { BoardRow, GameDetail as Detail, QuoteRow } from "../lib/api";
import { sendJson } from "../lib/api";
import { ago, evClass, fmtAmerican, fmtTime, marketLabel, money, num, pct, sideLabel, signedPct } from "../lib/format";
import { Button, Empty, ErrorBox, Panel, Pill, Stat, Td, Th } from "./Primitives";

const GROUPS: { title: string; markets: string[] }[] = [
  { title: "Full game", markets: ["ml", "3way", "puck"] },
  { title: "Totals", markets: ["total", "reg_total", "team_total_home", "team_total_away"] },
  { title: "First period", markets: ["p1_ml", "p1_3way", "p1_spread", "p1_total"] },
  { title: "Second period", markets: ["p2_ml", "p2_3way", "p2_spread", "p2_total"] },
  { title: "Third period", markets: ["p3_ml", "p3_3way", "p3_spread", "p3_total"] },
];

export default function GameDetail({ detail, reload, minEdge }: { detail: Detail; reload: () => void; minEdge: number }) {
  const { game, snapshot, closing, best, edges, bets, quotes } = detail;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ha = game.home_abbr, aa = game.away_abbr;
  const booksPerMarket = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quotes) m.set(q.market, (m.get(q.market) ?? 0) + 1);
    return m;
  }, [quotes]);

  const paper = async (q: QuoteRow) => {
    setBusy(true); setErr(null);
    try {
      await sendJson("POST", "/bets", { game_id: game.id, market: q.market, side: q.side, point: q.point, sportsbook: q.sportsbook, sportsbook_id: q.sportsbook_id, price: q.price, stake: 100 });
      reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const s = snapshot?.summary, i = snapshot?.inputs;
  const rowsFor = (market: string): BoardRow[] => (snapshot?.board ?? []).filter((r) => r.market === market);

  return (
    <div className="space-y-3">
      <Panel title={`${game.away_name} at ${game.home_name}`} right={<span>{fmtTime(game.game_time)} · <Pill tone={game.status === "final" ? "blue" : game.status === "live" ? "amber" : "slate"}>{game.status}</Pill></span>}>
        {game.status === "final" && (
          <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
            <span className="font-mono text-lg text-slate-100">{aa} {game.final_away} – {game.final_home} {ha}{game.went_so ? " (SO)" : game.went_ot ? " (OT)" : ""}</span>
            {game.periods && <span className="font-mono text-xs text-slate-400">periods {game.periods.map((p) => `${p[1]}-${p[0]}`).join(" · ")} (away-home)</span>}
            <span className="text-xs text-slate-500">regulation {game.reg_away}–{game.reg_home}</span>
          </div>
        )}
        {!snapshot ? <Empty>No pricing snapshot yet — the worker prices a game once BB-Odds has a consensus moneyline for it.</Empty> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Consensus home" value={pct(i!.p_home)} sub={fmtAmerican(i!.p_home >= 0.5 ? (-100 * i!.p_home) / (1 - i!.p_home) : (100 * (1 - i!.p_home)) / i!.p_home)} />
            {i!.eng?.rates && <Stat label="Empty-net rates" value={`${pct(i!.eng.rates.home_lead1, 0)} / ${pct(i!.eng.rates.away_lead1, 0)}`}
              sub={`home lead (${i!.eng.away_coach.coach ?? "?"} pulls) / away lead (${i!.eng.home_coach.coach ?? "?"} pulls) · 2-goal ${pct(i!.eng.rates.home_lead2, 0)} / ${pct(i!.eng.rates.away_lead2, 0)} · lg ${pct(i!.eng.league.lead1, 0)} / ${pct(i!.eng.league.lead2, 0)}`} />}
            <Stat label="Consensus total" value={`${i!.total_point}${i!.total_assumed ? "*" : ""}`} sub={`over ${pct(i!.p_over)}`} />
            <Stat label="λ home / away" value={`${num(s!.lambda_home)} / ${num(s!.lambda_away)}`} sub={`exp ${num(s!.exp_total)} (reg ${num(s!.exp_reg_total)})`} />
            <Stat label="60-min draw" value={pct(s!.p_draw)} sub={`home ${pct(s!.p_reg_home)} · away ${pct(s!.p_reg_away)}`} />
            <Stat label="Home if tied" value={pct(s!.p_tie_home)} sub="OT + shootout" />
            <Stat label="Books quoting" value={quotes.length} sub={`${booksPerMarket.size} markets`} />
            <Stat label="Edges ≥ min" value={edges.filter((e) => e.ev >= minEdge).length} sub={`of ${edges.length} positive`} tone={edges.some((e) => e.ev >= minEdge) ? "text-emerald-300" : undefined} />
            <Stat label="Priced" value={ago(snapshot.computed_at)} sub={s!.converged === false ? "fit did not converge" : `consensus ${ago(i!.consensus_at)}`} tone={s!.converged === false ? "text-amber-300" : undefined} />
          </div>
        )}
        {s?.market_check && Object.keys(s.market_check).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500">
            <span className="uppercase tracking-wider">Model vs market check</span>
            {Object.entries(s.market_check).map(([k, v]) => (
              <span key={k} title="model fair minus BB-Odds's own devigged consensus at this point (pushes conditioned out)">
                {k.replace(/_/g, " ")}{v.point !== null ? ` ${v.point}` : ""}: <span className="font-mono text-slate-300">{pct(v.model)}</span> vs <span className="font-mono">{pct(v.market)}</span> <span className={`font-mono ${Math.abs(v.diff) > 0.04 ? "text-amber-300" : "text-slate-400"}`}>({signedPct(v.diff)})</span>
              </span>
            ))}
          </div>
        )}
      </Panel>

      {err && <ErrorBox error={err} />}

      {snapshot && GROUPS.map((grp) => (
        <Panel key={grp.title} title={grp.title}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {grp.markets.map((market) => {
              const rows = rowsFor(market);
              if (!rows.length) return null;
              return (
                <div key={market} className="min-w-0">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{marketLabel(market)}</span>
                    <span className="text-[10px] text-slate-600">{booksPerMarket.get(market) ? `${booksPerMarket.get(market)} quotes` : "no book quotes"}</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead><tr><Th>Side</Th><Th right>Fair</Th><Th right>Price</Th><Th right>Best book</Th><Th right>EV</Th><Th></Th></tr></thead>
                    <tbody>
                      {rows.map((r) => {
                        const b = best[`${r.market}|${r.side}|${r.point}`];
                        return (
                          <tr key={`${r.side}${r.point}`} className="border-t border-slate-800/60">
                            <Td className="text-slate-200">{sideLabel(r.side, r.point, ha, aa)}</Td>
                            <Td right mono title={r.push ? `push ${pct(r.push)}` : undefined}>{pct(r.prob)}{r.push > 0.001 ? <span className="text-slate-600">·</span> : ""}</Td>
                            <Td right mono className="text-slate-300">{fmtAmerican(r.fair_price)}</Td>
                            <Td right mono className="text-slate-400" title={b ? `${b.sportsbook} · quoted ${ago(b.quoted_at)}` : undefined}>{b ? `${fmtAmerican(b.price)} ${b.sportsbook}` : "—"}</Td>
                            <Td right mono className={b ? evClass(b.ev) : "text-slate-600"}>{b ? signedPct(b.ev) : "—"}</Td>
                            <Td right>{b && game.status === "pregame" && <Button small disabled={busy} tone={b.ev >= minEdge ? "blue" : "slate"} onClick={() => paper(b)}>paper</Button>}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </Panel>
      ))}

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Positive-EV quotes" right={`${edges.length}`}>
          {!edges.length ? <Empty>Nothing priced above fair right now.</Empty> : (
            <table className="w-full text-xs">
              <thead><tr><Th>Market</Th><Th>Side</Th><Th>Book</Th><Th right>Price</Th><Th right>Fair</Th><Th right>EV</Th><Th right>¼ Kelly</Th></tr></thead>
              <tbody>
                {edges.slice(0, 40).map((e, k) => (
                  <tr key={k} className="border-t border-slate-800/60">
                    <Td>{marketLabel(e.market)}</Td><Td>{sideLabel(e.side, e.point, ha, aa)}</Td><Td className="text-slate-400">{e.sportsbook}</Td>
                    <Td right mono>{fmtAmerican(e.price)}</Td><Td right mono className="text-slate-400">{fmtAmerican(e.fair_price)}</Td>
                    <Td right mono className={evClass(e.ev)}>{signedPct(e.ev)}</Td><Td right mono className="text-slate-400">{pct(e.kelly * 0.25)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Paper bets on this game" right={`${bets.length}`}>
          {!bets.length ? <Empty>No paper bets.</Empty> : (
            <table className="w-full text-xs">
              <thead><tr><Th>Market</Th><Th>Side</Th><Th>Book</Th><Th right>Price</Th><Th right>Stake</Th><Th right>EV</Th><Th>Status</Th><Th right>P&L</Th><Th right>CLV</Th></tr></thead>
              <tbody>
                {bets.map((b) => (
                  <tr key={b.id} className="border-t border-slate-800/60">
                    <Td>{marketLabel(b.market)}</Td><Td>{sideLabel(b.side, b.point, ha, aa)}</Td><Td className="text-slate-400">{b.sportsbook}{b.source === "manual" ? " ✎" : ""}</Td>
                    <Td right mono>{fmtAmerican(b.price)}</Td><Td right mono>{money(b.stake)}</Td><Td right mono className={evClass(b.ev)}>{signedPct(b.ev)}</Td>
                    <Td><Pill tone={b.status === "won" ? "green" : b.status === "lost" ? "red" : b.status === "pending" ? "slate" : "amber"}>{b.status}</Pill></Td>
                    <Td right mono className={(b.pnl ?? 0) > 0 ? "text-emerald-300" : (b.pnl ?? 0) < 0 ? "text-rose-300" : ""}>{b.pnl === null ? "—" : money(b.pnl)}</Td>
                    <Td right mono title="closing model fair − fair at bet">{signedPct(b.clv_model)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      {closing && (
        <Panel title="Closing snapshot" right={<span>{closing.inputs.source ?? "main.odds consensus close"} · {fmtTime(closing.computed_at)}</span>}>
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-slate-300">
            <span>home {pct(closing.inputs.p_home)}</span><span>total {closing.inputs.total_point} (over {pct(closing.inputs.p_over)})</span>
            <span>λ {num(closing.summary.lambda_home)} / {num(closing.summary.lambda_away)}</span><span>draw {pct(closing.summary.p_draw)}</span>
          </div>
        </Panel>
      )}
    </div>
  );
}
