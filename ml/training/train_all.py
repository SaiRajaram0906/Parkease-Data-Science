"""Run the whole Data Science pipeline and train the three models.

    python -m ml.training.train_all

Steps: load -> validate -> clean -> features -> EDA summary -> train ->
evaluate -> save. Models are written to models/ and are only loaded, never
retrained, by the prediction service.

Models are saved with joblib and must be loaded with the same scikit-learn
version that trained them, so run this once on the machine that will run the
service.
"""
from __future__ import annotations

import json
import platform
import sys
import time
from datetime import datetime, timezone

import joblib
import pandas as pd
import sklearn

from ml import config
from ml.eda.analytics import dataset_overview
from ml.preprocessing.clean_data import clean_dataset, save_cleaned
from ml.preprocessing.demo_links import build_demo_links, save_demo_links
from ml.preprocessing.features import build_feature_table, build_serving_state, save_features
from ml.preprocessing.load_data import load_dataset
from ml.preprocessing.validate_data import validate, write_report
from ml.training import train_availability, train_demand, train_price
from ml.training.common import BASE_FEATURES, split_frames


def main() -> int:
    started = time.time()
    print("1/6 Loading and validating the dataset")
    data = load_dataset()
    report = validate(data)
    write_report(report)
    if not report["all_passed"]:
        print(f"   {report['checks_failed']} validation check(s) failed. "
              f"See {config.REPORTS_DIR / 'validation_report.txt'}. Training stopped.")
        return 1
    print(f"   {report['checks_passed']} of {report['checks_total']} checks passed")

    print("2/6 Cleaning and handling missing values")
    cleaned, cleaning_report = clean_dataset(data)
    save_cleaned(cleaned, cleaning_report)
    save_demo_links(build_demo_links(cleaned))

    print("3/6 Engineering features")
    table = build_feature_table(cleaned)
    save_features(table, build_serving_state(cleaned, table))
    print(f"   {len(table)} slot-hour rows")

    print("4/6 Computing the EDA summary")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    (config.REPORTS_DIR / "eda_overview.json").write_text(
        json.dumps(dataset_overview(cleaned)), encoding="utf-8")

    print("5/6 Training and evaluating models")
    availability = train_availability.train(table)
    print(f"   availability: {availability['selected_model']}  test {availability['test_metrics']}")
    demand = train_demand.train(table)
    print(f"   demand:       {demand['selected_model']}  test accuracy "
          f"{demand['test_metrics']['accuracy']}  macro-F1 {demand['test_metrics']['f1_macro']}")
    # For the price model's "as used in the app" test, demand must come from a
    # model that has not seen the test period.
    train_df, val_df, _ = split_frames(table[table["demand_level"].notna()])
    fit_df = pd.concat([train_df, val_df])
    honest_demand = train_demand.candidates()[demand["selected_model"]].fit(
        fit_df[BASE_FEATURES], fit_df["demand_level"])
    price = train_price.train(table, demand_model=honest_demand)
    print(f"   price:        {price['selected_model']}  test (Rs/h) {price['test_metrics_rupees']}")

    print("6/6 Saving metrics")
    metrics = {
        "synthetic_data": True,
        "notice": ("Models are trained and evaluated on synthetic data. Scores describe "
                   "how well the models fit the generated dataset, not real parking."),
        "trained_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "random_seed": config.RANDOM_SEED,
        "environment": {"python": platform.python_version(),
                        "scikit_learn": sklearn.__version__, "joblib": joblib.__version__},
        "data_files": data.files,
        "evaluation_design": (
            f"Time-based split. Train to {config.TRAIN_END}, validation to "
            f"{config.VALIDATION_END}, test after that. Models are compared on validation, "
            "the chosen one is refitted on train + validation and scored once on test. "
            "The deployed model is then refitted on all the history."),
        "models": {"availability": availability, "demand": demand, "price": price},
    }
    (config.MODELS_DIR / config.METRICS_FILE).write_text(json.dumps(metrics, indent=1),
                                                         encoding="utf-8")
    print(f"Done in {time.time() - started:.0f} s. Models and metrics are in {config.MODELS_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
