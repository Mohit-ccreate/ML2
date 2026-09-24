"""OptionEdge dashboard server.

Flask app serving the single-page quant-terminal UI.
Run:  python dashboard/app.py   ->  http://0.0.0.0:8000
"""
from __future__ import annotations

import json
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

HERE = Path(__file__).parent
PROJECT = HERE.parent
RESULTS = PROJECT / "optionedge" / "results"
CHARTS = PROJECT / "optionedge" / "data" / "charts"

app = Flask(__name__, static_folder=str(HERE / "static"), static_url_path="")

_STATE_CACHE: tuple[float, dict] | None = None


def _state() -> dict:
    global _STATE_CACHE
    import time

    p = RESULTS / "state.json"
    if not p.exists():
        return {"error": "state.json not found - run the OptionEdge pipeline first "
                         "(python optionedge/train.py)"}
    mtime = p.stat().st_mtime
    if _STATE_CACHE is None or _STATE_CACHE[0] != mtime:
        _STATE_CACHE = (mtime, json.loads(p.read_text()))
    return _STATE_CACHE[1]


@app.get("/")
@app.get("/predict")
@app.get("/playground")
@app.get("/backtest")
@app.get("/alpha")
@app.get("/research")
def index():
    """Single-page shell — JS activates the section from the URL/path."""
    return send_from_directory(HERE / "static", "index.html")


@app.get("/api/state")
def api_state():
    return jsonify(_state())


@app.get("/api/health")
def api_health():
    p = RESULTS / "state.json"
    return jsonify({
        "ok": p.exists(),
        "generated": (json.loads(p.read_text()).get("generated") if p.exists() else None),
    })


@app.get("/hero.png")
def hero():
    return send_from_directory(RESULTS, "hero.png")


@app.get("/charts/<path:name>")
def charts(name):
    return send_from_directory(CHARTS, name)


# --------------------------------------------------------------------------- #
# interactive prediction: pick any date -> ViT probabilities + attention
# --------------------------------------------------------------------------- #
import base64
import io
import threading

_PRED: dict | None = None
_PRED_LOCK = threading.Lock()


def _predict_ctx() -> dict:
    """Lazy-load dataset + in-sample ViT (architecture read from state.json)."""
    global _PRED
    if _PRED is not None:
        return _PRED
    with _PRED_LOCK:
        if _PRED is not None:
            return _PRED
        import sys

        import numpy as np
        import torch

        sys.path.insert(0, str(PROJECT / "optionedge"))
        from charts import chart_path_for, load_image, render_chart
        from data import load_raw, make_dataset
        from models_vit import ViT

        st = _state()
        if isinstance(st, dict) and st.get("error"):
            raise RuntimeError(st["error"])
        vm = st["meta"]["vit"]
        ds = make_dataset()
        raw = load_raw()
        pos = np.searchsorted(raw.index.values, ds.index.values)
        m = ViT(dim=vm["dim"], depth=vm["depth"], heads=vm["heads"])
        raw_sd = torch.load(RESULTS / "vit_insample.pt", map_location="cpu",
                            weights_only=False)
        # train.py stores numpy arrays in the state dict - convert back
        sd = {k: (torch.from_numpy(v) if isinstance(v, np.ndarray) else v)
              for k, v in raw_sd.items()}
        m.load_state_dict(sd)
        m.eval()
        _PRED = dict(ds=ds, raw=raw, pos=pos, model=m)
    return _PRED


def _predict_at(ctx: dict, k: int, with_chart: bool = True) -> dict:
    """Core single-session ViT inference at dataset position k."""
    import numpy as np
    import pandas as pd
    import torch

    from charts import chart_path_for, load_image, render_chart

    ds, raw, pos, model = ctx["ds"], ctx["raw"], ctx["pos"], ctx["model"]
    d = ds.index[k]
    cp = chart_path_for(d)
    if not cp.exists():
        render_chart(raw, int(pos[k]), cp)
    x = load_image(cp)
    # exact training-time normalisation: per-image, per-channel z-score
    x = ((x - x.mean(axis=(1, 2), keepdims=True))
         / (x.std(axis=(1, 2), keepdims=True) + 1e-3)).astype(np.float32)
    xt = torch.tensor(x).unsqueeze(0)
    with torch.no_grad():
        p = torch.softmax(model(xt), dim=1).numpy()[0]
        attn = model.cls_attention(xt)[0]
    row = ds.iloc[k]
    nxt = row.get("next_ret")
    out = {
        "date": str(d.date()),
        "close": round(float(row["close"]), 1),
        "probs": [round(float(v), 4) for v in p],
        "signal": ["SELL", "HOLD", "BUY"][int(p.argmax())],
        "attention": [[round(float(v), 4) for v in r] for r in attn],
    }
    if with_chart:
        out["chart_b64"] = base64.b64encode(cp.read_bytes()).decode()
    if nxt is not None and pd.notna(nxt):
        out["next_ret_pct"] = round(float(nxt) * 100, 3)
        out["actual"] = ["SELL", "HOLD", "BUY"][int(row["y3"])]
    return out


@app.get("/api/predict")
def predict():
    date = request.args.get("date") or None
    try:
        import pandas as pd

        ctx = _predict_ctx()  # also puts optionedge/ on sys.path
        ds = ctx["ds"]
        if date:
            ts = pd.Timestamp(date)
            k = ds.index.searchsorted(ts)
            if k >= len(ds) or ds.index[k] != ts:
                return jsonify({"error": f"{date} is not a trading day in the dataset "
                                         f"({ds.index[0].date()} .. {ds.index[-1].date()})"}), 404
        else:
            k = len(ds) - 1
        return jsonify(_predict_at(ctx, k))
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    except FileNotFoundError as e:
        return jsonify({"error": "ViT weights (results/vit_insample.pt) are missing - "
                                 "re-running the pipeline will regenerate them. Try again shortly."}), 503
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"predict failed: {e}"}), 500


