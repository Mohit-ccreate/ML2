"""OptionEdge - full pipeline: features -> models -> walk-forward -> backtest -> state.json

Models
  * ViT (from scratch, PyTorch)   - consumes rendered 15-day candlestick charts
  * LSTM                           - 20-day feature sequences (paper's model)
  * XGBoost / RandomForest         - tabular ensembles (paper's models)
  * Ensemble stack                 - logistic stack of ViT+LSTM+XGBoost probabilities

Protocols (all leak-free, time-ordered, date-aligned)
  * in-sample        : refit on full history, score on full history
  * paper-style      : 80/20 *time* split (train on first 80%, test on last 20%)
  * walk-forward OOS : expanding window, one test block per year (2020..2026)

The stack ensemble is fitted, inside every protocol and every window, ONLY on
the member models' train-side probabilities and applied to the test side.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, f1_score, precision_score,
                             recall_score, roc_auc_score)
from xgboost import XGBClassifier

sys.path.insert(0, str(Path(__file__).parent))
from backtest import (INITIAL, STAKE_FRAC, atm_price, buy_and_hold, performance,  # noqa: E402
                      run_backtest, rsi_strategy)
from charts import (CACHE, IMG, chart_path_for, load_image, render_chart,  # noqa: E402
                    render_hero)
from data import (ALL_FEATURES, FEATURES, LABEL_THR, VIX_AVAILABLE,
                 load_raw, make_dataset)  # noqa: E402
from models_vit import LSTMModel, ViT  # noqa: E402

torch.set_num_threads(2)
np.random.seed(42)
torch.manual_seed(42)
warnings.filterwarnings("ignore")

HERE = Path(__file__).parent
RESULTS = HERE / "results"
DEVICE = "cpu"
SEQ = 20


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# --------------------------------------------------------------------------- #
def metrics_block(y3: np.ndarray, y_up: np.ndarray, proba: np.ndarray) -> dict:
    pred = proba.argmax(axis=1)
    p_up = proba[:, 2] + 0.5 * proba[:, 1]
    return {
        "acc_3c": round(float(accuracy_score(y3, pred)), 4),
        "macro_f1": round(float(f1_score(y3, pred, average="macro", zero_division=0)), 4),
        "macro_prec": round(float(precision_score(y3, pred, average="macro", zero_division=0)), 4),
        "macro_rec": round(float(recall_score(y3, pred, average="macro", zero_division=0)), 4),
        "acc_updown": round(float(accuracy_score((y_up > 0).astype(int), (p_up > 0.5).astype(int))), 4),
        "auc_updown": round(float(roc_auc_score(y_up, p_up)), 4) if len(np.unique(y_up)) > 1 else None,
        "base_rate_up": round(float((y_up > 0).mean()), 4),
    }


def oos_frame(proba: np.ndarray, rows: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({
        "p_sell": proba[:, 0], "p_hold": proba[:, 1], "p_buy": proba[:, 2],
        "pred": proba.argmax(axis=1),
        "close": rows["close"].values, "iv_proxy": rows["iv_proxy"].values,
        "rsi_14": rows["rsi_14"].values,
    }, index=rows.index)


# --------------------------------------------------------------------------- #
# torch training
# --------------------------------------------------------------------------- #
def class_weights(y: np.ndarray, cap: float = 1.6) -> torch.Tensor:
    w = 1.0 / np.bincount(y, minlength=3) / len(y)
    w = w / w.mean()
    return torch.tensor(np.minimum(w, cap), dtype=torch.float32)


def train_torch(model, Xtr: np.ndarray, ytr: np.ndarray, n_val: int,
                epochs: int, batch: int, lr: float,
                patience: int | None = 4) -> float:
    """patience=None -> no early stopping, keep final weights (in-sample capacity)."""
    model.train()
    n_val = min(n_val, max(30, len(ytr) // 8))
    dev_n = len(ytr) - n_val
    y_all = torch.tensor(ytr, dtype=torch.long, device=DEVICE)
    w = class_weights(ytr)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    best, best_sd, bad, t0 = np.inf, None, 0, time.time()
    for ep in range(epochs):
        idx = np.arange(dev_n)
        np.random.shuffle(idx)
        tot, cnt = 0.0, 0
        for s in range(0, len(idx), batch):
            b = idx[s:s + batch]
            xb = torch.tensor(Xtr[b], dtype=torch.float32, device=DEVICE)
            opt.zero_grad()
            loss = F.cross_entropy(model(xb), y_all[b], weight=w)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tot += loss.item() * len(b)
            cnt += len(b)
        model.eval()
        with torch.no_grad():
            xv = torch.tensor(Xtr[dev_n:], dtype=torch.float32, device=DEVICE)
            vloss = F.cross_entropy(model(xv), y_all[dev_n:], weight=w).item()
        for g in opt.param_groups:
            g["lr"] = lr * 0.5 * (1 + np.cos(np.pi * (ep + 1) / epochs))
        if patience is None:
            best = vloss  # track for logging only
        elif vloss < best - 1e-5:
            best, bad = vloss, 0
            best_sd = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
        if (ep + 1) % max(1, epochs // 5) == 0 or ep == 0:
            log(f"        epoch {ep + 1:3d}/{epochs}  train {tot / max(cnt, 1):.4f}  "
                f"val {vloss:.4f}  best {best:.4f}  ({time.time() - t0:.0f}s)")
        if patience is not None and bad >= patience:
            log(f"        early stop at epoch {ep + 1}")
            break
    if best_sd is not None:
        model.load_state_dict(best_sd)
    return best


def predict_torch(model, X: np.ndarray, batch: int = 256) -> np.ndarray:
    model.eval()
    out = []
    with torch.no_grad():
        for s in range(0, len(X), batch):
            xb = torch.tensor(X[s:s + batch], dtype=torch.float32, device=DEVICE)
            out.append(F.softmax(model(xb), dim=1).cpu().numpy())
    return np.vstack(out)


def metrics_bin(y: np.ndarray, prob: np.ndarray) -> dict:
    pred = (prob > 0.5).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum())
    pp = int((pred == 1).sum())
    return {
        "acc": round(float((pred == y).mean()), 4),
        "auc": round(float(roc_auc_score(y, prob)), 4) if len(np.unique(y)) > 1 else None,
        "precision": round(tp / pp, 4) if pp else None,
        "base_rate": round(float(y.mean()), 4),
    }


def seq_matrix(ds: pd.DataFrame, seq: int = SEQ) -> np.ndarray:
    X = ds[FEATURES].to_numpy(dtype=np.float32)
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    out = np.lib.stride_tricks.sliding_window_view(X, seq, axis=0)
    return out.transpose(0, 2, 1).copy()


# --------------------------------------------------------------------------- #
def _xgb_common(n_trees: int, metric: str) -> XGBClassifier:
    return XGBClassifier(n_estimators=n_trees, max_depth=5, learning_rate=0.05,
                         subsample=0.9, colsample_bytree=0.8, reg_lambda=1.0,
                         min_child_weight=3, tree_method="hist", n_jobs=2,
                         random_state=42, eval_metric=metric)


def xgb(n_trees: int) -> XGBClassifier:
    return _xgb_common(n_trees, "mlogloss")  # xgboost 3.x metric name


def xgb_bin(n_trees: int) -> XGBClassifier:
    """Binary-label variant (multi_logloss requires 3+ classes)."""
    return _xgb_common(n_trees, "logloss")


def fit_xgb_early(m: XGBClassifier, Xtr: np.ndarray, ytr: np.ndarray) -> None:
    """Time-ordered 15% tail validation with early stopping."""
    v = max(1, int(len(Xtr) * 0.15))
    m.set_params(early_stopping_rounds=40)
    m.fit(Xtr[:-v], ytr[:-v], eval_set=[(Xtr[-v:], ytr[-v:])], verbose=False)


def rf(n_trees: int) -> RandomForestClassifier:
    return RandomForestClassifier(n_estimators=n_trees, min_samples_leaf=2,
                                  n_jobs=2, random_state=42)


# --------------------------------------------------------------------------- #
# generic model runner - returns date-indexed probability records
# --------------------------------------------------------------------------- #
def run_model(name: str, ds: pd.DataFrame, X: np.ndarray, y: np.ndarray,
              make, fit_fn, predict_fn, wf_start: int, years: list[int]) -> dict:
    """fit_fn(model, Xtr, ytr, proto) / predict_fn(model, X) -> (n,3) probas.
    proto in {"insample","paper","wf"} lets torch models use protocol budgets.
    `ds`/`X`/`y` share the same row order and index (dates)."""
    n = len(ds)
    n_val = max(60, int(n * 0.12))
    Xf = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    Xf = Xf.astype(np.float32) if Xf.dtype != np.float32 else Xf
    y_up = ds["y_up"].to_numpy()
    t_model0 = time.time()
    res = {"name": name, "dates_full": ds.index}

    log(f"  {name}: in-sample fit (full history)")
    m = make()
    fit_fn(m, Xf, y, "insample")
    res["insample"] = {"model": m, "prob": predict_fn(m, Xf)}
    if hasattr(m, "n_params"):
        res["params"] = m.n_params()

    log(f"  {name}: paper-style 80/20 time split")
    cut = int(0.8 * n)
    m2 = make()
    fit_fn(m2, Xf[:cut], y[:cut], "paper")
    res["paper"] = {"cut": cut, "tr": predict_fn(m2, Xf[:cut]),
                    "te": predict_fn(m2, Xf[cut:])}

    log(f"  {name}: walk-forward (expanding window, yearly test blocks)")
    records = []
    for yr in years:
        te_mask = (ds.index.year == yr)
        tr_mask = (ds.index.year < yr)
        if tr_mask.sum() < 400 or te_mask.sum() < 40:
            log(f"    test {yr}: skipped (train={tr_mask.sum()})")
            continue
        t0 = time.time()
        m3 = make()
        fit_fn(m3, Xf[tr_mask], y[tr_mask], "wf")
        p_tr = predict_fn(m3, Xf[tr_mask])
        p_te = predict_fn(m3, Xf[te_mask])
        mm = metrics_block(y[te_mask], y_up[te_mask], p_te)
        log(f"    test {yr}: acc3c {mm['acc_3c']:.3f}  up/dn {mm['acc_updown']:.3f}  "
            f"auc {mm['auc_updown']}  (n={te_mask.sum()}, {time.time() - t0:.0f}s)")
        records.append({"yr": yr, "tr": pd.DataFrame(p_tr, index=ds.index[tr_mask],
                                                     columns=["p_sell", "p_hold", "p_buy"]),
                        "te": pd.DataFrame(p_te, index=ds.index[te_mask],
                                           columns=["p_sell", "p_hold", "p_buy"])})
    res["wf"] = records
    res["insample_sd"] = ({k: v.cpu().numpy() for k, v in m.state_dict().items()}
                          if isinstance(m, torch.nn.Module) else None)
    log(f"  {name} done in {(time.time() - t_model0) / 60:.1f} min")
    return res


def run_alpha(ds: pd.DataFrame, X: np.ndarray, y: np.ndarray, valid: np.ndarray,
              n_wf: int, wf_start: int, years: list[int]) -> dict:
    """Binary vol-expansion (long straddle) model, date-indexed records."""
    Xf = np.nan_to_num(X[valid], nan=0.0, posinf=0.0, neginf=0.0)
    yf = y[valid]
    dates = ds.index[valid]
    n = len(dates)
    res = {"dates_full": dates}

    log("  Alpha: in-sample fit (full history)")
    m = xgb_bin(600)
    m.fit(Xf, yf)
    prob = m.predict_proba(Xf)[:, 1]
    res["insample"] = metrics_bin(yf, prob)

    log("  Alpha: paper-style 80/20 time split")
    cut = int(0.8 * n)
    m2 = xgb_bin(400)
    fit_xgb_early(m2, Xf[:cut], yf[:cut])
    res["paper"] = {"cut": cut, "metrics": metrics_bin(yf[cut:], m2.predict_proba(Xf[cut:])[:, 1])}

    log("  Alpha: walk-forward (expanding window, yearly test blocks)")
    records = []
    for yr in years:
        te_mask = (dates.year == yr)
        tr_mask = (dates.year < yr)
        if tr_mask.sum() < 400 or te_mask.sum() < 40:
            continue
        t0 = time.time()
        m3 = xgb_bin(n_wf)
        m3.fit(Xf[tr_mask], yf[tr_mask])
        p_tr = m3.predict_proba(Xf[tr_mask])[:, 1]
        p_te = m3.predict_proba(Xf[te_mask])[:, 1]
        mm = metrics_bin(yf[te_mask], p_te)
        log(f"    test {yr}: acc {mm['acc']:.3f}  auc {mm['auc']:.3f}  "
            f"prec {mm['precision']}  base {mm['base_rate']:.3f} (n={te_mask.sum()}, {time.time() - t0:.0f}s)")
        records.append({"yr": yr,
                        "tr_dates": dates[tr_mask], "tr": p_tr,
                        "te_dates": dates[te_mask], "te": p_te})
    res["wf"] = records
    te_d = pd.DatetimeIndex(np.concatenate([r["te_dates"] for r in records]))
    te_p = np.concatenate([r["te"] for r in records])
    y_te = pd.Series(y, index=ds.index).reindex(te_d).to_numpy()
    res["wf_oos"] = metrics_bin(y_te, te_p)
    res["wf_pred"] = pd.Series(te_p, index=te_d)
    return res


# --------------------------------------------------------------------------- #
# ensemble (date-aligned logistic stack)
# --------------------------------------------------------------------------- #
def build_ensemble(ds: pd.DataFrame, members: dict, y: pd.Series) -> dict:
    names = list(members.keys())
    df_key = {"insample": "insample_df", "paper": "paper_df"}

    def hstack_df(dates, kind) -> np.ndarray:
        Zs = []
        for k in names:
            df = members[k][df_key[kind]].reindex(dates)
            Zs.append(df[["p_sell", "p_hold", "p_buy"]].to_numpy())
        return np.hstack(Zs)

    def hstack_recs(dates, side: str) -> np.ndarray:
        """meta-features from each member's *window* model (no leak)."""
        Zs = [members[k]["wf_by_yr"][yr][side].reindex(dates)[
            ["p_sell", "p_hold", "p_buy"]].to_numpy() for k in names]
        return np.hstack(Zs)

    # in-sample: meta-features of each member's full-history model;
    # stack fitted on a 90% date prefix (in-sample protocol by definition)
    common = members[names[0]]["dates_full"]
    for k in names[1:]:
        common = common.intersection(members[k]["dates_full"])
    common = common.sort_values()
    clf = (LogisticRegression(max_iter=3000, C=1.0)
           .fit(hstack_df(common[:int(0.9 * len(common))], "insample"),
                y.loc[common[:int(0.9 * len(common))]].to_numpy()))
    prob_all = clf.predict_proba(hstack_df(common, "insample"))
    yy = y.loc[common].to_numpy()
    m_ins = metrics_block(yy, ds["y_up"].reindex(common).to_numpy(), prob_all)

    # paper-style: each member's OWN 80/20 model, common date sets
    # (dates taken from each member's paper_df index so offsets align)
    tr_dates = te_dates = None
    for k in names:
        cut = members[k]["paper_cut"]
        idx = members[k]["paper_df"].index
        tr_d = idx[:cut]
        te_d = idx[cut:]
        tr_dates = tr_d if tr_dates is None else tr_dates.intersection(tr_d)
        te_dates = te_d if te_dates is None else te_dates.intersection(te_d)
    Ztr = hstack_df(tr_dates, "paper")
    Zte = hstack_df(te_dates, "paper")
    clf2 = LogisticRegression(max_iter=3000, C=1.0).fit(Ztr, y.loc[tr_dates].to_numpy())
    prob_paper = clf2.predict_proba(Zte)
    m_paper = metrics_block(y.loc[te_dates].to_numpy(),
                            ds["y_up"].reindex(te_dates).to_numpy(), prob_paper)

    # walk-forward: per year, fit the stack on that window's TRAIN-side
    # meta-features of the members' window models, apply to the test side
    yr_list = [r["yr"] for r in members[names[0]]["wf"]]
    wf_probs = []
    for yr in yr_list:
        tr_d, te_d = None, None
        for k in names:
            rec = members[k]["wf_by_yr"][yr]
            tr_d = rec["tr"].index if tr_d is None else tr_d.intersection(rec["tr"].index)
            te_d = rec["te"].index if te_d is None else te_d.intersection(rec["te"].index)
        Ztr = hstack_recs(tr_d, "tr")
        Zte = hstack_recs(te_d, "te")
        c3 = LogisticRegression(max_iter=3000, C=1.0).fit(Ztr, y.loc[tr_d].to_numpy())
        p_te = c3.predict_proba(Zte)
        wf_probs.append(pd.DataFrame(p_te, index=te_d, columns=["p_sell", "p_hold", "p_buy"]))
        mm = metrics_block(y.loc[te_d].to_numpy(), ds["y_up"].reindex(te_d).to_numpy(), p_te)
        log(f"    ens test {yr}: acc3c {mm['acc_3c']:.3f}  up/dn {mm['acc_updown']:.3f} "
            f"auc {mm['auc_updown']} (n={len(te_d)})")
    wf_p = pd.concat(wf_probs).sort_index()
    m_wf = metrics_block(y.loc[wf_p.index].to_numpy(),
                         ds["y_up"].reindex(wf_p.index).to_numpy(), wf_p.to_numpy())
    log(f"    ENSEMBLE walk-forward OOS: acc3c {m_wf['acc_3c']:.3f}  "
        f"up/dn {m_wf['acc_updown']:.3f}  auc {m_wf['auc_updown']}")
    rows = ds.loc[wf_p.index]
    return {"insample": m_ins, "paper": m_paper, "wf": m_wf,
            "wf_oos": oos_frame(wf_p.to_numpy(), rows),
            "insample_dates": common, "insample_prob": prob_all}


# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fast", action="store_true", help="reduced runs for smoke tests")
    args = ap.parse_args()

    RESULTS.mkdir(exist_ok=True)
    CACHE.mkdir(exist_ok=True)
    t_start = time.time()
    log("=== OptionEdge pipeline start " + ("(FAST)" if args.fast else "(FULL)") + " ===")

    ds = make_dataset()
    raw = load_raw()
    pos = np.searchsorted(raw.index.values, ds.index.values)
    X = ds[ALL_FEATURES].to_numpy(dtype=float)
    y = ds["y3"].to_numpy(dtype=int)
    y_s = pd.Series(y, index=ds.index)
    n = len(ds)
    bc = np.bincount(y) / n
    log(f"dataset: {n} rows  {ds.index[0].date()} -> {ds.index[-1].date()}  "
        f"{len(ALL_FEATURES)} features"
        + (f" (incl. {len(ALL_FEATURES) - len(FEATURES)} India-VIX)" if VIX_AVAILABLE else " [no VIX data]")
        + f" | balance S/H/B {bc}")

    # ---------------- charts ----------------
    missing = [k for k in range(n) if not chart_path_for(ds.index[k]).exists()]
    if missing:
        log(f"rendering {len(missing)} chart images ({IMG}x{IMG})...")
        t0 = time.time()
        for j, k in enumerate(missing):
            render_chart(raw, int(pos[k]), chart_path_for(ds.index[k]))
            if (j + 1) % 500 == 0:
                log(f"    {j + 1}/{len(missing)}  ({time.time() - t0:.0f}s)")
        log(f"charts done in {time.time() - t0:.0f}s")
    X_img = np.stack([load_image(chart_path_for(ds.index[k])) for k in range(n)])
    # per-image z-score: charts are thin neon lines on a dark background -
    # standardising per image amplifies the price-action signal 10x+
    mu = X_img.mean(axis=(2, 3), keepdims=True)
    sd = X_img.std(axis=(2, 3), keepdims=True) + 1e-3
    X_img = ((X_img - mu) / sd).astype(np.float32)
    log(f"images in RAM: {X_img.shape} ({X_img.nbytes / 1e6:.0f} MB, z-scored)")

    fast = args.fast
    xgb_wf = 120 if fast else 300
    rf_wf = 120 if fast else 300
    vit_dim = 192 if fast else 192   # must be divisible by heads (6)
    vit_depth = 3 if fast else 4
    lstm_hid = 64 if fast else 96
    wf_year0 = 2024 if fast else 2020
    wf_start = int(np.searchsorted(ds.index.year.values, wf_year0))
    years = sorted(set(ds.index.year.tolist()[wf_start:]))
    log(f"walk-forward test years: {years}")

    # ---------------- fit helpers ----------------
    n_val_full = max(60, int(n * 0.12))
    # protocol budgets: in-sample = memorisation capacity (paper's style),
    # walk-forward = honest OOS (extra fitting buys nothing, only time)
    vit_budget = {"insample": (40 if not fast else 12, None),  # no early stop: capacity protocol
                  "paper": (24 if not fast else 8, 4),
                  "wf": (16 if not fast else 6, 4)}
    lstm_budget = {"insample": (20 if not fast else 6, 4),
                   "paper": (16 if not fast else 4, 4),
                   "wf": (12 if not fast else 4, 4)}

    def fit_vit(m, Xtr, ytr, proto="insample"):
        ep, pat = vit_budget[proto]
        train_torch(m, Xtr, ytr, n_val_full, ep, 128, 2e-3, patience=pat)

    def fit_lstm(m, Xtr, ytr, proto="insample"):
        ep, pat = lstm_budget[proto]
        train_torch(m, Xtr, ytr, n_val_full, ep, 64, 1e-3, patience=pat)

    def fit_xg(m, Xtr, ytr, proto="insample"):
        m.fit(Xtr, ytr)

    def fit_rf(m, Xtr, ytr, proto="insample"):
        m.fit(Xtr, ytr)

    # ---------------- models ----------------
    def vit_model():
        return ViT(dim=vit_dim, depth=vit_depth, heads=6).to(DEVICE)

    def lstm_model():
        return LSTMModel(len(FEATURES), SEQ, hid=lstm_hid).to(DEVICE)

    log("--- ViT (Vision Transformer, from scratch, PyTorch) ---")
    vit = run_model("ViT", ds, X_img, y, vit_model, fit_vit,
                    lambda m, Xa: predict_torch(m, Xa), wf_start, years)

    X_seq = seq_matrix(ds)
    ds_seq = ds.iloc[SEQ - 1:]
    y_seq = (ds["y3"].to_numpy()[SEQ - 1:])
    X_seq_aligned = X_seq

    log("--- LSTM (20-day feature sequences) ---")
    lstm = run_model("LSTM", ds_seq, X_seq_aligned, y_seq, lstm_model, fit_lstm,
                     lambda m, Xa: predict_torch(m, Xa), wf_start, years)

    log("--- XGBoost ---")
    xg = run_model("XGBoost", ds, X, y,
                   lambda: xgb(xgb_wf), fit_xg,
                   lambda m, Xa: m.predict_proba(Xa), wf_start, years)

    log("--- RandomForest ---")
    rfm = run_model("RandomForest", ds, X, y,
                    lambda: rf(rf_wf), fit_rf,
                    lambda m, Xa: m.predict_proba(Xa), wf_start, years)

    # ---------------- ensemble ----------------
    log("--- Ensemble (logistic stack of ViT + LSTM + XGBoost) ---")
    vit_fit = vit["insample"]["model"]
    lstm_fit = lstm["insample"]["model"]
    # give each member a date-indexed meta-feature set for the ensemble protocols
    for src in (vit, lstm, xg, rfm):
        src["paper_cut"] = int(0.8 * len(src["dates_full"]))
        src["wf_by_yr"] = {r["yr"]: r for r in src["wf"]}
        src["insample_df"] = pd.DataFrame(src["insample"]["prob"], index=src["dates_full"],
                                          columns=["p_sell", "p_hold", "p_buy"])
        src["paper_df"] = pd.concat([
            pd.DataFrame(src["paper"]["tr"], index=src["dates_full"][:src["paper_cut"]],
                         columns=["p_sell", "p_hold", "p_buy"]),
            pd.DataFrame(src["paper"]["te"],
                         index=src["dates_full"][src["paper_cut"]:],
                         columns=["p_sell", "p_hold", "p_buy"])])
    # NOTE: the ensemble's paper + walk-forward protocols use each member's own
    # protocol/window models (train-side meta-features only). The in-sample
    # protocol uses the members' full-history models, by definition.
    ens = build_ensemble(ds, {"ViT": vit, "LSTM": lstm, "XGBoost": xg}, y_s)

    # ---------------- summary table ----------------
    log("=== summary (acc3c = 3-class acc, ud = up/down acc) ===")
    for nm, src in (("ViT", vit), ("LSTM", lstm), ("XGBoost", xg), ("RandomForest", rfm)):
        dates = src["dates_full"]
        prob = src["insample_df"].to_numpy()
        m_i = metrics_block(y_s.loc[dates].to_numpy(), ds["y_up"].reindex(dates).to_numpy(), prob)
        cut = src["paper_cut"]
        m_p = metrics_block(y_s.loc[dates[cut:]].to_numpy(),
                            ds["y_up"].reindex(dates[cut:]).to_numpy(),
                            src["paper_df"].iloc[cut:].to_numpy())
        te_d = pd.DatetimeIndex(np.concatenate([r["te"].index for r in src["wf"]])).sort_values()
        te_p = pd.concat([r["te"] for r in src["wf"]]).reindex(te_d).to_numpy()
        m_w = metrics_block(y_s.loc[te_d].to_numpy(), ds["y_up"].reindex(te_d).to_numpy(), te_p)
        log(f"  {nm:12s} insample acc {m_i['acc_3c']:.3f} f1 {m_i['macro_f1']:.3f} | "
            f"paper acc {m_p['acc_3c']:.3f} | wf acc {m_w['acc_3c']:.3f} ud {m_w['acc_updown']:.3f}")
    log(f"  {'Ensemble':12s} insample acc {ens['insample']['acc_3c']:.3f} "
        f"f1 {ens['insample']['macro_f1']:.3f} | paper acc {ens['paper']['acc_3c']:.3f} | "
        f"wf acc {ens['wf']['acc_3c']:.3f} ud {ens['wf']['acc_updown']:.3f}")

    # ---------------- paper label check ----------------
    log("--- label-design check (paper's 'next-day > +1% => BUY else SELL') ---")
    y_paper = ds["y_paper"].to_numpy().astype(int)
    cut = int(0.8 * n)
    mp = xgb_bin(300)  # paper's label is binary (BUY/SELL)
    fit_xgb_early(mp, X[:cut], y_paper[:cut])
    acc_paper = float(accuracy_score(y_paper[cut:], mp.predict(X[cut:])))
    maj = float(max((y_paper > 0).mean(), (y_paper < 1).mean()))
    log(f"    paper-label acc (80/20 time split): {acc_paper:.3f} | majority baseline: {maj:.3f}")

    # ---------------- backtests ----------------
    log("--- backtests on walk-forward OOS (Black-Scholes ATM options) ---")
    oos_dates = ens["wf_oos"].index
    bt, eq = {}, {}

    def frame_for(src):
        te_d = pd.DatetimeIndex(np.concatenate([r["te"].index for r in src["wf"]])).sort_values()
        te_p = pd.concat([r["te"] for r in src["wf"]]).reindex(te_d)
        return oos_frame(te_p.to_numpy(), ds.loc[te_d])

    for nm, fr in (("Ensemble", ens["wf_oos"]), ("ViT", frame_for(vit)),
                   ("LSTM", frame_for(lstm)), ("XGBoost", frame_for(xg)),
                   ("RandomForest", frame_for(rfm))):
        fr = fr.reindex(oos_dates)
        e, s = run_backtest(fr)
        bt[nm] = s
        eq[nm] = list(zip(e.index.strftime("%Y-%m-%d").tolist(), e.round(0).tolist()))
        log(f"    {nm:13s} final Rs{e.iloc[-1]:>12,.0f}  ret {s['total_return_pct']:>7.2f}%  "
            f"sharpe {s['sharpe']:>5.2f}  mdd {s['max_drawdown_pct']:>6.2f}%  "
            f"win {s['win_rate_pct']:>5.1f}%  trades {s['n_trades']}")
    bh = buy_and_hold(ds.loc[oos_dates])
    rsi_eq = rsi_strategy(ds.loc[oos_dates], ds.loc[oos_dates, "iv_proxy"])
    eq["Buy&Hold NIFTY"] = list(zip(oos_dates.strftime("%Y-%m-%d").tolist(), bh.round(0).tolist()))
    eq["RSI momentum"] = list(zip(oos_dates.strftime("%Y-%m-%d").tolist(), rsi_eq.round(0).tolist()))
    bt["Buy&Hold NIFTY"] = performance(bh)
    bt["RSI momentum"] = performance(rsi_eq)
    for nm in ("Buy&Hold NIFTY", "RSI momentum"):
        s = bt[nm]
        log(f"    {nm:13s} final Rs{s['final_equity']:>12,.0f}  ret {s['total_return_pct']:>7.2f}%  "
            f"sharpe {s['sharpe']:>5.2f}  mdd {s['max_drawdown_pct']:>6.2f}%")

    # ---------------- OptionEdge Alpha: vol-expansion straddle ----------------
    log("--- OptionEdge Alpha: vol-expansion long-straddle model ---")
    from backtest import STRADDLE_HOLD, run_straddle_backtest

    ret5 = ds["close"].shift(-5) / ds["close"] - 1.0
    y_alpha = ((ret5.abs() > ds["iv_proxy"] * np.sqrt(5.0 / 252.0) * 0.95).astype(int))
    alpha_valid = (np.arange(n) <= n - 6) & y_alpha.notna().to_numpy()
    alpha_years = [yr for yr in years]
    alpha = run_alpha(ds, X, y_alpha.to_numpy(), alpha_valid, xgb_wf, wf_start, alpha_years)

    # OOS backtest frame: from first OOS date to last exitable day
    oos_start = alpha["wf_pred"].index[0]
    bt_rows = ds.loc[oos_start: ds.index[n - 6]]
    aprob = alpha["wf_pred"].reindex(bt_rows.index).fillna(0.0)
    pred_full = (aprob > 0.5).to_numpy().astype(int)
    FIXED_STAKE = INITIAL * 0.10   # Rs 10,000 of premium per straddle (realistic retail)

    eq_a, st_a = run_straddle_backtest(bt_rows, pred_full, fixed_stake=FIXED_STAKE)
    log(f"    Alpha straddle: final Rs{eq_a.iloc[-1]:,.0f}  ret {st_a['total_return_pct']:.2f}%  "
        f"sharpe {st_a['sharpe']:.2f}  mdd {st_a['max_drawdown_pct']:.2f}%  "
        f"win {st_a['win_rate_pct']:.1f}%  trades {st_a['n_trades']}")

    # baselines over the same period
    eq_b, st_b = run_straddle_backtest(bt_rows, np.ones(len(bt_rows), dtype=int),
                                       fixed_stake=FIXED_STAKE)
    rule_iv_med = (ds["iv_proxy"] < ds["iv_proxy"].rolling(252).median()).fillna(False).astype(int)
    pred_rule = rule_iv_med.reindex(bt_rows.index).fillna(0).to_numpy().astype(int)
    eq_r, st_r = run_straddle_backtest(bt_rows, pred_rule, fixed_stake=FIXED_STAKE)
    bh_a = buy_and_hold(bt_rows)
    for nm, s in (("Straddle every 5d", st_b), ("Rule IV<1yr-med", st_r),
                  ("Buy&Hold (same period)", performance(bh_a))):
        log(f"    {nm:22s} final Rs{s['final_equity']:>12,.0f}  ret {s['total_return_pct']:>7.2f}%  "
            f"sharpe {s['sharpe']:>5.2f}")

    alpha_equity = {
        "Alpha straddle": list(zip(eq_a.index.strftime("%Y-%m-%d").tolist(), eq_a.round(0).tolist())),
        "Straddle every 5d": list(zip(eq_b.index.strftime("%Y-%m-%d").tolist(), eq_b.round(0).tolist())),
        "IV-median rule": list(zip(eq_r.index.strftime("%Y-%m-%d").tolist(), eq_r.round(0).tolist())),
        "Buy&Hold (same period)": list(zip(bt_rows.index.strftime("%Y-%m-%d").tolist(),
                                          bh_a.round(0).tolist())),
    }

    # per-trade details for the alpha (most recent 60)
    close_a = bt_rows["close"].to_numpy()
    iv_a = bt_rows["iv_proxy"].to_numpy()
    from backtest import strike_of, bs_atm
    a_trades = []
    i = 0
    while i < len(bt_rows) - STRADDLE_HOLD:
        if pred_full[i] == 1:
            K = strike_of(close_a[i])
            T0 = STRADDLE_HOLD / 252.0
            c0 = bs_atm(close_a[i], K, iv_a[i], T0, "c") * 1.0025
            p0 = bs_atm(close_a[i], K, iv_a[i], T0, "p") * 1.0025
            c1 = max(close_a[i + STRADDLE_HOLD] - K, 0.0) * 0.9975
            p1 = max(K - close_a[i + STRADDLE_HOLD], 0.0) * 0.9975
            prem0, prem1 = c0 + p0, c1 + p1
            a_trades.append({
                "d": str(bt_rows.index[i].date()),
                "close": round(float(close_a[i]), 0),
                "prob": round(float(aprob.iloc[i]), 3),
                "prem_in": round(float(prem0), 1), "prem_out": round(float(prem1), 1),
                "ret_pct": round((prem1 / prem0 - 1) * 100, 1),
            })
            i += STRADDLE_HOLD
        else:
            i += 1

    state_alpha = {
        "label": "next-5-day |move| > 95% of IV-implied 5-day range  =>  long ATM straddle (vol-expansion day)",
        "hold_days": STRADDLE_HOLD,
        "stake": f"fixed Rs {FIXED_STAKE:,.0f} of premium per straddle (10% of initial capital)",
        "in-sample": alpha["insample"], "paper-style": alpha["paper"]["metrics"],
        "walk-forward OOS": alpha["wf_oos"],
        "per_year": [
            {"year": r["yr"], **metrics_bin(
                pd.Series(y_alpha.to_numpy(), index=ds.index).reindex(r["te_dates"]).to_numpy(),
                r["te"])} for r in alpha["wf"]],
        "backtest": st_a,
        "baselines": {"Straddle every 5d": st_b, "IV-median rule": st_r,
                      "Buy&Hold (same period)": performance(bh_a)},
        "equity": alpha_equity,
        "trades": a_trades[-60:],
        "period": f"{str(bt_rows.index[0].date())} to {str(bt_rows.index[-1].date())}",
    }

    # per-trade list (ensemble OOS)
    fr = ens["wf_oos"]
    close = fr["close"].to_numpy()
    iv = fr["iv_proxy"].to_numpy()
    trades = []
    for i in range(len(fr) - 1):
        s = int(fr["pred"].iloc[i])
        if s in (0, 2):
            kind = "c" if s == 2 else "p"
            p0 = atm_price(close, iv, i, kind) * 1.0025
            p1 = atm_price(close, iv, i + 1, kind) * 0.9975
            trades.append({
                "d": str(fr.index[i].date()), "close": round(float(close[i]), 0),
                "p_sell": round(float(fr["p_sell"].iloc[i]), 3),
                "p_hold": round(float(fr["p_hold"].iloc[i]), 3),
                "p_buy": round(float(fr["p_buy"].iloc[i]), 3),
                "signal": ["SELL", "HOLD", "BUY"][s],
                "opt": "ATM Call" if s == 2 else "ATM Put",
                "entry": round(float(p0), 1), "exit": round(float(p1), 1),
                "ret_pct": round((p1 / p0 - 1) * 100, 1),
            })
    trades = trades[-120:]

    # ---------------- attention + hero ----------------
    log("--- attention map + hero chart ---")
    hero_png = RESULTS / "hero.png"
    hero_k = n - 1
    vit_fit.eval()
    with torch.no_grad():
        for k in range(n - 1, max(n - 30, 0), -1):
            pk = F.softmax(vit_fit(torch.tensor(X_img[k:k + 1], dtype=torch.float32)), dim=1)
            if int(pk.argmax()) in (0, 2):
                hero_k = k
                break
    render_hero(raw, int(pos[hero_k]), hero_png)
    with torch.no_grad():
        xt = torch.tensor(X_img[hero_k:hero_k + 1], dtype=torch.float32)
        attn = vit_fit.cls_attention(xt)
        p_hero = F.softmax(vit_fit(xt), dim=1).numpy()
    sig_hero = ["SELL", "HOLD", "BUY"][int(p_hero.argmax())]
    log(f"    hero {ds.index[hero_k].date()}  signal={sig_hero}  probs={np.round(p_hero[0], 3)}")

    # ---------------- monthly P&L ----------------
    eqs = pd.Series([v for _, v in eq["Ensemble"]],
                    index=pd.to_datetime([d for d, _ in eq["Ensemble"]]))
    monthly = []
    for (_yr, mo), grp in eqs.groupby([eqs.index.year, eqs.index.month]):
        monthly.append([int(mo), round(float(grp.iloc[-1] / grp.iloc[0] - 1) * 100, 1)])

    # ---------------- ticker ----------------
    ticker = []
    for k in range(n - 1, n - 7, -1):
        ticker.append({
            "d": str(ds.index[k].date()), "close": f"{ds['close'].iloc[k]:,.0f}",
            "ret": f"{ds['next_ret'].iloc[k - 1] * 100:+.2f}%",
            "iv": f"{ds['iv_proxy'].iloc[k] * 100:.1f}%",
            "rsi": f"{ds['rsi_14'].iloc[k]:.0f}",
            "vol21": f"{ds['vol_21'].iloc[k] * 100:.0f}%",
        })
    ticker.reverse()

    # ---------------- save ----------------
    log("--- saving models + state.json ---")
    torch.save(vit["insample_sd"], RESULTS / "vit_insample.pt")
    torch.save({k: v.cpu().numpy() for k, v in
                lstm["insample"]["model"].state_dict().items()}, RESULTS / "lstm_insample.pt")

    def proto(src):
        dates = src["dates_full"]
        m_i = metrics_block(y_s.loc[dates].to_numpy(), ds["y_up"].reindex(dates).to_numpy(),
                            src["insample_df"].to_numpy())
        cut = src["paper_cut"]
        m_p = metrics_block(y_s.loc[dates[cut:]].to_numpy(),
                            ds["y_up"].reindex(dates[cut:]).to_numpy(),
                            src["paper_df"].iloc[cut:].to_numpy())
        te_d = pd.DatetimeIndex(np.concatenate([r["te"].index for r in src["wf"]])).sort_values()
        te_p = pd.concat([r["te"] for r in src["wf"]]).reindex(te_d).to_numpy()
        m_w = metrics_block(y_s.loc[te_d].to_numpy(), ds["y_up"].reindex(te_d).to_numpy(), te_p)
        return {"in-sample": m_i, "paper-style": m_p, "walk-forward OOS": m_w,
                "per_year": [
                    {"year": r["yr"], **metrics_block(
                        y_s.loc[r["te"].index].to_numpy(),
                        ds["y_up"].reindex(r["te"].index).to_numpy(), r["te"].to_numpy())}
                    for r in src["wf"]]}

    paper_models = {
        "XGBoost": {"acc": 89.2, "prec": 0.91, "f1": 0.89, "sharpe": 1.78, "return_inr": 196450},
        "RandomForest": {"acc": 87.4, "prec": 0.88, "f1": 0.86, "sharpe": 1.53, "return_inr": 182300},
        "LSTM": {"acc": 90.1, "prec": 0.92, "f1": 0.90, "sharpe": 1.95, "return_inr": 205720},
    }

    state = {
        "generated": time.strftime("%Y-%m-%d %H:%M"),
        "meta": {
            "data_from": str(ds.index[0].date()), "data_to": str(ds.index[-1].date()),
            "n_samples": int(n), "n_features": len(ALL_FEATURES),
            "vix": ({"available": True,
                     "note": "India VIX (NSE, computed from the NIFTY 50 option chain) "
                             "features on supervised models; neutral-filled pre-2020-08"}
                    if VIX_AVAILABLE else
                    {"available": False, "note": "INDIAVIX.csv missing - price features only"}),
            "label_rule": f"next-day return > +{LABEL_THR:.1%} => BUY, < -{LABEL_THR:.1%} => SELL, else HOLD",
            "capital": INITIAL, "brokerage": 50, "slippage_pct": 0.25, "hold_days": 1,
            "wf_period": f"{str(oos_dates[0].date())} -> {str(oos_dates[-1].date())}",
            "vit": {"dim": vit_dim, "depth": vit_depth, "heads": 6, "patch": 8,
                    "img": IMG, "params": vit.get("params", 0),
                    "seq_model_params": lstm.get("params", 0)},
        },
        "paper": {"source": "Firoz A. Sherasiya (2025), IJFMR 7(4), 'Developing A Machine Learning-Based Options Trading Strategy for the Indian Market'",
                  "models": paper_models,
                  "label": "next-day > +1% => BUY else SELL (imbalanced label)"},
        "alpha": state_alpha,
        "models": {},
        "oos": {"equity": eq, "trades": trades,
                "period": f"{str(oos_dates[0].date())} to {str(oos_dates[-1].date())}"},
        "backtests": bt,
        "monthly_pnl": monthly,
        "feature_importance": (
            sorted(zip(ALL_FEATURES, [float(v) for v in
                                      xg["insample"]["model"].feature_importances_]),
                   key=lambda t: -t[1])[:16]
            if hasattr(xg["insample"]["model"], "feature_importances_") else []),
        "attention": {"date": str(ds.index[hero_k].date()), "grid": attn[0].tolist(),
                      "signal": sig_hero, "probs": p_hero[0].round(3).tolist()},
        "hero": {"png": "hero.png", "date": str(ds.index[hero_k].date()),
                 "close": round(float(ds["close"].iloc[hero_k]), 0)},
        "ticker": ticker,
        "label_design_check": {
            "paper_label_acc": round(acc_paper, 4), "majority_baseline": round(maj, 4),
            "note": "The reference paper's label makes SELL the majority class (~75-80% of days). "
                    "A majority-class classifier already scores that high on it - so part of the "
                    "paper's 89-90% is label design, not edge. Balanced 3-class labels (used here) "
                    "measure true directional skill."},
    }
    for nm, src in (("ViT", vit), ("LSTM", lstm), ("XGBoost", xg), ("RandomForest", rfm)):
        d = proto(src)
        d["backtest"] = bt[nm]
        if nm in ("ViT", "LSTM"):
            d["params"] = src.get("params", 0)
        state["models"][nm] = d
    state["models"]["Ensemble"] = {
        "in-sample": ens["insample"], "paper-style": ens["paper"],
        "walk-forward OOS": ens["wf"], "backtest": bt["Ensemble"]}

    with open(RESULTS / "state.json", "w") as fh:
        json.dump(state, fh, indent=1, default=float)
    log(f"state.json written -> {RESULTS / 'state.json'}")
    log(f"=== pipeline done in {(time.time() - t_start) / 60:.1f} min ===")


if __name__ == "__main__":
    main()
