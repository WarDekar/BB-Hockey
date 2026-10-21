// BookBadge — the shared sportsbook badge, ported from BB-Odds (frontend/src/components/
// BookBadge.jsx). Real logos: files in src/assets/books/ named by slug (lowercase, every
// non-alphanumeric stripped: "DraftKings" → draftkings.png) are picked up automatically.
// Books without a file get a brand-coloured monogram tile. Same circular backing as TeamLogo.
import { memo } from "react";

const files = import.meta.glob("../assets/books/*.{png,svg,webp}", { eager: true, import: "default" }) as Record<string, string>;
const logos: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) logos[path.split("/").pop()!.replace(/\.(png|svg|webp)$/i, "")] = url;

const slugify = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const BRAND: Record<string, { bg: string; fg: string }> = {
  circa: { bg: "#9f1239", fg: "#ffffff" }, draftkings: { bg: "#53d337", fg: "#0b2818" }, caesars: { bg: "#111111", fg: "#d4af37" },
  betonline: { bg: "#b91c1c", fg: "#ffffff" }, bovada: { bg: "#cc0000", fg: "#ffffff" }, pinnacle: { bg: "#0b3861", fg: "#ffffff" },
  peppermill: { bg: "#7c3aed", fg: "#ffffff" }, atlantis: { bg: "#0d9488", fg: "#ffffff" }, boomers: { bg: "#ea580c", fg: "#ffffff" },
  paradisewager: { bg: "#2563eb", fg: "#ffffff" }, polymarket: { bg: "#8b5cf6", fg: "#ffffff" }, sharpbookprice: { bg: "#1d4ed8", fg: "#ffffff" },
  isisports: { bg: "#065f46", fg: "#ffffff" }, goldennugget: { bg: "#a16207", fg: "#ffffff" }, betmgm: { bg: "#b3a125", fg: "#111111" },
  kalshi: { bg: "#0f766e", fg: "#ffffff" }, bet365: { bg: "#14805e", fg: "#ffff9c" }, bookmaker: { bg: "#7f1d1d", fg: "#ffffff" },
  fanduel: { bg: "#1493ff", fg: "#ffffff" }, marketconsensus: { bg: "#334155", fg: "#e2e8f0" },
};

const initials = (name: string | null | undefined) => {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

function Badge({ name, size = 20 }: { name: string | null | undefined; size?: number }) {
  const slug = slugify(name);
  const logo = logos[slug];
  if (logo) {
    return (
      <span className="inline-flex flex-shrink-0 items-center justify-center rounded-full align-middle"
            style={{ width: size, height: size, backgroundColor: "#cbd5e1", padding: Math.max(2, Math.round(size * 0.12)) }}>
        <img src={logo} alt="" className="h-full w-full object-contain" />
      </span>
    );
  }
  const key = BRAND[slug] ? slug : Object.keys(BRAND).find((k) => slug.length >= 3 && (slug.includes(k) || k.includes(slug)));
  const brand = (key && BRAND[key]) || { bg: "#3a3f50", fg: "#cbd5e1" };
  return (
    <span aria-hidden="true" className="inline-flex flex-shrink-0 select-none items-center justify-center rounded-full align-middle font-bold leading-none"
          style={{ width: size, height: size, backgroundColor: brand.bg, color: brand.fg, fontSize: Math.round(size * 0.42) }}>
      {initials(name)}
    </span>
  );
}

// Memoised: the tables re-render on every poll; props are a string and a number, so the shallow compare is exactly right.
export const BookBadge = memo(Badge);
