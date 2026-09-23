"""OptionEdge - data loading, feature engineering and labelling.

Data: NIFTY 50 index daily OHLCV (NSE, via Yahoo Finance mirror), 2007-2026.
All features at time t use information available up to and including close of day t.
Labels look one day ahead (next trading day close-to-close return).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).parent / "data" / "raw" / "NIFTY50_stock_history.csv"

LABEL_THR = 0.005  # |next-day return| beyond +/-0.5% counts as a directional move
PAPER_THR = 0.01   # the reference paper's exact buy threshold (next-day > +1%)


def load_raw(start: str = "2010-01-01") -> pd.DataFrame:
    df = pd.read_csv(RAW, parse_dates=["Date"]).set_index("Date").sort_index()
    df = df[~df.index.duplicated(keep="first")]
    df = df.loc[start:]
    return df[["Open", "High", "Low", "Close", "Volume"]].astype(float)


def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def _parkinson_vol(high: pd.Series, low: pd.Series, n: int) -> pd.Series:
    """Parkinson high-low volatility, annualised - used as an IV level proxy."""
    x = np.log(high / low) ** 2
    return np.sqrt(x.rolling(n).mean() / (4.0 * np.log(2.0))) * np.sqrt(252.0)


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    c, h, l, o, v = df["Close"], df["High"], df["Low"], df["Open"], df["Volume"]
    f = pd.DataFrame(index=df.index)

    # --- returns & momentum -------------------------------------------------
    for n in (1, 3, 5, 10, 21):
        f[f"ret_{n}"] = c.pct_change(n)
    f["rsi_14"] = _rsi(c, 14)
    ema9 = c.ewm(span=9, adjust=False).mean()
    ema21 = c.ewm(span=21, adjust=False).mean()
    ema50 = c.ewm(span=50, adjust=False).mean()
    f["ema9_dist"] = c / ema9 - 1.0
    f["ema21_dist"] = c / ema21 - 1.0
    f["ema50_dist"] = c / ema50 - 1.0
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    f["macd_hist"] = (macd - macd.ewm(span=9, adjust=False).mean()) / c

    # --- volatility / option-chain style proxies -----------------------------
    f["bb_mid"] = c.rolling(20).mean()
    f["bb_sd"] = c.rolling(20).std()
    f["bb_pctb"] = ((c - (f["bb_mid"] - 2 * f["bb_sd"])) / (4 * f["bb_sd"])).fillna(0.5)
    f["bb_width"] = (4 * f["bb_sd"] / f["bb_mid"]).fillna(0.0)
    r = c.pct_change()
    f["vol_10"] = r.rolling(10).std() * np.sqrt(252)
    f["vol_21"] = r.rolling(21).std() * np.sqrt(252)
    f["vol_52"] = r.rolling(52).std() * np.sqrt(252)
    f["ret_10_z"] = f["ret_10"] / (
        (f["vol_21"] * np.sqrt(10.0) / np.sqrt(252.0)).replace(0, np.nan))
    f["iv_proxy"] = _parkinson_vol(h, l, 21)          # IV level proxy
    f["iv_slope"] = f["vol_10"] - f["vol_52"]         # term-structure-like slope
    f["iv_change_5"] = f["iv_proxy"].diff(5)
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    f["atr_14"] = tr.rolling(14).mean() / c
    f["vol_regime"] = f["vol_21"] / f["vol_52"]
    f.drop(columns=["bb_mid", "bb_sd"], inplace=True)

    # --- intrabar micro-structure -------------------------------------------
    f["hl_range"] = (h - l) / c
    rng = (h - l).replace(0, np.nan)
    f["close_loc"] = ((c - l) / rng).fillna(0.5)
    f["gap"] = o / c.shift() - 1

    # --- volume ---------------------------------------------------------------
    vmask = v > 0
    vfill = v.where(vmask).ffill().fillna(0.0)
    vm, vs = vfill.rolling(21).mean(), vfill.rolling(21).std()
    f["vol_z"] = ((vfill - vm) / vs.replace(0, np.nan)).fillna(0.0)
    f["vol_missing"] = (~vmask).astype(float)

    # --- calendar ---------------------------------------------------------------
    f["dow"] = df.index.dayofweek.astype(float)
    f["month"] = df.index.month.astype(float)

    f["up_frac_20"] = (r > 0).rolling(20).mean()
    f = f.replace([np.inf, -np.inf], np.nan)
    return f


FEATURES = [
    "ret_1", "ret_3", "ret_5", "ret_10", "ret_21",
    "rsi_14", "macd_hist", "ema9_dist", "ema21_dist", "ema50_dist", "ret_10_z",
    "bb_pctb", "bb_width", "vol_10", "vol_21", "vol_52",
    "iv_proxy", "iv_slope", "iv_change_5", "atr_14", "vol_regime",
    "hl_range", "close_loc", "gap", "vol_z", "vol_missing",
    "up_frac_20", "dow", "month",
]


def make_dataset() -> pd.DataFrame:
    """Full feature matrix + labels.  Rows with undefined features are dropped."""
    df = load_raw()
    f = add_features(df)
    nxt = df["Close"].shift(-1) / df["Close"] - 1.0

    y3 = np.where(nxt > LABEL_THR, 2, np.where(nxt < -LABEL_THR, 0, 1)).astype(int)
    out = f.copy()
    out["y3"] = y3                       # 0=SELL  1=HOLD  2=BUY
    out["y_up"] = (nxt > 0).astype(float)
    out["y_paper"] = (nxt > PAPER_THR).astype(float)  # paper's exact label design
    out["next_ret"] = nxt
    out["close"] = df["Close"].values
    out["open"] = df["Open"].values
    out["high"] = df["High"].values
    out["low"] = df["Low"].values
    out["volume"] = df["Volume"].values

    out = out.dropna(subset=FEATURES)
    out = out.iloc[:-1]                  # last row has no next day
    return out


if __name__ == "__main__":
    d = make_dataset()
    print(d.shape)
    print(d[FEATURES].describe().T[["mean", "std"]].round(3).head(10))
    print("y3 balance:", d["y3"].value_counts(normalize=True).round(3).to_dict())
    print("y_up balance:", d["y_up"].mean().round(3))
