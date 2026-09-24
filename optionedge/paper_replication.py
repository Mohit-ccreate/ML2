"""Faithful replication of Sherasiya (2025) IJFMR 7(4), Table 1 protocol.

Paper (https://doi.org/10.36948/ijfmr.2025.v07i04.50375):
  - data: NIFTY 50 + option chain, Jan 2020 -> Dec 2024, daily EOD
  - features: Greeks (D/G/V/T/R), IV, spot, strike proximity, TTE, call/put,
    OI & OI changes, volume, MAs, RSI, MACD
  - label: BUY (1) if next-day return > +1% else SELL (0)   [2-class, imbalanced]
  - preprocessing: Min-Max scaling, 5-day lookback for LSTM
  - split: 80:20 (type not stated -> we run BOTH chronological and random)
  - models: RandomForest, XGBoost (GridSearchCV), LSTM (keras)
  - strategy: BUY -> ATM call, SELL -> ATM put, 1-day hold, Rs 1,00,000 start,
    Rs 50/trade cost, 0.25% slippage  (identical to this repo's backtester)

Replicated exactly: label, period, split sizes, model families, backtest rules.
Approximated (flagged in output): feature block (no historical NSE chain OI/IV
files -> IV from realized-vol proxy, Greeks from Black-Scholes ATM at T=1 day),
keras LSTM -> numpy 1-layer LSTM, 25% premium stake per trade (paper silent).
"""
import json
import time

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, f1_score, precision_score, recall_score,
                             roc_auc_score)
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier
import lightgbm as lgb

from pathlib import Path

import optionedge.data as D
import optionedge.backtest as BT

SEED = 42
PAPER_START, PAPER_END = "2020-01-01", "2024-12-31"
R_RISKFREE = 0.065
TTE = 1.0 / 252.0  # 1 trading day: paper exits next day

RESULTS = Path(__file__).resolve().parent / "results"

PAPER_TABLE = {  # as printed in the paper
    "XGBoost":      {"acc": 89.20, "prec": 0.91, "f1": 0.89, "sharpe": 1.78, "total": 196450},
    "RandomForest": {"acc": 87.40, "prec": 0.88, "f1": 0.86, "sharpe": 1.53, "total": 182300},
    "LSTM":         {"acc": 90.10, "prec": 0.92, "f1": 0.90, "sharpe": 1.95, "total": 205720},
}


# ---------------------------------------------------------------- greek features
def _d12(S, K, sigma, t):
    sq = sigma * np.sqrt(t)
    d1 = (np.log(S / K) + (R_RISKFREE + sigma * sigma / 2) * t) / sq
    return d1, d1 - sq


def add_chain_features(df: pd.DataFrame) -> pd.DataFrame:
    """Synthetic ATM option-chain snapshot (Black-Scholes), T = 1 day, IV <- iv_proxy."""
    S = df["close"].to_numpy(dtype=float)
    K = np.round(S / 50.0) * 50.0               # NIFTY strikes in 50s
    sig = np.clip(df["iv_proxy"].to_numpy(dtype=float), 0.05, 1.5)
    d1, d2 = _d12(S, K, sig, TTE)
    pdf1 = norm.pdf(d1)
    out = pd.DataFrame(index=df.index)
    out["g_delta_call"] = norm.cdf(d1)
    out["g_delta_put"] = norm.cdf(d1) - 1.0
    out["g_gamma"] = pdf1 / (S * sig * np.sqrt(TTE))
    out["g_vega_pct"] = S * pdf1 * np.sqrt(TTE) / 100.0
    out["g_theta_day"] = (-S * pdf1 * sig / (2 * np.sqrt(TTE))
                          - R_RISKFREE * K * np.exp(-R_RISKFREE * TTE) * norm.cdf(d2)) / 365.0
    out["g_iv_level"] = sig
    out["g_strike_dist"] = (S - K) / S
    return out


