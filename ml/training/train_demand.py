"""Model 2 - parking demand (classification: Low / Medium / High).

Compare  Logistic Regression, Decision Tree, Random Forest.
Choose   highest validation macro-F1 (the classes are unbalanced, so accuracy
         alone would reward ignoring the smallest class).
Leakage  price_per_hour and same-hour occupancy are not features.
Rows whose demand_level is missing are not used: a target is never imputed.
"""
from __future__ import annotations

from typing import Dict

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier

from ml import config
from ml.evaluation.metrics import classification_metrics, feature_importance
from ml.training.common import BASE_FEATURES, make_pipeline, split_frames, split_summary

TARGET = "demand_level"
LABELS = config.DEMAND_LEVELS


def candidates() -> Dict[str, object]:
    seed = config.RANDOM_SEED
    return {
        "Logistic Regression": make_pipeline(
            LogisticRegression(max_iter=2000, C=1.0, random_state=seed),
            BASE_FEATURES, scale=True),
        "Decision Tree": make_pipeline(
            DecisionTreeClassifier(max_depth=8, min_samples_leaf=20, random_state=seed),
            BASE_FEATURES),
        "Random Forest": make_pipeline(
            RandomForestClassifier(n_estimators=300, min_samples_leaf=5, max_features="sqrt",
                                   n_jobs=-1, random_state=seed), BASE_FEATURES),
    }


def _brief(metrics: Dict[str, object]) -> Dict[str, object]:
    return {k: metrics[k] for k in ("accuracy", "precision_macro", "recall_macro", "f1_macro")}


def train(table: pd.DataFrame) -> Dict[str, object]:
    data = table[table[TARGET].notna()]
    train_df, val_df, test_df = split_frames(data)
    X_train, y_train = train_df[BASE_FEATURES], train_df[TARGET]
    X_val, y_val = val_df[BASE_FEATURES], val_df[TARGET]
    X_test, y_test = test_df[BASE_FEATURES], test_df[TARGET]

    majority = y_train.value_counts().index[0]
    comparison = [{"model": f"Baseline: always {majority}", "baseline": True,
                   **_brief(classification_metrics(y_val, np.full(len(y_val), majority), LABELS))}]
    for name, pipeline in candidates().items():
        pipeline.fit(X_train, y_train)
        comparison.append({"model": name, "baseline": False,
                           **_brief(classification_metrics(y_val, pipeline.predict(X_val), LABELS))})
    best_name = max((row for row in comparison if not row["baseline"]),
                    key=lambda row: row["f1_macro"])["model"]

    fit_df = pd.concat([train_df, val_df])
    final = candidates()[best_name].fit(fit_df[BASE_FEATURES], fit_df[TARGET])
    test_pred = final.predict(X_test)
    test_metrics = classification_metrics(y_test, test_pred, LABELS)
    test_majority = fit_df[TARGET].value_counts().index[0]
    test_baseline = _brief(classification_metrics(y_test, np.full(len(y_test), test_majority), LABELS))
    # Being wrong by two levels (Low <-> High) is the costly mistake.
    actual_num = y_test.map(config.DEMAND_TO_NUMBER).to_numpy()
    predicted_num = pd.Series(test_pred).map(config.DEMAND_TO_NUMBER).to_numpy()
    importance = feature_importance(final, X_test, y_test, "f1_macro")

    deployed = candidates()[best_name].fit(data[BASE_FEATURES], data[TARGET])
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(deployed, config.MODELS_DIR / config.DEMAND_MODEL_FILE, compress=3)

    def distribution(series: pd.Series) -> Dict[str, object]:
        counts = series.value_counts()
        return {label: {"count": int(counts.get(label, 0)),
                        "share": round(float(counts.get(label, 0)) / len(series) * 100, 1)}
                for label in LABELS}

    return {
        "name": "Parking demand",
        "problem_type": "classification",
        "target": "demand_level (Low / Medium / High) of a slot-hour",
        "features": BASE_FEATURES,
        "rows_excluded": "slot-hours with a missing demand_level",
        "split": split_summary(train_df, val_df, test_df),
        "selection_metric": "validation macro-F1 (higher is better)",
        "comparison": comparison,
        "selected_model": best_name,
        "test_metrics": test_metrics,
        "test_baseline_majority": test_baseline,
        "test_within_one_level": round(float(np.mean(np.abs(actual_num - predicted_num) <= 1)), 4),
        "class_distribution": {"train": distribution(fit_df[TARGET]),
                               "test": distribution(y_test)},
        "feature_importance": importance,
    }
