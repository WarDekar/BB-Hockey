// Filter-bar primitives, ported from BB-Odds's My Till / Top Bets bars:
// pill chips in composable single-select groups (click the active chip to
// clear it), a divider between groups, and themed popover selects instead of
// native <select>s (OS menus clash with the dark chrome).
import { useEffect, useRef, useState, type ReactNode } from "react";

export const chipClass = (active: boolean) =>
  `whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${active ? "bg-accent text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`;

export const Chip = ({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) => (
  <button onClick={onClick} className={chipClass(active)} title={title}>{children}</button>
);

/** Single-select chip group; clicking the active chip clears back to `all`. */
export const ChipGroup = ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, ReactNode][] }) => (
  <div className="flex items-center gap-1">
    {options.map(([k, label]) => <Chip key={k} active={value === k} onClick={() => onChange(value === k ? "all" : k)}>{label}</Chip>)}
  </div>
);

export const Divider = () => <div className="h-5 w-px shrink-0 bg-slate-800" />;

export const inputClass = "rounded border border-slate-800 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-accent/60";

function usePopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", key); };
  }, [open]);
  return { open, setOpen, btnRef, panelRef };
}

const triggerClass = "whitespace-nowrap rounded-full bg-slate-800 pl-2.5 pr-2 py-0.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-accent/60";
const panelClass = "absolute left-0 top-full z-50 mt-1 w-max min-w-full space-y-0.5 rounded-lg border border-slate-800 bg-slate-900 p-1.5 shadow-xl";
const rowClass = "flex w-full items-center gap-3 whitespace-nowrap rounded px-2 py-1 text-left text-xs transition-colors hover:bg-slate-800/60";

export function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const { open, setOpen, btnRef, panelRef } = usePopover();
  const current = options.find((o) => o.value === value);
  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((v) => !v)} className={triggerClass}>{current?.label ?? value}<span className="ml-1.5 text-[9px] text-slate-500">▾</span></button>
      {open && (
        <div ref={panelRef} className={panelClass}>
          {options.map((o) => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }} className={rowClass}>
              <span className={o.value === value ? "font-semibold text-slate-100" : "text-slate-300"}>{o.label}</span>
              <span className="ml-auto text-emerald-400">{o.value === value ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Multi-select; `value` is null for "everything" or the selected keys. Rows toggle without closing. */
export function MultiSelect({ options, value, onChange, noun = "books" }: { options: { key: string; label: string; sub?: string }[]; value: string[] | null; onChange: (v: string[] | null) => void; noun?: string }) {
  const { open, setOpen, btnRef, panelRef } = usePopover();
  const [query, setQuery] = useState("");
  useEffect(() => { if (open) setQuery(""); }, [open]);
  const all = value === null;
  const sel = new Set(all ? options.map((o) => o.key) : value);
  const toggle = (k: string) => {
    const next = new Set(sel);
    if (next.has(k)) next.delete(k); else next.add(k);
    onChange(next.size === options.length ? null : [...next]);
  };
  const label = all ? `All ${noun}` : sel.size === 0 ? `No ${noun}` : sel.size === 1 ? options.find((o) => sel.has(o.key))?.label ?? `1 of ${options.length}` : `${sel.size} of ${options.length} ${noun}`;
  const q = query.trim().toLowerCase();
  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((v) => !v)} className={`${triggerClass} ${all ? "" : "text-accent"}`}>{label}<span className="ml-1.5 text-[9px] text-slate-500">▾</span></button>
      {open && (
        <div ref={panelRef} className={panelClass}>
          <div className="flex items-center gap-1">
            <Chip active={false} onClick={() => onChange(null)}>All</Chip>
            <Chip active={false} onClick={() => onChange([])}>None</Chip>
          </div>
          {options.length > 8 && <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search…" className={`${inputClass} w-full`} />}
          <div className="max-h-72 space-y-0.5 overflow-y-auto scrollbar-thin">
            {options.filter((o) => !q || o.label.toLowerCase().includes(q)).map((o) => (
              <button key={o.key} onClick={() => toggle(o.key)} className={rowClass}>
                <span className={sel.has(o.key) ? "font-semibold text-slate-100" : "text-slate-400"}>{o.label}</span>
                {o.sub && <span className="font-mono text-[10px] text-slate-500">{o.sub}</span>}
                <span className="ml-auto pl-3 text-emerald-400">{sel.has(o.key) ? "✓" : ""}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Market vocabulary → line type / period, shared by the Bets and Edges bars.
export const lineOf = (m: string) => (m.endsWith("ml") || m.endsWith("3way") ? "ml" : m === "puck" || m.endsWith("spread") ? "spread" : "total");
export const periodOf = (m: string) => (/^p\d/.test(m) ? m.slice(0, 2) : "game");
export const LINE_OPTS: [string, string][] = [["ml", "ML"], ["spread", "Puck"], ["total", "Total"]];
export const PERIOD_OPTS: [string, string][] = [["game", "Game"], ["p1", "P1"], ["p2", "P2"], ["p3", "P3"]];
export const teamMatch = (q: string, r: { home_name?: string; away_name?: string; home_abbr?: string | null; away_abbr?: string | null }) =>
  !q || [r.home_name, r.away_name, r.home_abbr, r.away_abbr].some((x) => x?.toLowerCase().includes(q));

// Game-date presets (My Till's Quick Select), applied to game time.
export const DATE_OPTS = [
  { value: "all", label: "All time" }, { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "last7", label: "Last 7 days" },
  { value: "thisWeek", label: "This week" }, { value: "lastWeek", label: "Last week" }, { value: "thisMonth", label: "This month" }, { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom…" },
];
export function dateRange(preset: string, from: string, to: string): [Date | null, Date | null] {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const addD = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const weekStart = addD(d0, -((d0.getDay() + 6) % 7));
  const monthStart = new Date(d0.getFullYear(), d0.getMonth(), 1);
  switch (preset) {
    case "today": return [d0, addD(d0, 1)];
    case "yesterday": return [addD(d0, -1), d0];
    case "last7": return [addD(d0, -6), addD(d0, 1)];
    case "thisWeek": return [weekStart, addD(weekStart, 7)];
    case "lastWeek": return [addD(weekStart, -7), weekStart];
    case "thisMonth": return [monthStart, new Date(d0.getFullYear(), d0.getMonth() + 1, 1)];
    case "lastMonth": return [new Date(d0.getFullYear(), d0.getMonth() - 1, 1), monthStart];
    case "custom": return [from ? new Date(`${from}T00:00`) : null, to ? addD(new Date(`${to}T00:00`), 1) : null];
    default: return [null, null];
  }
}

