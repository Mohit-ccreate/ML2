"""OptionEdge - chart renderer.

Turns the last 15 trading days of NIFTY price action into a small image that a
Vision Transformer can see: candles + EMA ribbon on top, RSI strip at the bottom.
The ViT therefore consumes *the chart* the way a human trader does.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

IMG = 64          # ViT input resolution
WIN = 15          # candles per image
BG = "#070b14"
UP, DN = "#00ffa3", "#ff3b6b"
EMA_C, EMA_M = "#22d3ee", "#e879f9"
RSI_C = "#facc15"

CACHE = Path(__file__).parent / "data" / "charts"


def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def _axes(fig, rect, facecolor=BG):
    ax = fig.add_axes(rect)
    ax.set_facecolor(facecolor)
    ax.tick_params(colors="#2b3350", labelsize=1.8, length=1)
    for s in ax.spines.values():
        s.set_color("#1b2340")
        s.set_linewidth(0.6)
    return ax


def render_chart(df: pd.DataFrame, i: int, path: Path) -> Path:
    """Render window ending at positional index `i` into a 64x64 PNG at `path`."""
    w = df.iloc[i - WIN + 1: i + 1]
    fig = plt.figure(figsize=(IMG / 40, IMG / 40), dpi=40)
    ax = _axes(fig, [0.02, 0.44, 0.96, 0.53])
    axr = _axes(fig, [0.02, 0.05, 0.96, 0.30])

    # candles
    for j, (_, row) in enumerate(w.iterrows()):
        col = UP if row["Close"] >= row["Open"] else DN
        ax.vlines(j, row["Low"], row["High"], color=col, lw=0.8, zorder=3)
        body_lo = min(row["Open"], row["Close"])
        body_h = max(abs(row["Close"] - row["Open"]), (row["High"] - row["Low"]) * 0.02)
        ax.add_patch(Rectangle((j - 0.31, body_lo), 0.62, body_h,
                               facecolor=col, edgecolor="none", zorder=3))
    lo, hi = w["Low"].min(), w["High"].max()
    ax.set_xlim(-0.7, WIN - 0.3)
    ax.set_ylim(lo - (hi - lo) * 0.06, hi + (hi - lo) * 0.06)

    # EMA ribbon
    e9 = df["Close"].ewm(span=9, adjust=False).mean().iloc[i - WIN + 1: i + 1]
    e21 = df["Close"].ewm(span=21, adjust=False).mean().iloc[i - WIN + 1: i + 1]
    xs = np.arange(WIN)
    ax.plot(xs, e9.values, color=EMA_C, lw=0.9, zorder=4)
    ax.plot(xs, e21.values, color=EMA_M, lw=0.9, zorder=4)

    # RSI strip
    rsi = _rsi(df["Close"]).iloc[i - WIN + 1: i + 1].values
    axr.plot(xs, rsi, color=RSI_C, lw=0.9)
    axr.axhline(70, color="#39415a", lw=0.5, ls="--")
    axr.axhline(30, color="#39415a", lw=0.5, ls="--")
    axr.set_xlim(-0.7, WIN - 0.3)
    axr.set_ylim(0, 100)

    fig.savefig(path, dpi=40, facecolor=BG)
    plt.close(fig)
    return path


def render_hero(df: pd.DataFrame, i: int, path: Path, win: int = 30, px: int = 512) -> Path:
    """Large annotated chart for the dashboard hero / attention display."""
    w = df.iloc[i - win + 1: i + 1].reset_index()
    rsi = _rsi(df["Close"]).iloc[i - win + 1: i + 1]
    e9 = df["Close"].ewm(span=9, adjust=False).mean().iloc[i - win + 1: i + 1]
    e21 = df["Close"].ewm(span=21, adjust=False).mean().iloc[i - win + 1: i + 1]
    v = df["Volume"].iloc[i - win + 1: i + 1].fillna(0)

    fig = plt.figure(figsize=(px / 40, px / 40), dpi=40)
    ax = _axes(fig, [0.045, 0.42, 0.93, 0.545])
    axr = _axes(fig, [0.045, 0.215, 0.93, 0.16])
    axv = _axes(fig, [0.045, 0.055, 0.93, 0.11])
    xs = np.arange(win)

    for j, row in w.iterrows():
        col = UP if row["Close"] >= row["Open"] else DN
        ax.vlines(j, row["Low"], row["High"], color=col, lw=1.6, zorder=3)
        body_lo = min(row["Open"], row["Close"])
        body_h = max(abs(row["Close"] - row["Open"]), (row["High"] - row["Low"]) * 0.02)
        ax.add_patch(Rectangle((j - 0.34, body_lo), 0.68, body_h, facecolor=col, edgecolor="none", zorder=3))
    ax.set_xlim(-0.8, win - 0.2)
    lo, hi = w["Low"].min(), w["High"].max()
    ax.set_ylim(lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08)
    ax.plot(xs, e9.values, color=EMA_C, lw=1.4, label="EMA 9", zorder=4)
    ax.plot(xs, e21.values, color=EMA_M, lw=1.4, label="EMA 21", zorder=4)
    ax.tick_params(colors="#4b5578", labelsize=px / 90)
    ax.set_yticks(np.linspace(lo, hi, 6))
    ax.get_yaxis().set_major_formatter(matplotlib.ticker.FormatStrFormatter("%.0f"))
    ticks = [int(j) for j in xs[::6]]
    ax.set_xticks(ticks)
    ax.set_xticklabels([str(w["Date"].iloc[j].date()) for j in ticks], rotation=0,
                       fontsize=px / 110, color="#4b5578")

    axr.plot(xs, rsi.values, color=RSI_C, lw=1.4)
    axr.axhline(70, color="#39415a", lw=0.8, ls="--")
    axr.axhline(30, color="#39415a", lw=0.8, ls="--")
    axr.set_xlim(-0.8, win - 0.2)
    axr.set_ylim(0, 100)
    axr.set_yticks([30, 70])
    axr.tick_params(colors="#4b5578", labelsize=px / 110)

    cols = [UP if c >= o else DN for c, o in zip(w["Close"], w["Open"])]
    axv.bar(xs, v.values, color=cols, width=0.68)
    axv.set_xlim(-0.8, win - 0.2)
    axv.tick_params(colors="#4b5578", labelsize=px / 130)
    axv.yaxis.set_visible(False)

    last = w.iloc[-1]
    col = UP if last["Close"] >= last["Open"] else DN
    title = f"NIFTY 50  -  {last['Date'].date()}   Close {last['Close']:,.0f}"
    fig.text(0.045, 0.965, title, color="#e2e8f0", fontsize=px / 64, family="monospace")
    fig.text(0.045, 0.925, "OptionEdge Vision Transformer input", color="#64748b",
             fontsize=px / 90, family="monospace")
    fig.savefig(path, dpi=40, facecolor=BG)
    plt.close(fig)
    return path


def chart_path_for(date: pd.Timestamp) -> Path:
    return CACHE / f"{date.date()}.png"


def load_image(path: Path) -> np.ndarray:
    """PNG -> float32 (3,64,64) in [0,1] without external deps."""
    import matplotlib.image as mpimg
    arr = mpimg.imread(str(path))
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=-1)
    arr = np.ascontiguousarray(arr[..., :3].transpose(2, 0, 1), dtype=np.float32)
    return arr
