import { useEffect, useState } from "react";
import type { Params as P } from "../lib/api";
import { sendJson } from "../lib/api";
import { Button, ErrorBox, Panel } from "./Primitives";

const FIELDS: { key: string; label: string; help: string; step: number }[] = [
  { key: "draw_inflation", label: "Draw inflation", help: "Multiplier on tied scores before renormalising (score effects). With the late kernel it applies at 17:00 of the third: 1.20 ≈ 20% tied at 17:00 and 22% after 60 (NHL.com PBP 2023-26). 1.45 was the full-game value for the old path.", step: 0.05 },
  { key: "late_kernel", label: "Late-game kernel (1/0)", help: "1 = the Poisson pair runs to 17:00 of the third and the last three minutes come from the measured kernel (goals after 17:00 by margin at 17:00, NHL.com PBP, 4,343 finals); 0 = full-game Poisson with the empty-net mass shifts below. The kernel is what fixes the totals shape (odd totals, exact 6).", step: 1 },
  { key: "kernel_pace_k", label: "Kernel pace elasticity", help: "How the kernel's late goals scale with the game's pace: every 'goals happen' cell is multiplied by ((λh+λa) / reference)^k. 0 = the same kernel for every game; 1 = fully proportional. Team-season pace in the PBP is too narrow (±4%) to measure it; set from the totals tails on the historical finals.", step: 0.1 },
  { key: "kernel_pace_ref", label: "Kernel pace reference", help: "λh+λa of the league-average game the kernel was measured on (equal teams, 5.97 regulation goals per game in the 2023-26 PBP).", step: 0.05 },
  { key: "eng_rate", label: "Empty-net rate, 1-goal leads", help: "League reference: of teams down one inside 3:00 that lost, the share that lost by two or more. Measured 0.44 from NHL.com play-by-play 2023-26. Per game the trailing coach's own rate is used when the benches are known; under the late kernel the coach's deviation from this number moves the kernel's empty-net branch by the same odds ratio.", step: 0.02 },
  { key: "eng_rate2", label: "Empty-net rate, 2-goal leads", help: "League reference for two-goal leads (down two late and lost by 2+, the share lost by 3+). Measured 0.42. Drives the ±2.5 alternates.", step: 0.02 },
  { key: "eng_chain", label: "Second empty-netter", help: "Old path only (late kernel off): of one-goal leads that took the empty-netter, the share that take a second. Measured 0.18. The kernel carries this itself.", step: 0.02 },
  { key: "eng_rate3", label: "Empty-net rate, 3-goal leads", help: "Old path only (late kernel off): share of three-goal wins that become four. Measured 0.14. The kernel carries this itself.", step: 0.02 },
  { key: "eng_prior_games", label: "Coach shrinkage (games)", help: "Weight of the league rate when blending a coach's own empty-net record: rate = (k + w·league) / (n + w). 40 ≈ one season of late deficits.", step: 5 },
  { key: "strength_sigma", label: "Strength uncertainty σ", help: "Optional mixture of the log rate-ratio around the fitted one (5-point Gauss-Hermite). Widens both sides' margins. Tested at 0.35 on 1,743 historical finals and rejected: favourites' margins already fit, underdog blowouts were overstated. Leave at 0.", step: 0.05 },
  { key: "coach_eng", label: "Use coach rates (1/0)", help: "1 = per-game empty-net rates from the trailing side's coach (Pulls tab); 0 = the two league rates above for every game.", step: 1 },
  { key: "ot_decided_share", label: "OT decided share", help: "Of games tied after 60, the share decided in 3v3 OT rather than the shootout. Measured 0.68 (904 OT games, 290 shootouts, 2023-26).", step: 0.05 },
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
    for (const k of FIELDS) f[k.key] = String(typeof data.params[k.key] === "boolean" ? (data.params[k.key] ? 1 : 0) : data.params[k.key]);
    setForm(f);
    setShares((data.params.period_shares as number[]).map(String));
  }, [data]);
  const save = async () => {
    setErr(null); setSaved(false);
    const body: Record<string, unknown> = {};
    for (const k of FIELDS) body[k.key] = k.key === "coach_eng" ? Number(form[k.key]) !== 0 : Number(form[k.key]);
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
