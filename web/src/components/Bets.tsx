import { useEffect, useMemo, useState } from "react";
import type { Bet } from "../lib/api";
import { sendJson } from "../lib/api";
import { evClass, fmtAmerican, fmtTime, marketLabel, matchup, money, num, pct, sideLabel, signedPct } from "../lib/format";
import { Button, Empty, ErrorBox, Panel, Pill, Stat, Td, Th } from "./Primitives";
import { ChipGroup, DATE_OPTS, Divider, LINE_OPTS, MultiSelect, PERIOD_OPTS, Select, dateRange, inputClass, lineOf, periodOf, teamMatch } from "./Filters";

// Filter bar after BB-Odds's My Till: status × line × period × source chip
// groups, a books multi-select and a game-date preset, all composing. The
// choice is remembered across reloads (team search is not — it's a lookup).
interface Filters { status: string; line: string; period: string; source: string; books: string[] | null; date: string; from: string; to: string; team: string }
const DEFAULT: Filters = { status: "all", line: "all", period: "all", source: "all", books: null, date: "all", from: "", to: "", team: "" };
const KEY = "bbh_bets_filters_v1";
const load = (): Filters => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || "{}"), team: "" }; } catch { return DEFAULT; } };


// Same definitions as paper.summary(), computed over whatever the bar leaves visible.
const SETTLED = new Set(["won", "lost", "push"]);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function summarize(rows: Bet[]) {
  const settled = rows.filter((b) => SETTLED.has(b.status));
  const clvM = rows.map((b) => b.clv_model).filter((x): x is number => x !== null);
  const staked = settled.reduce((a, b) => a + b.stake, 0);
  const pnl = rows.reduce((a, b) => a + (b.pnl ?? 0), 0);
  return {
    pending: rows.filter((b) => b.status === "pending").length, settled: settled.length,
    won: rows.filter((b) => b.status === "won").length, lost: rows.filter((b) => b.status === "lost").length, pushed: rows.filter((b) => b.status === "push").length,
    staked, pnl, roi: staked ? pnl / staked : null,
    avg_ev: avg(rows.filter((b) => b.status !== "void").map((b) => b.ev)),
    avg_clv_model: avg(clvM), clv_model_n: clvM.length, clv_model_pos: clvM.filter((x) => x > 0).length,
    avg_clv_price: avg(rows.map((b) => b.clv_price).filter((x): x is number => x !== null)),
  };
}
function breakdown(rows: Bet[], key: (b: Bet) => string) {
  const groups = new Map<string, Bet[]>();
  for (const b of rows) if (b.status !== "void") groups.set(key(b), [...(groups.get(key(b)) ?? []), b]);
  return [...groups.entries()].map(([k, bs]) => ({ key: k, ...summarize(bs), n: bs.length })).sort((a, b) => b.n - a.n);
}

