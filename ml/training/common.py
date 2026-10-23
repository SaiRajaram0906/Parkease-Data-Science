"""Shared building blocks for the training scripts."""
from __future__ import annotations

from typing import Dict, List, Tuple

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from ml.preprocessing import features as F

# Features of the availability and demand models. Neither price_per_hour nor
# any same-hour occupancy value is in this list (see features.py).
BASE_FEATURES: List[str] = (F.TIME_FEATURES + F.SLOT_FEATURES
                            + F.CATEGORICAL_FEATURES + F.HISTORY_FEATURES)

# Features of the price model: the demand level plus what describes the
# listing and the moment. The owner's own past prices are deliberately left
# out, so the model learns the market response, not one owner's habit.
PRICE_FEATURES: List[str] = (
    ["demand_num"] + F.TIME_FEATURES + F.SLOT_FEATURES + F.CATEGORICAL_FEATURES
    + ["slot_hist_occupancy", "slot_hist_bookings_per_day", "zone_hour_hist_demand"])


def make_preprocessor(columns: List[str], scale: bool) -> ColumnTransformer:
    """Median-impute numbers, one-hot encode categories, optionally scale.

    It sits inside each model pipeline, so its statistics (medians, scales,
    category lists) are learned from the training rows only.
    """
    categorical = [c for c in columns if c in F.CATEGORICAL_FEATURES]
    numeric = [c for c in columns if c not in categorical]
    numeric_steps = [("impute", SimpleImputer(strategy="median"))]
    if scale:
        numeric_steps.append(("scale", StandardScaler()))
    return ColumnTransformer([
        ("numeric", Pipeline(numeric_steps), numeric),
        ("categorical", OneHotEncoder(handle_unknown="ignore"), categorical),
    ])


def make_pipeline(estimator, columns: List[str], scale: bool = False) -> Pipeline:
    return Pipeline([("prepare", make_preprocessor(columns, scale)), ("model", estimator)])


def split_frames(table: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    return (table[table["split"] == "train"], table[table["split"] == "validation"],
            table[table["split"] == "test"])


def split_summary(train: pd.DataFrame, validation: pd.DataFrame,
                  test: pd.DataFrame) -> Dict[str, object]:
    def describe(frame: pd.DataFrame) -> Dict[str, object]:
        return {"rows": int(len(frame)),
                "from": frame["booking_date"].min().strftime("%Y-%m-%d"),
                "to": frame["booking_date"].max().strftime("%Y-%m-%d")}
    return {"train": describe(train), "validation": describe(validation), "test": describe(test)}
