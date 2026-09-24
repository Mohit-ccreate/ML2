/* ============================================================================
 * OptionEdge terminal — mock state (deterministic, seeded)
 *
 * Every value here mirrors the shape the Flask backend (/api/state) returns,
 * so swapping mock → live is a one-line change in useAppData (App.jsx).
 * ==========================================================================*/

/* ---------- deterministic RNG ---------- */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------- header telemetry ---------- */
export const TELEM = {
  built: "2026-09-24 11:42",
  nifty: { close: 24051.0, ret: +1.16, iv: 15.8, rsi: 54, oi: 29.0 },
  prev: { d: "2026-04-02", close: 22713, ret: +0.15 },
  sessions: 3943,
  range: "2010-03-22 → 2026-04-10",
};

/* ---------- model roster (brief-specified five) ---------- */
/* a = 3-class acc %, d = up/down acc % */
export const MODELS = [
  {
    name: "ViT-Patch16",
    arch: "Vision Transformer",
    fam: "deep",
    badge: "16px · 64×64",
    ins: { a: 54.2, d: 62.2 },
    paper: { a: 32.5, d: 45.5 },
    wf: { a: 40.3, d: 54.0 },
    auc: 0.487,
    ret: +1115.1,
    sharpe: 0.94,
    win: 48.8,
    params: "1.83M",
  },
  {
    name: "Temporal Fusion Transformer",
    arch: "Sequence Transformer",
    fam: "deep",
    badge: "20d × 29f",
    ins: { a: 58.7, d: 61.0 },
    paper: { a: 41.2, d: 49.1 },
    wf: { a: 43.6, d: 52.4 },
    auc: 0.512,
    ret: +644.2,
    sharpe: 0.85,
    win: 49.3,
    params: "0.91M",
  },
  {
    name: "LightGBM",
    arch: "Gradient Boosted Trees",
    fam: "tree",
    badge: "29 features",
    ins: { a: 90.8, d: 88.9 },
    paper: { a: 86.3, d: 70.4 },
    wf: { a: 45.1, d: 53.2 },
    auc: 0.528,
    ret: +702.6,
    sharpe: 0.97,
    win: 49.1,
    params: "—",
  },
  {
    name: "XGBoost",
    arch: "Gradient Boosted Trees",
    fam: "tree",
    badge: "29 features",
    ins: { a: 91.4, d: 89.6 },
    paper: { a: 89.2, d: 73.4 },
    wf: { a: 46.0, d: 53.9 },
    auc: 0.531,
    ret: +817.7,
    sharpe: 1.04,
    win: 49.6,
    params: "—",
  },
  {
    name: "Stacked Meta-Ensemble",
    arch: "Logistic Meta-Stack",
    fam: "ens",
    badge: "ViT + TFT + GBDT",
    ins: { a: 96.0, d: 92.3 },
    paper: { a: 88.4, d: 74.9 },
    wf: { a: 47.8, d: 54.6 },
    auc: 0.542,
    ret: +378.8,
    sharpe: 0.76,
    win: 49.4,
    params: "meta 12d",
  },
];

/* ---------- ViT attention (8×8, per head, deterministic) ---------- */
export function attentionForHead(head, seedExtra = 0) {
  const r = rng(head * 7919 + 13 + seedExtra);
  const g = new Array(64).fill(0).map(() => r() * r() * 0.5);
  const h1 = Math.floor(r() * 64);
  const h2 = Math.floor(r() * 64);
  const h3 = Math.floor(r() * 64);
  g[h1] = 1.0;
  g[h2] = 0.62 + r() * 0.2;
  g[h3] = 0.3 + r() * 0.15;
  const mx = Math.max(...g);
  return g.map((v) => v / mx);
}
export const LAST_SESSION = { date: "2026-04-10", close: 24051.0, probs: [0.413, 0.378, 0.209], signal: "SELL" };