export default function Bets({ bets, reload, onOpen }: { bets: Bet[]; reload: () => void; onOpen: (id: number) => void }) {
  const [f, setF] = useState<Filters>(load);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ ...f, team: "" })); } catch { /* private mode */ } }, [f]);
  const set = (patch: Partial<Filters>) => setF((p) => ({ ...p, ...patch }));

  const books = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bets) counts.set(b.sportsbook, (counts.get(b.sportsbook) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => ({ key: k, label: k, sub: String(n) }));
  }, [bets]);

  const shown = useMemo(() => {
    const [lo, hi] = dateRange(f.date, f.from, f.to);
    const bookSet = f.books === null ? null : new Set(f.books);
    const team = f.team.trim().toLowerCase();
    return bets.filter((b) => {
      if (f.status === "settled" ? !SETTLED.has(b.status) : f.status !== "all" && b.status !== f.status) return false;
      if (f.line !== "all" && lineOf(b.market) !== f.line) return false;
      if (f.period !== "all" && periodOf(b.market) !== f.period) return false;
      if (f.source !== "all" && (b.source === "manual" ? "manual" : "auto") !== f.source) return false;
      if (bookSet && !bookSet.has(b.sportsbook)) return false;
      if (lo || hi) {
        const t = new Date(b.game_time ?? b.placed_at);
        if ((lo && t < lo) || (hi && t >= hi)) return false;
      }
      if (!teamMatch(team, b)) return false;
      return true;
    });
  }, [bets, f]);
  const s = useMemo(() => summarize(shown), [shown]);
  const byMarket = useMemo(() => breakdown(shown, (b) => b.market), [shown]);
  const byBook = useMemo(() => breakdown(shown, (b) => b.sportsbook), [shown]);
  const active = JSON.stringify({ ...f, team: "" }) !== JSON.stringify(DEFAULT) || f.team.trim() !== "";

  const voidBet = async (id: number) => {
    setErr(null);
    try { await sendJson("POST", `/bets/${id}/void`); reload(); } catch (e) { setErr((e as Error).message); }
  };

  const rows = (list: ReturnType<typeof breakdown>, label: (k: string) => string) => (
    <table className="w-full text-xs">
      <thead><tr><Th>{label === marketLabel ? "Market" : "Book"}</Th><Th right>Bets</Th><Th right>W–L–P</Th><Th right>Staked</Th><Th right>P&L</Th><Th right>ROI</Th><Th right>Avg EV</Th><Th right>CLV model</Th><Th right>CLV price</Th></tr></thead>
      <tbody>
        {list.map((m) => (
          <tr key={m.key} className="border-t border-slate-800/60">
            <Td>{label(m.key)}</Td><Td right mono>{m.n}</Td><Td right mono>{m.won}–{m.lost}–{m.pushed}</Td><Td right mono>{money(m.staked)}</Td>
            <Td right mono className={m.pnl > 0 ? "text-emerald-300" : m.pnl < 0 ? "text-rose-300" : ""}>{money(m.pnl)}</Td>
            <Td right mono>{m.roi === null ? "—" : signedPct(m.roi)}</Td><Td right mono>{signedPct(m.avg_ev)}</Td><Td right mono>{signedPct(m.avg_clv_model)}</Td><Td right mono>{signedPct(m.avg_clv_price)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Pending" value={s.pending} />
        <Stat label="Settled" value={s.settled} sub={`${s.won}–${s.lost}–${s.pushed}`} />
        <Stat label="Staked" value={money(s.staked)} />
        <Stat label="P&L" value={money(s.pnl)} tone={s.pnl > 0 ? "text-emerald-300" : s.pnl < 0 ? "text-rose-300" : undefined} />
        <Stat label="ROI" value={s.roi === null ? "—" : signedPct(s.roi)} />
        <Stat label="Avg EV at bet" value={signedPct(s.avg_ev)} />
        <Stat label="Avg CLV (model)" value={signedPct(s.avg_clv_model)} sub={s.clv_model_n ? `${pct(s.clv_model_pos / s.clv_model_n, 0)} positive of ${s.clv_model_n}` : "closing fair − fair at bet"} />
        <Stat label="Avg CLV (price)" value={signedPct(s.avg_clv_price)} sub="vs same book's close" />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <ChipGroup value={f.status} onChange={(status) => set({ status })} options={[["pending", "Pending"], ["settled", "Settled"], ["won", "Won"], ["lost", "Lost"], ["push", "Push"], ["void", "Void"]]} />
        <Divider />
        <ChipGroup value={f.line} onChange={(line) => set({ line })} options={LINE_OPTS} />
        <Divider />
        <ChipGroup value={f.period} onChange={(period) => set({ period })} options={PERIOD_OPTS} />
        <Divider />
        <ChipGroup value={f.source} onChange={(source) => set({ source })} options={[["auto", "Auto"], ["manual", "Manual ✎"]]} />
        <Divider />
        <MultiSelect options={books} value={f.books} onChange={(books) => set({ books })} />
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
          <span><span className="font-mono text-slate-300">{shown.length}</span> of {bets.length}</span>
          {active && <button onClick={() => setF(DEFAULT)} className="text-accent hover:underline">clear</button>}
        </span>
      </div>

      {err && <div className="shrink-0"><ErrorBox error={err} /></div>}
      <Panel className="flex min-h-0 flex-1 flex-col" bodyClassName="flex min-h-0 flex-1 flex-col p-3" title="Ledger" right={active ? <span className="text-accent">filtered</span> : undefined}>
        {!shown.length ? <Empty>{bets.length ? "No paper bets match these filters." : "No paper bets. Auto-paper takes the best price on every edge above the threshold; the game page papers anything by hand."}</Empty> : (
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-[1] bg-slate-900 shadow-[0_1px_0_0_var(--color-slate-800)]"><tr><Th>Placed</Th><Th>Game</Th><Th>Market</Th><Th>Side</Th><Th>Book</Th><Th right>Price</Th><Th right>Stake</Th><Th right>Fair</Th><Th right>EV</Th><Th>Status</Th><Th right>P&L</Th><Th right>Close fair</Th><Th right>CLV model</Th><Th right>CLV price</Th><Th></Th></tr></thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                    <Td className="text-slate-500">{fmtTime(b.placed_at)}</Td>
                    <Td className="cursor-pointer font-medium text-slate-100" onClick={() => onOpen(b.game_id)}>{matchup({ home_abbr: b.home_abbr, away_abbr: b.away_abbr, home_name: b.home_name ?? "", away_name: b.away_name ?? "" })}{b.game_status === "final" ? <span className="ml-1 font-mono text-slate-500">{b.final_away}–{b.final_home}</span> : null}</Td>
                    <Td>{marketLabel(b.market)}</Td><Td>{sideLabel(b.side, b.point, b.home_abbr, b.away_abbr)}</Td>
                    <Td className="cursor-pointer text-slate-400 hover:text-slate-200" title="filter to this book" onClick={() => set({ books: [b.sportsbook] })}>{b.sportsbook}{b.source === "manual" ? " ✎" : ""}</Td>
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

      {shown.length > 0 && (
        <details className="shrink-0 rounded-lg border border-slate-800 bg-slate-900">
          <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">By market · by book{active ? <span className="ml-2 normal-case tracking-normal text-accent">filtered</span> : null}</summary>
          <div className="grid gap-3 border-t border-slate-800 p-3 lg:grid-cols-2">
            {rows(byMarket, marketLabel)}
            {rows(byBook, (k) => k)}
          </div>
          <p className="px-3 pb-3 text-[11px] text-slate-500">Stakes: quarter-Kelly on a 100-unit bankroll, capped at 1 unit ({num(100, 0)}). CLV (model) is the closing-consensus model's fair minus the fair at placement; CLV (price) is the taken price against the same book's last pre-start quote. Tiles and breakdowns follow the filter bar.</p>
        </details>
      )}
    </div>
  );
}
