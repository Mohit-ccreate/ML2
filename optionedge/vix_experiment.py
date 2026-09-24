"""Does the option chain's OWN data lift predictive skill?

India VIX is computed by NSE from the NIFTY 50 option chain itself (like the
US VIX from SPX options) — so it is the closest freely-available proxy for
the "IV from the chain" features the reference paper claims to use.

Experiment (walk-forward, expanding window, yearly test blocks — identical
protocol to optionedge/train.py run_alpha):
  base      = the 29 price features (current pipeline)
  base+vix  = + 6 India-VIX features (level, 1d change, 5d move, 60d z-score,
              1y percentile, VIX/realized-vol ratio)
Labels:
  alpha   = |5-day move| > 95% of IV-implied 5-day range  (straddle days)
  paper   = next-day return > +1%  (the reference paper's label)

Data: optionedge/data/chain/INDIAVIX.csv (2020-08-03 -> 2026-07-31).
"""
import time
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBClassifier

import optionedge.data as D

HERE = Path(__file__).resolve().parent
VIX_CSV = HERE / "data" / "chain" / "INDIAVIX.csv"


def load_vix() -> pd.Series:
    v = pd.read_csv(VIX_CSV, parse_dates=["date"]).set_index("date").sort_index()
    return v["close"]


def vix_features(vix: pd.Series, iv_proxy: pd.Series) -> pd.DataFrame:
    out = pd.DataFrame(index=vix.index)
    out["vix_close"] = vix
    out["vix_chg_1d"] = vix.diff()
    out["vix_ret_5d"] = vix / vix.shift(5) - 1.0
    m60, s60 = vix.rolling(60).mean(), vix.rolling(60).std()
    out["vix_z_60d"] = (vix - m60) / s60
    out["vix_pctile_252"] = vix.rolling(252, min_periods=60).rank(pct=True)
    out["vix_vs_realized"] = vix / (iv_proxy * 100.0) - 1.0
    return out


def walk_forward(dates: pd.DatetimeIndex, X: np.ndarray, y: np.ndarray, years) -> dict:
    """Expanding window, yearly test blocks (train.py protocol: min 400 tr / 40 te)."""
    records = []
    for yr in years:
        te_mask = np.array(dates.year == yr)
        tr_mask = np.array(dates.year < yr)
        if tr_mask.sum() < 400 or te_mask.sum() < 40:
            continue
        m = XGBClassifier(n_estimators=600, learning_rate=0.05, max_depth=4,
                          subsample=0.9, colsample_bytree=0.9, tree_method="hist",
                          random_state=42, n_jobs=-1, verbosity=0)
        m.fit(np.nan_to_num(X[tr_mask], nan=0.0), y[tr_mask])
        p_te = m.predict_proba(np.nan_to_num(X[te_mask], nan=0.0))[:, 1]
        records.append({"yr": yr, "te_idx": np.where(te_mask)[0], "p": p_te, "model": m})
    if not records:
        return {}
    te_idx = np.concatenate([r["te_idx"] for r in records])
    prob = np.concatenate([r["p"] for r in records])
    from sklearn.metrics import accuracy_score, roc_auc_score
    yt = y[te_idx]
    return {
        "n": len(te_idx),
        "period": f"{dates[te_idx[0]].date()} -> {dates[te_idx[-1]].date()}",
        "auc": round(float(roc_auc_score(yt, prob)), 4),
        "acc": round(float(accuracy_score(yt, (prob >= 0.5).astype(int))), 4),
        "base_rate": round(float(yt.mean()), 4),
        "per_year": {r["yr"]: round(float(roc_auc_score(y[r["te_idx"]], r["p"])), 4) for r in records},
        "model": records[-1]["model"],
    }


def main():
    t0 = time.time()
    ds = D.make_dataset()
    vix = load_vix()
    vix = vix[vix.index <= ds.index[-1]]
    vf = vix_features(vix, ds["iv_proxy"].reindex(vix.index))

    ret5 = ds["close"].shift(-5) / ds["close"] - 1.0
    y_alpha = (ret5.abs() > ds["iv_proxy"] * np.sqrt(5.0 / 252.0) * 0.95).to_numpy().astype(int)
    y_paper = ds["y_paper"].to_numpy().astype(int)

    vf_aligned = vf.reindex(ds.index)
    mask = vf_aligned["vix_close"].notna().to_numpy() & ret5.notna().to_numpy()
    ds_v = ds[mask]
    X_base = ds_v[D.FEATURES].to_numpy(dtype=float)
    X_vix = vf_aligned.loc[mask].to_numpy(dtype=float)
    dates = ds_v.index
    y_a, y_p = y_alpha[mask], y_paper[mask]
    years = list(range(int(dates[0].year) + 1, int(dates[-1].year) + 1))

    print(f"VIX {vix.index[0].date()} -> {vix.index[-1].date()}  |  experiment window {dates[0].date()} -> {dates[-1].date()} (n={len(dates)})")
    print(f"labels: alpha base rate {y_a.mean():.3f} | paper base rate {y_p.mean():.3f}\n")

    print("=" * 78)
    print("A) STRADDLE (vol-expansion) label — the project's real edge")
    r_base = walk_forward(dates, X_base, y_a, years)
    r_vix = walk_forward(dates, np.hstack([X_base, X_vix]), y_a, years)
    print(f"  {'':14} {'AUC':>7} {'acc':>7} {'base':>7}  {r_base['period']}  n={r_base['n']}")
    print(f"  {'base (29)':14} {r_base['auc']:>7.4f} {r_base['acc']:>7.4f} {r_base['base_rate']:>7.4f}")
    print(f"  {'base+VIX':14} {r_vix['auc']:>7.4f} {r_vix['acc']:>7.4f} {r_vix['base_rate']:>7.4f}")
    print(f"  per-year AUC base : {r_base['per_year']}")
    print(f"  per-year AUC vix  : {r_vix['per_year']}")
    imp = sorted(zip([D.FEATURES[i] if i < len(D.FEATURES) else f"vix_{i-len(D.FEATURES)}"
                      for i in range(len(D.FEATURES) + 6)],
                     r_vix["model"].feature_importances_), key=lambda t: -t[1])
    print("  top features (base+VIX model): " +
          ", ".join(f"{n}={v:.3f}" for n, v in imp[:8]))

    print("=" * 78)
    print("B) PAPER label (next-day > +1% => BUY) — the 'accuracy' question")
    r_base = walk_forward(dates, X_base, y_p, years)
    r_vix = walk_forward(dates, np.hstack([X_base, X_vix]), y_p, years)
    print(f"  {'':14} {'AUC':>7} {'acc':>7} {'base':>7}  {r_base['period']}  n={r_base['n']}")
    print(f"  {'base (29)':14} {r_base['auc']:>7.4f} {r_base['acc']:>7.4f} {r_base['base_rate']:>7.4f}")
    print(f"  {'base+VIX':14} {r_vix['auc']:>7.4f} {r_vix['acc']:>7.4f} {r_vix['base_rate']:>7.4f}")
    print(f"  per-year AUC base : {r_base['per_year']}")
    print(f"  per-year AUC vix  : {r_vix['per_year']}")

    print(f"\ndone in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
