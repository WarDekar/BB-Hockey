// Team cells: logo + code, full name (and rotation when known) in a custom hover tip.
// `Matchup` is the "AWAY @ HOME" cell every table uses; `TeamTag` is a single team.
import { HoverTip } from "./HoverTip";
import { TeamLogo } from "./TeamLogo";
import { teamOf, useTeams } from "../lib/teams";

/**
 * `pad` fixes the rotation (3 ch, right-aligned) and the code (3 ch, mono) to column
 * widths so a table of teams lines up whatever the digit count or code length;
 * `align` says which edge the code hugs (right for an away column, left for home).
 */
export function TeamTag({ abbr, name, size = 18, className = "", rotation, labelOverride, pad = false, align = "left" }: {
  abbr?: string | null; name?: string | null; size?: number; className?: string; rotation?: number | null; labelOverride?: string; pad?: boolean; align?: "left" | "right";
}) {
  useTeams();
  const t = teamOf(abbr);
  const full = t?.name ?? name ?? abbr ?? "";
  const tip = full || rotation ? <span>{full}{rotation ? <span className="ml-2 font-mono text-slate-400">rot {rotation}</span> : null}</span> : null;
  const rotCls = pad ? "inline-block w-[3ch] text-right" : "";
  const codeCls = pad ? `inline-block w-[3ch] font-mono tabular-nums ${align === "right" ? "text-right" : "text-left"}` : "";
  return (
    <HoverTip tip={tip} className={className}>
      <span className="inline-flex items-center gap-1.5">
        {rotation || pad ? <span className={`font-mono text-[10px] text-slate-500 ${rotCls}`}>{rotation ?? ""}</span> : null}
        <TeamLogo abbr={abbr} size={size} />
        <span className={codeCls}>{labelOverride ?? abbr ?? name ?? "—"}</span>
      </span>
    </HoverTip>
  );
}

export function Matchup({ g, size = 18, className = "", rotations = false }: {
  g: { home_abbr?: string | null; away_abbr?: string | null; home_name?: string | null; away_name?: string | null; home_rotation?: number | null; away_rotation?: number | null };
  size?: number; className?: string; rotations?: boolean;
}) {
  useTeams();
  const a = teamOf(g.away_abbr), h = teamOf(g.home_abbr);
  const tip = (
    <span>
      <span className="font-medium text-slate-100">{a?.name ?? g.away_name ?? g.away_abbr}</span>
      <span className="text-slate-500"> at </span>
      <span className="font-medium text-slate-100">{h?.name ?? g.home_name ?? g.home_abbr}</span>
      {g.away_rotation || g.home_rotation ? <span className="ml-2 font-mono text-slate-400">rot {g.away_rotation ?? "?"} / {g.home_rotation ?? "?"}</span> : null}
    </span>
  );
  return (
    <HoverTip tip={tip} className={className}>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {rotations && g.away_rotation ? <span className="font-mono text-[10px] text-slate-500">{g.away_rotation}</span> : null}
        <TeamLogo abbr={g.away_abbr} size={size} /><span>{g.away_abbr ?? g.away_name}</span>
        <span className="text-slate-500">@</span>
        {rotations && g.home_rotation ? <span className="font-mono text-[10px] text-slate-500">{g.home_rotation}</span> : null}
        <TeamLogo abbr={g.home_abbr} size={size} /><span>{g.home_abbr ?? g.home_name}</span>
      </span>
    </HoverTip>
  );
}

/** A priced side: the team's logo before "ABBR +1.5"; totals and draws stay text. */
export function SideCell({ side, label, homeAbbr, awayAbbr, size = 16 }: { side: string; label: string; homeAbbr?: string | null; awayAbbr?: string | null; size?: number }) {
  const abbr = side === "home" ? homeAbbr : side === "away" ? awayAbbr : null;
  if (!abbr) return <span>{label}</span>;
  return <TeamTag abbr={abbr} size={size} name={label} className="" rotation={null} labelOverride={label} />;
}
