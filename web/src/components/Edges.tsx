import { useMemo, useState } from "react";
import type { Edge } from "../lib/api";
import { ago, evClass, fmtAmerican, fmtClock, marketLabel, matchup, pct, sideLabel, signedPct } from "../lib/format";
import { Empty, Panel, Pill, Td, Th } from "./Primitives";

export default function Edges({ rows, minEdge, onOpen }: { rows: Edge[]; minEdge: number; onOpen: (id: number) => void }) {
  const [min, setMin] = useState(minEdge);
  const [family, setFamily] = useState("all");
  const [book, setBook] = useState("all");
  const families = useMemo(() => [...new Set(rows.map((r) => r.market))].sort(), [rows]);
  const books = useMemo(() => [...new Set(rows.map((r) => r.sportsbook))].sort(), [rows]);
  const shown = rows.filter((r) => r.ev >= min && (family === "all" || r.market === family) && (book === "all" || r.sportsbook === book));
  const sel = "rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-xs text-slate-200";
  return (
    <Panel title="Edges" right={<span className="flex items-center gap-2">
      <label>min EV <input type="number" step="0.5" value={(min * 100).toFixed(1)} onChange={(e) => setMin(Number(e.target.value) / 100)} className={`${sel} w-16 text-right`} />%</label>
      <select value={family} onChange={(e) => setFamily(e.target.value)} className={sel}><option value="all">all markets</option>{families.map((f) => <option key={f} value={f}>{marketLabel(f)}</option>)}</select>
      <select value={book} onChange={(e) => setBook(e.target.value)} className={sel}><option value="all">all books</option>{books.map((b) => <option key={b} value={b}>{b}</option>)}</select>
      <span>{shown.length} / {rows.length}</span>
    </span>}>
      {!shown.length ? <Empty>No quotes above {pct(min)} EV on pregame games right now.</Empty> : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead><tr><Th>Game</Th><Th>Start</Th><Th>Market</Th><Th>Side</Th><Th>Book</Th><Th right>Price</Th><Th right>Fair</Th><Th right>Fair prob</Th><Th right>EV</Th><Th right>¼ Kelly</Th><Th right>Quoted</Th><Th></Th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} onClick={() => onOpen(e.game_id)} className="cursor-pointer border-t border-slate-800/60 hover:bg-slate-800/40">
                  <Td className="font-medium text-slate-100">{matchup(e)}</Td><Td mono className="text-slate-400">{fmtClock(e.game_time)}</Td>
                  <Td>{marketLabel(e.market)}</Td><Td>{sideLabel(e.side, e.point, e.home_abbr, e.away_abbr)}</Td><Td className="text-slate-400">{e.sportsbook}</Td>
                  <Td right mono>{fmtAmerican(e.price)}</Td><Td right mono className="text-slate-400">{fmtAmerican(e.fair_price)}</Td>
                  <Td right mono title={e.push_prob ? `push ${pct(e.push_prob)}` : undefined}>{pct(e.fair_prob)}</Td>
                  <Td right mono className={evClass(e.ev)}>{signedPct(e.ev)}</Td><Td right mono className="text-slate-400">{pct(e.kelly * 0.25)}</Td>
                  <Td right className="text-slate-500">{ago(e.quoted_at)}</Td><Td>{e.papered && <Pill tone="blue">papered</Pill>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
