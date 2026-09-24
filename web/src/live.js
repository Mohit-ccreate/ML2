/* Live data layer — pulls real state from the Flask API (proxied /api in dev).
   Falls back to the deterministic mock engine when the API is unreachable,
   so the terminal always renders. `src: "api" | "mock"` drives the badge. */
import { useEffect, useState, useCallback } from "react";

const NAMES = { ViT: "ViT-Patch16", LSTM: "LSTM", XGBoost: "XGBoost", RandomForest: "RandomForest", Ensemble: "Stacked Meta-Ensemble" };
const KIND = { ViT: "deep", LSTM: "deep", XGBoost: "tree", RandomForest: "tree", Ensemble: "ens" };
const ARCH = {
  ViT: "ViT · 64² patch8 · 4L", LSTM: "LSTM · H96 · W10", XGBoost: "XGBoost · 600t d4",
  RandomForest: "RF · 600 trees", Ensemble: "XGB+RF+LSTM → logit",
};
const EQ_COLORS = { Ensemble: "#34d399", "Buy&Hold NIFTY": "#60a5fa", ViT: "#a78bfa", XGBoost: "#fbbf24", RandomForest: "#f472b6", LSTM: "#22d3ee", "RSI momentum": "#9ca3af" };

const _p = (x, k = "acc_3c") => (x?.[k] ?? 0) * 100; // fractions -> percents (UI contract)
export function mapState(s) {
  const vitMeta = s.meta?.vit || {};
  const models = Object.entries(s.models || {}).map(([name, m]) => {
    const kind = KIND[name] || "tree";
    const bt = m.backtest || {};
    const wf = m["walk-forward OOS"] || {};
    const ins = m["in-sample"] || {};
    const ps = m["paper-style"] || null;
    const badge = name === "ViT" && vitMeta.depth ? `D${vitMeta.depth}·P${vitMeta.patch}·${vitMeta.params ? (vitMeta.params / 1e6).toFixed(2) + "M" : ""}` : name === "LSTM" ? "H96·W10" : "";
    return {
      name: NAMES[name] || name,
      kind,
      fam: kind,
      arch: ARCH[name] || name,
      ins: { a: _p(ins), d: _p(ins, "acc_updown") },
      paper: ps ? { a: _p(ps), d: _p(ps, "acc_updown") } : null,
      wf: { a: _p(wf), d: _p(wf, "acc_updown"), auc: wf.auc_updown ?? 0 },
      auc: wf.auc_updown ?? 0,
      ret: (bt.total_return_pct || 0) / 100,
      sharpe: bt.sharpe ?? 0,
      win: bt.win_rate_pct || 0,
      badge,
      bt,
    };
  });

  // oos.equity {name: [[date, v]]} -> {labels, series:[{name,color,data:[{x,y}]}]}
  const eqRaw = s.oos?.equity || {};
  const first = Object.values(eqRaw)[0] || [];
  const labels = first.map(([x]) => x);
  const series = Object.entries(eqRaw).map(([name, pts]) => ({
    name, color: EQ_COLORS[name] || "#94a3b8", data: pts, // [[date, value], ...] as the charts expect
  }));

  const al = s.alpha || {};
  const alBt = al.backtest || {};
  const hero = s.hero || {};
  const tkr = s.ticker || [];

  return {
    generated: s.generated,
    meta: s.meta || {},
    vitMeta,
    hero,
    attention: s.attention || null,
    ticker: tkr,
    models,
    equity: { labels, series },
    oos: s.oos || {},
    oosPeriod: s.oos?.period || "",
    alpha: { ...al, ret_pct: alBt.total_return_pct, sharpe: alBt.sharpe, win_pct: alBt.win_rate_pct, max_dd: alBt.max_drawdown_pct, n: alBt.n_trades, pf: alBt.profit_factor, period: al.period },
    monthly: s.monthly_pnl || [],
    paper: s.paper || null,
    lcd: s.label_design_check || null,
    featImp: (s.feature_importance || []).map(([n, w]) => ({ n, w })),
    backtests: s.backtests || {},
    heroRet: tkr.length ? tkr[tkr.length - 1].ret : null,
    heroRsi: tkr.length ? tkr[tkr.length - 1].rsi : null,
    heroIv: tkr.length ? tkr[tkr.length - 1].iv : null,
    heroVol: tkr.length ? tkr[tkr.length - 1].vol21 : null,
  };
}

export function useLive() {
  const [state, setState] = useState(null);
  const [src, setSrc] = useState("mock");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch("/api/state", { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(r.status);
      const s = await r.json();
      setState(mapState(s));
      setSrc("api");
    } catch {
      setState(null);
      setSrc("mock");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { live: state, src, busy, reload: load };
}

/* ---- live prediction endpoints (ViT via Flask) ---- */
export async function apiPredictCsv(csv) {
  const r = await fetch("/api/predict", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  if (!r.ok) throw new Error("predict " + r.status);
  return r.json();
}
export async function apiPredictDate(date) {
  const r = await fetch("/api/predict?date=" + encodeURIComponent(date));
  if (!r.ok) throw new Error("predict " + r.status);
  return r.json();
}
export async function apiPredictRange(from, to) {
  const r = await fetch("/api/predict_range", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  if (!r.ok) throw new Error("range " + r.status);
  return r.json();
}
export async function apiLatest(rows = 60) {
  const r = await fetch("/api/latest?rows=" + rows);
  if (!r.ok) throw new Error("latest " + r.status);
  return r.json();
}