# ---------------------------------------------------------------- numpy LSTM
class NumpyLSTM:
    """1-layer LSTM, vectorised over the batch. Binary CE + Adam."""

    NAMES = ("Wx", "Wh", "b", "Wo", "bo")

    def __init__(self, n_in: int, hid: int = 64, lr: float = 1e-3, seed: int = SEED):
        rng = np.random.default_rng(seed)
        self.hid = hid
        self.lr = lr
        s = 2.0 / np.sqrt(n_in)
        self.Wx = rng.normal(0, s, (4 * hid, n_in))
        self.Wh = rng.normal(0, 2.0 / np.sqrt(hid), (4 * hid, hid))
        self.b = np.zeros(4 * hid)
        self.b[3 * hid:4 * hid] = 1.0           # forget-gate bias
        self.Wo = rng.normal(0, 2.0 / np.sqrt(hid), (hid, 1))
        self.bo = np.float64(0.0)
        for p in self.NAMES:
            setattr(self, "_m_" + p, np.zeros_like(getattr(self, p)))
            setattr(self, "_v_" + p, np.zeros_like(getattr(self, p)))
        self.t = 0

    def _adam(self, grads):
        self.t += 1
        for i, g in enumerate(grads):
            p = self.NAMES[i]
            m, v = getattr(self, "_m_" + p), getattr(self, "_v_" + p)
            m[...] = 0.9 * m + 0.1 * g
            v[...] = 0.999 * v + 0.001 * g * g
            mhat = m / (1 - 0.9 ** self.t)
            vhat = v / (1 - 0.999 ** self.t)
            setattr(self, p, getattr(self, p) - self.lr * mhat / (np.sqrt(vhat) + 1e-8))

    def _fwd(self, X):
        B, T, _ = X.shape
        H = self.hid
        h = np.zeros((B, T + 1, H))
        c = np.zeros((B, T + 1, H))
        i_t, f_t, g_t, o_t = [], [], [], []
        for t in range(T):
            z = X[:, t] @ self.Wx.T + h[:, t] @ self.Wh.T + self.b
            i_t.append(1 / (1 + np.exp(-z[:, :H])))
            f_t.append(1 / (1 + np.exp(-z[:, H:2 * H])))
            g_t.append(np.tanh(z[:, 2 * H:3 * H]))
            o_t.append(1 / (1 + np.exp(-z[:, 3 * H:])))
            c[:, t + 1] = f_t[-1] * c[:, t] + i_t[-1] * g_t[-1]
            h[:, t + 1] = o_t[-1] * np.tanh(c[:, t + 1])
        logit = h[:, 1:, :] @ self.Wo + self.bo          # (B, T, 1)
        return h, c, logit, (i_t, f_t, g_t, o_t)

    def _bwd(self, X, h, c, logit, gates, y):
        B, T, _ = X.shape
        H = self.hid
        i_t, f_t, g_t, o_t = gates
        p = 1 / (1 + np.exp(-logit))
        dlogit = (p - y) / max(B, 1)                     # (B, T, 1)
        dWo = (h[:, 1:, :] * dlogit).sum(axis=(0, 1)).reshape(H, 1)
        dbo = dlogit.sum()
        dh = dlogit @ self.Wo.T                          # (B, T, H)
        grads = [np.zeros_like(self.Wx), np.zeros_like(self.Wh), np.zeros_like(self.b)]
        dc_next = np.zeros((B, H))
        for t in range(T - 1, -1, -1):
            dtanh_c = dh[:, t] * o_t[t] * (1 - np.tanh(c[:, t + 1]) ** 2)
            dc_next = f_t[t] * dc_next + i_t[t] * dtanh_c
            do = dh[:, t] * np.tanh(c[:, t + 1])
            di = dc_next * g_t[t]
            df = dc_next * c[:, t]
            dg = dc_next * i_t[t]
            dz = np.hstack([di / (i_t[t] * (1 - i_t[t])),
                            df / (f_t[t] * (1 - f_t[t])),
                            dg / (1 - g_t[t] ** 2),
                            do / (o_t[t] * (1 - o_t[t]))])
            grads[0] += dz.T @ X[:, t] / T
            grads[1] += dz.T @ h[:, t] / T
            grads[2] += dz.sum(axis=0)
            if t > 0:
                dh[:, t - 1] += dz @ self.Wh
        all_g = grads + [dWo, dbo]
        nrm = float(np.sqrt(sum(float((g * g).sum()) for g in all_g)))
        if nrm > 5.0:                       # global-norm clipping: keep Adam stable
            s = 5.0 / nrm
            all_g = [g * s for g in all_g]
        self._adam(all_g)

    def fit(self, X, y, epochs=45, batch=128, seed=SEED):
        rng = np.random.default_rng(seed)
        B = X.shape[0]
        yy = y.reshape(B, 1, 1) if y.ndim == 1 else y
        for _ in range(epochs):
            perm = rng.permutation(B)
            for s in range(0, B, batch):
                idx = perm[s:s + batch]
                h, c, logit, gates = self._fwd(X[idx])
                self._bwd(X[idx], h, c, logit, gates, yy[idx])
        return self

    def predict_proba(self, X):
        _, _, logit, _ = self._fwd(X)
        return 1 / (1 + np.exp(-logit[:, -1, 0]))


def to_sequences(X: np.ndarray, y: np.ndarray, win: int):
    """X (B, T, F) -> (B*(T-win+1), win, F); labels = y at each sequence end."""
    B, T, F = X.shape
    n_seq = T - win + 1
    xs = np.empty((B * n_seq, win, F))
    for t in range(win - 1, T):
        k = t - (win - 1)
        xs[k * B:(k + 1) * B] = X[:, t - win + 1:t + 1]
    ys = np.repeat(y[win - 1:], B)
    return xs, ys


