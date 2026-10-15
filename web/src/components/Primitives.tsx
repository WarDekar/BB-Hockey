import type { ReactNode } from "react";

export const Panel = ({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`rounded-lg border border-slate-800 bg-slate-900 ${className}`}>
    {(title || right) && (
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</h2>
        <div className="text-xs text-slate-500">{right}</div>
      </header>
    )}
    <div className="p-3">{children}</div>
  </section>
);

export const Th = ({ children, right = false, className = "" }: { children?: ReactNode; right?: boolean; className?: string }) => (
  <th className={`whitespace-nowrap px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${right ? "text-right" : "text-left"} ${className}`}>{children}</th>
);
export const Td = ({ children, right = false, mono = false, className = "", title, onClick }: { children?: ReactNode; right?: boolean; mono?: boolean; className?: string; title?: string; onClick?: () => void }) => (
  <td title={title} onClick={onClick} className={`whitespace-nowrap px-2 py-1 ${right ? "text-right" : ""} ${mono ? "font-mono tabular-nums" : ""} ${className}`}>{children}</td>
);

export const Pill = ({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue" }) => {
  const t = { slate: "bg-slate-800 text-slate-300", green: "bg-emerald-500/15 text-emerald-300", red: "bg-rose-500/15 text-rose-300", amber: "bg-amber-500/15 text-amber-300", blue: "bg-accent/15 text-accent" }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${t}`}>{children}</span>;
};

export const Stat = ({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) => (
  <div className="rounded-md border border-slate-800 bg-slate-950/40 px-3 py-2">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`font-mono text-lg tabular-nums ${tone ?? "text-slate-100"}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
  </div>
);

export const Button = ({ children, onClick, tone = "slate", disabled, small }: { children: ReactNode; onClick?: () => void; tone?: "slate" | "blue" | "red"; disabled?: boolean; small?: boolean }) => {
  const t = { slate: "border-slate-700 text-slate-300 hover:border-slate-600 hover:text-slate-100", blue: "border-accent/60 text-accent hover:bg-accent/10", red: "border-rose-500/50 text-rose-300 hover:bg-rose-500/10" }[tone];
  return (
    <button disabled={disabled} onClick={onClick} className={`rounded border ${t} ${small ? "px-1.5 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"} disabled:opacity-40`}>
      {children}
    </button>
  );
};

export const Empty = ({ children }: { children: ReactNode }) => <div className="px-2 py-6 text-center text-sm text-slate-500">{children}</div>;
export const ErrorBox = ({ error }: { error: string }) => <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>;
