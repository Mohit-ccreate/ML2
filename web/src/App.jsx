/* ============================================================================
 * OPTIONEDGE — NIFTY 50 · ML TERMINAL  (v2 React redesign)
 * ----------------------------------------------------------------------------
 * Production-style single-file terminal: design-system primitives + 8 tabbed
 * views (Overview / ViT Attention / Predictions / Sentiment / Option Greeks /
 * Backtest / Benchmarks / Reports) with full loading / empty / active states.
 *
 * Mock state lives in ./mock.js (same shape as the Flask /api/state payload —
 * swap useAppData for a real fetch to go live).
 * ==========================================================================*/
import React, { useState, useEffect, useMemo, useRef, useId } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BookOpen, BrainCircuit,
  CalendarRange, CheckCircle2, ChevronDown, Crosshair, Download, FileText,
  FlaskConical, FolderUp, Gauge as GaugeIcon, Info, Layers, LayoutDashboard, LineChart,
  Loader2, Moon, Play, Radio, RefreshCw, Scale, Search, Shuffle, Sigma,
  Sparkles, Sun, Target, Timer, TrendingDown, TrendingUp, MoveHorizontal,
  Waves, Wifi, Zap,
} from "lucide-react";

import {
  TELEM, MODELS, attentionForHead, LAST_SESSION, genScenario, latest60, parseCsv,
  pseudoPredict, batchDays, batchDay, equitySeries, BT_STATS, MONTHLY_PNL, TRADES,
  BENCH, SENTIMENT, GREEKS, FINDINGS, REPORT_FILES, METHOD,
} from "./mock";
import { useLive, apiLatest, apiPredictCsv, apiPredictRange } from "./live";

/* ============================== helpers ============================== */
const cls = (...a) => a.filter(Boolean).join(" ");
const inr = (v) => "₹" + Math.round(v).toLocaleString("en-IN");
const f2 = (v) => (v == null ? "—" : v.toFixed(2));
const pctS = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const TONE = {
  green: "text-green", rose: "text-rose", cyan: "text-cyan",
  violet: "text-violet", amber: "text-amber", mid: "text-mid", lo: "text-lo", hi: "text-hi",
};