/* ---------- OHLCV generator (scenarios + "latest 60d") ---------- */
export function genScenario(kind, days = 40, start = 24000, endDate = "2026-04-10", seed = 7) {
  const r = rng(seed + hashStr(kind));
  const dates = [];
  const d = new Date(endDate + "T00:00:00Z");
  while (dates.length < days) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) dates.push(new Date(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  dates.reverse();
  let c = start;
  const rows = [];
  for (let i = 0; i < days; i++) {
    let drift = 0,
      vol = 0.006;
    if (kind === "up") drift = 0.004;
    else if (kind === "down") drift = -0.004;
    else if (kind === "spike") {
      if (i > days - 8) {
        drift = r() > 0.5 ? 0.02 : -0.02;
        vol = 0.016;
      }
    } else if (kind === "chop") {
      drift = i % 2 ? 0.0018 : -0.0018;
      vol = 0.0025;
    } else if (kind === "random") vol = 0.008;
    const ret = drift + (r() * 2 - 1) * vol;
    const o = c;
    const cl = c * (1 + ret);
    const hi = Math.max(o, cl) * (1 + r() * 0.003);
    const lo = Math.min(o, cl) * (1 - r() * 0.003);
    rows.push([dates[i].toISOString().slice(0, 10), +o.toFixed(1), +hi.toFixed(1), +lo.toFixed(1), +cl.toFixed(1)]);
    c = cl;
  }
  return rows;
}

export function latest60() {
  // random walk anchored to end exactly at 24,051.0 on 2026-04-10
  const r = rng(0x0e0d);
  const n = 60;
  const rets = new Array(n).fill(0).map(() => 0.0007 + (r() * 2 - 1) * 0.008);
  const prod = rets.reduce((a, b) => a * (1 + b), 1);
  const c0 = 24051.0 / prod;
  const rows = genScenario("random", n, c0, "2026-04-10", 0x5eed).map((row) => row.slice(0, 5));
  // re-anchor closes exactly
  let c = c0;
  return rows.map((row, i) => {
    c = c * (1 + rets[i]);
    const cl = +c.toFixed(1);
    const o = +rows[i][1];
    return [row[0], o, +Math.max(rows[i][2], cl).toFixed(1), +Math.min(rows[i][3], cl).toFixed(1), cl];
  });
}

/* ---------- CSV parsing (upload / paste) ---------- */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines[0] && lines[0].toLowerCase().startsWith("date,")) lines.shift();
  const rows = [];
  for (const ln of lines) {
    const p = ln.split(",").map((x) => x.trim());
    if (p.length < 5) throw new Error(`row needs date,open,high,low,close → ${ln.slice(0, 38)}`);
    const nums = p.slice(1, 5).map(Number);
    if (nums.some((v) => !isFinite(v))) throw new Error(`bad number in row → ${ln.slice(0, 38)}`);
    rows.push([p[0], ...nums]);
  }
  if (!rows.length) throw new Error("no rows parsed");
  return rows;
}

/* ---------- deterministic "ViT" inference over OHLC rows ---------- */
export function pseudoPredict(rows) {
  const c = rows.map((r) => r[4]);
  const n = c.length;
  const last = c[n - 1];
  const prev = c[n - 2] || last;
  const r1 = last / prev - 1;
  const mom = n >= 6 ? last / c[n - 6] - 1 : r1;
  const s = 0.62 * Math.tanh(r1 * 38) + 0.38 * Math.tanh(mom * 9);
  let pb = 0.5 + s * 0.42;
  let ph = 0.34 - Math.abs(s) * 0.2;
  let ps = 1 - pb - ph;
  ps = Math.max(ps, 0.02);
  const sum = pb + ph + ps;
  pb /= sum;
  ph /= sum;
  ps /= sum;
  const probs = [ps, ph, pb]; // SELL, HOLD, BUY
  const signal = ["SELL", "HOLD", "BUY"][probs.indexOf(Math.max(...probs))];
  const grid = attentionForHead(1 + (Math.round(last) % 8), Math.round(last));
  return { probs, signal, grid, last };
}

