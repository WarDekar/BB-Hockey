// TeamLogo — THE way a team logo renders anywhere in the app, ported from BB-Odds
// (frontend/src/components/TeamLogo.jsx) and BB-Futures (ADR-002 §4).
//
// House rule: every team logo gets the light circular backing on every surface. Many marks
// are dark or transparent and vanish against the dark theme without it; the circle also
// matches BookBadge so book and team marks read as one system. Non-negotiables, each with a
// reason: slate-300 backing (white was too harsh, operator 2026-09-08), inset padding
// max(1, round(size*0.12)) so the mark never touches the edge, `onError` hides the PARENT so
// a dead link leaves no empty circle, `alt=''` because the logo sits beside the team code.
// One shared component, never inlined at a call site: inlining is how BB-Odds's grid ended
// up with bare logos.
import { teamOf } from "../lib/teams";

export function TeamLogo({ abbr, url, size = 22, className = "", alt = "" }: { abbr?: string | null; url?: string | null; size?: number; className?: string; alt?: string }) {
  const src = url ?? teamOf(abbr)?.logo_url ?? null;
  if (!src) return null;
  return (
    <span className={`inline-flex flex-shrink-0 items-center justify-center rounded-full align-middle ${className}`}
          style={{ width: size, height: size, backgroundColor: "#cbd5e1", padding: Math.max(1, Math.round(size * 0.12)) }}>
      <img src={src} alt={alt} loading="lazy" className="h-full w-full object-contain"
           onError={(e) => { const p = (e.target as HTMLImageElement).parentElement; if (p) p.style.display = "none"; }} />
    </span>
  );
}
