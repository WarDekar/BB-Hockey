import { useState } from "react";
import type { Bet, BetSummary } from "../lib/api";
import { sendJson } from "../lib/api";
import { evClass, fmtAmerican, fmtTime, marketLabel, matchup, money, num, pct, sideLabel, signedPct } from "../lib/format";
import { Button, Empty, ErrorBox, Panel, Pill, Stat, Td, Th } from "./Primitives";

export default function Bets({ bets, summary, reload, onOpen }: { bets: Bet[]; summary: BetSummary | null; reload: () => void; onOpen: (id: number) => void }) {
  const [filter, setFilter] = useState("all");
  const [err, setErr] = useState<string | null>(null);
  const shown = bets.filter((b) => filter === "all" || b.status === filter);
  const voidBet = async (id: number) => {
    setErr(null);
    try { await sendJson("POST", `/bets/${id}/void`); reload(); } catch (e) { setErr((e as Error).message); }
  };
  const s = summary;
  return (
    <div className="space-y-3">
      {s && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Pending" value={s.pending} />
          <Stat label="Settled" value={s.settled} sub={`${s.won}–${s.lost}–${s.pushed}`} />
          <Stat label="Staked" value={money(s.staked)} />
          <Stat label="P&L" value={money(s.pnl)} tone={s.pnl > 0 ? "text-emerald-300" : s.pnl < 0 ? "text-rose-300" : undefined} />
          <Stat label="ROI" value={s.roi === null ? "—" : signedPct(s.roi)} />
          <Stat label="Avg EV at bet" value={signedPct(s.avg_ev)} />
          <Stat label="Avg CLV (model)" value={signedPct(s.avg_clv_model)} sub={s.clv_model_n ? `${pct(s.clv_model_pos / s.clv_model_n, 0)} positive of ${s.clv_model_n}` : "closing fair − fair at bet"} />
          <Stat label="Avg CLV (price)" value={signedPct(s.avg_clv_price)} sub="vs same book's close" />
        </div>
      )}
      {err && <ErrorBox error={err} />}
      <Panel title="Ledger" right={<span className="flex items-center gap-1">{["all", "pending", "won", "lost", "push", "void"].map((f) => (
        <button key={f} onClick={() => setFilter(f)} className={`rounded px-1.5 py-0.5 text-[11px] ${filter === f ? "bg-accent/20 text-accent" : "text-slate-500 hover:text-slate-300"}`}>{f}</button>
      ))}<span className="ml-2">{shown.length}</span></span>}>
        {!shown.length ? <Empty>No paper bets{filter !== "all" ? ` with status ${filter}` : ""}. Auto-paper takes the best price on every edge above the threshold; the game page papers anything by hand.</Empty> : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead><tr><Th>Placed</Th><Th>Game</Th><Th>Market</Th><Th>Side</Th><Th>Book</Th><Th right>Price</Th><Th right>Stake</Th><Th right>Fair</Th><Th right>EV</Th><Th>Status</Th><Th right>P&L</Th><Th right>Close fair</Th><Th right>CLV model</Th><Th right>CLV price</Th><Th></Th></tr></thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                    <Td className="text-slate-500">{fmtTime(b.placed_at)}</Td>
                    <Td className="cursor-pointer font-medium text-slate-100" onClick={() => onOpen(b.game_id)}>{matchup({ home_abbr: b.home_abbr, away_abbr: b.away_abbr, home_name: b.home_name ?? "", away_name: b.away_name ?? "" })}{b.game_status === "final" ? <span className="ml-1 font-mono text-slate-500">{b.final_away}–{b.final_home}</span> : null}</Td>
                    <Td>{marketLabel(b.market)}</Td><Td>{sideLabel(b.side, b.point, b.home_abbr, b.away_abbr)}</Td>
                    <Td className="text-slate-400">{b.sportsbook}{b.source === "manual" ? " ✎" : ""}</Td>
                    <Td right mono>{fmtAmerican(b.price)}</Td><Td right mono>{money(b.stake)}</Td><Td right mono className="text-slate-400">{pct(b.fair_prob)}</Td>
                    <Td right mono className={evClass(b.ev)}>{signedPct(b.ev)}</Td>
                    <Td><Pill tone={b.status === "won" ? "green" : b.status === "lost" ? "red" : b.status === "pending" ? "slate" : "amber"}>{b.status}</Pill></Td>
                    <Td right mono className={(b.pnl ?? 0) > 0 ? "text-emerald-300" : (b.pnl ?? 0) < 0 ? "text-rose-300" : "text-slate-500"}>{b.pnl === null ? "—" : money(b.pnl)}</Td>
                    <Td right mono className="text-slate-400">{pct(b.closing_fair_prob)}</Td>
                    <Td right mono className={b.clv_model === null ? "text-slate-600" : b.clv_model > 0 ? "text-emerald-300" : "text-rose-300"}>{signedPct(b.clv_model)}</Td>
                    <Td right mono className={b.clv_price === null ? "text-slate-600" : b.clv_price > 0 ? "text-emerald-300" : "text-rose-300"} title={b.closing_price !== null ? `closed ${fmtAmerican(b.closing_price)}` : undefined}>{signedPct(b.clv_price)}</Td>
                    <Td right>{b.status === "pending" && <Button small tone="red" onClick={() => voidBet(b.id)}>void</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {s && s.by_market.length > 0 && (
        <Panel title="By market">
          <table className="w-full text-xs">
            <thead><tr><Th>Market</Th><Th right>Bets</Th><Th right>W–L</Th><Th right>Staked</Th><Th right>P&L</Th><Th right>ROI</Th><Th right>Avg EV</Th><Th right>Avg CLV</Th></tr></thead>
            <tbody>
              {s.by_market.map((m) => (
                <tr key={m.market} className="border-t border-slate-800/60">
                  <Td>{marketLabel(m.market)}</Td><Td right mono>{m.n}</Td><Td right mono>{m.won}–{m.lost}</Td><Td right mono>{money(m.staked)}</Td>
                  <Td right mono className={m.pnl > 0 ? "text-emerald-300" : m.pnl < 0 ? "text-rose-300" : ""}>{money(m.pnl)}</Td>
                  <Td right mono>{m.staked ? signedPct(m.pnl / m.staked) : "—"}</Td><Td right mono>{signedPct(m.avg_ev)}</Td><Td right mono>{signedPct(m.avg_clv_model)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500">Stakes: quarter-Kelly on a 100-unit bankroll, capped at 1 unit ({num(100, 0)}). CLV (model) is the closing-consensus model's fair minus the fair at placement; CLV (price) is the taken price against the same book's last pre-start quote.</p>
        </Panel>
      )}
    </div>
  );
}