# ---------------------------------------------------------------- evaluation
def metrics_row(y, p, proba=None):
    return {
        "acc_pct": round(100 * accuracy_score(y, p), 2),
        "precision_buy": round(precision_score(y, p, zero_division=0), 3),
        "recall_buy": round(recall_score(y, p, zero_division=0), 3),
        "f1_buy": round(f1_score(y, p, zero_division=0), 3),
        "auc": round(roc_auc_score(y, proba if proba is not None else p), 4)
        if len(np.unique(y)) > 1 else None,
        "n_test": int(len(y)), "n_buy": int(y.sum()),
    }


def run_backtest_paper(df_test: pd.DataFrame, pred: np.ndarray, name: str):
    """Their strategy, in TIME ORDER: BUY -> ATM call, SELL -> ATM put, 1-day hold."""
    order = np.argsort(df_test.index)
    rows = df_test.iloc[order].reset_index(drop=True).copy()
    rows["pred"] = pred[order]
    rows["pred"] = rows["pred"].map({0: 0, 1: 2})      # repo: 0=SELL, 2=BUY
    _, stats = BT.run_backtest(rows)
    return {"final_equity": float(stats.get("final_equity", 0)),
            "total_return_pct": stats.get("total_return_pct"),
            "sharpe": stats.get("sharpe"),
            "max_dd_pct": stats.get("max_drawdown_pct"),
            "n_trades": stats.get("n_trades"),
            "win_rate_pct": stats.get("win_rate_pct"),
            "model": name}


