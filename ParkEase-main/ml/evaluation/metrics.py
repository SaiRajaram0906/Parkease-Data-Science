"""Evaluation helpers shared by the three models."""
from __future__ import annotations

from typing import Dict, List, Sequence

import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, confusion_matrix, mean_absolute_error,
                             mean_squared_error, precision_recall_fscore_support, r2_score)

from ml import config

FEATURE_LABELS = {
    "hour": "Hour of day",
    "day_of_week_num": "Day of week",
    "is_weekend": "Weekend",
    "is_holiday": "Holiday",
    "is_off_day": "Weekend or holiday",
    "peak_hour": "Peak hour",
    "morning_peak": "Morning peak",
    "evening_peak": "Evening peak",
    "slot_capacity": "Slot capacity",
    "base_price_per_hour": "Base price",
    "price_rel_peers": "Price vs similar listings",
    "parking_zone": "Parking zone",
    "vehicle_type_supported": "Vehicle type",
    "slot_hist_occupancy": "Slot historical occupancy",
    "slot_prev_day_occupancy": "Slot previous-day occupancy",
    "slot_rolling_occupancy": "Slot 7-day rolling occupancy",
    "slot_hist_bookings_per_day": "Slot booking frequency",
    "slot_hist_demand": "Slot historical demand",
    "slot_hist_duration": "Slot average booking duration",
    "zone_hour_hist_occupancy": "Zone-hour historical occupancy",
    "zone_hour_hist_demand": "Zone-hour historical demand",
    "zone_hour_hist_bookings": "Zone-hour booking count",
    "demand_num": "Demand level",
}


def regression_metrics(y_true: Sequence[float], y_pred: Sequence[float]) -> Dict[str, float]:
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 4),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def classification_metrics(y_true: Sequence[str], y_pred: Sequence[str],
                           labels: List[str]) -> Dict[str, object]:
    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, zero_division=0)
    macro = precision_recall_fscore_support(y_true, y_pred, labels=labels,
                                            average="macro", zero_division=0)
    weighted = precision_recall_fscore_support(y_true, y_pred, labels=labels,
                                               average="weighted", zero_division=0)
    return {
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision_macro": round(float(macro[0]), 4),
        "recall_macro": round(float(macro[1]), 4),
        "f1_macro": round(float(macro[2]), 4),
        "f1_weighted": round(float(weighted[2]), 4),
        "per_class": [{
            "label": label, "precision": round(float(precision[i]), 4),
            "recall": round(float(recall[i]), 4), "f1": round(float(f1[i]), 4),
            "support": int(support[i]),
        } for i, label in enumerate(labels)],
        "confusion_matrix": {
            "labels": labels,   # rows = actual, columns = predicted
            "matrix": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
        },
    }


def feature_importance(model, X: pd.DataFrame, y, scoring: str,
                       repeats: int = 5) -> List[Dict[str, object]]:
    """Permutation importance on held-out data.

    Each feature is shuffled in turn; the drop in score says how much the
    model relies on it. Measured on original columns (before one-hot
    encoding), so every model type is described in the same terms.
    """
    result = permutation_importance(model, X, y, scoring=scoring, n_repeats=repeats,
                                    random_state=config.RANDOM_SEED, n_jobs=1)
    rows = [{
        "feature": column,
        "label": FEATURE_LABELS.get(column, column),
        "importance": round(float(max(result.importances_mean[i], 0.0)), 5),
    } for i, column in enumerate(X.columns)]
    rows.sort(key=lambda r: r["importance"], reverse=True)
    total = sum(r["importance"] for r in rows) or 1.0
    for row in rows:
        row["share"] = round(row["importance"] / total * 100, 1)
    return rows
