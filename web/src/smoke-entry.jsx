/* SSR smoke entry — renders every tab and unit-checks the mock logic. */
import React from "react";
import { renderToString } from "react-dom/server";
import App from "./App";
import { pseudoPredict, genScenario, parseCsv, batchDays, batchDay, latest60 } from "./mock";

export function smoke() {
  const tabs = ["overview", "attention", "predictions", "sentiment", "greeks", "backtest", "benchmarks", "reports"];
  const out = tabs.map((t) => renderToString(<App initialTab={t} instantData />));
  const must = {
    overview: ["MODEL ROSTER", "ViT-Patch16", "Stacked Meta-Ensemble", "LIVE (WS)", "NIFTY 50", "BENCHMARKING"],
    attention: ["LIVE ATTENTION FEED", "H8", "HEAD × PATCH ENERGY", "VISION TRANSFORMER"],
    predictions: ["Custom OHLCV", "WHAT-IF TWIST", "Session Fabricator", "Batch Runner", "UPLOAD CSV", "LOAD LATEST 60D"],
    sentiment: ["MARKET SENTIMENT", "GREED", "FEATURE REGIME READOUT"],
    greeks: ["OPTION GREEKS", "24,050", "BLACK-SCHOLES", "Vega"],
    backtest: ["WALK-FORWARD OOS", "DRAWDOWN", "MONTHLY RETURNS", "RECENT ENSEMBLE TRADES"],
    benchmarks: ["BENCHMARK", "F1-SCORE", "LABEL-DESIGN CHECK", "REFERENCE PAPER"],
    reports: ["GENERATED REPORTS", "HOW IT&#x27;S BUILT", "STRADDLE IS THE REAL EDGE", "AUDIT-READY"],
  };
  const fail = [];
  tabs.forEach((t, i) => {
    (must[t] || []).forEach((s) => {
      if (!out[i].includes(s)) fail.push(`${t}: missing "${s}"`);
    });
  });

  /* unit checks on the deterministic mock engine */
  const rows = genScenario("up");
  if (rows.length !== 40) fail.push("genScenario length " + rows.length);
  const p = pseudoPredict(rows);
  if (Math.abs(p.probs.reduce((a, b) => a + b, 0) - 1) > 1e-6) fail.push("probs don't sum to 1");
  if (!["SELL", "HOLD", "BUY"].includes(p.signal)) fail.push("bad signal " + p.signal);
  if (p.grid.length !== 64) fail.push("grid not 64 cells");
  const p2 = pseudoPredict(rows.map((r) => (r[4] === rows[rows.length - 1][4] ? [r[0], r[1], r[2], r[3], r[4] * 1.02] : r)));
  if (JSON.stringify(p.probs) === JSON.stringify(p2.probs)) fail.push("pseudoPredict insensitive to twist");
  const l60 = latest60();
  if (l60.length !== 60) fail.push("latest60 length " + l60.length);
  if (Math.abs(l60[l60.length - 1][4] - 24051.0) > 0.05) fail.push("latest60 not anchored: " + l60[l60.length - 1][4]);
  const bd = batchDays("2024-01-01", "2024-01-31");
  if (bd.length < 18 || bd.length > 23) fail.push("batch days count " + bd.length);
  const day = batchDay(bd[0]);
  if (!["SELL", "HOLD", "BUY"].includes(day.signal) || !isFinite(day.next)) fail.push("batchDay shape");
  let threw = false;
  try { parseCsv("2024-01-01,1,2"); } catch { threw = true; }
  if (!threw) fail.push("parseCsv should reject short rows");
  const parsed = parseCsv("date,open,high,low,close\n2024-01-01,1,2,0.5,1.5");
  if (parsed.length !== 1 || parsed[0][4] !== 1.5) fail.push("parseCsv parse");

  return fail;
}