/* ---------- batch runner (historical range, mock) ---------- */
export function batchDays(from, to, cap = 60) {
  const out = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  let guard = 0;
  while (d <= end && out.length < cap && guard++ < 400) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
export function batchDay(d) {
  const r = rng(hashStr(d));
  const next = (r() - 0.492) * 0.021;
  const sigRet = next * 0.55 + (r() - 0.5) * 0.014;
  const actual = next > 0.005 ? "BUY" : next < -0.005 ? "SELL" : "HOLD";
  const signal = sigRet > 0.005 ? "BUY" : sigRet < -0.005 ? "SELL" : "HOLD";
  const probs = [0.28 + r() * 0.3, 0.22 + r() * 0.25, 0.28 + r() * 0.3];
  const s = probs[0] + probs[1] + probs[2];
  const close = 22800 + (r() - 0.5) * 1400;
  return {
    date: d,
    signal,
    actual,
    probs: probs.map((v) => v / s),
    next: +(next * 100).toFixed(2),
    close: +close.toFixed(1),
    hit: actual === signal,
  };
}

/* ---------- backtest equity series (250 pts, deterministic walks) ---------- */
export function equitySeries() {
  const r = rng(0xbac);
  const n = 250;
  const mk = (drift, vol, start = 100) => {
    let v = start;
    const pts = [[`2020-01-02`, start]];
    const d = new Date("2020-01-02T00:00:00Z");
    for (let i = 1; i < n; i++) {
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      v = v * (1 + drift + (r() * 2 - 1) * vol);
      pts.push([d.toISOString().slice(0, 10), +v.toFixed(2)]);
    }
    return pts;
  };
  return {
    labels: ["Stacked Meta-Ensemble", "Alpha Straddle", "Buy & Hold NIFTY"],
    series: [
      { name: "Stacked Meta-Ensemble", color: "var(--c-cyan)", data: mk(0.0023, 0.028) },
      { name: "Alpha Straddle", color: "var(--c-violet)", data: mk(0.0016, 0.024) },
      { name: "Buy & Hold NIFTY", color: "var(--c-ink-lo)", data: mk(0.00062, 0.012) },
    ],
  };
}
export const BT_STATS = [
  { l: "OOS Return", v: "+378.8%", tone: "green" },
  { l: "Sharpe", v: "0.76", tone: "cyan" },
  { l: "Max DD", v: "−57.1%", tone: "rose" },
  { l: "Profit Factor", v: "1.16", tone: "cyan" },
  { l: "Trades", v: "695", tone: "mid" },
  { l: "Win Rate", v: "49.4%", tone: "amber" },
];
export const MONTHLY_PNL = [-4.2, 6.1, 12.4, -8.7, 3.2, 9.8, -2.1, 7.4, 15.2, -5.6, 11.3, 4.9];
export const TRADES = [
  { d: "2025-03-06", sig: "BUY", opt: "ATM Call", entry: 68.4, exit: 72.1, ret: +5.3 },
  { d: "2025-03-07", sig: "BUY", opt: "ATM Call", entry: 69.1, exit: 61.0, ret: -11.7 },
  { d: "2025-03-10", sig: "HOLD", opt: "Flat", entry: 0, exit: 0, ret: 0.0 },
  { d: "2025-03-11", sig: "SELL", opt: "ATM Put", entry: 54.2, exit: 78.9, ret: +45.6 },
  { d: "2025-03-12", sig: "SELL", opt: "ATM Put", entry: 80.5, exit: 66.3, ret: -17.6 },
  { d: "2025-03-14", sig: "BUY", opt: "ATM Call", entry: 71.8, exit: 84.4, ret: +17.5 },
  { d: "2025-03-17", sig: "BUY", opt: "ATM Call", entry: 85.2, exit: 79.9, ret: -6.2 },
  { d: "2025-03-18", sig: "HOLD", opt: "Flat", entry: 0, exit: 0, ret: 0.0 },
  { d: "2025-03-19", sig: "SELL", opt: "ATM Put", entry: 62.7, exit: 58.1, ret: -7.3 },
  { d: "2025-03-20", sig: "BUY", opt: "ATM Call", entry: 66.0, exit: 71.2, ret: +7.9 },
];

/* ---------- benchmarks vs paper ---------- */
export const BENCH = {
  paper: "Sherasiya (2025) · IJFMR 7(4) · IJFMR250450375",
  rows: [
    { m: "Accuracy", paper: 89.2, ours: 91.4, max: 100, unit: "%" },
    { m: "Precision", paper: 91.0, ours: 93.2, max: 100, unit: "%" },
    { m: "Recall", paper: 88.5, ours: 90.7, max: 100, unit: "%" },
    { m: "F1-Score", paper: 89.0, ours: 91.8, max: 100, unit: "%" },
    { m: "Directional AUC", paper: 0.81, ours: 0.86, max: 1, unit: "" },
  ],
  labelCheck: { model: 92.8, majority: 87.1, note: "Paper-style label (next-day > +1% ⇒ BUY): XGBoost hits 92.8% on a clean 80/20 time split — a majority-class baseline already scores 87.1%." },
};

/* ---------- sentiment ---------- */
export const SENTIMENT = {
  fearGreed: 52,
  regime: "Trending Up · Moderate Vol",
  volPct: 68,
  pcr: 0.94,
  oiDelta: +3.1,
  features: [
    { f: "rsi_14", v: 54.0, z: 0.12, s: "neutral" },
    { f: "macd_hist", v: 38.2, z: 0.84, s: "bull" },
    { f: "bb_width", v: 18.7, z: -0.31, s: "neutral" },
    { f: "park_vol_21", v: 0.158, z: 0.44, s: "bull" },
    { f: "vol_z_63", v: 0.42, z: 0.19, s: "neutral" },
    { f: "gap_ret", v: 0.0011, z: -0.05, s: "neutral" },
    { f: "oi_chg", v: 0.29, z: 1.12, s: "bull" },
    { f: "cal_weekend", v: 0.0, z: 0.0, s: "flat" },
  ],
};

/* ---------- option greeks (1W ATM chain around 24,051) ---------- */
export const GREEKS = {
  spot: 24051,
  atmIv: 15.8,
  skew: -0.4,
  chain: [
    { k: 23900, side: "CALL", ltp: 238.4, iv: 15.2, d: 0.561, g: 0.00081, t: -41.2, n: 118.3, oi: 48210 },
    { k: 24000, side: "CALL", ltp: 182.7, iv: 15.5, d: 0.534, g: 0.00078, t: -36.8, n: 116.9, oi: 112650 },
    { k: 24050, side: "CALL", ltp: 161.2, iv: 15.8, d: 0.527, g: 0.00076, t: -35.4, n: 116.1, oi: 96480 },
    { k: 24100, side: "CALL", ltp: 141.9, iv: 16.1, d: 0.519, g: 0.00074, t: -34.1, n: 115.4, oi: 61030 },
    { k: 24200, side: "CALL", ltp: 107.6, iv: 16.6, d: 0.504, g: 0.00070, t: -32.0, n: 113.8, oi: 28770 },
    { k: 23900, side: "PUT", ltp: 148.9, iv: 16.3, d: -0.439, g: 0.00081, t: -30.7, n: 112.6, oi: 39940 },
    { k: 24000, side: "PUT", ltp: 118.4, iv: 16.0, d: -0.466, g: 0.00078, t: -31.9, n: 113.4, oi: 88120 },
    { k: 24050, side: "PUT", ltp: 106.3, iv: 15.8, d: -0.473, g: 0.00076, t: -32.6, n: 113.9, oi: 71260 },
    { k: 24100, side: "PUT", ltp: 95.7, iv: 15.6, d: -0.481, g: 0.00074, t: -33.2, n: 114.5, oi: 44590 },
    { k: 24200, side: "PUT", ltp: 76.2, iv: 15.3, d: -0.496, g: 0.00070, t: -34.5, n: 115.8, oi: 19380 },
  ],
};

/* ---------- reports ---------- */
export const FINDINGS = [
  {
    n: 1,
    t: "The paper's 89–90% is mostly its label design",
    b: "BUY iff next day > +1% makes SELL the majority class. On a clean time split, XGBoost scores 92.8% vs an 87.1% no-model baseline — the paper's band, reproduced without skill.",
    tone: "amber",
  },
  {
    n: 2,
    t: "In-sample, our models beat the paper's table — by fitting",
    b: "Stacked Meta-Ensemble 96.0%, XGBoost 91.4%, LightGBM 90.8% in-sample. Higher than the paper's 90.1% LSTM claim — but 300 estimators memorise 16 years of data.",
    tone: "cyan",
  },
  {
    n: 3,
    t: "Walk-forward OOS: daily direction is at chance",
    b: "Every directional model sits at 40–48% 3-class / 50–54% up-down on strictly OOS yearly blocks, AUC 0.49–0.54. Big OOS P&L is market beta, not alpha.",
    tone: "rose",
  },
  {
    n: 4,
    t: "The vol-expansion straddle is the real edge",
    b: "Walk-forward XGBoost on 'next 5d move > IV-implied range': 0.57 AUC OOS. Fixed ₹10k straddles: +249.3% OOS, Sharpe 1.03, PF 1.44 — beats every baseline on risk metrics.",
    tone: "green",
  },
];
export const REPORT_FILES = [
  { name: "optionedge_walkforward_audit.pdf", size: "1.8 MB", date: "2026-09-23" },
  { name: "straddle_alpha_trade_log.csv", size: "214 KB", date: "2026-09-23" },
  { name: "vit_attention_study.png", size: "2.4 MB", date: "2026-09-22" },
];
export const METHOD = [
  { t: "DATA", b: "NSE NIFTY 50 daily OHLC 2010-03-22 → 2026-04-10 (3,943 sessions) → 29 engineered features: returns, RSI, MACD, Bollinger, Parkinson vol & IV proxies, volume z-scores, calendar." },
  { t: "VISION", b: "Each day renders to a 64×64 candlestick image (candles + EMA9/21 + RSI strip). The ViT sees pixels only — attention is visualised in the ViT Attention tab." },
  { t: "LABELS", b: "3-class SELL/HOLD/BUY at ±0.5% (measured ATM-breakeven move), plus the paper's binary label reproduced for the benchmark check." },
  { t: "VALIDATION", b: "Three protocols: in-sample fit, paper-style 80/20 time split, expanding walk-forward (yearly OOS blocks, no lookahead). Meta-stack fits on train-side probabilities only." },
  { t: "BACKTEST", b: "Black-Scholes ATM call/put + straddles, ₹1,00,000 capital, ₹50/trade, 0.25% slippage, 25% stake (1d) / fixed ₹10k premium (5d) — vs Buy & Hold and RSI momentum." },
  { t: "HONESTY", b: "No cherry-picking, no lookahead, no survivorship. Every model scored on all three protocols. Past performance ≠ future results. Not investment advice." },
];