/* ============================== primitives ============================== */
function Card({ children, className = "" }) {
  return (
    <section className={cls("rounded-2xl border border-edge/80 bg-card/90 backdrop-blur", className)}>
      {children}
    </section>
  );
}
const BADGE_TONES = {
  cyan: "border-cyan/40 bg-cyan/10 text-cyan",
  violet: "border-violet/40 bg-violet/10 text-violet",
  green: "border-green/40 bg-green/10 text-green",
  rose: "border-rose/40 bg-rose/10 text-rose",
  amber: "border-amber/40 bg-amber/10 text-amber",
};
function Badge({ tone = "cyan", children }) {
  return (
    <span className={cls("rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold tracking-[0.16em]", BADGE_TONES[tone])}>
      {children}
    </span>
  );
}
function CardHead({ badge, tone = "cyan", title, sub, right }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-edge/60 px-5 py-3.5">
      {badge && <Badge tone={tone}>{badge}</Badge>}
      <h2 className="font-display text-[12px] font-bold tracking-[0.2em] text-hi">{title}</h2>
      {sub && <span className="font-mono text-[10px] text-lo">{sub}</span>}
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
function Stat({ icon: Icon, label, value, sub, tone = "cyan" }) {
  return (
    <div className="rounded-xl border border-edge/80 bg-panel/70 px-4 py-3 transition duration-200 hover:-translate-y-0.5 hover:border-cyan/40">
      <div className={cls("flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.15em]", TONE[tone])}>
        <Icon size={12} /> {label}
      </div>
      <div className={cls("mt-1.5 font-mono text-xl font-bold tabular-nums", TONE[tone])}>{value}</div>
      {sub && <div className="mt-1 font-mono text-[10px] text-mid">{sub}</div>}
    </div>
  );
}
export const Sk = ({ className = "" }) => <div className={cls("animate-pulse rounded-md bg-edge/60", className)} />;
function Btn({ variant = "ghost", icon: Icon, children, className = "", ...rest }) {
  const v = {
    ghost: "border-edge bg-panel/60 text-mid hover:border-cyan/40 hover:text-hi",
    primary: "border-transparent bg-gradient-to-r from-violet to-cyan text-white hover:brightness-110",
    cyan: "border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20",
  }[variant];
  return (
    <button
      {...rest}
      className={cls(
        "focus-ring inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 font-mono text-[11px] font-semibold tracking-wide transition duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        v, className
      )}
    >
      {Icon && <Icon size={14} className={rest.disabled ? "animate-spin" : ""} />}
      {children}
    </button>
  );
}
function Seg({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap rounded-lg border border-edge bg-base/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cls(
            "rounded-md px-3 py-1.5 font-mono text-[10.5px] font-semibold tracking-wide transition duration-150",
            value === o.v
              ? "bg-gradient-to-r from-cyan/20 to-violet/20 text-hi ring-1 ring-cyan/50"
              : "text-lo hover:text-mid"
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
function SearchInput({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lo" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="focus-ring w-52 rounded-lg border border-edge bg-base/60 py-2 pl-8 pr-3 font-mono text-[11px] text-hi placeholder:text-lo"
      />
    </div>
  );
}
function Select({ value, onChange, options, label }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-lo">{label}</span>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="focus-ring cursor-pointer appearance-none rounded-lg border border-edge bg-base/60 py-2 pl-3 pr-8 font-mono text-[11px] text-hi"
        >
          {options.map((o) => (
            <option key={o.v} value={o.v} className="bg-card text-hi">{o.l}</option>
          ))}
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-lo" />
      </div>
    </div>
  );
}
function DateInput({ label, value, onChange, min, max }) {
  return (
    <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-lo">
      {label}
      <input
        type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)}
        className="focus-ring rounded-lg border border-edge bg-base/60 px-3 py-2 font-mono text-[11px] normal-case text-hi"
      />
    </label>
  );
}
function SignalBadge({ signal, size = "lg" }) {
  const map = {
    BUY: "border-green/50 bg-green/15 text-green",
    SELL: "border-rose/50 bg-rose/15 text-rose",
    HOLD: "border-amber/50 bg-amber/15 text-amber",
  };
  return (
    <span className={cls(
      "inline-flex items-center rounded-lg border font-display font-extrabold tracking-[0.22em]",
      map[signal] || "border-edge text-mid",
      size === "lg" ? "px-5 py-2.5 text-lg" : "px-3 py-1 text-xs"
    )}>
      {signal}
    </span>
  );
}
function ProbBars({ probs }) {
  const names = ["SELL", "HOLD", "BUY"];
  const colors = ["bg-rose", "bg-amber", "bg-green"];
  return (
    <div className="w-full space-y-1.5">
      {probs.map((p, i) => (
        <div key={names[i]} className="grid grid-cols-[46px_1fr_48px] items-center gap-2 font-mono text-[10px]">
          <span className="tracking-wider text-lo">{names[i]}</span>
          <div className="h-2 overflow-hidden rounded-full bg-edge/60">
            <div className={cls("h-full rounded-full", colors[i])} style={{ width: `${(p * 100).toFixed(1)}%` }} />
          </div>
          <span className="text-right tabular-nums text-hi">{(p * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}
function Empty({ icon: Icon = Search, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-14 text-center">
      <div className="rounded-xl border border-edge bg-panel/60 p-3.5"><Icon size={20} className="text-lo" /></div>
      <div className="font-display text-[11px] font-bold tracking-[0.22em] text-mid">{title}</div>
      {sub && <div className="max-w-md font-mono text-[10.5px] leading-relaxed text-lo">{sub}</div>}
    </div>
  );
}
function Callout({ icon: Icon = Info, tone = "violet", children }) {
  const wrap = {
    violet: "border-violet/30 bg-violet/[0.06]", amber: "border-amber/30 bg-amber/[0.06]",
    cyan: "border-cyan/30 bg-cyan/[0.06]", rose: "border-rose/30 bg-rose/[0.06]",
  }[tone];
  return (
    <div className={cls("flex gap-3 rounded-xl border px-4 py-3 text-[12px] leading-relaxed text-mid", wrap)}>
      <Icon size={15} className={cls("mt-0.5 shrink-0", TONE[tone])} />
      <div>{children}</div>
    </div>
  );
}
const Th = ({ children, className = "" }) => (
  <th className={cls("whitespace-nowrap px-3 py-2.5 text-right font-mono text-[9.5px] font-semibold uppercase tracking-[0.15em] text-lo first:text-left", className)}>
    {children}
  </th>
);
const Td = ({ children, className = "" }) => (
  <td className={cls("whitespace-nowrap px-3 py-2.5 text-right font-mono text-[11.5px] tabular-nums text-hi first:text-left", className)}>
    {children}
  </td>
);
function Adense({ children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

/* ============================== charts (hand-rolled SVG) ============================== */
function EquityChart({ series, height = 280, highlight = 0, yFmt = (v) => v.toFixed(0) }) {
  const [hover, setHover] = useState(null);
  const uid = useId().replace(/[:]/g, "");
  const W = 880, H = height;
  const P = { l: 52, r: 16, t: 16, b: 24 };
  const data = series.map((s) => s.data);
  const n = data[0].length;
  const all = data.flatMap((d) => d.map((p) => p[1]));
  const min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.06 || 1;
  const lo = min - pad, hi = max + pad;
  const X = (i) => P.l + (i / (n - 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const path = (d) => d.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const area = (d) => `${path(d)} L${X(n - 1).toFixed(1)},${(H - P.b).toFixed(1)} L${X(0).toFixed(1)},${(H - P.b).toFixed(1)} Z`;
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((fx - P.l) / (W - P.l - P.r)) * (n - 1))));
    setHover(i);
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={series[highlight].color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={series[highlight].color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke="rgb(var(--c-edge))" strokeOpacity="0.6" strokeDasharray="3 5" />
            <text x={P.l - 8} y={Y(v) + 3} textAnchor="end" fontSize="9" fontFamily="JetBrains Mono, monospace" fill="rgb(var(--c-ink-lo))">{yFmt(v)}</text>
          </g>
        ))}
        {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
          <text key={i} x={X(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="9" fontFamily="JetBrains Mono, monospace" fill="rgb(var(--c-ink-lo))">{data[0][i][0]}</text>
        ))}
        <path d={area(data[highlight])} fill={`url(#area-${uid})`} />
        {series.map((s, si) => (
          <path key={s.name} d={path(data[si])} fill="none" stroke={s.color} strokeWidth={si === highlight ? 2.2 : 1.3} strokeOpacity={si === highlight ? 1 : 0.7} />
        ))}
        {hover != null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={P.t} y2={H - P.b} stroke="rgb(var(--c-cyan))" strokeOpacity="0.5" strokeDasharray="2 3" />
            {series.map((s) => (
              <circle key={s.name} cx={X(hover)} cy={Y(data[series.indexOf(s)][hover][1])} r="3" fill={s.color} />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-1.5 z-10 min-w-[190px] rounded-lg border border-edge bg-card/95 px-3 py-2 font-mono text-[10px] shadow-xl backdrop-blur"
          style={{ left: `${(X(hover) / W) * 100}%`, transform: `translateX(${hover > n / 2 ? "-108%" : "10px"})` }}
        >
          <div className="mb-1 text-lo">{data[0][hover][0]}</div>
          {series.map((s, si) => (
            <div key={s.name} className="flex items-center gap-2 py-0.5">
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="text-mid">{s.name}</span>
              <span className="ml-auto pl-3 tabular-nums text-hi">{yFmt(data[si][hover][1])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function DrawdownChart({ data }) {
  let peak = -Infinity;
  const dd = data.map((v) => { peak = Math.max(peak, v); return ((v - peak) / peak) * 100; });
  const W = 460, H = 150, P = { l: 40, r: 10, t: 12, b: 18 };
  const lo = Math.min(...dd) - 2, hi = 2;
  const X = (i) => P.l + (i / (dd.length - 1)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const d = dd.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const uid = useId().replace(/[:]/g, "");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <linearGradient id={`dd-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--c-rose))" stopOpacity="0.05" />
          <stop offset="100%" stopColor="rgb(var(--c-rose))" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {[0, -20, -40, -60].map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke="rgb(var(--c-edge))" strokeOpacity="0.6" strokeDasharray="3 5" />
          <text x={P.l - 6} y={Y(v) + 3} textAnchor="end" fontSize="8.5" fontFamily="JetBrains Mono, monospace" fill="rgb(var(--c-ink-lo))">{v}%</text>
        </g>
      ))}
      <path d={`${d} L${X(dd.length - 1)},${Y(0)} L${X(0)},${Y(0)} Z`} fill={`url(#dd-${uid})`} />
      <path d={d} fill="none" stroke="rgb(var(--c-rose))" strokeWidth="1.4" />
    </svg>
  );
}
function CandleViz({ rows, grid, attnOn = true, attnOp = 0.55 }) {
  const seg = rows.slice(-15);
  const uid = useId().replace(/[:]/g, "");
  if (!seg.length) return null;
  const hi = Math.max(...seg.map((r) => r[2]));
  const lo = Math.min(...seg.map((r) => r[3]));
  const W = 320, H = 210;
  const Y = (v) => 8 + (1 - (v - lo) / (hi - lo || 1)) * (H - 16);
  const cw = (W - 16) / seg.length;
  return (
    <div className="relative overflow-hidden rounded-xl border border-edge/80 bg-base/70">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <linearGradient id={`g-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(var(--c-cyan))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(var(--c-violet))" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {seg.map((r, i) => {
          const up = r[4] >= r[1];
          const cx = 8 + i * cw + cw / 2;
          const col = up ? "rgb(var(--c-green))" : "rgb(var(--c-rose))";
          const bTop = Y(Math.max(r[1], r[4]));
          const bH = Math.max(2, Math.abs(Y(r[1]) - Y(r[4])));
          return (
            <g key={r[0]}>
              <line x1={cx} x2={cx} y1={Y(r[2])} y2={Y(r[3])} stroke={col} strokeWidth="1" strokeOpacity="0.9" />
              <rect x={cx - cw * 0.3} y={bTop} width={cw * 0.6} height={bH} fill={col} rx="1" />
            </g>
          );
        })}
        <line x1="8" x2={W - 8} y1={Y(seg[seg.length - 1][4])} y2={Y(seg[seg.length - 1][4])} stroke={`url(#g-${uid})`} strokeWidth="1" strokeDasharray="4 3" />
      </svg>
      {attnOn && grid && (
        <div className="pointer-events-none absolute inset-0 grid grid-cols-8 grid-rows-8">
          {grid.map((w, i) => (
            <div key={i} className="border border-violet/10" style={{ background: `rgb(var(--c-violet) / ${(w * attnOp).toFixed(3)})` }} />
          ))}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-1.5 left-2 font-mono text-[8.5px] tracking-[0.12em] text-mid">
        64×64 RENDER · LAST 15 SESSIONS · [CLS] ATTENTION
      </div>
    </div>
  );
}
function Gauge({ value, size = 190 }) {
  const cx = 95, cy = 96, R = 76;
  const pt = (a) => [cx + R * Math.cos((a * Math.PI) / 180), cy - R * Math.sin((a * Math.PI) / 180)];
  const arc = (a0, a1) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const ang = 180 - value * 1.8;
  const [nx, ny] = [cx + (R - 14) * Math.cos((ang * Math.PI) / 180), cy - (R - 14) * Math.sin((ang * Math.PI) / 180)];
  return (
    <svg viewBox="0 0 190 118" width={size} className="mx-auto">
      <path d={arc(180, 126)} fill="none" stroke="rgb(var(--c-rose))" strokeWidth="10" strokeLinecap="round" strokeOpacity="0.8" />
      <path d={arc(122, 58)} fill="none" stroke="rgb(var(--c-amber))" strokeWidth="10" strokeOpacity="0.8" />
      <path d={arc(54, 0)} fill="none" stroke="rgb(var(--c-green))" strokeWidth="10" strokeLinecap="round" strokeOpacity="0.8" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="rgb(var(--c-ink-hi))" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5" fill="rgb(var(--c-ink-hi))" />
      <text x="22" y="114" fontSize="8.5" fontFamily="JetBrains Mono, monospace" fill="rgb(var(--c-ink-lo))">FEAR</text>
      <text x="148" y="114" fontSize="8.5" fontFamily="JetBrains Mono, monospace" fill="rgb(var(--c-ink-lo))">GREED</text>
    </svg>
  );
}

/* ============================== header + ticker ============================== */
const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "attention", label: "ViT Attention", icon: BrainCircuit },
  { id: "predictions", label: "Predictions", icon: Crosshair },
  { id: "sentiment", label: "Sentiment", icon: Activity },
  { id: "greeks", label: "Option Greeks", icon: Sigma },
  { id: "backtest", label: "Backtest", icon: LineChart },
  { id: "benchmarks", label: "Benchmarks", icon: Scale },
  { id: "reports", label: "Reports", icon: FileText },
];
function Header({ tab, setTab, theme, setTheme, refreshing, onRefresh, src = "mock", built = null, tick = null }) {
  const last = tick?.[tick.length - 1] || null;
  const prev = tick?.[tick.length - 2] || null;
  return (
    <header className="sticky top-0 z-40 border-b border-edge/80 bg-base/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-cyan/40 bg-gradient-to-br from-cyan/25 to-violet/25 shadow-glow-cyan">
            <Zap size={17} className="text-cyan" />
          </div>
          <div>
            <div className="font-display text-[15px] font-black tracking-[0.24em] text-hi">
              OPTION<span className="text-cyan">EDGE</span>
            </div>
            <div className="font-mono text-[8.5px] tracking-[0.3em] text-lo">NIFTY 50 · ML TERMINAL</div>
          </div>
          <span className="ml-1 flex items-center gap-1.5 rounded-full border border-green/40 bg-green/10 px-2.5 py-1 font-mono text-[9px] font-bold tracking-[0.18em] text-green">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
            </span>
            LIVE (WS)
          </span>
        </div>

        <nav className="order-last flex w-full gap-1 overflow-x-auto pb-0.5 lg:order-none lg:w-auto lg:flex-1 lg:justify-center">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cls(
                "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[10.5px] font-semibold tracking-wide transition duration-150",
                tab === id
                  ? "border-cyan/50 bg-gradient-to-r from-cyan/15 to-violet/15 text-hi shadow-glow-cyan"
                  : "border-transparent text-lo hover:bg-panel/70 hover:text-mid"
              )}
            >
              <Icon size={13} className={tab === id ? "text-cyan" : ""} />
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <span className="hidden items-center gap-1.5 rounded-lg border border-edge bg-panel/50 px-2.5 py-1.5 font-mono text-[9.5px] tracking-wider text-mid md:flex">
            <Timer size={11} className="text-cyan" /> BUILT {built || TELEM.built}
          </span>
          <span className={cls("hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[9px] font-bold tracking-[0.14em] md:flex",
            src === "api" ? "border-green/40 bg-green/10 text-green" : "border-amber/40 bg-amber/10 text-amber")}>
            {src === "api" ? "DATA · LIVE API" : "DATA · MOCK"}
          </span>
          <Btn variant="cyan" icon={RefreshCw} onClick={onRefresh} disabled={refreshing} className="!px-3 !py-1.5">
            {refreshing ? "SYNCING" : "REFRESH"}
          </Btn>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="focus-ring grid h-8 w-8 place-items-center rounded-lg border border-edge bg-panel/60 text-mid transition hover:text-hi"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>
      <div className="border-t border-edge/60 bg-card/40">
        <div className="mx-auto flex max-w-[1440px] items-center gap-x-5 overflow-x-auto px-5 py-1.5 font-mono text-[10.5px]">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-bold tracking-wider text-mid">NIFTY 50</span>
            <span className="font-bold tabular-nums text-hi">{last ? last.close : TELEM.nifty.close.toLocaleString("en-IN")}</span>
            <span className={cls("flex items-center gap-0.5 font-bold tabular-nums", (last ? last.ret : `+${TELEM.nifty.ret}%`).startsWith("-") ? "text-rose" : "text-green")}>
              <ArrowUpRight size={11} className={(last ? last.ret : "").startsWith("-") ? "-scale-y-100" : ""} />
              {last ? last.ret : `+${TELEM.nifty.ret}%`}
            </span>
          </span>
          <span className="text-edge">•</span>
          <span className="whitespace-nowrap text-cyan">IV {last ? last.iv : `${TELEM.nifty.iv}%`}</span>
          <span className="text-edge">•</span>
          <span className="whitespace-nowrap text-mid">RSI {last ? last.rsi : TELEM.nifty.rsi}</span>
          <span className="text-edge">•</span>
          <span className="whitespace-nowrap text-green">VOL21 {last ? last.vol21 : `${TELEM.nifty.oi}%`}</span>
          <span className="text-edge">•</span>
          <span className="whitespace-nowrap text-lo">
            PREV {prev ? prev.d : TELEM.prev.d} · {prev ? prev.close : TELEM.prev.close.toLocaleString("en-IN")}{" "}
            <span className="text-mid">({prev ? prev.ret : pctS(TELEM.prev.ret)})</span>
          </span>
          <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-lo">
            <Wifi size={11} className="text-green" /> {TELEM.sessions.toLocaleString("en-IN")} SESSIONS · {TELEM.range}
          </span>
        </div>
      </div>
    </header>
  );
}

/* ============================== 1 · OVERVIEW ============================== */
function ModelRoster({ loading, rows0 }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("name");
  const [fam, setFam] = useState("all");
  const rows = useMemo(() => {
    let r = (rows0 || MODELS).filter((m) => (fam === "all" || m.fam === fam) && m.name.toLowerCase().includes(q.trim().toLowerCase()));
    const key = {
      name: (m) => m.name, insample: (m) => m.ins.a, paper: (m) => m.paper.a,
      wf: (m) => m.wf.a, auc: (m) => m.auc, ret: (m) => m.ret, sharpe: (m) => m.sharpe,
    }[sort];
    return [...r].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : key(b) - key(a)));
  }, [q, sort, fam]);
  const famChip = { deep: ["DEEP", "border-violet/40 bg-violet/10 text-violet"], tree: ["GBDT", "border-green/40 bg-green/10 text-green"], ens: ["STACK", "border-amber/40 bg-amber/10 text-amber"] };
  return (
    <Card>
      <CardHead
        badge="BENCHMARKING" tone="cyan" title="MODEL ROSTER" sub="3 protocols · 3,943 sessions"
        right={
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search models…" />
            <Select
              label="Sort" value={sort} onChange={setSort}
              options={[
                { v: "name", l: "Name" }, { v: "insample", l: "In-sample" }, { v: "paper", l: "Paper 80/20" },
                { v: "wf", l: "Walk-fwd OOS" }, { v: "auc", l: "OOS AUC" }, { v: "ret", l: "OOS Return" }, { v: "sharpe", l: "Sharpe" },
              ]}
            />
            <Seg
              value={fam} onChange={setFam}
              options={[{ v: "all", l: "All" }, { v: "deep", l: "Deep Learning" }, { v: "tree", l: "Tree Models" }, { v: "ens", l: "Ensemble" }]}
            />
          </>
        }
      />
      {loading ? (
        <div className="space-y-2.5 p-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-3">
              <Sk className="h-4 w-40" /><Sk className="h-4 w-28" /><Sk className="h-4 flex-1" />
            </div>
          ))}
        </div>
      ) : rows.length ? (
        <Adense>
          <thead className="border-b border-edge/60">
            <tr>
              <Th>Model</Th><Th className="!text-left">Architecture</Th><Th>In-Sample</Th><Th>Paper 80/20</Th>
              <Th>Walk-Fwd OOS</Th><Th>OOS AUC</Th><Th>OOS Return</Th><Th>Sharpe</Th><Th>Win %</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.name} className="border-b border-edge/40 transition-colors last:border-0 hover:bg-cyan/[0.04]">
                <Td className="font-bold">{m.name}</Td>
                <Td className="!text-left">
                  <span className="mr-2 inline-flex items-center gap-1.5">
                    {m.fam === "deep" ? <BrainCircuit size={11} className="text-violet" /> : m.fam === "tree" ? <Zap size={11} className="text-green" /> : <Layers size={11} className="text-amber" />}
                    <span className={cls("rounded-md border px-1.5 py-0.5 font-mono text-[8.5px] font-bold tracking-wider", famChip[m.fam][1])}>
                      {famChip[m.fam][0]}
                    </span>
                  </span>
                  <span className="text-[10px] text-lo">{m.arch} · {m.badge}</span>
                </Td>
                <Td className="text-mid">{m.ins.a.toFixed(1)} / {m.ins.d.toFixed(1)}</Td>
                <Td className="text-mid">{m.paper.a.toFixed(1)} / {m.paper.d.toFixed(1)}</Td>
                <Td className="font-bold text-cyan">{m.wf.a.toFixed(1)} / {m.wf.d.toFixed(1)}</Td>
                <Td className={m.auc >= 0.53 ? "text-green" : m.auc >= 0.5 ? "text-cyan" : "text-rose"}>{m.auc.toFixed(3)}</Td>
                <Td className={m.ret >= 0 ? "text-green" : "text-rose"}>{pctS(m.ret, 0)}</Td>
                <Td className={m.sharpe >= 1 ? "text-green" : "text-cyan"}>{m.sharpe.toFixed(2)}</Td>
                <Td className="text-mid">{m.win.toFixed(1)}</Td>
              </tr>
            ))}
          </tbody>
        </Adense>
      ) : (
        <Empty icon={Search} title="NO MODELS MATCH YOUR SEARCH" sub={`query "${q}" · ${fam === "all" ? "all families" : fam} — try a different name or clear the filter.`} />
      )}
      <div className="border-t border-edge/50 px-5 py-2 font-mono text-[9.5px] tracking-wider text-lo">
        FORMAT: 3-CLASS ACC / UP-DOWN ACC · WALK-FWD = STRICTLY OUT-OF-SAMPLE YEARLY BLOCKS · {rows.length} OF {MODELS.length} MODELS
      </div>
    </Card>
  );
}
function OverviewTab({ loading, go, L }) {
  const eq = useMemo(() => (L && L.equity ? L.equity : equitySeries()), [L]);
  const H = L?.hero || {};
  const al = L?.alpha || {};
  const ensAcc = L ? (L.models.find((m) => m.kind === "ens")?.wf.a ?? 0) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {loading ? (
          Array.from({ length: 7 }).map((_, i) => <Sk key={i} className="h-[86px]" />)
        ) : (
          <>
            <Stat icon={ArrowUpRight} label="Last Close" value={H.close != null ? Math.round(H.close).toLocaleString("en-IN") : TELEM.nifty.close.toLocaleString("en-IN")}
              sub={`NIFTY 50 · ${H.date || "2026-04-10"} · ${L?.heroRet || pctS(TELEM.nifty.ret)}`} tone={L ? (H.close != null ? "green" : "green") : "green"} />
            <Stat icon={Waves} label="ATM IV" value={L?.heroIv || `${TELEM.nifty.iv}%`} sub="parkinson 21d" tone="cyan" />
            <Stat icon={GaugeIcon} label="RSI (14)" value={L?.heroRsi || TELEM.nifty.rsi} sub="neutral zone 40–60" tone="cyan" />
            <Stat icon={TrendingUp} label="VOL 21D" value={L?.heroVol || `+${TELEM.nifty.oi}%`} sub="realized vol band" tone="green" />
            <Stat icon={Target} label="Honest OOS Acc" value={L ? ensAcc.toFixed(2) + "%" : "47.8%"}
              sub={L ? `3-class walk-fwd · ${L.meta?.n_samples ?? ""} rows` : "walk-fwd 3-class · base 44.1%"} tone="violet" />
            <Stat icon={Zap} label="Alpha Straddle" value={L ? pctS(al.ret_pct) : "+249.3%"} sub={L ? `OOS ${al.period} · Sharpe ${al.sharpe}` : "OOS 2020→26 · Sharpe 1.03"} tone={L ? al.ret_pct >= 0 ? "green" : "rose" : "green"} />
            <Stat icon={BrainCircuit} label="Last Signal" value={LAST_SESSION.signal} sub={`ViT · ${LAST_SESSION.date}`} tone={LAST_SESSION.signal === "SELL" ? "rose" : LAST_SESSION.signal === "BUY" ? "green" : "amber"} />
          </>
        )}
      </div>

      <ModelRoster loading={loading} rows0={L?.models} />

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHead
            badge="EQUITY" tone="cyan" title="WALK-FORWARD OOS BACKTEST"
            sub={L ? `${L.oosPeriod} · 3-class ensemble · ₹1,00,000 start` : "2020-01-02 → 2026-04-10 · ₹1,00,000 start"}
            right={
              <button onClick={() => go("backtest")} className="focus-ring flex items-center gap-1 rounded-lg border border-edge bg-panel/60 px-2.5 py-1.5 font-mono text-[10px] font-semibold text-mid transition hover:border-cyan/40 hover:text-cyan">
                VIEW FULL <ChevronDown size={11} className="-rotate-90" />
              </button>
            }
          />
          <div className="p-4">
            {loading ? <Sk className="h-[280px]" /> : <EquityChart series={eq.series} highlight={0} />}
          </div>
        </Card>
        <Card className="border-violet/30">
          <div className="flex h-full flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <Badge tone="violet">OPTIONEDGE ALPHA</Badge>
              <h3 className="font-display text-[12px] font-bold tracking-[0.18em] text-hi">VOL-EXPANSION STRADDLE</h3>
            </div>
            <p className="text-[12.5px] leading-relaxed text-mid">
              Walk-forward XGBoost flags days where the next 5-day move is likely to{" "}
              <b className="text-hi">exceed the IV-implied range</b>. Long ATM straddle, 5-day hold, convex payoff.
              The only out-of-sample edge in the project that survives scrutiny.
            </p>
            <div className="mt-auto grid grid-cols-2 gap-2.5">
              {[["OOS RETURN", "+249.3%", "green"], ["SHARPE", "1.03", "cyan"], ["MAX DD", "−25.8%", "rose"], ["PROFIT FACTOR", "1.44", "green"]].map(([l, v, t]) => (
                <div key={l} className="rounded-lg border border-edge/80 bg-panel/60 px-3 py-2">
                  <div className="font-mono text-[8.5px] tracking-[0.16em] text-lo">{l}</div>
                  <div className={cls("font-mono text-lg font-bold tabular-nums", TONE[t])}>{v}</div>
                </div>
              ))}
            </div>
            <Btn variant="primary" icon={Play} onClick={() => go("backtest")} className="justify-center">
              OPEN BACKTEST LAB
            </Btn>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ============================== 2 · VIT ATTENTION ============================== */
function AttentionTab({ loading, L }) {
  const [head, setHead] = useState(1);
  const latest = useMemo(() => latest60(), []);
  const att = L?.attention || null;
  const grid = useMemo(() => {
    if (L && att && head === 1) return [].concat(...att.grid);
    return attentionForHead(head, Math.round(L?.hero.close ?? TELEM.nifty.close));
  }, [head, L, att]);
  const spec = useMemo(() => Array.from({ length: 8 }, (_, h) => {
    const g = (L && att && h === 0) ? [].concat(...att.grid) : attentionForHead(h + 1, Math.round(L?.hero.close ?? TELEM.nifty.close));
    const cols = new Array(8).fill(0);
    g.forEach((v, i) => { cols[i % 8] += v / 8; });
    return cols;
  }), [L, att]);
  const top = grid.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]).slice(0, 4);
  const peak = Math.max(...grid);
  const sess = att || LAST_SESSION;
  const ensAcc = L ? (L.models.find((m) => m.kind === "ens")?.wf.a ?? 0) : 47.8;
  const alRet = L ? L.alpha.ret_pct : 249.3;
  return (
    <Card>
      <CardHead
        badge="VISION TRANSFORMER" tone="violet" title="LIVE ATTENTION FEED"
        sub={`${sess.date} · close ${inr(L?.hero.close ?? TELEM.nifty.close)} · D192 × 4 blocks · 6 heads ${L && head === 1 ? "· GRID = LIVE SAVED" : ""}`}
        right={
          <Seg value={`h${head}`} onChange={(v) => setHead(+v.slice(1))}
            options={Array.from({ length: 8 }, (_, i) => ({ v: `h${i + 1}`, l: `H${i + 1}${L && i === 0 ? " ·" : ""}` }))} />
        }
      />
      <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_1fr]">
        {loading ? (
          <div className="space-y-3"><Sk className="h-[230px]" /><Sk className="h-10" /></div>
        ) : (
          <>
            <div>
              <CandleViz rows={latest} grid={grid} />
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <SignalBadge signal={sess.signal} />
                <div className="min-w-[220px] flex-1"><ProbBars probs={sess.probs} /></div>
              </div>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-lo">
                The pulsing grid is the [CLS] token's attention over the 8×8 patch grid of the exact 64×64 candlestick
                render — where the model is looking. Bars = SELL/HOLD/BUY probability for the <b className="text-mid">next</b> session.
              </p>
            </div>
            <div className="space-y-4">
              <Callout tone="violet" icon={Info}>
                <b className="text-hi">Methodology:</b> this runs the in-sample fit — recent dates look confident by
                construction. Walk-forward OOS keeps daily direction at chance ({ensAcc.toFixed(1)}% 3-class); the
                deployable signal is the <b className="text-hi">vol-expansion straddle</b> ({pctS(alRet)} OOS, Backtest tab).
              </Callout>
              {L && head !== 1 && (
                <Callout tone="amber" icon={Info}>
                  H2–H8 shown here are mock previews (only head 1's grid is stored with the model). Switch to
                  <b className="text-hi"> H1</b> for the live saved attention grid from the trained ViT.
                </Callout>
              )}
              <div>
                <div className="mb-2 font-mono text-[9.5px] font-bold tracking-[0.18em] text-lo">HEAD × PATCH ENERGY (SPECTROGRAM)</div>
                <div className="overflow-hidden rounded-xl border border-edge/80">
                  {spec.map((cols, h) => (
                    <div key={h} className={cls("flex items-center gap-2 px-2", h % 2 ? "bg-panel/40" : "")}>
                      <span className={cls("w-6 font-mono text-[9px]", h + 1 === head ? "font-bold text-violet" : "text-lo")}>H{h + 1}</span>
                      <div className="flex flex-1 gap-1">
                        {cols.map((w, j) => (
                          <div key={j} className="h-4 flex-1 rounded-[3px]" style={{ background: `rgb(var(--c-violet) / ${(0.06 + w * 0.9).toFixed(3)})` }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 font-mono text-[9.5px] font-bold tracking-[0.18em] text-lo">TOP PATCHES · HEAD {head}</div>
                <div className="grid grid-cols-2 gap-2">
                  {top.map(([w, i]) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-edge/80 bg-panel/60 px-2.5 py-1.5 font-mono text-[10px]">
                      <span className="text-lo">[{Math.floor(i / 8)},{i % 8}]</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-edge/60">
                        <div className="h-full rounded-full bg-violet" style={{ width: `${(w * 100).toFixed(0)}%` }} />
                      </div>
                      <span className="tabular-nums text-hi">{(w * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-edge/80 bg-panel/60 px-3 py-2 font-mono text-[10px]">
                <span className="text-lo">PEAK ATTENTION</span>
                <span className="font-bold tabular-nums text-violet">{peak.toFixed(3)} · {(peak > 0.5 ? "SINGLE-PATCH LOCK" : "DISTRIBUTED READ")}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ============================== 3 · PREDICTIONS ============================== */
const SCEN = {
  up: { label: "Steady uptrend", sub: "+0.4% / day drift", icon: TrendingUp, tone: "green", hover: "hover:border-green/50" },
  down: { label: "Steady downtrend", sub: "−0.4% / day drift", icon: TrendingDown, tone: "rose", hover: "hover:border-rose/50" },
  spike: { label: "Vol spike", sub: "8 wild sessions at the end", icon: Zap, tone: "violet", hover: "hover:border-violet/50" },
  chop: { label: "Sideways chop", sub: "alternating ±0.18%", icon: MoveHorizontal, tone: "amber", hover: "hover:border-amber/50" },
  random: { label: "Random walk", sub: "σ 0.8% / day", icon: Shuffle, tone: "cyan", hover: "hover:border-cyan/50" },
};
function PredictionsTab({ loading, L }) {
  const [mode, setMode] = useState("custom");
  const [csv, setCsv] = useState("");
  const [csvErr, setCsvErr] = useState("");
  const [twist, setTwist] = useState(0);
  const [scen, setScen] = useState(null);
  const [scenRows, setScenRows] = useState(null);
  const [showRows, setShowRows] = useState(false);
  const [from, setFrom] = useState("2024-01-01");
  const [to, setTo] = useState("2024-01-31");
  const [batch, setBatch] = useState({ phase: "idle", prog: 0, out: [], msg: "" });
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [attnOn, setAttnOn] = useState(true);
  const [attnOp, setAttnOp] = useState(0.55);
  const fileRef = useRef(null);
  const origRef = useRef(null);
  const timerRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const finishPredict = (rows, title) => {
    const r = pseudoPredict(rows);
    setResult({ rows, title, ...r, date: rows[rows.length - 1][0], close: rows[rows.length - 1][4], n: rows.length, src: "mock" });
    setPhase("done");
  };
  const runPredict = (rows, title, delay = 850) => {
    setPhase("run");
    setResult(null);
    if (L) {
      const text = rows.map((r) => r.join(",")).join("\n");
      apiPredictCsv(text)
        .then((r) => {
          if (r.error) throw new Error(r.error);
          setResult({
            rows, title: `${title} · LIVE ViT`,
            signal: r.signal, probs: r.probs, grid: [].concat(...(r.attention || [])),
            date: r.date, close: r.close, n: rows.length,
            chart_b64: r.chart_b64, actual: r.actual, next_ret_pct: r.next_ret_pct, src: "api",
          });
          setPhase("done");
        })
        .catch((e) => {
          setCsvErr(`API: ${e.message} — showing deterministic mock instead`);
          finishPredict(rows, title);
        });
      return;
    }
    timerRef.current = setTimeout(() => finishPredict(rows, title), delay);
  };
  const applyTwist = (rows, dp) => {
    const r = rows.map((x) => [...x]);
    const last = r[r.length - 1];
    const c = +(last[4] * (1 + dp)).toFixed(2);
    last[4] = c;
    if (c > last[2]) last[2] = c;
    if (c < last[3]) last[3] = +(c * 0.999).toFixed(2);
    return r;
  };
  const predictCustom = () => {
    let rows;
    try { rows = parseCsv(csv); } catch (e) { setCsvErr(e.message); return; }
    const min = L ? 26 : 16;
    if (rows.length < min) { setCsvErr(`need at least ${min} daily rows (chart window + warm-up), got ${rows.length}`); return; }
    setCsvErr("");
    origRef.current = rows;
    const eff = twist !== 0 ? applyTwist(rows, twist / 100) : rows;
    runPredict(eff, `your data${twist !== 0 ? ` · twist ${pctS(twist / 100, 2)}` : ""}`);
  };
  const onTwist = (v) => {
    setTwist(v);
    if (phase === "done" && origRef.current) {
      const rows = v !== 0 ? applyTwist(origRef.current, v / 100) : origRef.current;
      finishPredict(rows, `your data${v !== 0 ? ` · twist ${pctS(v / 100, 2)}` : ""}`);
    }
  };
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const rows = parseCsv(String(rd.result));
        setCsv(rows.map((r) => r.join(",")).join("\n"));
        setCsvErr(`uploaded ${f.name} · ${rows.length} rows parsed — hit PREDICT MY DATA`);
      } catch (err) {
        setCsvErr(`could not parse ${f.name}: ${err.message}`);
      }
    };
    rd.readAsText(f);
    e.target.value = "";
  };
  const loadLatest = () => {
    if (L) {
      setPhase("run");
      apiLatest(60)
        .then((r) => {
          if (r.error) throw new Error(r.error);
          const rows = parseCsv(r.csv);
          setCsv(r.csv);
          origRef.current = rows;
          setCsvErr(`loaded ${r.rows} live rows through ${r.date} — running ViT…`);
          runPredict(rows, `latest ${r.rows}d from NIFTY`);
        })
        .catch((e) => setCsvErr(`latest fetch failed: ${e.message}`));
      return;
    }
    const rows = latest60();
    setCsv(rows.map((r) => r.join(",")).join("\n"));
    setCsvErr("");
    origRef.current = rows;
    runPredict(rows, "latest 60d from NIFTY", 700);
  };
  const fireScen = (kind) => {
    const rows = genScenario(kind);
    setScen(kind);
    setScenRows(rows);
    setShowRows(true);
    setCsv(rows.map((r) => r.join(",")).join("\n"));
    origRef.current = rows;
    runPredict(rows, `scenario · ${SCEN[kind].label.toLowerCase()}`, 750);
  };
  const runBatch = () => {
    const days = batchDays(from, to);
    if (!from || !to || from > to) { setBatch({ phase: "error", prog: 0, out: [], msg: "invalid range — FROM must be on/before TO" }); return; }
    if (!days.length) { setBatch({ phase: "error", prog: 0, out: [], msg: "no trading days in range" }); return; }
    if (days.length > 60) { setBatch({ phase: "error", prog: 0, out: [], msg: `${days.length} days — max 60 sessions per batch` }); return; }
    // live: hit the real Flask batch endpoint, which grades against actuals
    if (L) {
      setBatch({ phase: "run", prog: 50, out: [], msg: "live ViT running on the server…", days });
      apiPredictRange(from, to)
        .then((r) => {
          if (r.error) throw new Error(r.error);
          const out = (r.days || []).map((d) => ({
            date: d.date, close: d.close, signal: d.signal, probs: d.probs,
            next: d.next_ret_pct, actual: d.actual, hit: d.actual != null && d.signal === d.actual,
          }));
          setBatch({ phase: "done", prog: 100, out, days, live: true, summary: r.summary });
        })
        .catch((e) => setBatch({ phase: "error", prog: 0, out: [], msg: e.message }));
      return;
    }
    setBatch({ phase: "run", prog: 0, out: [], msg: "", days });
    let i = 0;
    const step = () => {
      i = Math.min(days.length, i + 3);
      const out = days.slice(0, i).map(batchDay);
      if (i >= days.length) setBatch({ phase: "done", prog: 100, out, days });
      else {
        setBatch({ phase: "run", prog: Math.round((i / days.length) * 100), out, days });
        timerRef.current = setTimeout(step, 50);
      }
    };
    timerRef.current = setTimeout(step, 150);
  };
  const graded = batch.out.filter((d) => d.actual != null);
  const hits = batch.out.filter((d) => d.hit).length;
  const hitPct = batch.live && batch.summary ? batch.summary.exact_hit_pct : graded.length ? Math.round((100 * hits) / graded.length) : null;

  return (
    <>
      <Card>
        <CardHead
          badge="INTERACTIVE" tone="cyan" title="FEED THE ViT" sub="every path → exact chart renderer → z-score → live inference"
          right={
            <Seg value={mode} onChange={setMode}
              options={[{ v: "custom", l: "📋 Custom OHLCV" }, { v: "fabricate", l: "🎰 Session Fabricator" }, { v: "batch", l: "📊 Batch Runner" }]} />
          }
        />
        <div className="p-5">
          {loading ? (
            <div className="grid gap-4 lg:grid-cols-2"><Sk className="h-[300px]" /><Sk className="h-[300px]" /></div>
          ) : (
            <>
              {mode === "custom" && (
                <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="font-mono text-[9.5px] font-bold tracking-[0.18em] text-lo">OHLCV INPUT · date,open,high,low,close</label>
                      <span className="font-mono text-[9.5px] text-lo">{csv.trim() ? csv.trim().split(/\r?\n/).length : 0} ROWS</span>
                    </div>
                    <textarea
                      value={csv}
                      onChange={(e) => { setCsv(e.target.value); setCsvErr(""); }}
                      spellCheck={false}
                      placeholder={"2026-04-01,24100.5,24250.0,23980.0,24180.5\n2026-04-02,24180.5,24320.0,24090.0,24210.0\n…  ≥16 rows · last row = the day you're asking about"}
                      className="focus-ring h-44 w-full resize-y rounded-xl border border-edge bg-base/70 p-3.5 font-mono text-[11px] leading-relaxed text-hi placeholder:text-lo"
                    />
                    {csvErr && (
                      <div className={cls("mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[10.5px]", csvErr.startsWith("uploaded") || csvErr.startsWith("could not") ? "border-amber/40 bg-amber/[0.07] text-amber" : "border-rose/40 bg-rose/[0.07] text-rose")}>
                        {csvErr.startsWith("uploaded") ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {csvErr}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={onFile} />
                      <Btn icon={FolderUp} onClick={() => fileRef.current && fileRef.current.click()}>UPLOAD CSV</Btn>
                      <Btn icon={Download} onClick={loadLatest}>LOAD LATEST 60D</Btn>
                      <Btn variant="primary" icon={phase === "run" ? Loader2 : Play} onClick={predictCustom} disabled={phase === "run"}>
                        {phase === "run" ? (L ? "RUNNING ON THE LIVE ViT…" : "RENDERING CHART…") : L ? "PREDICT MY DATA · LIVE" : "PREDICT MY DATA"}
                      </Btn>
                    </div>
                  </div>
                  <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-violet/30 bg-violet/[0.05] p-4">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono text-[9.5px] font-bold tracking-[0.18em] text-violet">WHAT-IF TWIST</span>
                        <span className="rounded-md border border-violet/40 bg-violet/10 px-2 py-0.5 font-mono text-[10.5px] font-bold tabular-nums text-violet">
                          {pctS(twist / 100, 2)}
                        </span>
                      </div>
                      <p className="mb-3 text-[11.5px] leading-relaxed text-mid">
                        Reprice the <b className="text-hi">final close</b> ±2% (high/low adjust to match) — the ViT re-runs live on the edited path.
                      </p>
                      <input
                        type="range" min="-200" max="200" step="1" value={twist}
                        onChange={(e) => onTwist(+e.target.value)}
                        className="tw-slider w-full"
                      />
                      <div className="mt-1.5 flex justify-between font-mono text-[9px] text-lo"><span>−2.00%</span><span>0</span><span>+2.00%</span></div>
                    </div>
                    <Callout tone="cyan" icon={FlaskConical}>
                      With a short input the EMA/RSI warm-up differs from full history, so predictions can drift a few
                      points from the hero signal — the model sees exactly the pixels you gave it.
                    </Callout>
                  </div>
                </div>
              )}

              {mode === "fabricate" && (
                <div>
                  <p className="mb-4 text-[12.5px] text-mid">
                    Fabricate 40 daily sessions out of thin air (anchored back from <b className="text-hi">2026-04-10</b>, start ₹24,000)
                    and ask the ViT about the end of a path that <b className="text-hi">never existed</b>.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {Object.entries(SCEN).map(([k, s]) => {
                      const Icon = s.icon;
                      return (
                        <button
                          key={k}
                          onClick={() => fireScen(k)}
                          className={cls(
                            "rounded-xl border p-4 text-left transition duration-200 hover:-translate-y-0.5",
                            s.hover,
                            scen === k ? "border-cyan/60 bg-cyan/[0.06] shadow-glow-cyan" : "border-edge bg-panel/50"
                          )}
                        >
                          <Icon size={18} className={TONE[s.tone]} />
                          <div className="mt-2.5 text-[13.5px] font-bold text-hi">{s.label}</div>
                          <div className="mt-1 font-mono text-[9.5px] text-lo">{s.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4">
                    <button
                      onClick={() => setShowRows((v) => !v)}
                      className="flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.16em] text-mid transition hover:text-cyan"
                    >
                      <ChevronDown size={12} className={cls("transition-transform", showRows && "rotate-180")} />
                      LAST 5 GENERATED ROWS
                    </button>
                    {showRows && scenRows && (
                      <pre className="mt-2 overflow-x-auto rounded-xl border border-edge/80 bg-base/70 p-3.5 font-mono text-[10.5px] leading-relaxed text-mid">
                        {scenRows.slice(-5).map((r) => r.join(",")).join("\n")}
                      </pre>
                    )}
                  </div>
                </div>
              )}

              {mode === "batch" && (
                <div>
                  <p className="mb-4 text-[12.5px] text-mid">
                    Run the ViT on <b className="text-hi">every session in a range</b> (≤60) — signal vs actual day by day, with an exact-hit rate.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <DateInput label="FROM" value={from} onChange={setFrom} />
                    <DateInput label="TO" value={to} onChange={setTo} />
                    <Btn variant="primary" icon={batch.phase === "run" ? Loader2 : Play} onClick={runBatch} disabled={batch.phase === "run"}>
                      {batch.phase === "run" ? `RUNNING ${batch.prog}%` : "RUN BATCH"}
                    </Btn>
                  </div>
                  {batch.phase === "error" && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose/40 bg-rose/[0.07] px-3 py-2.5 font-mono text-[11px] text-rose">
                      <AlertTriangle size={14} /> {batch.msg}
                    </div>
                  )}
                  {batch.phase === "run" && (
                    <div className="mt-5">
                      <div className="h-1.5 overflow-hidden rounded-full bg-edge/60">
                        <div className="h-full rounded-full bg-gradient-to-r from-cyan to-violet transition-all duration-100" style={{ width: `${batch.prog}%` }} />
                      </div>
                      <div className="mt-2 font-mono text-[10px] text-lo">running the ViT on every session in range… {batch.out.length}/{batch.days ? batch.days.length : 0}</div>
                    </div>
                  )}
                  {batch.phase === "done" && (
                    <div className="mt-5">
                      <div className="mb-3 flex flex-wrap gap-2.5">
                        {[
                          [String(batch.out.length), "SESSIONS RUN", "cyan"],
                          [hitPct == null ? "—" : `${hitPct}%`, "EXACT 3-CLASS HIT RATE", hitPct >= 50 ? "green" : "amber"],
                          [`${hits}/${graded.length}`, "CORRECT / GRADED", "violet"],
                        ].map(([v, l, t]) => (
                          <div key={l} className="rounded-xl border border-edge/80 bg-panel/60 px-4 py-2.5">
                            <div className={cls("font-mono text-xl font-bold tabular-nums", TONE[t])}>{v}</div>
                            <div className="font-mono text-[8.5px] tracking-[0.16em] text-lo">{l}</div>
                          </div>
                        ))}
                      </div>
                      <div className="max-h-[380px] overflow-y-auto rounded-xl border border-edge/80">
                        <table className="w-full border-collapse">
                          <thead className="sticky top-0 bg-panel">
                            <tr>
                              <Th>Date</Th><Th>NIFTY</Th><Th>ViT Signal</Th><Th>P S/H/B %</Th><Th>Next Day</Th><Th>Actual</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {batch.out.map((d) => (
                              <tr key={d.date} className={cls("border-b border-edge/40 last:border-0", d.hit && "bg-green/[0.05]")}>
                                <Td className="text-mid">{d.date}</Td>
                                <Td>{d.close.toLocaleString("en-IN")}</Td>
                                <Td>
                                  <span className={cls("rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider",
                                    d.signal === "BUY" ? "border-green/40 bg-green/10 text-green" : d.signal === "SELL" ? "border-rose/40 bg-rose/10 text-rose" : "border-amber/40 bg-amber/10 text-amber")}>
                                    {d.signal}
                                  </span>
                                  {d.hit && <CheckCircle2 size={11} className="ml-1.5 inline text-green" />}
                                </Td>
                                <Td className="text-mid">{d.probs.map((p) => (p * 100).toFixed(0)).join(" / ")}</Td>
                                <Td className={d.next == null ? "text-lo" : d.next >= 0 ? "text-green" : "text-rose"}>{pctS(d.next, 2)}</Td>
                                <Td className="text-mid">{d.actual || "—"}</Td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-3 font-mono text-[10px] leading-relaxed text-lo">
                        {batch.live ? "Live grading — every row is the real in-sample ViT served by the Flask API, checked against the actual next-day label. " : ""}
                        Green rows = the ViT's call matched the actual next-day label. The honest read: daily direction
                        hovers around chance — the vol-expansion straddle (Backtest) is where the edge is.
                      </p>
                    </div>
                  )}
                  {batch.phase === "idle" && (
                    <div className="mt-5">
                      <Empty icon={CalendarRange} title="NO BATCH RUN YET" sub="Pick a FROM/TO range (≤60 sessions) and hit RUN BATCH — the terminal will walk the ViT through every session and grade each call." />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* shared live-inference result panel */}
      {(phase === "run" || phase === "done") && (
        <Card className="mt-4">
          <CardHead badge="RESULT" tone="violet" title="LIVE INFERENCE" sub={result ? `${result.title} · ${result.date}` : "rendering…"} />
          <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_1fr]">
            {phase === "run" ? (
              <div className="flex min-h-[250px] flex-col items-center justify-center gap-3">
                <Loader2 size={26} className="animate-spin text-violet" />
                <div className="font-mono text-[10.5px] tracking-[0.16em] text-mid">RENDERING CHART → Z-SCORE → RUNNING ViT…</div>
              </div>
            ) : (
              <>
                <div>
                  <CandleViz rows={result.rows} grid={result.grid} attnOn={attnOn} attnOp={attnOp} />
                  <div className="mt-2.5 flex flex-wrap items-center gap-4 font-mono text-[10px] text-lo">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input type="checkbox" checked={attnOn} onChange={(e) => setAttnOn(e.target.checked)} className="accent-violet" />
                      attention overlay
                    </label>
                    <label className="flex items-center gap-2">
                      opacity <input type="range" min="0" max="100" value={attnOp * 100} onChange={(e) => setAttnOp(e.target.value / 100)} className="tw-slider w-28" />
                    </label>
                    <span className="ml-auto flex items-center gap-1.5">low <i className="h-1 w-16 rounded bg-gradient-to-r from-transparent to-violet" /> high</span>
                  </div>
                  {result.chart_b64 && (
                    <div className="mt-3">
                      <div className="mb-1.5 font-mono text-[9px] font-bold tracking-[0.18em] text-lo">EXACT 64×64 RENDER FED TO THE ViT</div>
                      <img src={`data:image/png;base64,${result.chart_b64}`} alt="chart rendered for the ViT" className="w-full rounded-xl border border-edge/80 bg-[#0b0f1a]" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col justify-center gap-4">
                  <SignalBadge signal={result.signal} />
                  <ProbBars probs={result.probs} />
                  <div className="font-mono text-[10.5px] leading-relaxed text-mid">
                    {result.date} · close {inr(result.close)} · {result.n} rows ·{" "}
                    {result.src === "api" ? <b className="text-cyan">LIVE in-sample ViT · served by the Flask API</b> : "in-sample ViT (deterministic mock)"}
                  </div>
                  {result.actual && (
                    <div className={cls("rounded-lg border px-3 py-2 font-mono text-[10.5px]",
                      result.signal === result.actual ? "border-green/40 bg-green/[0.07] text-green" : "border-rose/40 bg-rose/[0.07] text-rose")}>
                      next-day actual: <b>{result.actual}</b> ({pctS(result.next_ret_pct, 2)}) — {result.signal === result.actual ? "the ViT got it right" : "the ViT was wrong"}
                    </div>
                  )}
                  <div className="font-mono text-[10.5px] text-lo">
                    conviction {(Math.max(...result.probs) * 100).toFixed(1)}% on {result.signal} · {result.actual ? "in-sample fit — treat as a capacity demo, not foresight." : "your data has no ground truth — this is the open question."}
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

/* ============================== 4 · SENTIMENT ============================== */
function SentimentTab({ loading }) {
  return (
    <Card>
      <CardHead badge="REGIME ENGINE" tone="amber" title="MARKET SENTIMENT" sub="feature-driven · last 20 sessions" />
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.3fr]">
        {loading ? (
          <div className="space-y-3"><Sk className="h-[200px]" /><Sk className="h-16" /></div>
        ) : (
          <>
            <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-edge/80 bg-panel/50 p-5">
              <div className="font-mono text-[9.5px] font-bold tracking-[0.18em] text-lo">FEAR &amp; GREED</div>
              <Gauge value={SENTIMENT.fearGreed} />
              <div className="-mt-4 font-mono text-3xl font-bold tabular-nums text-hi">{SENTIMENT.fearGreed}</div>
              <div className="font-mono text-[10px] tracking-[0.18em] text-amber">NEUTRAL</div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  [SENTIMENT.regime, "cyan"], [`P${SENTIMENT.volPct} VOL`, "amber"], [`PCR ${SENTIMENT.pcr}`, "cyan"], [`OI Δ +${SENTIMENT.oiDelta}%`, "green"],
                ].map(([v, t], i) => (
                  <div key={i} className="rounded-lg border border-edge/80 bg-panel/60 px-3 py-2">
                    <div className="font-mono text-[8.5px] tracking-[0.16em] text-lo">{["REGIME", "5D VOL PCTL", "PUT / CALL", "OI DELTA"][i]}</div>
                    <div className={cls("mt-0.5 truncate font-mono text-[13px] font-bold", TONE[t])}>{v}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-2 font-mono text-[9.5px] font-bold tracking-[0.18em] text-lo">FEATURE REGIME READOUT</div>
                <div className="overflow-hidden rounded-xl border border-edge/80">
                  <Adense>
                    <thead className="border-b border-edge/60 bg-panel/60">
                      <tr><Th>Feature</Th><Th>Value</Th><Th>Z-Score</Th><Th>Read</Th></tr>
                    </thead>
                    <tbody>
                      {SENTIMENT.features.map((f) => (
                        <tr key={f.f} className="border-b border-edge/40 last:border-0 hover:bg-cyan/[0.04]">
                          <Td className="text-mid">{f.f}</Td>
                          <Td>{f.v}</Td>
                          <Td className={f.z > 0.8 ? "text-green" : f.z < -0.8 ? "text-rose" : "text-mid"}>{f.z >= 0 ? "+" : ""}{f.z.toFixed(2)}</Td>
                          <Td>
                            <span className={cls("inline-flex items-center gap-1.5 font-mono text-[9.5px] font-bold tracking-wider",
                              f.s === "bull" ? "text-green" : f.s === "bear" ? "text-rose" : "text-lo")}>
                              <span className={cls("h-1.5 w-1.5 rounded-full", f.s === "bull" ? "bg-green" : f.s === "bear" ? "bg-rose" : "bg-lo")} />
                              {f.s.toUpperCase()}
                            </span>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Adense>
                </div>
              </div>
              <Callout tone="amber" icon={Info}>
                Regime reads are computed on the 29-feature vector the models consume — the same z-scores that feed
                LightGBM/XGBoost. Sentiment is context, not a trade: direction is at chance OOS.
              </Callout>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ============================== 5 · OPTION GREEKS ============================== */
function GreeksTab({ loading }) {
  return (
    <Card>
      <CardHead
        badge="BLACK-SCHOLES" tone="cyan" title="OPTION GREEKS · 1W ATM CHAIN" sub={`spot ${GREEKS.spot.toLocaleString("en-IN")} · T 7d · r 6.5%`}
        right={
          <>
            {[["SPOT", GREEKS.spot.toLocaleString("en-IN"), "hi"], ["ATM IV", `${GREEKS.atmIv}%`, "cyan"], ["SKEW", `${GREEKS.skew} vol`, "amber"]].map(([l, v, t]) => (
              <div key={l} className="hidden rounded-lg border border-edge/80 bg-panel/60 px-3 py-1.5 sm:block">
                <span className="font-mono text-[8.5px] tracking-[0.16em] text-lo">{l} </span>
                <span className={cls("font-mono text-[12px] font-bold tabular-nums", TONE[t])}>{v}</span>
              </div>
            ))}
          </>
        }
      />
      <div className="p-5">
        {loading ? (
          <Sk className="h-[380px]" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-edge/80">
            <table className="w-full border-collapse">
              <thead className="border-b border-edge/60 bg-panel/60">
                <tr>
                  <Th>Strike</Th><Th>Side</Th><Th>LTP</Th><Th>IV</Th><Th>Δ Delta</Th><Th>Γ Gamma</Th><Th>Θ θ/day</Th><Th>ν Vega</Th><Th>OI</Th>
                </tr>
              </thead>
              <tbody>
                {GREEKS.chain.map((o, i) => {
                  const itm = o.side === "CALL" ? o.k < GREEKS.spot : o.k > GREEKS.spot;
                  return (
                    <tr key={`${o.k}-${o.side}`} className={cls("border-b border-edge/40 last:border-0 transition-colors hover:bg-cyan/[0.04]", itm && "bg-cyan/[0.04]")}>
                      <Td className={cls(itm ? "font-bold text-cyan" : "text-mid")}>{o.k.toLocaleString("en-IN")}{itm && <span className="ml-1.5 rounded border border-cyan/40 bg-cyan/10 px-1 py-px font-mono text-[8px] font-bold text-cyan">ITM</span>}</Td>
                      <Td>
                        <span className={cls("rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold", o.side === "CALL" ? "border-green/40 bg-green/10 text-green" : "border-rose/40 bg-rose/10 text-rose")}>
                          {o.side}
                        </span>
                      </Td>
                      <Td>{o.ltp.toFixed(1)}</Td>
                      <Td className="text-cyan">{o.iv.toFixed(1)}%</Td>
                      <Td className="text-mid">{o.d.toFixed(3)}</Td>
                      <Td className="text-mid">{o.g.toFixed(5)}</Td>
                      <Td className="text-rose">{o.t.toFixed(1)}</Td>
                      <Td className="text-amber">{o.n.toFixed(1)}</Td>
                      <Td className="text-mid">{o.oi.toLocaleString("en-IN")}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-lo">
          Greeks priced off the Parkinson-21d IV surface (mock). The straddle alpha buys the ATM pair only on
          vol-expansion flags — convex payoff, losses capped at premium.
        </p>
      </div>
    </Card>
  );
}

/* ============================== 6 · BACKTEST ============================== */
function BacktestTab({ loading, L }) {
  const eq = useMemo(() => (L && L.equity ? L.equity : equitySeries()), [L]);
  const ensBt = L?.backtests?.Ensemble || null;
  const stats = L && ensBt ? [
    { l: "OOS Return", v: pctS(ensBt.total_return_pct, 1), tone: ensBt.total_return_pct >= 0 ? "green" : "rose" },
    { l: "Sharpe", v: ensBt.sharpe, tone: "cyan" },
    { l: "Max DD", v: `−${Math.abs(ensBt.max_drawdown_pct).toFixed(1)}%`, tone: "rose" },
    { l: "Profit Factor", v: ensBt.profit_factor, tone: "cyan" },
    { l: "Trades", v: ensBt.n_trades, tone: "mid" },
    { l: "Win Rate", v: ensBt.win_rate_pct + "%", tone: "amber" },
  ] : BT_STATS;
  const trades = L ? (L.oos?.trades || []).slice(-10).map((t) => ({ d: t.d, close: t.close, sig: t.signal, opt: t.opt, entry: t.entry, exit: t.exit, ret: t.ret_pct })) : TRADES;
  const monthly = L ? L.monthly.slice(-12) : MONTHLY_PNL.map((v) => [1, v]);
  const monthLbl = (m) => ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][m - 1];
  return (
    <>
      <Card>
        <CardHead
          badge="WALK-FORWARD OOS" tone="cyan" title="DIRECTIONAL 1-DAY MODELS"
          sub={L ? `${L.oosPeriod} · ATM options · 25% stake · ensemble vs buy & hold` : "2020-01-02 → 2026-04-10 · ATM options · 25% stake"}
          right={
            <div className="flex flex-wrap gap-2">
              {stats.map((s) => (
                <span key={s.l} className="rounded-lg border border-edge/80 bg-panel/60 px-2.5 py-1 font-mono text-[9.5px]">
                  <span className="tracking-wider text-lo">{s.l} </span>
                  <b className={TONE[s.tone]}>{s.v}</b>
                </span>
              ))}
            </div>
          }
        />
        <div className="p-4">
          {loading ? <Sk className="h-[300px]" /> : <EquityChart series={eq.series} height={300} highlight={1} yFmt={(v) => "₹" + (v / 100).toFixed(0) + "k"} />}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead badge="RISK" tone="rose" title="ENSEMBLE DRAWDOWN" sub="peak → trough %" />
          <div className="p-4">{loading ? <Sk className="h-[150px]" /> : <DrawdownChart data={eq.series[0].data.map((p) => p[1])} />}</div>
        </Card>
        <Card>
          <CardHead badge="P&L" tone="green" title="MONTHLY RETURNS" sub={L ? "ensemble · OOS · % per calendar month · last 12" : "ensemble · OOS · % per calendar month"} />
          <div className="p-4">
            {loading ? <Sk className="h-[150px]" /> : (
              <div className="grid grid-cols-6 gap-1.5">
                {monthly.map(([m, v], i) => (
                  <div
                    key={i}
                    className="flex h-14 flex-col items-center justify-center rounded-lg border font-mono"
                    style={{
                      background: `rgb(${v >= 0 ? "var(--c-green)" : "var(--c-rose)"} / ${Math.min(0.5, 0.08 + Math.abs(v) / 30).toFixed(2)})`,
                      borderColor: `rgb(${v >= 0 ? "var(--c-green)" : "var(--c-rose)"} / 0.35)`,
                    }}
                  >
                    <span className="text-[8px] text-lo">{monthLbl(m)}</span>
                    <span className={cls("text-[11px] font-bold tabular-nums", v >= 0 ? "text-green" : "text-rose")}>{v > 0 ? "+" : ""}{v.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
      <Card>
        <CardHead badge="TICKER TAPE" tone="violet" title="RECENT ENSEMBLE TRADES" sub="last 10 · Black-Scholes premiums" />
        <div className="p-4">
          {loading ? <Sk className="h-[280px]" /> : (
            <div className="overflow-x-auto rounded-xl border border-edge/80">
              <table className="w-full border-collapse">
                <thead className="border-b border-edge/60 bg-panel/60">
                  <tr><Th>Date</Th><Th>NIFTY</Th><Th>Signal</Th><Th>Option</Th><Th>Entry</Th><Th>Exit</Th><Th>Ret</Th></tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.d} className="border-b border-edge/40 last:border-0 hover:bg-cyan/[0.04]">
                      <Td className="text-mid">{t.d}</Td>
                      <Td>{t.close != null ? Math.round(t.close).toLocaleString("en-IN") : "—"}</Td>
                      <Td>
                        <span className={cls("rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider",
                          t.sig === "BUY" ? "border-green/40 bg-green/10 text-green" : t.sig === "SELL" ? "border-rose/40 bg-rose/10 text-rose" : "border-amber/40 bg-amber/10 text-amber")}>
                          {t.sig}
                        </span>
                      </Td>
                      <Td className="text-mid">{t.opt}</Td>
                      <Td>{t.entry ? t.entry.toFixed(1) : "—"}</Td>
                      <Td>{t.exit ? t.exit.toFixed(1) : "—"}</Td>
                      <Td className={cls("font-bold", t.ret > 0 ? "text-green" : t.ret < 0 ? "text-rose" : "text-lo")}>
                        {t.ret === 0 ? "flat" : `${t.ret >= 0 ? "+" : ""}${t.ret}%`}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

/* ============================== 7 · BENCHMARKS ============================== */
/* Paper-protocol replication numbers — from optionedge/results/paper_replication.json
   (optionedge/paper_replication.py, same label/split/features/costs as the paper). */
const PAPER_REPL = {
  period: "NIFTY 50 · Jan 2020 → Dec 2024 · 1,237 sessions · BUY iff next-day return > +1%",
  baselineChrono: 93.15,
  baselineRandom: 83.47,
  buyRate: 13.18,
  rows: [
    // [name, ours, paperAcc, chronoAcc, randomAcc, chronoRet, chronoSh, randomRet, randomSh, paperPnl, paperSh]
    ["XGBoost", false, 89.2, 93.15, 83.87, -2.5, 0.26, 177.02, 1.6, 196450, 1.78],
    ["RandomForest", false, 87.4, 93.15, 83.87, -5.88, 0.21, 166.23, 1.56, 182300, 1.53],
    ["LSTM (5-day)", false, 90.1, 93.15, 85.89, 7.9, 0.43, 94.21, 1.18, 205720, 1.95],
    ["LightGBM · ours", true, null, 93.15, 82.26, -2.5, 0.26, 102.34, 1.24, null, null],
    ["XGBoost + class weights · ours", true, null, 91.13, 77.82, -9.95, 0.14, 102.32, 1.24, null, null],
    ["Stacked meta-ensemble · ours", true, null, 93.15, 83.06, -2.5, 0.26, 156.85, 1.52, null, null],
  ],
};
function BenchmarksTab({ loading, L }) {
  const lcd = L?.lcd || null;
  const models = L?.models || MODELS;
  const al = L?.alpha || null;
  return (
    <>
      {loading ? (
        <div className="space-y-3"><Sk className="h-[220px]" /><Sk className="h-[300px]" /><Sk className="h-[200px]" /></div>
      ) : (
        <div className="space-y-4">
          {/* ============ 1 · THE HEAD-TO-HEAD ============ */}
          <Card className="border-amber/25">
            <CardHead
              badge="PAPER PROTOCOL" tone="amber" title="THE PAPER, RUN THE PAPER'S WAY"
              sub={`${PAPER_REPL.period} · 80:20 split · ₹1L · BUY→ATM call / SELL→ATM put · 1-day hold · ₹50 + 0.25% slip`}
            />
            <div className="p-5">
              <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-rose/30 bg-rose/[0.06] p-4">
                  <div className="font-mono text-[9px] font-bold tracking-[0.16em] text-rose">DOING NOTHING (ALWAYS SELL)</div>
                  <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-hi">93.15%</div>
                  <div className="mt-1 text-[11px] leading-snug text-mid">
                    only <b className="text-hi">{PAPER_REPL.buyRate}%</b> of days ever rise more than +1% next day —
                    so "always SELL" is correct <b className="text-hi">93.15%</b> of the 2024 test year.
                  </div>
                </div>
                <div className="rounded-xl border border-edge/80 bg-panel/60 p-4">
                  <div className="font-mono text-[9px] font-bold tracking-[0.16em] text-mid">PAPER'S TABLE 1 (REPORTED)</div>
                  <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-hi">89.2–90.1%</div>
                  <div className="mt-1 text-[11px] leading-snug text-mid">
                    XGB 89.2 · RF 87.4 · LSTM 90.1 — <b className="text-hi">all below the no-model baseline</b> on an
                    honest split, and their ₹1.8–2.1L profits (below).
                  </div>
                </div>
                <div className="rounded-xl border border-cyan/30 bg-cyan/[0.05] p-4">
                  <div className="font-mono text-[9px] font-bold tracking-[0.16em] text-cyan">EVERY MODEL WE RE-RAN</div>
                  <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-hi">≤ 93.15%</div>
                  <div className="mt-1 text-[11px] leading-snug text-mid">
                    chronological 80:20: trees + LSTM + stacked all land exactly at the baseline.
                    <b className="text-hi"> The label, not the model, sets the score.</b>
                  </div>
                </div>
              </div>

              <div className="mb-2 font-mono text-[9.5px] font-bold tracking-[0.18em] text-lo">ACCURACY · PAPER'S LABEL, PAPER'S SPLIT</div>
              <Adense>
                <thead className="border-b border-edge/60">
                  <tr><Th>Model</Th><Th>Paper Table 1</Th><Th>Ours · chronological</Th><Th>Ours · random (leaky)</Th><Th>Majority baseline</Th></tr>
                </thead>
                <tbody>
                  {PAPER_REPL.rows.map((r) => (
                    <tr key={r[0]} className="border-b border-edge/40 last:border-0">
                      <Td className={cls("font-bold", r[1] ? "text-amber" : "text-hi")}>{r[0]}</Td>
                      <Td className={r[2] == null ? "text-lo" : "text-mid"}>{r[2] == null ? "—" : r[2].toFixed(1) + "%"}</Td>
                      <Td className={cls(r[3] >= PAPER_REPL.baselineChrono ? "text-rose" : "text-cyan")}>{r[3].toFixed(2)}%</Td>
                      <Td className={r[4] > PAPER_REPL.baselineRandom ? "text-amber" : "text-mid"}>{r[4].toFixed(2)}%</Td>
                      <Td className="text-lo">chr {PAPER_REPL.baselineChrono}% · rnd {PAPER_REPL.baselineRandom}%</Td>
                    </tr>
                  ))}
                </tbody>
              </Adense>

              <div className="mb-2 mt-5 font-mono text-[9.5px] font-bold tracking-[0.18em] text-lo">BACKTEST · ₹1,00,000 · PAPER'S EXACT TRADING RULES</div>
              <Adense>
                <thead className="border-b border-edge/60">
                  <tr><Th>Model</Th><Th>Paper P&L (reported)</Th><Th>Paper Sharpe</Th><Th>Ours · chronological</Th><Th>Ours · random (leaky)</Th></tr>
                </thead>
                <tbody>
                  {PAPER_REPL.rows.map((r) => (
                    <tr key={r[0]} className="border-b border-edge/40 last:border-0">
                      <Td className={cls("font-bold", r[1] ? "text-amber" : "text-hi")}>{r[0]}</Td>
                      <Td className={r[9] == null ? "text-lo" : "text-mid"}>{r[9] == null ? "—" : "+" + inr(r[9])}</Td>
                      <Td className={r[10] == null ? "text-lo" : "text-mid"}>{r[10] == null ? "—" : r[10].toFixed(2)}</Td>
                      <Td className={r[5] >= 0 ? "text-green" : "text-rose"}>{pctS(r[5])} · Sh {r[6].toFixed(2)}</Td>
                      <Td className="text-green">{pctS(r[7])} · Sh {r[8].toFixed(2)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Adense>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-lo">
                Same data, same +1% label, same option mapping, same costs. Chronological 80:20 = honest
                (2020–23 train → 2024 test); random 80:20 = the leaky variant the paper's split type never specifies.
                Reproduction: optionedge/paper_replication.py → results/paper_replication.json.
              </p>
            </div>
          </Card>

          {/* ============ 2 · WHY THE PAPER LOOKS GOOD ============ */}
          <Card>
            <CardHead badge="VERDICT" tone="rose" title="WHY THE PAPER'S TABLE LOOKS SO GOOD" sub="Three compounding effects — none of them forecasting skill" />
            <div className="grid gap-4 p-5 lg:grid-cols-3">
              <div className="rounded-xl border border-rose/25 bg-rose/[0.04] p-4">
                <div className="mb-2 flex items-center gap-2"><Scale size={13} className="text-rose" />
                  <span className="font-mono text-[10px] font-bold tracking-[0.16em] text-rose">1 · MAJORITY CLASS</span></div>
                <p className="text-[11.5px] leading-relaxed text-mid">
                  "Next day up more than +1%" is true on only <b className="text-hi">13.2%</b> of sessions. A
                  no-model "always SELL" scores <b className="text-hi">93.15%</b> on the 2024 test year — the
                  paper's best model (90.1%) doesn't beat it. {lcd ? <>{lcd.note}</> : ""}
                </p>
              </div>
              <div className="rounded-xl border border-amber/25 bg-amber/[0.04] p-4">
                <div className="mb-2 flex items-center gap-2"><Shuffle size={13} className="text-amber" />
                  <span className="font-mono text-[10px] font-bold tracking-[0.16em] text-amber">2 · SPLIT LEAKAGE</span></div>
                <p className="text-[11.5px] leading-relaxed text-mid">
                  A random 80:20 scatters adjacent days across train/test — fatal for a 5-day window LSTM. Under it,
                  our LSTM hits <b className="text-hi">85.89%</b> (baseline there is 83.47%) vs 93.15% no-skill on
                  the honest split. That's the only way the paper's 90.1% becomes reachable.
                </p>
              </div>
              <div className="rounded-xl border border-green/25 bg-green/[0.04] p-4">
                <div className="mb-2 flex items-center gap-2"><TrendingUp size={13} className="text-green" />
                  <span className="font-mono text-[10px] font-bold tracking-[0.16em] text-green">3 · BULL ATM OPTIONS</span></div>
                <p className="text-[11.5px] leading-relaxed text-mid">
                  NIFTY 50 tripled over 2020–24. In the leaky split, even a barely-above-baseline signal prints
                  <b className="text-hi"> +94–177%</b> (Sharpe 1.18–1.60) from daily ATM option P&L — the same order
                  as the paper's ₹1.8–2.1L. The profits measure the market, not the model.
                </p>
              </div>
            </div>
          </Card>

          {/* ============ 3 · OUR PROTOCOL ============ */}
          <Card>
            <CardHead
              badge="OUR PROTOCOL" tone="cyan" title="HONEST WALK-FORWARD (3-CLASS, ±0.5% DEADBAND)"
              sub="Not directly comparable to the paper's 2-class +1% label — shown for the record"
            />
            <div className="grid gap-5 p-5 lg:grid-cols-[1.5fr_1fr]">
              <div>
                <Adense>
                  <thead className="border-b border-edge/60">
                    <tr><Th>Model</Th><Th>In-Sample</Th><Th>Paper-style 80:20</Th><Th>Walk-Fwd OOS</Th><Th>OOS Return</Th><Th>Sharpe</Th></tr>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.name} className="border-b border-edge/40 last:border-0">
                        <Td className="font-bold">{m.name.split(" ")[0]}</Td>
                        <Td className="text-mid">{(m.ins?.a ?? 0).toFixed(1)} / {(m.ins?.d ?? 0).toFixed(1)}</Td>
                        <Td className="text-mid">{m.paper ? `${m.paper.a.toFixed(1)} / ${m.paper.d.toFixed(1)}` : "—"}</Td>
                        <Td className="font-bold text-cyan">{(m.wf?.a ?? 0).toFixed(1)} / {(m.wf?.d ?? 0).toFixed(1)}</Td>
                        <Td className={m.ret >= 0 ? "text-green" : "text-rose"}>{pctS(m.ret, 0)}</Td>
                        <Td className={m.sharpe >= 1 ? "text-green" : "text-cyan"}>{(m.sharpe ?? 0).toFixed(2)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Adense>
                <p className="mt-2 font-mono text-[9.5px] leading-relaxed text-lo">
                  3-class BUY/HOLD/SELL with ±0.5% deadband · strict yearly walk-forward 2020 → 2026 ·
                  daily direction stays at chance — that's the honest answer for 1-day signals.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Callout tone="green" icon={Zap}>
                  <b className="text-hi">The signal that survives:</b> the vol-expansion straddle. Walk-fwd OOS
                  {al ? <> AUC <b className="text-hi">{(al["walk-forward OOS"]?.auc ?? 0).toFixed(3)}</b> · {pctS(al.ret_pct)} (Sh {al.sharpe})</> : " AUC 0.570 · +249.3% (Sh 1.03)"}
                  {" "} vs straddle-every-5d {pctS(al?.baselines?.["Straddle every 5d"]?.total_return_pct ?? 216.7)}
                  {" "}(Sh {al?.baselines?.["Straddle every 5d"]?.sharpe ?? 0.74}) and B&H {pctS(al?.baselines?.["Buy&Hold (same period)"]?.total_return_pct ?? 86.4)}.
                </Callout>
                <Callout tone="cyan" icon={Waves}>
                  <b className="text-hi">VIX upgrade:</b> 7 India-VIX features nearly doubled the straddle's
                  walk-fwd backtest: {pctS(al?.ret_pct ?? 424.3)} (Sh {al?.sharpe ?? 1.12}, PF {al?.pf ?? 1.75})
                  {" "}vs +249.3% / 1.03 / 1.44 pre-upgrade. Pooled OOS AUC ≈0.56 with the VIX-era years
                  (2023–25) the strongest (0.58–0.67); 2022→26 A/B: 0.539 → 0.585.
                </Callout>
                <Callout tone="amber" icon={AlertTriangle}>
                  <b className="text-hi">Bottom line:</b> the paper's table is baseline + leakage + bull-market
                  option P&L. Our walk-forward direction models are at chance; the straddle alpha is the only
                  out-of-sample edge that survives every protocol we tried.
                </Callout>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/* ============================== 8 · REPORTS ============================== */
function ReportsTab({ loading, L }) {
  const [exports, setExports] = useState({});
  const doExport = (i) => {
    if (exports[i] !== "idle") return;
    setExports((e) => ({ ...e, [i]: "prep" }));
    setTimeout(() => setExports((e) => ({ ...e, [i]: "ready" })), 900);
  };
  const al = L?.alpha || null;
  const ensAcc = L ? (L.models.find((m) => m.kind === "ens")?.wf.a ?? 0) : null;
  const findings = FINDINGS.map((f) => {
    if (!L) return f;
    if (f.n === 3) return {
      ...f,
      b: `Every directional model sits at ${Math.min(...L.models.map((m) => m.wf?.a ?? 0)).toFixed(0)}–${Math.max(...L.models.map((m) => m.wf?.a ?? 0)).toFixed(0)}% 3-class on strictly OOS yearly blocks (ensemble ${ensAcc.toFixed(1)}%), AUC ≈ 0.50. Big OOS P&L is market beta, not alpha.`,
    };
    if (f.n === 4) return {
      ...f,
      b: `Walk-forward XGBoost on 'next 5d move > IV-implied range': ${(al["walk-forward OOS"]?.auc ?? 0).toFixed(3)} AUC OOS (now with 7 India-VIX features). Fixed-stake straddles: ${pctS(al.ret_pct)} OOS, Sharpe ${al.sharpe}, PF ${al.pf} — beats every baseline on risk metrics.`,
    };
    return f;
  });
  findings.push({
    n: 5,
    t: "India VIX is the chain-IV edge we were missing",
    b: `Pre-VIX era (2010–20) the straddle model had no vol-regime input. 7 India-VIX features (level, 252d percentile, 1d change…) nearly doubled the walk-fwd backtest: +249% → ${pctS(al?.ret_pct ?? 424.3)} (Sh ${al?.sharpe ?? 1.12}, PF ${al?.pf ?? 1.75}), and VIX features rank top-8 by importance. Wired into the pipeline — ${L?.meta?.n_features ?? 36}-feature dataset.`,
    tone: "amber",
  });
  return (
    <>
      <Card className="border-rose/30 bg-gradient-to-br from-rose/[0.07] via-panel/60 to-amber/[0.05]">
        <div className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="rose">HEADLINE VERDICT</Badge>
            <span className="font-mono text-[10px] tracking-wider text-lo">PAPER PROTOCOL REPLICATION · {PAPER_REPL.period}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-edge/70 bg-base/40 p-4">
              <div className="font-mono text-[9px] font-bold tracking-[0.16em] text-lo">NO-MODEL BASELINE</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-hi">93.15%</div>
              <div className="mt-1 text-[11px] text-mid">always-SELL on the paper's +1% label, honest 2024 test year</div>
            </div>
            <div className="rounded-xl border border-edge/70 bg-base/40 p-4">
              <div className="font-mono text-[9px] font-bold tracking-[0.16em] text-lo">PAPER TABLE 1</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-hi">89.2–90.1%</div>
              <div className="mt-1 text-[11px] text-mid">below the baseline on an honest split; reachable only with a leaky random 80:20</div>
            </div>
            <div className="rounded-xl border border-cyan/40 bg-cyan/[0.06] p-4">
              <div className="font-mono text-[9px] font-bold tracking-[0.16em] text-cyan">OUR RE-RUN (6 MODELS)</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-hi">≤ 93.15%</div>
              <div className="mt-1 text-[11px] text-mid">every model at baseline on the honest split — the label design, not the model, sets the score</div>
            </div>
          </div>
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-lo">
            Full head-to-head (accuracy + ₹1L backtest, paper's exact costs) → BENCHMARKS tab. Reproduction:
            optionedge/paper_replication.py → results/paper_replication.json (n=1,237, 13.2% BUY rate).
          </p>
        </div>
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {findings.map((f) => (
          <Card key={f.n} className={cls("p-5", f.tone === "green" && "border-green/30", f.tone === "rose" && "border-rose/30", f.tone === "violet" && "border-violet/30")}>
            <div className="flex items-start gap-3">
              <span className={cls("grid h-8 w-8 shrink-0 place-items-center rounded-lg border font-display text-[13px] font-black",
                f.tone === "green" ? "border-green/40 bg-green/10 text-green" : f.tone === "rose" ? "border-rose/40 bg-rose/10 text-rose" : f.tone === "amber" ? "border-amber/40 bg-amber/10 text-amber" : "border-cyan/40 bg-cyan/10 text-cyan")}>
                {f.n}
              </span>
              <div>
                <h3 className="font-display text-[11.5px] font-bold tracking-[0.12em] text-hi">{f.t.toUpperCase()}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-mid">{f.b}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <CardHead badge="AUDIT-READY" tone="cyan" title="GENERATED REPORTS" sub="3 artefacts · walk-forward audit chain"
          right={loading ? <Sk className="h-8 w-28" /> : (
            <Btn icon={Download} onClick={() => REPORT_FILES.forEach((_, i) => doExport(i))}>EXPORT ALL</Btn>
          )}
        />
        <div className="divide-y divide-edge/50">
          {REPORT_FILES.map((f, i) => (
            <div key={f.name} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-cyan/[0.03]">
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-edge bg-panel/60"><FileText size={15} className="text-cyan" /></div>
              <div className="min-w-0">
                <div className="truncate font-mono text-[11.5px] font-semibold text-hi">{f.name}</div>
                <div className="font-mono text-[9.5px] text-lo">{f.size} · generated {f.date}</div>
              </div>
              <div className="ml-auto">
                {exports[i] === "prep" ? (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-mid"><Loader2 size={12} className="animate-spin" /> PREPARING…</span>
                ) : exports[i] === "ready" ? (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-green"><CheckCircle2 size={12} /> READY</span>
                ) : (
                  <Btn icon={Download} onClick={() => doExport(i)} className="!px-3 !py-1.5">DOWNLOAD</Btn>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="mt-4">
        <CardHead badge="METHOD" tone="violet" title="HOW IT'S BUILT" sub="and what we refuse to fake" />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {METHOD.map((m) => (
            <div key={m.t} className="rounded-xl border border-edge/80 bg-panel/50 p-4">
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.2em] text-cyan">
                <BookOpen size={12} /> {m.t}
              </div>
              <p className="text-[11.5px] leading-relaxed text-mid">{m.b}</p>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5">
          <Callout tone="cyan" icon={Sparkles}>
            Built as a direct, more rigorous follow-up to <b className="text-hi">Sherasiya (2025), IJFMR 7(4)</b>.
            Educational research — not investment advice.
          </Callout>
        </div>
      </Card>
    </>
  );
}

/* ============================== APP SHELL ============================== */
export default function App({ initialTab = "overview", instantData = false }) {
  const [tab, setTab] = useState(initialTab);
  const { live, src, reload } = useLive();
  const [theme, setTheme] = useState(() => {
    try { return (typeof localStorage !== "undefined" && localStorage.getItem("oe2-theme")) || "dark"; } catch { return "dark"; }
  });
  const [loading, setLoading] = useState(!instantData);
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimer = useRef(null);

  useEffect(() => {
    if (instantData) { setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, [nonce, instantData]);
  useEffect(() => {
    try { localStorage.setItem("oe2-theme", theme); } catch { /* private mode */ }
  }, [theme]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  const onRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    setNonce((n) => n + 1);
    reload();
    refreshTimer.current = setTimeout(() => setRefreshing(false), 900);
  };
  const L = live;

  return (
    <div data-theme={theme} className="min-h-screen bg-base font-sans text-hi">
      <Header tab={tab} setTab={setTab} theme={theme} setTheme={setTheme} refreshing={refreshing} onRefresh={onRefresh}
        src={src} built={L?.generated} tick={L?.ticker} />
      <main key={tab} className="mx-auto max-w-[1440px] animate-rise space-y-4 px-5 py-5">
        {tab === "overview" && <OverviewTab loading={loading} go={setTab} L={L} />}
        {tab === "attention" && <AttentionTab loading={loading} L={L} />}
        {tab === "predictions" && <PredictionsTab loading={loading} L={L} />}
        {tab === "sentiment" && <SentimentTab loading={loading} />}
        {tab === "greeks" && <GreeksTab loading={loading} />}
        {tab === "backtest" && <BacktestTab loading={loading} L={L} />}
        {tab === "benchmarks" && <BenchmarksTab loading={loading} L={L} />}
        {tab === "reports" && <ReportsTab loading={loading} L={L} />}
      </main>
      <footer className="border-t border-edge/60 py-5 text-center font-mono text-[9.5px] tracking-[0.14em] text-lo">
        OPTIONEDGE · NIFTY 50 INDEX OPTIONS · DATA 2010-03-22 → 2026-04-10 · ViT FROM SCRATCH (1.83M PARAMS) ·
        WALK-FORWARD VALIDATED · EDUCATIONAL RESEARCH — NOT INVESTMENT ADVICE
      </footer>
    </div>
  );
}
