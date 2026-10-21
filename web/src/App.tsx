import { useEffect, useMemo } from "react";
import Bets from "./components/Bets";
import Board from "./components/Board";
import Calibration from "./components/Calibration";
import Edges from "./components/Edges";
import GameDetail from "./components/GameDetail";
import Params from "./components/Params";
import Pulls from "./components/Pulls";
import { Button, Empty, ErrorBox } from "./components/Primitives";
import Results from "./components/Results";
import { useApi, useHash } from "./hooks";
import { useTeams } from "./lib/teams";
import type { Bet, BetSummary, Calibration as Calib, Edge, GameDetail as Detail, Health, Params as P, ResultRow, SlateRow } from "./lib/api";
import { ago, money } from "./lib/format";

const TABS = ["board", "edges", "bets", "results", "pulls", "calibration", "params"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [hash, setHash] = useHash();
  const gameId = hash.startsWith("game=") ? Number(hash.slice(5)) : null;
  const tab: Tab = (TABS as readonly string[]).includes(hash) ? (hash as Tab) : "board";
  useTeams();   // one subscription for the tree: cells read the store directly (thousands of per-cell hooks were the Edges render cost)
  const health = useApi<Health>("/health", 30000);
  const slate = useApi<SlateRow[]>(tab === "board" ? "/slate" : null, 60000);
  const edges = useApi<Edge[]>(tab === "edges" ? "/edges?min_ev=-1" : null, 60000);   // the whole board; the tab's min-EV box filters
  const bets = useApi<Bet[]>(tab === "bets" ? "/bets?limit=5000" : null, 60000);
  const betSummary = useApi<BetSummary>(tab === "bets" ? "/bets/summary" : null, 60000);
  const results = useApi<ResultRow[]>(tab === "results" ? "/results?days=365" : null, 120000);
  const calib = useApi<Calib>(tab === "calibration" ? "/calibration" : null, 0);
  const params = useApi<P>(tab === "params" ? "/params" : null, 0, false);
  const detail = useApi<Detail>(gameId ? `/games/${gameId}` : null, 30000);
  const minEdge = health.data?.paper.min_edge ?? 0.03;
  const pricing = health.data?.heartbeats.pricing;
  const settlement = health.data?.heartbeats.settlement;

  useEffect(() => { document.title = gameId && detail.data ? `${detail.data.game.away_abbr} @ ${detail.data.game.home_abbr} · BB-Hockey` : "BB-Hockey"; }, [gameId, detail.data]);
  const open = (id: number) => setHash(`game=${id}`);
  const nav = useMemo(() => TABS.map((t) => (
    <button key={t} onClick={() => setHash(t)} className={`px-2.5 py-1 text-xs capitalize ${tab === t && !gameId ? "bg-accent/20 text-accent" : "text-slate-400 hover:text-slate-100"}`}>{t}</button>
  )), [tab, gameId, setHash]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="z-10 shrink-0 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2.5 max-sm:px-3">
          <div className="mr-2 flex select-none items-center gap-2">
            <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0" aria-hidden="true">
              <rect x="3" y="3" width="34" height="34" rx="8" fill="#1f2937" stroke="#7b9cf5" strokeWidth="2" />
              <line x1="10" y1="8" x2="24" y2="27" stroke="#e5e7eb" strokeWidth="3" strokeLinecap="round" />
              <line x1="24" y1="27" x2="31" y2="24" stroke="#e5e7eb" strokeWidth="3" strokeLinecap="round" />
              <ellipse cx="13" cy="30" rx="6" ry="2.6" fill="#fb923c" /><rect x="7" y="27.5" width="12" height="2.6" fill="#fb923c" /><ellipse cx="13" cy="27.5" rx="6" ry="2.6" fill="#fdba74" />
            </svg>
            <div className="flex flex-col justify-center leading-none">
              <span className="text-3xl font-bold tracking-tight max-sm:text-2xl"><span className="text-accent">BB</span><span className="text-brand-orange">-</span><span className="text-ice">Hockey</span></span>
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">Derivative pricer · paper</span>
            </div>
          </div>
          <div className="inline-flex overflow-hidden rounded border border-slate-700">{nav}</div>
          {gameId && <Button small onClick={() => setHash(tab)}>← back</Button>}
          <span className="ml-auto inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1" title={pricing?.note ?? "no pricing heartbeat"}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${health.data?.status === "ok" ? "bg-emerald-400" : health.data ? "bg-amber-400" : "bg-rose-400"}`} />
              <span className="text-slate-400">priced {ago(pricing?.last_run_at)}</span>
            </span>
            <span title={settlement?.note ?? ""}>settled {ago(settlement?.last_run_at)}</span>
            {health.data && <span><span className="text-slate-600">pending</span> <span className="font-mono text-slate-300">{health.data.counts.pending_bets}</span></span>}
            {health.data && <span><span className="text-slate-600">finals</span> <span className="font-mono text-slate-300">{health.data.counts.finals}</span></span>}
            {health.data && <span className={health.data.paper.auto ? "text-slate-400" : "text-amber-300"}>auto-paper {health.data.paper.auto ? `≥ ${(minEdge * 100).toFixed(0)}%` : "off"}</span>}
          </span>
        </div>
      </header>
      <main className="mx-auto min-h-0 w-full max-w-[1920px] flex-1 overflow-y-auto px-6 py-4 max-sm:px-3 scrollbar-thin">
        {health.error && <div className="mb-3"><ErrorBox error={`API unreachable: ${health.error}`} /></div>}
        {gameId ? (
          detail.error ? <ErrorBox error={detail.error} /> : detail.data ? <GameDetail detail={detail.data} reload={detail.reload} minEdge={minEdge} /> : <Empty>Loading…</Empty>
        ) : tab === "board" ? (
          slate.error ? <ErrorBox error={slate.error} /> : slate.data ? <Board rows={slate.data} onOpen={open} /> : <Empty>Loading…</Empty>
        ) : tab === "edges" ? (
          edges.error ? <ErrorBox error={edges.error} /> : edges.data ? <Edges rows={edges.data} minEdge={minEdge} onOpen={open} /> : <Empty>Loading…</Empty>
        ) : tab === "bets" ? (
          bets.error ? <ErrorBox error={bets.error} /> : bets.data ? <Bets bets={bets.data} reload={() => { bets.reload(); betSummary.reload(); }} onOpen={open} /> : <Empty>Loading…</Empty>
        ) : tab === "results" ? (
          results.error ? <ErrorBox error={results.error} /> : results.data ? <Results rows={results.data} onOpen={open} /> : <Empty>Loading…</Empty>
        ) : tab === "pulls" ? (
          <Pulls />
        ) : tab === "calibration" ? (
          calib.error ? <ErrorBox error={calib.error} /> : calib.data ? <Calibration data={calib.data} /> : <Empty>Loading…</Empty>
        ) : (
          params.error ? <ErrorBox error={params.error} /> : params.data ? <Params data={params.data} reload={params.reload} /> : <Empty>Loading…</Empty>
        )}
      </main>
      <footer className="shrink-0 px-6 py-3 text-[11px] text-slate-600">BB-Hockey · slot 18 · paper only · fairs from a diagonal-inflated Poisson fitted to BB-Odds's devigged consensus ML + total · P&L {money(betSummary.data?.pnl ?? null)}</footer>
    </div>
  );
}
