"""Offline EDA figures (PNG) for the project report.

Draws the nine required charts from the same analytics functions the app
uses, so the report and the dashboard always show the same numbers.

Run from the project root:

    python -m ml.eda.make_figures

Output: data/reports/figures/*.png and data/reports/eda_overview.json
All figures describe SYNTHETIC data.
"""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from ml import config  # noqa: E402
from ml.eda.analytics import dataset_overview  # noqa: E402
from ml.preprocessing.clean_data import clean_dataset  # noqa: E402

BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
DEMAND_COLOURS = {"Low": "#86b6ef", "Medium": "#2a78d6", "High": "#104281"}
INK, MUTED, GRID = "#0b0b0b", "#52514e", "#e6e5e1"
NOTE = "Synthetic data"


def _style(ax, title: str, xlabel: str = "", ylabel: str = "") -> None:
    ax.set_title(title, loc="left", fontsize=12, fontweight="bold", color=INK)
    ax.set_xlabel(xlabel, color=MUTED)
    ax.set_ylabel(ylabel, color=MUTED)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=MUTED, length=0)


def _save(fig, name: str) -> None:
    out = config.REPORTS_DIR / "figures"
    out.mkdir(parents=True, exist_ok=True)
    fig.text(0.99, 0.01, NOTE, ha="right", va="bottom", fontsize=8, color=MUTED)
    fig.tight_layout()
    fig.savefig(out / name, dpi=150)
    plt.close(fig)


def make_figures(overview: dict) -> None:
    # 1. Bookings by hour
    rows = overview["bookings_by_hour"]
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot([r["label"][:2] for r in rows], [r["weekday"] for r in rows], color=BLUE, lw=2,
            marker="o", ms=4, label="Working days")
    ax.plot([r["label"][:2] for r in rows], [r["weekend"] for r in rows], color=ORANGE, lw=2,
            marker="o", ms=4, label="Weekends and holidays")
    _style(ax, "When is parking demand highest?", "Hour of day", "Bookings per day")
    ax.legend(frameon=False)
    _save(fig, "01_bookings_by_hour.png")

    # 2. Bookings by day of week
    rows = overview["bookings_by_day_of_week"]
    fig, ax = plt.subplots(figsize=(7, 4))
    bars = ax.bar([r["short"] for r in rows], [r["per_day"] for r in rows], color=BLUE, width=0.6)
    ax.bar_label(bars, fmt="%.0f", color=INK, fontsize=9)
    _style(ax, "Which days are busiest?", "", "Bookings per day")
    _save(fig, "02_bookings_by_day_of_week.png")

    # 3. Monthly trend
    rows = overview["monthly_trend"]
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot([r["label"] for r in rows], [r["bookings"] for r in rows], color=BLUE, lw=2, marker="o", ms=4)
    _style(ax, "Is the platform growing?", "", "Bookings per month")
    ax.set_ylim(bottom=0)
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right")
    _save(fig, "03_monthly_trend.png")

    # 4. Occupancy by zone
    rows = sorted(overview["zones"], key=lambda r: r["occupancy"], reverse=True)
    fig, ax = plt.subplots(figsize=(7, 4))
    bars = ax.bar([r["zone"] for r in rows], [r["occupancy"] for r in rows], color=BLUE, width=0.6)
    ax.bar_label(bars, fmt="%.0f%%", color=INK, fontsize=9)
    _style(ax, "Which zones are used most fully?", "", "Average occupancy (%)")
    _save(fig, "04_occupancy_by_zone.png")

    # 5. Demand distribution
    rows = [r for r in overview["demand_distribution"] if r["level"] in DEMAND_COLOURS]
    fig, ax = plt.subplots(figsize=(6, 4))
    bars = ax.bar([r["level"] for r in rows], [r["share"] for r in rows],
                  color=[DEMAND_COLOURS[r["level"]] for r in rows], width=0.55)
    ax.bar_label(bars, fmt="%.1f%%", color=INK, fontsize=9)
    _style(ax, "How balanced are the demand classes?", "Demand level", "Share of bookings (%)")
    _save(fig, "05_demand_distribution.png")

    # 6. Price vs demand (scatter)
    points = overview["price_vs_demand"]["points"]
    fig, ax = plt.subplots(figsize=(7, 5))
    for level, colour in DEMAND_COLOURS.items():
        chosen = [p for p in points if p["level"] == level]
        ax.scatter([p["base_price"] for p in chosen], [p["price"] for p in chosen], s=14,
                   color=colour, alpha=0.75, label=level, edgecolors="white", linewidths=0.3)
    limit = max(p["price"] for p in points)
    ax.plot([0, 100], [0, 100], color=MUTED, lw=1, ls="--", label="Price = base price")
    ax.set_ylim(0, limit * 1.05)
    _style(ax, "Do owners charge more when demand is high?", "Base price (Rs/h)", "Price charged (Rs/h)")
    ax.legend(frameon=False, title="Demand")
    _save(fig, "06_price_vs_demand.png")

    # 7. Distance vs cancellation
    rows = overview["distance_vs_cancellation"]
    fig, ax = plt.subplots(figsize=(7, 4))
    bars = ax.bar([r["band"] for r in rows], [r["cancellation_rate"] for r in rows], color=BLUE, width=0.6)
    ax.bar_label(bars, fmt="%.1f%%", color=INK, fontsize=9)
    _style(ax, "Do far-away bookings get cancelled more?", "Distance to the slot", "Cancelled (%)")
    _save(fig, "07_distance_vs_cancellation.png")

    # 8. Revenue by zone
    rows = sorted(overview["zones"], key=lambda r: r["completed_revenue"], reverse=True)
    fig, ax = plt.subplots(figsize=(7, 4))
    bars = ax.bar([r["zone"] for r in rows], [r["completed_revenue"] / 1e5 for r in rows], color=BLUE, width=0.6)
    ax.bar_label(bars, fmt="%.1f", color=INK, fontsize=9)
    _style(ax, "Which zones earn the most?", "", "Completed revenue (Rs lakh)")
    _save(fig, "08_revenue_by_zone.png")

    # 9. Correlation heatmap (diverging: blue negative, red positive, grey zero)
    labels = overview["correlation"]["labels"]
    n = len(labels)
    matrix = np.array([c["value"] for c in overview["correlation"]["cells"]]).reshape(n, n)
    cmap = matplotlib.colors.LinearSegmentedColormap.from_list("div", ["#2a78d6", "#f0efec", "#e34948"])
    fig, ax = plt.subplots(figsize=(8, 7))
    image = ax.imshow(matrix, cmap=cmap, vmin=-1, vmax=1)
    ax.set_xticks(range(n), labels, rotation=45, ha="right", color=MUTED)
    ax.set_yticks(range(n), labels, color=MUTED)
    for i in range(n):
        for j in range(n):
            ax.text(j, i, f"{matrix[i, j]:.2f}", ha="center", va="center", fontsize=7,
                    color="white" if abs(matrix[i, j]) > 0.6 else INK)
    ax.set_title("How are the main variables related? (Spearman)", loc="left",
                 fontsize=12, fontweight="bold", color=INK)
    for side in ax.spines.values():
        side.set_visible(False)
    ax.tick_params(length=0)
    fig.colorbar(image, ax=ax, shrink=0.7)
    _save(fig, "09_correlation_heatmap.png")


if __name__ == "__main__":
    cleaned, _ = clean_dataset()
    result = dataset_overview(cleaned)
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (config.REPORTS_DIR / "eda_overview.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    make_figures(result)
    print("Wrote 9 figures to", config.REPORTS_DIR / "figures")
    for line in result["insights"]:
        print(" -", line)
