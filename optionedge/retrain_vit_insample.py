"""Fast path: (re)train ONLY the in-sample ViT and save results/vit_insample.pt.

Used by the dashboard's /api/predict (ViT Time Machine) when the model weights
were lost (e.g. sandbox restart) but state.json is still valid. Reproduces
train.py's exact in-sample protocol: same seed (set on `import train`), same
data, same per-image z-scoring, same train_torch call and budget
(40 epochs, batch 128, lr 2e-3, no early stopping) - so the saved weights are
identical to what a full `train.py` run would produce.

Charts must already be rendered (a full or --fast run does that).
"""
from __future__ import annotations

import sys
import time

sys.path.insert(0, ".")

import numpy as np
import torch

import train  # noqa: E402  (seeds numpy+torch; provides train_torch/RESULTS/DEVICE)
from charts import chart_path_for, load_image  # noqa: E402
from data import make_dataset  # noqa: E402
from models_vit import ViT  # noqa: E402


def main() -> None:
    t0 = time.time()
    ds = make_dataset()
    n = len(ds)
    y = ds["y3"].to_numpy(dtype=int)

    print(f"loading {n} chart images...")
    X_img = np.stack([load_image(chart_path_for(d)) for d in ds.index])
    mu = X_img.mean(axis=(2, 3), keepdims=True)
    sd = X_img.std(axis=(2, 3), keepdims=True) + 1e-3
    X_img = ((X_img - mu) / sd).astype("float32")
    print(f"images in RAM: {X_img.shape} ({time.time() - t0:.0f}s)")

    m = ViT(dim=192, depth=4, heads=6).to(train.DEVICE)
    train.train_torch(m, X_img, y, max(60, int(n * 0.12)),
                      40, 128, 2e-3, patience=None)
    train.RESULTS.mkdir(exist_ok=True)
    torch.save({k: v.cpu().numpy() for k, v in m.state_dict().items()},
               train.RESULTS / "vit_insample.pt")
    print(f"saved {train.RESULTS / 'vit_insample.pt'} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
