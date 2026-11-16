"""Static figures for the command-line report (matplotlib)."""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from .analysis import Run, series_summary  # noqa: E402
from .state import GROUPS  # noqa: E402

INK, MUTED, LINE = "#232b29", "#63706d", "#dde2db"
POLICY_COLORS = {"maintain": "#276150", "tighten": "#173b31", "relax_chips": "#bc7457",
                 "relax_chips_hbm": "#d9a441", "selective": "#497b9a", "broad_relax": "#8c4a3c",
                 "adaptive": "#907ca4"}
GROUP_COLORS = {"Economics": "#497b9a", "Openness": "#6fa58c", "Security": "#907ca4",
                "Conflict": "#bc7457", "AI safety": "#8c4a3c", "Durable lead": "#d9a441",
                "Integration": "#8b938f"}


def _style(ax, title, ylabel=""):
    ax.set_title(title, fontsize=10, color=INK, loc="left")
    ax.set_ylabel(ylabel, fontsize=8, color=MUTED)
    ax.tick_params(labelsize=8, colors=MUTED)
    ax.grid(color=LINE, linewidth=0.6)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(LINE)


def trajectories(run: Run, path: Path, policies=("maintain", "relax_chips", "broad_relax")) -> None:
    """Compute, capability and the three indigenisation outcomes, median with 10-90% bands."""
    panels = [("ratio_stock", "US:China installed capacity", "ratio", True),
              ("ratio_train", "US:China frontier training compute", "ratio", True),
              ("lag_years", "US capability lead", "years", False),
              ("dom_share", "Domestic adoption (share of new Chinese capacity)", "share", False),
              ("K_logic", "Domestic know-how: logic", "index (1 = frontier)", False),
              ("K_sme", "Domestic know-how: equipment", "index (1 = frontier)", False),
              ("Q_dom", "Domestic chip output", "capacity units per year", True),
              ("C_cn", "China's installed capacity", "capacity units", True),
              ("O", "Open-model competitive pressure", "index", False)]
    fig, axes = plt.subplots(3, 3, figsize=(13, 9.5))
    for ax, (name, title, ylabel, log) in zip(axes.ravel(), panels):
        for pol in policies:
            if pol not in run.results:
                continue
            s = series_summary(run.results[pol], name)
            c = POLICY_COLORS.get(pol, INK)
            ax.plot(s["year"], s["p50"], color=c, linewidth=1.8, label=run.cfg.policies[pol]["label"])
            ax.fill_between(s["year"], s["p10"], s["p90"], color=c, alpha=0.12, linewidth=0)
        if log:
            ax.set_yscale("log")
        _style(ax, title, ylabel)
    axes[0, 0].legend(fontsize=8, frameon=False)
    fig.suptitle(f"{run.cfg.label}: trajectories by policy (median, 10-90% band)", fontsize=11, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def decomposition(table: pd.DataFrame, labels: dict, path: Path) -> None:
    """Expected value of each policy minus the reference, decomposed, one panel per cell."""
    cells = table[["config", "weights"]].drop_duplicates().values.tolist()
    configs = list(dict.fromkeys(c for c, _ in cells))
    weights = list(dict.fromkeys(w for _, w in cells))
    fig, axes = plt.subplots(len(configs), len(weights), figsize=(4.6 * len(weights), 3.1 * len(configs)), squeeze=False)
    for i, cfg in enumerate(configs):
        for j, w in enumerate(weights):
            ax = axes[i, j]
            t = table[(table.config == cfg) & (table.weights == w)].reset_index(drop=True)
            y = np.arange(len(t))
            pos, neg = np.zeros(len(t)), np.zeros(len(t))
            for g in GROUPS:
                v = t[g].to_numpy()
                left = np.where(v >= 0, pos, neg)
                ax.barh(y, v, left=left, color=GROUP_COLORS[g], height=0.62, label=g if (i, j) == (0, 0) else None)
                pos, neg = pos + np.maximum(v, 0), neg + np.minimum(v, 0)
            ax.plot(t["delta_value"], y, "o", color=INK, markersize=4)
            ax.axvline(0, color=MUTED, linewidth=0.8)
            ax.set_yticks(y, [labels.get(p, p) for p in t["policy"]])
            ax.invert_yaxis()
            _style(ax, f"{cfg} / {w}", "")
            ax.set_xlabel("vs reference policy, $tn present value", fontsize=8, color=MUTED)
    fig.legend(loc="lower center", ncol=7, fontsize=8, frameon=False)
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    fig.savefig(path, dpi=130)
    plt.close(fig)


def break_even(grid: pd.DataFrame, x: str, y: str, title: str, path: Path) -> None:
    piv = grid.pivot(index=y, columns=x, values="delta_value")
    lim = float(np.abs(piv.to_numpy()).max()) or 1.0
    fig, ax = plt.subplots(figsize=(6.4, 4.8))
    im = ax.pcolormesh(piv.columns, piv.index, piv.to_numpy(), cmap="BrBG", vmin=-lim, vmax=lim, shading="nearest")
    if piv.to_numpy().min() < 0 < piv.to_numpy().max():
        ax.contour(piv.columns, piv.index, piv.to_numpy(), levels=[0], colors=INK, linewidths=1.6)
    fig.colorbar(im, ax=ax, label="value difference, $tn")
    ax.set_xlabel(x, fontsize=9)
    ax.set_ylabel(y, fontsize=9)
    _style(ax, title)
    ax.grid(False)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def outcomes(probs: pd.DataFrame, labels: dict, path: Path) -> None:
    from .state import REGIMES, REGIME_LABELS
    colors = ["#276150", "#8fbfae", "#8c4a3c", "#d6a394", "#497b9a", "#d9a441", "#b9b4a3", "#e3e1d8"]
    configs = list(dict.fromkeys(probs["config"]))
    fig, axes = plt.subplots(1, len(configs), figsize=(5.2 * len(configs), 3.6), squeeze=False)
    for ax, cfg in zip(axes[0], configs):
        t = probs[probs.config == cfg].reset_index(drop=True)
        y, left = np.arange(len(t)), np.zeros(len(t))
        for r, c in zip(REGIMES, colors):
            ax.barh(y, t[r], left=left, color=c, height=0.62, label=REGIME_LABELS[r] if ax is axes[0][0] else None)
            left = left + t[r].to_numpy()
        for k in range(len(t)):
            ax.text(1.02, k, f"war {100 * t.war_by_2050[k]:.0f}%  cat. {100 * t.catastrophe[k]:.0f}%", va="center", fontsize=7, color=MUTED)
        ax.set_yticks(y, [labels.get(p, p) for p in t["policy"]])
        ax.invert_yaxis()
        ax.set_xlim(0, 1.32)
        _style(ax, cfg)
        ax.grid(False)
    fig.legend(loc="lower center", ncol=4, fontsize=7.5, frameon=False)
    fig.tight_layout(rect=(0, 0.1, 1, 1))
    fig.savefig(path, dpi=130)
    plt.close(fig)
