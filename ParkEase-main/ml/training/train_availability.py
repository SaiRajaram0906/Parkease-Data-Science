"""Model 1 - parking availability (regression).

Target   occupancy_rate of a slot-hour (0-100). Free spaces follow from it:
         available = capacity x (1 - occupancy / 100).
Compare  Linear Regression, Decision Tree, Random Forest, Gradient Boosting.
Choose   lowest validation MAE. Report on the untouched test period.
"""
from __future__ import annotations

from typing import Dict

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.tree import DecisionTreeRegressor

from ml import config
from ml.evaluation.metrics import feature_importance, regression_metrics
from ml.training.common import BASE_FEATURES, make_pipeline, split_frames, split_summary

TARGET = "occupancy_rate"


def candidates() -> Dict[str, object]:
    seed = config.RANDOM_SEED
    return {
        "Linear Regression": make_pipeline(LinearRegression(), BASE_FEATURES, scale=True),
        "Decision Tree": make_pipeline(
            DecisionTreeRegressor(max_depth=8, min_samples_leaf=20, random_state=seed),
            BASE_FEATURES),
        "Random Forest": make_pipeline(
            RandomForestRegressor(n_estimators=200, min_samples_leaf=5, max_features=0.5,
                                  n_jobs=-1, random_state=seed), BASE_FEATURES),
        "Gradient Boosting": make_pipeline(
            HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05,
                                          max_leaf_nodes=31, random_state=seed),
            BASE_FEATURES),
    }


def train(table: pd.DataFrame) -> Dict[str, object]:
    data = table[table["slot_capacity"] >= config.AVAILABILITY_MIN_CAPACITY]
    train_df, val_df, test_df = split_frames(data)
    X_train, y_train = train_df[BASE_FEATURES], train_df[TARGET]
    X_val, y_val = val_df[BASE_FEATURES], val_df[TARGET]
    X_test, y_test = test_df[BASE_FEATURES], test_df[TARGET]

    # Baselines a model has to beat to be worth using.
    zone_hour = X_val["zone_hour_hist_occupancy"].fillna(y_train.mean())
    slot_mean = X_val["slot_hist_occupancy"].fillna(y_train.mean())
    comparison = [
        {"model": "Baseline: overall mean", "baseline": True,
         **regression_metrics(y_val, np.full(len(y_val), y_train.mean()))},
        {"model": "Baseline: zone-hour average", "baseline": True,
         **regression_metrics(y_val, zone_hour)},
        {"model": "Baseline: slot historical average", "baseline": True,
         **regression_metrics(y_val, slot_mean)},
    ]
    fitted = {}
    for name, pipeline in candidates().items():
        pipeline.fit(X_train, y_train)
        fitted[name] = pipeline
        comparison.append({"model": name, "baseline": False,
                           **regression_metrics(y_val, np.clip(pipeline.predict(X_val), 0, 100))})
    best_name = min((row for row in comparison if not row["baseline"]),
                    key=lambda row: row["mae"])["model"]

    # Refit the chosen model on train + validation, then test once.
    fit_df = pd.concat([train_df, val_df])
    final = candidates()[best_name].fit(fit_df[BASE_FEATURES], fit_df[TARGET])
    test_pred = np.clip(final.predict(X_test), 0, 100)
    test_metrics = regression_metrics(y_test, test_pred)
    residual = y_test.to_numpy() - test_pred
    tail = (1 - config.PREDICTION_INTERVAL) / 2
    interval = {"coverage": config.PREDICTION_INTERVAL,
                "lower": round(float(np.quantile(residual, tail)), 2),
                "upper": round(float(np.quantile(residual, 1 - tail)), 2)}
    # Error in whole parking spaces, which is what a driver experiences.
    spaces_true = test_df["slot_capacity"] * (1 - y_test / 100)
    spaces_pred = test_df["slot_capacity"] * (1 - test_pred / 100)
    slots_mae = float(np.mean(np.abs(spaces_true - spaces_pred)))
    importance = feature_importance(final, X_test, y_test, "neg_mean_absolute_error")
    test_baseline = regression_metrics(
        y_test, X_test["slot_hist_occupancy"].fillna(fit_df[TARGET].mean()))

    # Deployed model: same settings, fitted on all the history.
    deployed = candidates()[best_name].fit(data[BASE_FEATURES], data[TARGET])
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(deployed, config.MODELS_DIR / config.AVAILABILITY_MODEL_FILE, compress=3)

    return {
        "name": "Parking availability",
        "problem_type": "regression",
        "target": "occupancy_rate (percent of spaces taken in a slot-hour)",
        "features": BASE_FEATURES,
        "rows_excluded": f"listings with capacity below {config.AVAILABILITY_MIN_CAPACITY}",
        "split": split_summary(train_df, val_df, test_df),
        "selection_metric": "validation MAE (lower is better)",
        "comparison": comparison,
        "selected_model": best_name,
        "test_metrics": test_metrics,
        "test_baseline_slot_average": test_baseline,
        "test_mae_spaces": round(slots_mae, 3),
        "prediction_interval": interval,
        "feature_importance": importance,
    }
