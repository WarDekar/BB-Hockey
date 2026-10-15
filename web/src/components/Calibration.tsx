import { CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { Calibration as Calib } from "../lib/api";
import { num, pct, signedPct } from "../lib/format";
import { Empty, Panel, Td, Th } from "./Primitives";

const PRIORS: { key: string; label: string; prior: string; pred?: string }[] = [
  { key: "reg_tie_rate", label: "Regulation ties", prior: "~23% (draw_inflation 1.45)", pred: "pred_draw" },
  { key: "so_share_of_ot", label: "Shootouts among OT games", prior: "35% (ot_decided_share 0.65)" },
  { key: "avg_total", label: "Goals per game (incl. OT/SO)", prior: "market", pred: "pred_total" },
  { key: "avg_reg_total", label: "Regulation goals", prior: "—", pred: "pred_reg_total" },
  { key: "home_win_rate", label: "Home wins", prior: "market", pred: "pred_home" },
  { key: "reg_one_goal_rate", label: "One-goal regulation margins", prior: "eng_rate 0.28 moves 1→2" },
  { key: "reg_two_goal_rate", label: "Two-goal regulation margins", prior: "" },
  { key: "p1_share", label: "P1 share of regulation goals", prior: "0.30" },
  { key: "p2_share", label: "P2 share", prior: "0.335" },
  { key: "p3_share", label: "P3 share", prior: "0.365" },
];

export default function Calibration({ data }: { data: Calib }) {
  const d = data.diagnostics;
  const pts = data.buckets.map((b) => ({ x: b.mean_prob, y: b.hit, n: b.n, brier: b.brier }));
  const finals = d.finals ?? 0;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Reliability — closing model, all markets" right={`${data.buckets.reduce((a, b) => a + b.n, 0)} observations`}>
          {!pts.length ? <Empty>Calibration needs settled games: every priced side of the closing board becomes an observation once the final is in.</Empty> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid stroke="#3a3f50" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="x" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="#6b7280" fontSize={11} />
                <YAxis type="number" dataKey="y" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke="#6b7280" fontSize={11} />
                <Tooltip contentStyle={{ background: "#282c3a", border: "1px solid #3a3f50", fontSize: 12 }} formatter={(v: unknown) => pct(Number(v))} labelFormatter={(v: unknown) => `predicted ${pct(Number(v))}`} />
                <Line data={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} dataKey="y" stroke="#6b7280" dot={false} strokeDasharray="4 4" isAnimationActive={false} />
                <Scatter data={pts} dataKey="y" fill="#7dd3fc" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>
        <Panel title="Structural rates — realised vs prior" right={`${finals} finals`}>
          <table className="w-full text-xs">
            <thead><tr><Th>Rate</Th><Th right>Realised</Th><Th right>Model (closing)</Th><Th>Prior</Th></tr></thead>
            <tbody>
              {PRIORS.map((p) => {
                const v = d[p.key], m = p.pred ? d[p.pred] : null;
                const isPct = !p.key.startsWith("avg_");
                return (
                  <tr key={p.key} className="border-t border-slate-800/60">
                    <Td>{p.label}</Td>
                    <Td right mono>{v === null || v === undefined ? "—" : isPct ? pct(v) : num(v)}</Td>
                    <Td right mono className="text-slate-400">{m === null || m === undefined ? "—" : isPct ? pct(m) : num(m)}</Td>
                    <Td className="text-slate-500">{p.prior}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500">The priors are what the model assumes about hockey; this table is the evidence for changing them (Params tab). Small samples swing — judge on hundreds of finals, not dozens.</p>
        </Panel>
      </div>
      <Panel title="By market family">
        {!data.by_family.length ? <Empty>No settled observations yet.</Empty> : (
          <table className="w-full text-xs">
            <thead><tr><Th>Family</Th><Th right>n</Th><Th right>Mean predicted</Th><Th right>Hit rate</Th><Th right>Bias</Th><Th right>Brier</Th></tr></thead>
            <tbody>
              {data.by_family.map((f) => (
                <tr key={f.family} className="border-t border-slate-800/60">
                  <Td>{f.family}</Td><Td right mono>{f.n}</Td><Td right mono>{pct(f.mean_prob)}</Td><Td right mono>{pct(f.hit)}</Td>
                  <Td right mono className={Math.abs(f.bias) > 0.03 ? "text-amber-300" : "text-slate-300"}>{signedPct(f.bias)}</Td><Td right mono>{num(f.brier, 4)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