@app.post("/api/predict_range")
def predict_range():
    """Batch: every trading day in [from, to] (max 60). Returns per-day
    predictions + a hit-rate summary vs the actual next-day labels."""
    data = request.get_json(force=True, silent=True) or {}
    try:
        import pandas as pd

        ctx = _predict_ctx()
        ds = ctx["ds"]
        frm = pd.Timestamp(data.get("from") or ds.index[0])
        to = pd.Timestamp(data.get("to") or ds.index[-1])
        if frm > to:
            frm, to = to, frm
        sel = ds.index[(ds.index >= frm) & (ds.index <= to)]
        if len(sel) < 2:
            return jsonify({"error": f"no trading days in {frm.date()} .. {to.date()} "
                                     f"(dataset {ds.index[0].date()} .. {ds.index[-1].date()})"}), 404
        if len(sel) > 60:
            return jsonify({"error": f"{len(sel)} days - max 60 sessions per batch, pick a smaller range"}), 400
        rows = []
        hits = graded = 0
        for d in sel:
            k = int(ds.index.get_loc(d))
            r = _predict_at(ctx, k, with_chart=False)
            r.pop("attention", None)
            if "actual" in r:
                graded += 1
                hits += int(r["signal"] == r["actual"])
            rows.append(r)
        return jsonify({
            "n": len(rows), "days": rows,
            "summary": {
                "graded": graded,
                "exact_hit": hits,
                "exact_hit_pct": round(100.0 * hits / graded, 1) if graded else None,
                "note": "exact 3-class hit rate vs actual next-day label",
            },
        })
    except (RuntimeError, FileNotFoundError) as e:
        return jsonify({"error": str(e) or "ViT weights missing"}), 503
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"range predict failed: {e}"}), 500


# --------------------------------------------------------------------------- #
# interactive prediction: user-supplied OHLC (arbitrary data)
# --------------------------------------------------------------------------- #
@app.get("/api/latest")
def api_latest():
    """Last N daily OHLC rows of the training dataset, CSV-ready for the
    paste-box (date,open,high,low,close per line)."""
    from data import make_dataset
    try:
        n = max(26, min(int(request.args.get("rows", 60)), 250))
    except ValueError:
        n = 60
    ds = make_dataset()
    d = ds.tail(n)
    lines = [f"{idx.date()},{r.open},{r.high},{r.low},{r.close}"
             for idx, r in d.iterrows()]
    return jsonify({"csv": "\n".join(lines), "date": str(d.index[-1].date()), "rows": len(lines)})


@app.post("/api/predict")
def api_predict_csv():
    """User-supplied daily OHLC -> rendered chart -> ViT -> SELL/HOLD/BUY +
    attention map. JSON: {"csv": "date,open,high,low,close\\n..."}."""
    data = request.get_json(force=True, silent=True) or {}
    csv = (data.get("csv") or "").strip()
    if not csv:
        return jsonify({"error": "no input - paste OHLC rows (date,open,high,low,close)"}), 400

    rows = []
    for line in csv.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [x.strip() for x in line.replace(";", ",").split(",")]
        if parts[0].lower() in ("date", "d"):
            continue  # optional header
        if len(parts) < 5:
            return jsonify({"error": f"row needs date,open,high,low,close -> {line!r}"}), 400
        try:
            rows.append((parts[0], float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4])))
        except ValueError:
            return jsonify({"error": f"bad number in row -> {line!r}"}), 400
    if len(rows) < 26:
        return jsonify({"error": f"need at least 26 daily rows (15-candle chart window + indicator warm-up), got {len(rows)}"}), 400

    try:
        import numpy as np
        import pandas as pd
        import torch
        import tempfile
        from pathlib import Path

        from charts import load_image, render_chart

        df = pd.DataFrame(rows, columns=["date", "Open", "High", "Low", "Close"])
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        if df["date"].isna().any():
            return jsonify({"error": "a date could not be parsed"}), 400
        df = df.set_index("date").sort_index()
        df = df[~df.index.duplicated(keep="last")]

        ctx = _predict_ctx()
        model = ctx["model"]
        last = len(df) - 1
        with tempfile.TemporaryDirectory() as td:
            png_path = Path(td) / "input_chart.png"
            render_chart(df, last, png_path)
            png_bytes = png_path.read_bytes()
            x = load_image(png_path)
        # exact training-time normalisation: per-image, per-channel z-score
        x = ((x - x.mean(axis=(1, 2), keepdims=True))
             / (x.std(axis=(1, 2), keepdims=True) + 1e-3)).astype(np.float32)
        xt = torch.tensor(x).unsqueeze(0)

        model.eval()
        with torch.no_grad():
            p = torch.softmax(model(xt), dim=1).numpy()[0]
            attn = model.cls_attention(xt)[0]

        return jsonify({
            "ok": True,
            "date": str(df.index[-1].date()),
            "close": round(float(df["Close"].iloc[-1]), 2),
            "rows": len(df),
            "signal": ["SELL", "HOLD", "BUY"][int(p.argmax())],
            "probs": [round(float(v), 4) for v in p],
            "attn": [[round(float(v), 4) for v in r] for r in attn.tolist()],
            "png": "data:image/png;base64," + base64.b64encode(png_bytes).decode(),
        })
    except (RuntimeError, FileNotFoundError) as e:
        return jsonify({"error": str(e) or "ViT weights missing - retrain still running"}), 503
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"predict failed: {e}"}), 500


if __name__ == "__main__":
    import sys

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    app.run(host="0.0.0.0", port=port, threaded=True)