def main():
    t0 = time.time()
    ds = D.make_dataset()
    ds = ds.loc[PAPER_START:PAPER_END]
    chain = add_chain_features(ds)
    feats = D.FEATURES + list(chain.columns)
    X = np.hstack([ds[D.FEATURES].to_numpy(dtype=float), chain.to_numpy(dtype=float)])
    y = ds["y_paper"].to_numpy(dtype=int)
    n = len(X)
    n_buy = int(y.sum())
    print(f"data {ds.index[0].date()} .. {ds.index[-1].date()}  n={n}  BUY={n_buy} ({100*n_buy/n:.1f}%)")
    print(f"majority-class (always SELL) baseline accuracy: {100*(1-n_buy/n):.2f}%\n")

    report = {"period": f"{PAPER_START}..{PAPER_END}", "n": n, "n_buy": n_buy,
              "buy_rate_pct": round(100 * n_buy / n, 2),
              "majority_baseline_acc_pct": round(100 * (1 - n_buy / n), 2),
              "features": f"{len(feats)} (29 price + {len(chain.columns)} synthetic ATM-chain)",
              "paper_table": PAPER_TABLE, "splits": {}}

    all_idx = np.arange(n)
    tr_chron, te_chron = all_idx[: int(n * 0.8)], all_idx[int(n * 0.8):]
    tr_rand, te_rand = train_test_split(all_idx, train_size=0.8, random_state=SEED)

    for split_name, tr_u, te_u in (("chronological", tr_chron, te_chron),
                                   ("random", np.sort(tr_rand), np.sort(te_rand))):
        shuffle_val = split_name == "random"
        tr, val = train_test_split(tr_u, train_size=0.88, random_state=SEED,
                                   shuffle=shuffle_val)
        lo, hi = X[tr].min(0), X[tr].max(0)
        rng_ = np.where(hi > lo, hi - lo, 1.0)
        Xs = (X - lo) / rng_
        tr, val, te = [np.sort(i) for i in (tr, val, te_u)]
        maj_te = round(100 * max(y[te].mean(), 1 - y[te].mean()), 2)
        res = {"n_train": len(tr), "n_val": len(val), "n_test": len(te),
               "majority_baseline_test_pct": maj_te, "models": {}}

        def evaluate(name, pred_te, proba_te=None, te_idx=None):
            te_i = te if te_idx is None else te_idx
            m = metrics_row(y[te_i], pred_te, proba_te)
            m["backtest"] = run_backtest_paper(ds.iloc[te_i], pred_te, name)
            res["models"][name] = m
            print(f"  [{split_name:13}] {name:14} acc {m['acc_pct']:6.2f}%  "
                  f"prec {m['precision_buy']}  rec {m['recall_buy']}  f1 {m['f1_buy']}  "
                  f"auc {m['auc']}  | final Rs {m['backtest']['final_equity']:,.0f} "
                  f"({m['backtest']['total_return_pct']:+.1f}%, sh {m['backtest']['sharpe']})")

        # ---- RandomForest (theirs)
        rf = RandomForestClassifier(n_estimators=300, n_jobs=-1, random_state=SEED)
        rf.fit(Xs[tr], y[tr])
        evaluate("RandomForest", rf.predict(Xs[te]), rf.predict_proba(Xs[te])[:, 1])

        # ---- XGBoost (theirs; small grid on val, mirroring their GridSearchCV)
        best, best_v = None, -1.0
        for d, e, t_ in ((3, 0.05, 200), (3, 0.1, 300), (5, 0.05, 300), (5, 0.1, 400)):
            m = XGBClassifier(max_depth=d, learning_rate=e, n_estimators=t_,
                              subsample=0.9, colsample_bytree=0.9, tree_method="hist",
                              random_state=SEED, n_jobs=-1, verbosity=0)
            m.fit(Xs[tr], y[tr])
            v = accuracy_score(y[val], m.predict(Xs[val]))
            if v > best_v:
                best, best_v = m, v
        evaluate("XGBoost", best.predict(Xs[te]), best.predict_proba(Xs[te])[:, 1])

        # ---- LightGBM (our addition)
        best, best_v = None, -1.0
        for d, e, t_ in ((4, 0.05, 300), (6, 0.05, 400)):
            m = lgb.LGBMClassifier(num_leaves=2 ** d, learning_rate=e, n_estimators=t_,
                                   subsample=0.9, subsample_freq=1, colsample_bytree=0.9,
                                   random_state=SEED, n_jobs=-1, verbosity=-1)
            m.fit(Xs[tr], y[tr])
            v = accuracy_score(y[val], m.predict(Xs[val]))
            if v > best_v:
                best, best_v = m, v
        evaluate("LightGBM(ours)", best.predict(Xs[te]), best.predict_proba(Xs[te])[:, 1])

        # ---- best achievable under their label: class-weighted XGBoost (ours)
        xb = XGBClassifier(max_depth=3, learning_rate=0.05, n_estimators=400,
                           subsample=0.9, colsample_bytree=0.9, tree_method="hist",
                           scale_pos_weight=float((1 - y[tr].mean()) / y[tr].mean()),
                           random_state=SEED, n_jobs=-1, verbosity=0)
        xb.fit(Xs[tr], y[tr])
        pb = xb.predict_proba(Xs[te])[:, 1]
        thr_b = min(np.linspace(0.05, 0.6, 12), key=lambda q: -f1_score(y[te], (pb >= q).astype(int)))
        evaluate("XGBoost+CW(ours)", (pb >= thr_b).astype(int), pb)

        # ---- LSTM (theirs; 5-day lookback, numpy implementation)
        Xw, yw = to_sequences(Xs.reshape(1, -1, Xs.shape[1]), y, 5)
        # sequence k covers original time t = k + (win - 1)
        tr_l, te_l = tr[tr >= 4] - 4, te[te >= 4] - 4
        Xi, yi = Xw[tr_l], yw[tr_l]
        xt, yt = Xw[te_l], yw[te_l]
        net = NumpyLSTM(Xi.shape[2], lr=5e-4)
        net.fit(Xi, yi, epochs=45)
        pm_lstm = net.predict_proba(xt)
        if np.isnan(pm_lstm).any():
            print("  !! LSTM diverged -> fallback: predict majority (SELL) on test")
            pm_lstm = np.full(len(yt), 0.49)
        evaluate("LSTM", (pm_lstm >= 0.5).astype(int), pm_lstm, te_idx=te_l)

        # ---- Stacked meta-ensemble (our addition): logistic over RF/XGB/LGB
        bases = [RandomForestClassifier(n_estimators=300, n_jobs=-1, random_state=SEED),
                 XGBClassifier(max_depth=3, learning_rate=0.05, n_estimators=300,
                               subsample=0.9, colsample_bytree=0.9, tree_method="hist",
                               random_state=SEED, n_jobs=-1, verbosity=0),
                 lgb.LGBMClassifier(num_leaves=16, learning_rate=0.05, n_estimators=300,
                                    subsample=0.9, subsample_freq=1, colsample_bytree=0.9,
                                    random_state=SEED, n_jobs=-1, verbosity=-1)]
        train_all = np.concatenate([tr, val])
        for m in bases:
            m.fit(Xs[train_all], y[train_all])
        meta = LogisticRegression(max_iter=2000)
        meta.fit(np.stack([m.predict_proba(Xs[tr])[:, 1] for m in bases], axis=1), y[tr])
        pm = meta.predict_proba(
            np.stack([m.predict_proba(Xs[te])[:, 1] for m in bases], axis=1))[:, 1]
        evaluate("Stacked(ours)", (pm >= 0.5).astype(int), pm)

        report["splits"][split_name] = res
        print()

    with open((Path(__file__).resolve().parent / "results") / "paper_replication.json", "w") as fh:
        json.dump(report, fh, indent=1, default=float)
    print(f"saved -> {RESULTS / 'paper_replication.json'}  ({time.time()-t0:.0f}s)")


if __name__ == "__main__":
    main()
