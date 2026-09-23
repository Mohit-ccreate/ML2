# OptionEdge ⚡ — Vision Transformer Options Terminal for NIFTY 50

A machine-learning options-trading research system for the Indian market. Its
**Vision Transformer (ViT) is built from scratch** and reads NIFTY 50 candlestick
charts the way a human trader does — the rendered chart *is* the model input.
It is stacked with the reference paper's LSTM, XGBoost and Random Forest into a
leak-free ensemble, everything is backtested in real Black-Scholes ATM options
under walk-forward (expanding-window, yearly out-of-sample) validation, and a
separate **vol-expansion straddle alpha** is tested against baselines — then
served on a quant-terminal dashboard with live ViT attention heatmaps, equity
curves, per-trade logs and a side-by-side comparison against the paper.

Data: real NSE NIFTY 50 daily OHLC, 2010-03-22 → 2026-04-10 (3,943 sessions),
29 engineered features (returns, RSI, MACD, Bollinger, Parkinson vol & IV
proxies, volume z-scores, calendar effects).

This project is a direct, more rigorous follow-up to:

> F. A. Sherasiya (2025), *Developing A Machine Learning-Based Options Trading
> Strategy for the Indian Market*, IJFMR 7(4), code IJFMR250450375 —
> XGBoost 89.2% / RandomForest 87.4% / LSTM 90.1% accuracy, Sharpe 1.53–1.95,
> ₹1,00,000 → ₹1,82,300–2,05,720.

## What's different here

| | Reference paper | OptionEdge |
|---|---|---|
| Inputs | tabular features only | **64×64 rendered candlestick charts** (candles + EMA9/21 + RSI strip) fed to a from-scratch ViT — plus the paper's tabular & sequence models |
| Models | XGBoost, RF, LSTM | same three **+ from-scratch ViT** + logistic **ensemble stack** (fitted on train-side meta-features only) |
| Labels | `next-day > +1% ⇒ BUY else SELL` — SELL is ~87% of all days, so a no-brainer classifier already scores that high | balanced 3-class SELL/HOLD/BUY at ±0.5% (measured ATM-breakeven move) — measures true directional skill |
| Evaluation | single 80/20 split | **three** protocols: in-sample fit, fair 80/20 *time* split, and **expanding walk-forward (yearly OOS blocks, no lookahead)** |
| Backtest | described | fully implemented: Black-Scholes ATM call/put, ₹1,00,000 capital, ₹50/trade, 0.25% slippage, 25% stake, 1-day hold — vs Buy & Hold and RSI momentum |
| Real edge | claimed | **OptionEdge Alpha**: XGBoost vol-expansion model timing long ATM straddles on 5-day holds — the component with a demonstrable out-of-sample edge |

## The honest numbers (what this research actually found)

### 1. The paper's 89–90% is mostly its label design — we measured it

The paper labels a day BUY only if the next day moves > +1%; every other day is
SELL. On NIFTY that makes SELL ~87% of all days. We trained the *same kind of*
XGBoost on that exact label with a clean 80/20 time split:

* **model accuracy: 92.8% — majority-class baseline: 87.1%.**

A majority classifier plus a dash of trend gets you from 87% to ~93%. That is
the same 89–90% band the paper reports. Their table is not reproducible as
*skill* under honest evaluation.

### 2. In-sample, our models do beat the paper's table — by fitting

Under the evaluation style these tables effectively use (model trained on the
full history, scored on that same history), our models fit the data harder:

| Model | Paper (claimed) | OptionEdge in-sample |
|---|---|---|
| RandomForest | 87.4% | **100.0%** |
| XGBoost | 89.2% | **91.4%** |
| Ensemble (ViT+LSTM+XGB) | — | **96.0%** |

