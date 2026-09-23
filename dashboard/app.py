"""OptionEdge dashboard server.

Flask app serving the single-page quant-terminal UI.
Run:  python dashboard/app.py   ->  http://0.0.0.0:8000
"""
from __future__ import annotations

import json
from pathlib import Path

from flask import Flask, jsonify, send_from_directory

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
def index():
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


@app.get("/api/predict")
def predict(date: str | None = None):
    try:
        import numpy as np
        import pandas as pd
        import torch

        ctx = _predict_ctx()  # also puts optionedge/ on sys.path
        from charts import chart_path_for, load_image, render_chart

        ds, raw, pos, model = ctx["ds"], ctx["raw"], ctx["pos"], ctx["model"]

        if date:
            ts = pd.Timestamp(date)
            k = ds.index.searchsorted(ts)
            if k >= len(ds) or ds.index[k] != ts:
                return jsonify({"error": f"{date} is not a trading day in the dataset "
                                         f"({ds.index[0].date()} .. {ds.index[-1].date()})"}), 404
        else:
            k = len(ds) - 1
        d = ds.index[k]

        # chart the ViT will see (from cache, or render on the fly)
        cp = chart_path_for(d)
        if not cp.exists():
            render_chart(raw, int(pos[k]), cp)
        x = load_image(cp)
        x = ((x - x.mean()) / (x.std() + 1e-3)).astype(np.float32)
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
            "chart_b64": base64.b64encode(cp.read_bytes()).decode(),
        }
        if nxt is not None and pd.notna(nxt):
            out["next_ret_pct"] = round(float(nxt) * 100, 3)
            out["actual"] = ["SELL", "HOLD", "BUY"][int(row["y3"])]
        return jsonify(out)
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    except FileNotFoundError as e:
        return jsonify({"error": "ViT weights (results/vit_insample.pt) are missing - "
                                 "re-running the pipeline will regenerate them. Try again shortly."}), 503
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"predict failed: {e}"}), 500


if __name__ == "__main__":
    import sys

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    app.run(host="0.0.0.0", port=port, threaded=True)
