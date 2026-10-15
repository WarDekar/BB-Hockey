import { useEffect, useState } from "react";
import type { Params as P } from "../lib/api";
import { sendJson } from "../lib/api";
import { Button, ErrorBox, Panel } from "./Primitives";

const FIELDS: { key: string; label: string; help: string; step: number }[] = [
  { key: "draw_inflation", label: "Draw inflation", help: "Multiplier on tied regulation scores before renormalising (score effects). 1.0 = independent Poisson (~17% ties); 1.45 ≈ 23%.", step: 0.05 },
  { key: "eng_rate", label: "Empty-net rate", help: "Share of one-goal regulation wins that become two-goal wins (the ENG counts on the total). Drives −1.5.", step: 0.02 },
  { key: "ot_decided_share", label: "OT decided share", help: "Of games tied after 60, the share decided in 3v3 OT rather than the shootout.", step: 0.05 },
  { key: "ot_skill_k", label: "OT skill k", help: "Home OT win prob = 0.5 + k·(p_reg_home − p_reg_away).", step: 0.1 },
  { key: "so_skill_k", label: "Shootout skill k", help: "Same for the shootout; small — shootouts are close to coin flips.", step: 0.1 },
  { key: "period_draw_inflation", label: "Period draw inflation", help: "Diagonal inflation inside a single period.", step: 0.05 },
  { key: "default_total", label: "Default total", help: "Used only when BB-Odds has no total for the game.", step: 0.5 },
  { key: "max_goals", label: "Max goals (grid)", help: "Per-team truncation of the score matrix.", step: 1 },
];

export default function Params({ data, reload }: { data: P; reload: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<string[]>(["", "", ""]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const f: Record<string, string> = {};
    for (const k of FIELDS) f[k.key] = String(data.params[k.key]);
    setForm(f);
    setShares((data.params.period_shares as number[]).map(String));
  }, [data]);
  const save = async () => {
    setErr(null); setSaved(false);
    const body: Record<string, unknown> = {};
    for (const k of FIELDS) body[k.key] = Number(form[k.key]);
    body.period_shares = shares.map(Number);
    try { await sendJson("PUT", "/params", body); setSaved(true); reload(); } catch (e) { setErr((e as Error).message); }
  };
  const inp = "w-24 rounded border border-slate-700 bg-slate-950/40 px-2 py-1 text-right font-mono text-xs text-slate-100";
  return (
    <Panel title="Model parameters" right="applied on the next pricing pass; snapshots record the params they were priced with">
      {err && <ErrorBox error={err} />}
      <div className="grid gap-3 md:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex items-start justify-between gap-3 rounded border border-slate-800 bg-slate-950/30 px-3 py-2">
            <span>
              <span className="block text-sm text-slate-200">{f.label} <span className="font-mono text-[10px] text-slate-600">default {String(data.defaults[f.key])}</span></span>
              <span className="block text-[11px] text-slate-500">{f.help}</span>
            </span>
            <input type="number" step={f.step} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className={inp} />
          </label>
        ))}
        <label className="flex items-start justify-between gap-3 rounded border border-slate-800 bg-slate-950/30 px-3 py-2 md:col-span-2">
          <span>
            <span className="block text-sm text-slate-200">Period shares (P1, P2, P3) <span className="font-mono text-[10px] text-slate-600">default {(data.defaults.period_shares as number[]).join(" / ")}</span></span>
            <span className="block text-[11px] text-slate-500">Share of the regulation scoring rate in each period; must sum to 1. Third periods carry the empty-net goals.</span>
          </span>
          <span className="flex gap-1">{shares.map((s, i) => <input key={i} type="number" step={0.005} value={s} onChange={(e) => setShares(shares.map((x, j) => (j === i ? e.target.value : x)))} className={inp} />)}</span>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button tone="blue" onClick={save}>Save</Button>
        {saved && <span className="text-xs text-emerald-300">saved</span>}
      </div>
    </Panel>
  );
}