Higher than the paper's 90.1% LSTM: yes. But trees with 300 estimators
memorise a 16-year dataset — this row is a capacity demonstration, not
forecasting skill. (The paper's flagship LSTM claim can't be reproduced even
in-sample by an LSTM on the same data: ours scores 45.9% in-sample, i.e. it
simply does not fit the pattern — consistent with #3 below.)

### 3. Walk-forward out-of-sample: daily direction is at chance

Every directional model — ViT, LSTM, XGBoost, RF, ensemble — sits at ~chance
on strictly out-of-sample yearly blocks (OOS 2020-01-01 → 2026-04-10):
3-class accuracy 40–48%, up/down accuracy 50–54%, AUC 0.49–0.52. A linear
probe on the raw 64px charts scores 100% in-sample and **36% out-of-sample
(below the 44% majority baseline)** — the exact overfitting fingerprint that
produces the paper's table. Daily NIFTY direction is essentially unlearnable
from these features; anything claiming otherwise is measuring leakage, not
edge.

The directional OOS backtests (long ATM call/put, 1-day hold) still print big
returns — ViT +1,115%, XGBoost +818%, Ensemble +379% — because NIFTY rose
~97% over that OOS window and a long-option book leverages a bull trend.
Win rates are 49–52% (coin flip) and Sharpes (0.6–1.0) only marginally exceed
Buy & Hold's 0.70: that P&L is **market beta, not forecasting alpha**, and a
flat bear window would have inverted it.

### 4. The vol-expansion straddle alpha: the real, demonstrable edge

Direction is coin-flip; **volatility expansion is not**. Next-5-day moves on
NIFTY are fatter than Parkinson-IV-implied ranges (real |5d moves| average
~1.76% vs ~1.73% implied). A walk-forward XGBoost model of
"will the next 5-day move exceed the IV-implied range?" reaches
**0.570 AUC** (53.9% accuracy vs 46.2% base rate) strictly out-of-sample,
year by year (AUC 0.48–0.67 across 2020–2026). Traded as a fixed-₹10,000
long ATM straddle on vol-expansion days (5-day hold, Black-Scholes entry,
intrinsic-value exit, 0.25% slippage, OOS 2020→2026):

| Strategy | Return | Sharpe | Max DD | Profit factor |
|---|---|---|---|---|
| **Alpha straddle (model-timed)** | **+249.3%** | **1.03** | **−25.8%** | **1.44** |
| Straddle every 5 days | +216.7% | 0.74 | −42.9% | 1.23 |
| Rule "IV < 1-yr median" | +37.1% | 0.33 | — | 0.86 |
| Buy & Hold (same period) | +86.4% | 0.65 | −38.4% | — |

202 trades, 44.1% win rate, +₹1,234 average P&L per straddle. The payoff is
convex (losses capped at the premium, wins are big), and the model beats the
naive always-on straddle on every risk metric — skipping dead-volatility
weeks is the only out-of-sample edge in the project that survives scrutiny.

Nothing here is investment advice; past performance ≠ future results.

## The dashboard

`http://localhost:8000` — a dark quant-terminal UI (ECharts, no frameworks):
scroll-revealed sections, animated KPI counters, a hero candlestick chart with
the **live ViT attention heatmap** pulsing over the patches the network looks
at, probability bars for the model's current-day signal, per-model cards with
in-sample / paper-style / walk-forward OOS rows and OOS backtest stats, the
vs-paper comparison chart, the three-protocol table, equity curves vs
Buy & Hold, drawdown, monthly P&L heat strip, feature importance, and
per-trade logs for both the directional ensemble and the straddle alpha.

## Layout

```
optionedge/
  data.py          # NSE NIFTY OHLC → 29 features + labels (3-class & paper-style)
  charts.py        # renders the 15-day candlestick image the ViT sees (+ hero chart)
  models_vit.py    # ViT (from scratch) + LSTM, PyTorch, CPU
  backtest.py      # Black-Scholes ATM option + straddle backtester
  train.py         # full pipeline (3 eval protocols, ensemble, alpha) → results/state.json
  results/         # state.json (dashboard data), hero.png, model weights
dashboard/
  app.py           # Flask server (port 8000)
  static/          # the quant-terminal UI (local ECharts, attention heatmap)
```

## Run it

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python optionedge/train.py         # full: ~40–60 min on 2 CPU cores (charts cached after first run)
.venv/bin/python optionedge/train.py --fast  # smoke test, ~11 min
.venv/bin/python dashboard/app.py            # → http://localhost:8000
```

The dashboard auto-detects a fresh `state.json` (mtime-watched) — just re-run
`train.py` and refresh the page.
