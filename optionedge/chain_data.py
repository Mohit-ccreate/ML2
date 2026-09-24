"""Historical NIFTY option-chain ingestion + daily features.

Drop a CSV of daily option-chain snapshots into optionedge/data/chain/ and
`python -m optionedge.chain_data <file>` prints the daily feature table.

Supported layouts (auto-detected, case-insensitive column aliases):
  WIDE : date, expiry, strike, ce_oi, pe_oi, ce_iv, pe_iv, ce_ltp, pe_ltp,
         ce_vol, pe_vol
  LONG : date, expiry, strike, type(CE/PE), oi, iv, ltp, volume

Sources that work: tradingtick.in "NIFTY option chain historical" CSVs,
NSE option-chain dumps saved daily, broker/app exports (Angel One, Groww,
Zerodha Kite) — anything with date + strike + CE/PE OI/IV/LTP.

Daily features (one row per trading day, active expiry = max total OI):
  pcr_oi          total PE OI / total CE OI
  pcr_vol         total PE volume / total CE volume
  oi_atm_net      (PE_OI - CE_OI) at ATM strike, / total OI
  iv_atm          (CE_IV + PE_IV) / 2 at ATM strike
  iv_skew_1       (PE_IV - CE_IV) one strike away from ATM
  iv_change_1d    iv_atm - iv_atm(previous day)
  oi_top3_share   OI share of the 3 largest strikes
  prem_atm_c_pct  ATM call LTP / spot * 100  (premium as % of index)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

CHAIN_DIR = Path(__file__).resolve().parent / "data" / "chain"

ALIASES = {
    "date": {"date", "dt", "date_time", "datetime", "timestamp", "time"},
    "expiry": {"expiry", "expiry_date", "exp", "contract_expiry"},
    "strike": {"strike", "strike_price", "spot_price", "strikeprice"},
    "type": {"type", "option_type", "instrument", "option", "side"},
    "ce_oi": {"ce_oi", "call_oi", "ce open interest", "call open interest"},
    "pe_oi": {"pe_oi", "put_oi", "pe open interest", "put open interest"},
    "ce_iv": {"ce_iv", "call_iv", "ce implied volatility", "call iv"},
    "pe_iv": {"pe_iv", "put_iv", "pe implied volatility", "put iv"},
    "ce_ltp": {"ce_ltp", "call_ltp", "ce_last_price", "call price", "ce_price"},
    "pe_ltp": {"pe_ltp", "put_ltp", "pe_last_price", "put price", "pe_price"},
    "ce_vol": {"ce_vol", "call_vol", "call_volume", "ce volume"},
    "pe_vol": {"pe_vol", "put_vol", "put_volume", "pe volume"},
    "oi": {"oi", "open_interest", "open interest"},
    "iv": {"iv", "implied_volatility", "implied volatility"},
    "ltp": {"ltp", "last_price", "price", "last traded price"},
    "vol": {"vol", "volume"},
}


def _norm_name(c: str) -> str:
    return str(c).strip().lower()


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns={c: _norm_name(c) for c in df.columns})
    mapping = {}
    for col in df.columns:
        for canon, aliases in ALIASES.items():
            if col in aliases:
                mapping[col] = canon
                break
    df = df.rename(columns=mapping)
    if "date" not in df.columns:
        raise ValueError(f"no date column found; columns: {list(df.columns)}")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"])
    df["date"] = df["date"].dt.normalize()
    return df


def to_wide(df: pd.DataFrame) -> pd.DataFrame:
    """LONG (type CE/PE, one row per strike) -> WIDE (ce_*/pe_* columns)."""
    if "type" not in df.columns:
        return df
    t = df["type"].astype(str).str.upper().str.strip()
    ce = t.isin(["CE", "CALL", "C", "CALL_OPTION"])
    pe = t.isin(["PE", "PUT", "P", "PUT_OPTION"])
    out = df[ce & (df["oi"].notna() if "oi" in df.columns else ce)].copy()
    for src, dst in (("oi", "ce_oi"), ("iv", "ce_iv"), ("ltp", "ce_ltp"), ("vol", "ce_vol")):
        if src in out.columns and dst not in out.columns:
            out[dst] = out[src]
    out = out.drop(columns=[c for c in ("type", "oi", "iv", "ltp", "vol") if c in out.columns])
    out = out.drop(columns=[c for c in out.columns if out[c].isna().all()])
    # build wide by merging CE-side and PE-side frames on (date, [expiry,] strike)
    pe_df = df[pe].copy()
    for src, dst in (("oi", "pe_oi"), ("iv", "pe_iv"), ("ltp", "pe_ltp"), ("vol", "pe_vol")):
        if src in pe_df.columns and dst not in pe_df.columns:
            pe_df[dst] = pe_df[src]
    pe_df = pe_df.drop(columns=[c for c in ("type", "oi", "iv", "ltp", "vol") if c in pe_df.columns])
    if "strike" not in out.columns or "strike" not in pe_df.columns:
        raise ValueError("strike column required for wide format")
    ce_cols = [c for c in out.columns if c.startswith("ce_")]
    pe_cols = [c for c in pe_df.columns if c.startswith("pe_")]
    keys = ["date", "strike"] + (["expiry"] if "expiry" in out.columns and "expiry" in pe_df.columns else [])
    wide = out[keys + ce_cols].merge(pe_df[keys + pe_cols], on=keys, how="outer")
    return wide


def load_chain_csv(path: str | Path) -> pd.DataFrame:
    """Load + normalize a chain CSV (auto-detects long/wide, CSV vs NSE JSON)."""
    p = Path(path)
    if p.suffix == ".json":
        j = pd.read_json(p)
        rec = j["records"] if "records" in j else j
        df = pd.DataFrame(rec)
    else:
        df = pd.read_csv(p)
    df = normalize_columns(df)
    if "strike" in df.columns:
        df["strike"] = pd.to_numeric(df["strike"], errors="coerce")
    df = df.dropna(subset=["strike"])
    df = to_wide(df)
    for c in ("ce_oi", "pe_oi", "ce_iv", "pe_iv", "ce_ltp", "pe_ltp", "ce_vol", "pe_vol"):
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def daily_features(chain: pd.DataFrame, spot: pd.Series | None = None) -> pd.DataFrame:
    """One row per day for the ACTIVE expiry (max total OI that day)."""
    c = chain.copy()
    c["tot_oi"] = c.get("ce_oi", pd.Series(0, index=c.index)).fillna(0.0) \
                + c.get("pe_oi", pd.Series(0, index=c.index)).fillna(0.0)
    if "expiry" in c.columns:
        tot_by = c.groupby(["date", "expiry"])["tot_oi"].sum().reset_index()
        act = tot_by.loc[tot_by.groupby("date")["tot_oi"].idxmax(),
                         ["date", "expiry"]].set_index("date")["expiry"]
    else:
        act = None
    rows = []
    for d, g in c.groupby("date"):
        if act is not None:
            g = g[g["expiry"] == act[d]] if "expiry" in g.columns else g
        s_oi = g["strike"].astype(float)
        atm = s_oi.iloc[np.argmin((s_oi - g["strike"].mean()).abs().to_numpy())] \
            if len(g) else np.nan
        tot = g["tot_oi"].sum() or np.nan
        ce_tot = g["ce_oi"].sum() if "ce_oi" in g else np.nan
        pe_tot = g["pe_oi"].sum() if "pe_oi" in g else np.nan
        g_atm = g[(g["strike"] == atm)] if not np.isnan(atm) else g.head(1)
        r = {"date": d}
        r["pcr_oi"] = (pe_tot / ce_tot) if ce_tot and ce_tot > 0 else np.nan
        if "ce_vol" in g.columns and "pe_vol" in g.columns:
            cv, pv = g["ce_vol"].sum(), g["pe_vol"].sum()
            r["pcr_vol"] = (pv / cv) if cv and cv > 0 else np.nan
        if len(g_atm):
            r["oi_atm_net"] = ((g_atm["pe_oi"].fillna(0).sum() - g_atm["ce_oi"].fillna(0).sum()) / tot) if tot else np.nan
            r["iv_atm"] = ((g_atm["ce_iv"].fillna(0).sum() + g_atm["pe_iv"].fillna(0).sum()) / 2) if "ce_iv" in g_atm else np.nan
            r["prem_atm_c_pct"] = (g_atm["ce_ltp"].iloc[0] / spot.loc[d] * 100) \
                if "ce_ltp" in g_atm and spot is not None and d in spot.index else np.nan
        # skew: one strike above/below ATM
        up = g[g["strike"] > atm]
        lo = g[g["strike"] < atm]
        if len(up) and len(lo) and "ce_iv" in g.columns:
            u1 = up["strike"].idxmin()
            l1 = lo["strike"].idxmax()
            r["iv_skew_1"] = (g.loc[l1, "pe_iv"] - g.loc[u1, "ce_iv"]) \
                if pd.notna(g.loc[l1, "pe_iv"]) and pd.notna(g.loc[u1, "ce_iv"]) else np.nan
        r["oi_top3_share"] = g.nlargest(3, "tot_oi")["tot_oi"].sum() / tot if tot else np.nan
        rows.append(r)
    out = pd.DataFrame(rows).set_index("date").sort_index()
    if "iv_atm" in out.columns:
        out["iv_change_1d"] = out["iv_atm"].diff()
    return out


def selftest() -> None:
    """Synthetic 30-day chain: proves ingestion -> wide -> features works."""
    rng = np.random.default_rng(7)
    dates = pd.bdate_range("2024-01-01", periods=30)
    expiries = ["2024-01-05", "2024-01-12", "2024-02-09"]
    strikes = np.arange(21000, 25500, 100)
    rows = []
    for d in dates:
        for k, e in enumerate(expiries):
            w = 2.0 ** (-k) * (1 + 0.1 * rng.standard_normal())
            for s in strikes:
                ce_oi = 1e5 * w * np.exp(-((s - 23500) ** 2) / (2 * 400 ** 2)) * rng.uniform(0.8, 1.2)
                pe_oi = 1.1 * ce_oi * rng.uniform(0.9, 1.1)
                rows.append({"date": d, "expiry": e, "strike": s, "type": "CE",
                             "oi": ce_oi, "iv": 14 + 3 * np.cos(s / 1000),
                             "ltp": max(2.0, 23500 * 0.001 * np.exp(-abs(s - 23500) / 300)),
                             "volume": ce_oi * 0.3})
                rows.append({"date": d, "expiry": e, "strike": s, "type": "PE",
                             "oi": pe_oi, "iv": 14 + 3 * np.cos(s / 1000) + 1.5,  # put skew
                             "ltp": max(2.0, 23300 * 0.001 * np.exp(-abs(s - 23300) / 300)),
                             "volume": pe_oi * 0.3})
    long_df = pd.DataFrame(rows)
    p = CHAIN_DIR / "_selftest_chain.csv"
    CHAIN_DIR.mkdir(parents=True, exist_ok=True)
    long_df.to_csv(p, index=False)
    chain = load_chain_csv(p)
    feats = daily_features(chain)
    p.unlink()
    assert len(feats) == 30, f"expected 30 days, got {len(feats)}"
    assert feats["pcr_oi"].dropna().between(0.5, 3).all(), "pcr_oi out of range"
    assert feats["iv_atm"].dropna().between(10, 20).all(), "iv_atm out of range"
    assert feats["iv_skew_1"].dropna().mean() > 0, "skew sign wrong"
    print(f"selftest OK: {len(feats)} days x {feats.shape[1]} features")
    print(feats.round(3).tail(3).to_string())


if __name__ == "__main__":
    if len(sys.argv) > 1:
        ch = load_chain_csv(sys.argv[1])
        df = daily_features(ch)
        print(f"{ch['date'].min().date()} .. {ch['date'].max().date()}  "
              f"({ch['date'].nunique()} days, {ch['strike'].nunique()} strikes)")
        print(df.round(4).tail(10).to_string())
    else:
        selftest()
