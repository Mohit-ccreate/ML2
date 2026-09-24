"""OptionEdge - options backtester.

Strategy (mirrors the reference paper):
  * signal at close of day t  ->  trade at close of day t
  * BUY  -> long ATM CALL      (strike rounded to 50)
  * SELL -> long ATM PUT
  * exit at close of day t+1 (1-day hold), no position on HOLD
  * initial capital Rs 1,00,000 | brokerage Rs 50/trade | slippage 0.25%

Option premiums are priced with Black-Scholes using the IV proxy from the
feature set (Parkinson realisation of the option chain's IV level),
r = 6.5% (India risk-free), T = 1/252 (1 day to expiry).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy.stats import norm

RISK_FREE = 0.065
SLIPPAGE = 0.0025
BROKERAGE = 50.0
INITIAL = 100_000.0
STRIKE_STEP = 50.0
STAKE_FRAC = 0.25   # max fraction of capital deployed as option premium per trade


def bs_price(s: float, k: float, sigma: float, r: float, t: float, kind: str) -> float:
    if t <= 0 or sigma <= 1e-8:
        return max(s - k, 0.0) if kind == "c" else max(k - s, 0.0)
    d1 = (math.log(s / k) + (r + sigma * sigma / 2.0) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    if kind == "c":
        return s * norm.cdf(d1) - k * math.exp(-r * t) * norm.cdf(d2)
    return k * math.exp(-r * t) * norm.cdf(-d2) - s * norm.cdf(-d1)


def atm_price(close: np.ndarray, iv: np.ndarray, i: int, kind: str) -> float:
    s = float(close[i])
    k = max(STRIKE_STEP * round(s / STRIKE_STEP), 1.0)
    sigma = float(np.clip(iv[i], 0.12, 0.80))
    return max(bs_price(s, k, sigma, RISK_FREE, 1.0 / 252.0, kind), 0.5)


def strike_of(s: float) -> float:
    return max(STRIKE_STEP * round(s / STRIKE_STEP), 1.0)


def bs_atm(S: float, K: float, iv: float, t: float, kind: str) -> float:
    return max(bs_price(S, K, float(np.clip(iv, 0.12, 0.80)), RISK_FREE, t, kind), 0.5)


def performance(equity: pd.Series) -> dict:
    ret = equity.pct_change().fillna(0.0)
    daily = ret[equity.index > equity.index[0]]
    sharpe = float(daily.mean() / daily.std() * math.sqrt(252)) if daily.std() > 0 else 0.0
    peak = equity.cummax()
    dd = (equity - peak) / peak
    return {
        "final_equity": round(float(equity.iloc[-1]), 2),
        "total_return_pct": round(float(equity.iloc[-1] / INITIAL - 1) * 100, 2),
        "sharpe": round(sharpe, 2),
        "max_drawdown_pct": round(float(dd.min()) * 100, 2),
        "ann_vol_pct": round(float(daily.std() * math.sqrt(252) * 100), 1),
    }


def run_backtest(rows: pd.DataFrame, sig_col: str = "pred",
                 initial: float = INITIAL) -> tuple[pd.Series, dict]:
    """rows: OOS rows with close/iv_proxy + signal column (0=SELL 1=HOLD 2=BUY).

    Signal produced at close of row i is executed at close[i], exited at
    close[i+1] (the *next* row's close must be present in `rows`).
    """
    close = rows["close"].to_numpy(dtype=float)
    iv = rows["iv_proxy"].to_numpy(dtype=float)
    sig = rows[sig_col].to_numpy(dtype=int)
    n = len(rows)
    eq = np.full(n, np.nan)
    cash, units, entry_cost, kind = initial, 0, 0.0, None
    n_trades, wins, pnl_sum, gross_win, gross_loss = 0, 0, 0.0, 0.0, 0.0

    for i in range(n):
        def _close(now_price: float) -> None:
            nonlocal cash, units, kind, n_trades, wins, pnl_sum, gross_win, gross_loss
            exit_price = now_price * (1 - SLIPPAGE)
            pnl = units * (exit_price - entry_price) - 2 * BROKERAGE
            cash += units * exit_price - BROKERAGE
            n_trades += 1
            pnl_sum += pnl
            if pnl > 0:
                wins += 1
                gross_win += pnl
            else:
                gross_loss += -pnl
            units, kind = 0, None

        if units > 0:                                   # exit previous trade today
            _close(atm_price(close, iv, i, kind))

        if i < n - 1:
            s = int(sig[i])
            if s in (0, 2) and cash > 2 * BROKERAGE:
                kind = "c" if s == 2 else "p"
                entry_price = atm_price(close, iv, i, kind)
                entry_cost = entry_price * (1 + SLIPPAGE)
                stake = min(cash * STAKE_FRAC, cash - BROKERAGE)
                units = max(int(stake / entry_cost), 0)
                if units > 0:
                    cash -= units * entry_cost + BROKERAGE
                else:
                    kind = None
        elif units > 0:                                 # liquidate at the very end
            _close(atm_price(close, iv, i, kind))

        eq[i] = cash + (units * entry_price if units > 0 else 0.0)

    equity = pd.Series(eq, index=rows.index).ffill().fillna(initial)
    stats = performance(equity)
    stats.update({
        "n_trades": int(n_trades),
        "win_rate_pct": round(100.0 * wins / n_trades, 1) if n_trades else 0.0,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else (
            99.9 if gross_win > 0 else 0.0),
        "avg_pnl": round(float(pnl_sum / n_trades), 0) if n_trades else 0.0,
    })
    return equity, stats


STRADDLE_HOLD = 5


def run_straddle_backtest(rows: pd.DataFrame, pred: np.ndarray,
                          stake_frac: float = STAKE_FRAC,
                          hold: int = STRADDLE_HOLD,
                          fixed_stake: float | None = None) -> tuple[pd.Series, dict]:
    """Long ATM straddle (call + put) on signal days, expires `hold` days out.

    rows: DataFrame with close/iv_proxy indexed by date (incl. the `hold` days
          needed to mark exits). pred: 0/1 signal per row (enter at close of t,
          exit at intrinsic value on close of t+hold). Non-overlapping: no new
          entry while in a trade. Sizing: `fixed_stake` rupees of premium per
          trade (realistic retail), or `stake_frac` of current capital.
    """
    close = rows["close"].to_numpy(dtype=float)
    iv = rows["iv_proxy"].to_numpy(dtype=float)
    n = len(rows)
    cash, units, K, entry_cost, entry_t = INITIAL, 0, 0.0, 0.0, 0
    n_trades, wins, pnl_sum, gross_win, gross_loss = 0, 0, 0.0, 0.0, 0.0
    eq = np.full(n, np.nan)

    def _mark(i: int) -> float:
        if units == 0:
            return cash
        t_rem = (entry_t + hold - i) / 252.0
        if t_rem <= 0:
            return cash + units * (max(close[i] - K, 0.0) + max(K - close[i], 0.0))
        c = bs_atm(close[i], K, iv[i], t_rem, "c")
        p = bs_atm(close[i], K, iv[i], t_rem, "p")
        return cash + units * (c + p)

    for i in range(n):
        if units > 0 and i >= entry_t + hold:                    # expiry: intrinsic value
            c = max(close[i] - K, 0.0) * (1 - SLIPPAGE)
            p = max(K - close[i], 0.0) * (1 - SLIPPAGE)
            pnl = units * ((c + p) - entry_cost) - 2 * BROKERAGE
            cash += units * (c + p) - BROKERAGE
            n_trades += 1
            pnl_sum += pnl
            if pnl > 0:
                wins += 1
                gross_win += pnl
            else:
                gross_loss += -pnl
            units, K = 0, 0.0
        if units == 0 and i < n - hold and int(pred[i]) == 1 and cash > 2 * BROKERAGE:
            K = strike_of(close[i])
            T0 = hold / 252.0                                    # expires `hold` days out
            c0 = bs_atm(close[i], K, iv[i], T0, "c") * (1 + SLIPPAGE)
            p0 = bs_atm(close[i], K, iv[i], T0, "p") * (1 + SLIPPAGE)
            entry_cost = c0 + p0
            stake = (fixed_stake if fixed_stake is not None
                     else min(cash * stake_frac, cash - 2 * BROKERAGE))
            stake = min(stake, cash - 2 * BROKERAGE)
            units = max(int(stake / entry_cost), 0)
            if units > 0:
                cash -= units * entry_cost + BROKERAGE
                entry_t = i
        eq[i] = _mark(i)
    equity = pd.Series(eq, index=rows.index).ffill().fillna(INITIAL)
    stats = performance(equity)
    stats.update({
        "n_trades": int(n_trades),
        "win_rate_pct": round(100.0 * wins / n_trades, 1) if n_trades else 0.0,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else (
            99.9 if gross_win > 0 else 0.0),
        "avg_pnl": round(float(pnl_sum / n_trades), 0) if n_trades else 0.0,
    })
    return equity, stats


def buy_and_hold(rows: pd.DataFrame) -> pd.Series:
    c = rows["close"]
    return INITIAL * c / c.iloc[0]


def rsi_strategy(rows: pd.DataFrame, iv: pd.DataFrame) -> pd.Series:
    """RSI momentum baseline (paper's momentum comparator): RSI<30 call, RSI>70 put."""
    rsi = rows["rsi_14"].to_numpy()
    sig = np.where(rsi < 30, 2, np.where(rsi > 70, 0, 1)).astype(int)
    tmp = pd.DataFrame({"close": rows["close"].values, "iv_proxy": iv.values, "pred": sig},
                       index=rows.index)
    eq, _ = run_backtest(tmp)
    return eq


if __name__ == "__main__":
    from data import make_dataset
    d = make_dataset()
    tail = d.tail(120)
    eq, st = run_backtest(pd.DataFrame({
        "close": tail["close"], "iv_proxy": tail["iv_proxy"],
        "rsi_14": tail["rsi_14"],
        "pred": (tail["next_ret"] > 0).astype(int) * 2,  # oracle-ish sanity check
    }))
    print(st)
