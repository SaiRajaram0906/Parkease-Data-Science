"""Model 3 - price response (regression) behind the price recommendation.

Approach: hybrid (option C of the brief).
  1. A regression model learns the market response in the history: by how
     much owners priced above or below their base price (price_ratio) for a
     given demand level, time, zone and listing.
  2. The recommendation applies that ratio to the owner's current price and
     then passes it through explainable rules (step size, caps, and a ceiling
     relative to similar listings). The rules are in ml/prediction.

Target   price_ratio = price_per_hour / base_price_per_hour.
Compare  Linear Regression, Decision Tree, Random Forest, Gradient Boosting.
Choose   lowest validation MAE.
Evaluated twice on the test period: with the true demand level, and with the
demand level predicted by Model 2, which is how it runs in the app.
"""
from __future__ import annotations

from typing import Dict, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.tree import DecisionTreeRegressor

from ml import config
from ml.evaluation.metrics import feature_importance, regression_metrics
from ml.training.common import (BASE_FEATURES, PRICE_FEATURES, make_pipeline, split_frames,
                                split_summary)

TARGET = "price_ratio"


def candidates() -> Dict[str, object]:
    seed = config.RANDOM_SEED
    return {
        "Linear Regression": make_pipeline(LinearRegression(), PRICE_FEATURES, scale=True),
        "Decision Tree": make_pipeline(
            DecisionTreeRegressor(max_depth=6, min_samples_leaf=30, random_state=seed),
            PRICE_FEATURES),
        "Random Forest": make_pipeline(
            RandomForestRegressor(n_estimators=200, min_samples_leaf=10, max_features=0.5,
                                  n_jobs=-1, random_state=seed), PRICE_FEATURES),
        "Gradient Boosting": make_pipeline(
            HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05,
                                          max_leaf_nodes=15, random_state=seed),
            PRICE_FEATURES),
    }


def _price_metrics(frame: pd.DataFrame, ratio_pred: np.ndarray) -> Dict[str, float]:
    """Errors in rupees per hour, which is what an owner cares about."""
    return regression_metrics(frame["price_per_hour"],
                              ratio_pred * frame["base_price_per_hour"])


def train(table: pd.DataFrame, demand_model: Optional[object] = None) -> Dict[str, object]:
    data = table[table["demand_num"].notna() & table[TARGET].notna()]
    train_df, val_df, test_df = split_frames(data)
    X_train, y_train = train_df[PRICE_FEATURES], train_df[TARGET]
    X_val, y_val = val_df[PRICE_FEATURES], val_df[TARGET]
    X_test, y_test = test_df[PRICE_FEATURES], test_df[TARGET]

    level_mean = train_df.groupby("demand_num")[TARGET].mean()
    comparison = [
        {"model": "Baseline: keep base price", "baseline": True,
         **regression_metrics(y_val, np.ones(len(y_val)))},
        {"model": "Baseline: average ratio per demand level", "baseline": True,
         **regression_metrics(y_val, X_val["demand_num"].map(level_mean))},
    ]
    for name, pipeline in candidates().items():
        pipeline.fit(X_train, y_train)
        comparison.append({"model": name, "baseline": False,
                           **regression_metrics(y_val, pipeline.predict(X_val))})
    best_name = min((row for row in comparison if not row["baseline"]),
                    key=lambda row: row["mae"])["model"]

    fit_df = pd.concat([train_df, val_df])
    final = candidates()[best_name].fit(fit_df[PRICE_FEATURES], fit_df[TARGET])
    test_pred = final.predict(X_test)
    result = {
        "name": "Price response",
        "problem_type": "regression",
        "target": "price_ratio (price charged / base price)",
        "features": PRICE_FEATURES,
        "rows_excluded": "slot-hours with a missing demand_level",
        "split": split_summary(train_df, val_df, test_df),
        "selection_metric": "validation MAE (lower is better)",
        "comparison": comparison,
        "selected_model": best_name,
        "test_metrics": regression_metrics(y_test, test_pred),
        "test_metrics_rupees": _price_metrics(test_df, test_pred),
        "test_baseline_keep_base_price_rupees": _price_metrics(test_df, np.ones(len(test_df))),
        "feature_importance": feature_importance(final, X_test, y_test,
                                                 "neg_mean_absolute_error"),
    }

    # How it runs in the app: demand comes from Model 2, not from the data.
    if demand_model is not None:
        predicted_level = pd.Series(demand_model.predict(test_df[BASE_FEATURES]),
                                    index=test_df.index)
        X_app = X_test.copy()
        X_app["demand_num"] = predicted_level.map(config.DEMAND_TO_NUMBER)
        app_pred = final.predict(X_app)
        result["test_metrics_with_predicted_demand"] = regression_metrics(y_test, app_pred)
        result["test_metrics_with_predicted_demand_rupees"] = _price_metrics(test_df, app_pred)

    deployed = candidates()[best_name].fit(data[PRICE_FEATURES], data[TARGET])
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(deployed, config.MODELS_DIR / config.PRICE_MODEL_FILE, compress=3)
    return result
