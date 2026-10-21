// HoverTip — the custom tooltip, ported from BB-Odds (frontend/src/components/HoverTip.jsx,
// design directive #7): portal + fixed position, dark themed card, arbitrary content. Never a
// native `title` for structured content. `tip` null → children render bare.
import { useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function HoverTip({ tip, width = 320, className = "", style, children }: { tip: ReactNode; width?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  if (tip === null || tip === undefined) return <span className={className} style={style}>{children}</span>;
  const onEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
    setPos({ top: Math.min(rect.bottom + 6, vh - 40), left: Math.max(8, Math.min(rect.left, vw - width - 16)) });
  };
  // inline-block, not inline: a plain inline span collapses to a sliver when it wraps block content (BB-Odds, 2026-09-17).
  return (
    <span className={className} style={{ display: "inline-block", ...style }} onMouseEnter={onEnter} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && createPortal(
        <div className="pointer-events-none fixed z-[100] rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 shadow-xl"
             style={{ top: pos.top, left: pos.left, maxWidth: `min(${width}px, calc(100vw - 16px))` }}>
          {tip}
        </div>,
        document.body,
      )}
    </span>
  );
}
