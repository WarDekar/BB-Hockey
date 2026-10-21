import { useMemo, useState } from "react";
import type { CoachNote, NoteLean, NoteStat, PullNotes as Notes } from "../lib/api";
import { useApi } from "../hooks";
import { pct } from "../lib/format";
import { Empty, ErrorBox, Pill, Stat } from "./Primitives";
import { ChipGroup, Divider, inputClass } from "./Filters";

// Cliff notes for the 32 current benches: when this coach's team trails late, does the
// opponent's puck line cash more or less often than the league? Sorted by the strongest lean.
const mmss = (s: number | null | undefined) => { if (s === null || s === undefined || !isFinite(s)) return "—"; const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const seasonLabel = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6)}`;
const tone = (l: NoteLean): "green" | "red" | "slate" | "amber" => (l.strength === "thin" || l.strength === "neutral" || !l.market ? "slate" : (l.market === "team +1.5" || l.market === "team +2.5") ? "green" : l.market === "over" || l.market === "under" ? "amber" : "red");
const label = (l: NoteLean, team: string) => l.market === "opp -1.5" ? `Opp −1.5 vs ${team}` : l.market === "team +1.5" ? `${team} +1.5` : l.market === "avoid +2.5" ? `Avoid ${team} +2.5` : l.market === "team +2.5" ? `${team} +2.5` : l.strength === "thin" ? "thin sample" : "no lean";
const totalLabel = (l: NoteLean, k: 1 | 2) => (l.market ? `${l.market === "over" ? "Over" : "Under"} lean, down ${k} late` : null);

function Line({ k, s, L }: { k: 1 | 2; s: NoteStat | null; L: NoteStat }) {
  if (!s) return <div className="text-[11px] text-slate-600">Down {k} late: no situations in sample</div>;
  const d = s.lose_big !== null && L.lose_big !== null ? s.lose_big - L.lose_big : null;
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px] leading-5">
      <span className="text-slate-500">Down {k} late</span>
      <span className="text-slate-300">
        <span className="font-mono">{s.n}</span> games{s.n_this ? <span className="text-slate-500"> ({s.n_this} this season)</span> : null} · loses by {k + 1}+ <span className={`font-mono ${d === null ? "" : d >= 0.05 ? "text-rose-300" : d <= -0.05 ? "text-emerald-300" : "text-slate-100"}`}>{pct(s.lose_big, 0)}</span>
        <span className="text-slate-500"> (lg {pct(L.lose_big, 0)})</span> · pulls <span className="font-mono">{pct(s.pull_rate, 0)}</span> at <span className="font-mono">{mmss(s.median_s)}</span> · EN <span className="font-mono">{pct(s.en, 0)}</span>
        {k === 1 ? <> · to OT/won <span className="font-mono">{pct(s.point, 0)}</span></> : null}
      </span>
      <span className="text-slate-500">Totals</span>
      <span className="text-slate-300">
        a goal after 17:00 <span className={`font-mono ${s.late1 !== null && L.late1 !== null ? (s.late1 - L.late1 >= 0.05 ? "text-amber-200" : s.late1 - L.late1 <= -0.05 ? "text-sky-200" : "text-slate-100") : ""}`}>{pct(s.late1, 0)}</span>
        <span className="text-slate-500"> (lg {pct(L.late1, 0)})</span> · two or more <span className="font-mono">{pct(s.late2, 0)}</span><span className="text-slate-500"> (lg {pct(L.late2, 0)})</span> · avg <span className="font-mono">{s.late_goals === null ? "—" : s.late_goals.toFixed(2)}</span><span className="text-slate-500"> (lg {L.late_goals === null ? "—" : L.late_goals.toFixed(2)})</span>
      </span>
    </div>
  );
}

export default function PullNotes() {
  const res = useApi<Notes>("/pulls/notes", 0, false);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all");
  const d = res.data;
  const rows = useMemo(() => {
    if (!d) return [] as CoachNote[];
    const s = q.trim().toLowerCase();
    return d.coaches.filter((c) => (!s || c.coach.toLowerCase().includes(s) || c.team.toLowerCase().includes(s))
      && (only === "all" || (only === "leans" ? (c.lean1.market || c.lean2.market || c.total1.market || c.total2.market) : only === "d1" ? c.lean1.market : only === "d2" ? c.lean2.market : (c.total1.market || c.total2.market))));
  }, [d, q, only]);
  if (res.error) return <ErrorBox error={res.error} />;
  if (!d) return <Empty>Loading coach notes…</Empty>;
  const L1 = d.league["1"], L2 = d.league["2"];
  const leans = d.coaches.filter((c) => c.lean1.market || c.lean2.market || c.total1.market || c.total2.market).length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Down 1 late → loses by 2+" value={pct(L1.lose_big, 0)} sub={`league, ${L1.n} team-games · opp −1.5 cashes`} />
        <Stat label="Down 1 late → to OT or won" value={pct(L1.point, 0)} sub="league" />
        <Stat label="Down 2 late → loses by 3+" value={pct(L2.lose_big, 0)} sub={`league, ${L2.n} team-games · +2.5 fails`} />
        <Stat label="Down 2 late → a goal after 17:00" value={pct(L2.late1, 0)} sub={`league · avg ${L2.late_goals?.toFixed(2)} late goals, moves a 6.5`} />
        <Stat label="Benches with a lean" value={leans} sub={`of ${d.coaches.length} current coaches`} />
        <Stat label="Sample" value={`${seasonLabel(d.season - 30003)} to ${seasonLabel(d.season)}`} sub="regular season + playoffs" />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <ChipGroup value={only} onChange={(v) => setOnly(v)} options={[["leans", "With a lean"], ["d1", "Puck line"], ["d2", "Alt +2.5"], ["tot", "Totals"]]} />
        <Divider />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="coach or team…" className={`${inputClass} w-32`} />
        <span className="ml-auto text-[11px] text-slate-500"><span className="font-mono text-slate-300">{rows.length}</span> benches · sorted by strongest lean</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((c) => (
            <div key={c.coach} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-mono text-base font-semibold text-ice">{c.team}</span>
                <span className="font-medium text-slate-100">{c.coach}</span>
                <span className="text-[11px] text-slate-500">since {c.since} · {c.games_with_team} g</span>
                <span className="ml-auto flex gap-1">
                  <Pill tone={tone(c.lean1)}>{label(c.lean1, c.team)}{c.lean1.strength === "strong" ? " ★" : ""}</Pill>
                  <Pill tone={tone(c.lean2)}>{label(c.lean2, c.team)}{c.lean2.strength === "strong" ? " ★" : ""}</Pill>
                  {totalLabel(c.total1, 1) && <Pill tone="amber">{totalLabel(c.total1, 1)}{c.total1.strength === "strong" ? " ★" : ""}</Pill>}
                  {totalLabel(c.total2, 2) && <Pill tone="amber">{totalLabel(c.total2, 2)}{c.total2.strength === "strong" ? " ★" : ""}</Pill>}
                </span>
              </div>
              {(c.tags1.length || c.tags2.length) ? <div className="mt-1 text-[11px] text-amber-200/80">{[...new Set([...c.tags1.map((t) => `${t} (down 1)`), ...c.tags2.map((t) => `${t} (down 2)`)])].join(" · ")}</div> : null}
              <div className="mt-1.5 space-y-0.5">
                <Line k={1} s={c.down1} L={L1} />
                <Line k={2} s={c.down2} L={L2} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 px-1 text-[11px] text-slate-500">{d.method}</p>
      </div>
    </div>
  );
}
