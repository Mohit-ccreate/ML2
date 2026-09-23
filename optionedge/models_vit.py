"""OptionEdge - Vision Transformer (from scratch, PyTorch) + LSTM baseline.

The ViT reads the rendered 15-day NIFTY candlestick chart (64x64 RGB):
  * patch embedding: 8x8 pixel patches -> linear projection (64 patches)
  * learnable [CLS] token + learned positional embeddings
  * 4 pre-norm transformer blocks, 6 heads, D=192
  * mean-pooled tokens -> 3-class head (SELL / HOLD / BUY)

Attention over the patch grid is exposed so the dashboard can show
*where on the chart* the model is looking.
"""
from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

IMG = 64
PATCH = 8
N_PATCH = (IMG // PATCH) ** 2  # 64


class PatchEmbed(nn.Module):
    def __init__(self, dim: int = 192, in_ch: int = 3):
        super().__init__()
        self.num = N_PATCH
        self.proj = nn.Linear(in_ch * PATCH * PATCH, dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, 3, IMG, IMG)
        B, _, H, W = x.shape
        x = x.unfold(2, PATCH, PATCH)          # (B, 3, H/p, W, p)
        x = x.unfold(3, PATCH, PATCH)          # (B, 3, H/p, W/p, p, p)
        x = x.permute(0, 2, 3, 1, 4, 5)        # (B, H/p, W/p, 3, p, p)
        x = x.reshape(B, self.num, 3 * PATCH * PATCH)
        return self.proj(x)


class Block(nn.Module):
    def __init__(self, dim: int, heads: int, mlp: int = 4, drop: float = 0.1):
        super().__init__()
        self.norm1 = nn.LayerNorm(dim)
        self.attn = nn.MultiheadAttention(dim, heads, dropout=drop, batch_first=True)
        self.norm2 = nn.LayerNorm(dim)
        self.mlp = nn.Sequential(
            nn.Linear(dim, dim * mlp), nn.GELU(), nn.Dropout(drop),
            nn.Linear(dim * mlp, dim), nn.Dropout(drop),
        )
        self.drop = nn.Dropout(drop)
        self.last_attn = None  # (B, N, N) averaged over heads, last forward

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.norm1(x)
        a, w = self.attn(h, h, h, need_weights=True, average_attn_weights=True)
        self.last_attn = w
        x = x + self.drop(a)
        x = x + self.mlp(self.norm2(x))
        return x


class ViT(nn.Module):
    def __init__(self, dim: int = 192, depth: int = 4, heads: int = 6,
                 classes: int = 3, drop: float = 0.1):
        super().__init__()
        self.embed = PatchEmbed(dim)
        self.cls = nn.Parameter(torch.zeros(1, 1, dim))
        self.pos = nn.Parameter(torch.zeros(1, N_PATCH + 1, dim))
        nn.init.trunc_normal_(self.pos, std=0.02)
        self.blocks = nn.ModuleList(Block(dim, heads, drop=drop) for _ in range(depth))
        self.norm = nn.LayerNorm(dim)
        self.head = nn.Linear(dim, classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.embed(x)
        B = x.size(0)
        x = torch.cat([self.cls.expand(B, -1, -1), x], dim=1) + self.pos
        for b in self.blocks:
            x = b(x)
        x = self.norm(x).mean(dim=1)
        return self.head(x)

    @torch.no_grad()
    def cls_attention(self, x: torch.Tensor) -> np.ndarray:
        """(B, 8, 8) attention map of the [CLS] token over the patch grid."""
        feat = self.embed(x)
        B = x.size(0)
        feat = torch.cat([self.cls.expand(B, -1, -1), feat], dim=1) + self.pos
        for b in self.blocks:
            feat = b(feat)
        attn = b.last_attn[:, 0, 1:]                       # CLS row, drop CLS col
        return attn.cpu().numpy().reshape(B, 8, 8)

    def n_params(self) -> int:
        return int(sum(p.numel() for p in self.parameters()))


class LSTMModel(nn.Module):
    """Sequence model over 20 days of 29-d feature vectors (paper's LSTM idea)."""

    def __init__(self, nf: int, seq: int, hid: int = 96, classes: int = 3, drop: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(nf, hid, 1, batch_first=True)
        self.drop = nn.Dropout(drop)
        self.head = nn.Linear(hid, classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out, _ = self.lstm(x)
        return self.head(self.drop(out[:, -1, :]))

    def n_params(self) -> int:
        return int(sum(p.numel() for p in self.parameters()))


def selftest() -> None:
    """Smoke test: shapes + attention map + gradient flow for both networks."""
    x = torch.rand(5, 3, IMG, IMG)
    m = ViT()
    logits = m(x)
    assert logits.shape == (5, 3), logits.shape
    amap = m.cls_attention(x)
    assert amap.shape == (5, 8, 8), amap.shape
    loss = F.cross_entropy(logits, torch.randint(0, 3, (5,)))
    loss.backward()
    assert m.head.weight.grad is not None and torch.isfinite(m.head.weight.grad).all()

    xm = torch.rand(5, 20, 29)
    lm = LSTMModel(29, 20)
    lg = lm(xm)
    assert lg.shape == (5, 3)
    F.cross_entropy(lg, torch.randint(0, 3, (5,))).backward()
    assert lm.head.weight.grad is not None
    print(f"ViT self-test OK  (params={m.n_params() / 1e6:.2f}M) | "
          f"LSTM self-test OK (params={lm.n_params() / 1e3:.1f}K)")


if __name__ == "__main__":
    selftest()
