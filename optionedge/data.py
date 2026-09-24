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

# --- India VIX: the option-chain-derived feature set (see vix_experiment.py) ---
# India VIX is computed by NSE from the NIFTY 50 option chain itself. It is the
# closest freely-available proxy for the "IV from the chain" data the reference
# paper claims. Walk-forward test (2023->2026 OOS): +0.049 AUC on the
# vol-expansion straddle label, positive every year; no rescuing effect on
# daily direction.
VIX_CSV = Path(__file__).parent / "data" / "chain" / "INDIAVIX.csv"
VIX_AVAILABLE = VIX_CSV.exists()
VIX_FEATURES = [
    "vix_close", "vix_chg_1d", "vix_ret_5d",
    "vix_z_60d", "vix_pctile_252", "vix_vs_realized", "vix_avail",
]
# Pre-VIX-era neutral fills (sentinel values trees can branch on; vix_avail=0
# marks them). India VIX long-run average ~15.
VIX_FILL = {"vix_close": 15.0, "vix_chg_1d": 0.0, "vix_ret_5d": 0.0,
            "vix_z_60d": 0.0, "vix_pctile_252": 0.5, "vix_vs_realized": 0.0,
            "vix_avail": 0.0}
ALL_FEATURES = FEATURES + (VIX_FEATURES if VIX_AVAILABLE else [])


def add_vix_features(df: pd.DataFrame) -> pd.DataFrame | None:
    """Daily India VIX features aligned to df's index (None if no VIX file)."""
    if not VIX_AVAILABLE:
        return None
    v = pd.read_csv(VIX_CSV, parse_dates=["date"]).set_index("date").sort_index()["close"]
    v = v.reindex(df.index)
    out = pd.DataFrame(index=df.index)
    out["vix_close"] = v
    out["vix_chg_1d"] = v.diff()
    out["vix_ret_5d"] = v / v.shift(5) - 1.0
    m60, s60 = v.rolling(60).mean(), v.rolling(60).std()
    out["vix_z_60d"] = (v - m60) / s60
    out["vix_pctile_252"] = v.rolling(252, min_periods=60).rank(pct=True)
    out["vix_vs_realized"] = v / (df["iv_proxy"] * 100.0) - 1.0
    out["vix_avail"] = v.notna().astype(float)
    return out.fillna(VIX_FILL)


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

    vf = add_vix_features(out)
    if vf is not None:
        out = pd.concat([out, vf], axis=1)

    out = out.dropna(subset=ALL_FEATURES)
    out = out.iloc[:-1]                  # last row has no next day
    return out


if __name__ == "__main__":
    d = make_dataset()
    print(d.shape)
    print(d[FEATURES].describe().T[["mean", "std"]].round(3).head(10))
    print("y3 balance:", d["y3"].value_counts(normalize=True).round(3).to_dict())
    print("y_up balance:", d["y_up"].mean().round(3))
