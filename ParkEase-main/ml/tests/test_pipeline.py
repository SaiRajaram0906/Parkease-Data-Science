"""Tests for the ParkEase Data Science layer.

Run from the project root, after `python -m ml.training.train_all`:

    python -m pytest ml/tests -q
"""
from __future__ import annotations

import datetime as dt
import shutil

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from ml import config
from ml.eda.analytics import dataset_overview, driver_analytics, owner_analytics
from ml.prediction.predictor import Predictor
from ml.preprocessing.clean_data import clean_dataset
from ml.preprocessing.features import HISTORY_FEATURES, build_feature_table
from ml.preprocessing.load_data import DatasetError, load_dataset
from ml.preprocessing.validate_data import validate
from ml.training.common import BASE_FEATURES, PRICE_FEATURES

DAY = dt.date(2026, 10, 6)
LINKED = {"id": 1, "name": "Linked", "latitude": 13.057985, "longitude": 80.247164,
          "price_per_hour": 80, "total_slots": 4, "vehicle_type": "car",
          "dataset_slot_id": "SLOT0179", "is_active": True}
NEW_SPOT = {"id": 2, "name": "New", "latitude": 13.0382, "longitude": 80.2285,
            "price_per_hour": 50, "total_slots": 2, "vehicle_type": "both", "is_active": True}
FAR_SPOT = {"id": 3, "name": "Mumbai", "latitude": 19.076, "longitude": 72.877,
            "price_per_hour": 60, "total_slots": 1, "vehicle_type": "car", "is_active": True}


@pytest.fixture(scope="session")
def raw():
    return load_dataset()


@pytest.fixture(scope="session")
def cleaned(raw):
    return clean_dataset(raw)


@pytest.fixture(scope="session")
def table(cleaned):
    return build_feature_table(cleaned[0])


@pytest.fixture(scope="session")
def predictor():
    instance = Predictor()
    assert instance.ready, instance.load_error
    return instance


@pytest.fixture(scope="session")
def client():
    from ml.service.app import app
    return TestClient(app)


# ----------------------------------------------------------------- loading
def test_dataset_loads_with_expected_shape(raw):
    assert len(raw.users) == 1800 and len(raw.slots) == 500 and len(raw.bookings) == 42378
    assert list(raw.bookings.columns) == config.BOOKINGS_COLUMNS
    assert str(raw.bookings["booking_date"].dtype).startswith("datetime64")


def test_loader_rejects_a_missing_column(tmp_path):
    for name in (config.USERS_FILE, config.SLOTS_FILE, config.BOOKINGS_FILE):
        shutil.copy(config.RAW_DIR / name, tmp_path / name)
    frame = pd.read_csv(tmp_path / config.BOOKINGS_FILE, dtype=str).drop(columns=["hour"])
    frame.to_csv(tmp_path / config.BOOKINGS_FILE, index=False)
    with pytest.raises(DatasetError):
        load_dataset(tmp_path)


def test_loader_reports_a_missing_file(tmp_path):
    with pytest.raises(DatasetError):
        load_dataset(tmp_path)


# -------------------------------------------------------------- validation
def test_all_validation_checks_pass(raw):
    report = validate(raw)
    assert report["all_passed"], [c for c in report["checks"] if not c["passed"]]


def test_validation_catches_a_broken_total(tmp_path):
    for name in (config.USERS_FILE, config.SLOTS_FILE, config.BOOKINGS_FILE):
        shutil.copy(config.RAW_DIR / name, tmp_path / name)
    frame = pd.read_csv(tmp_path / config.BOOKINGS_FILE, dtype=str)
    frame.loc[5, "total_amount"] = "99999"
    frame.to_csv(tmp_path / config.BOOKINGS_FILE, index=False)
    failed = [c["name"] for c in validate(load_dataset(tmp_path))["checks"] if not c["passed"]]
    assert any("total_amount" in name for name in failed)


# ---------------------------------------------------------------- cleaning
def test_cleaning_keeps_every_row_and_never_touches_raw(raw, cleaned):
    data, _ = cleaned
    assert len(data.bookings) == len(raw.bookings)
    assert raw.bookings["occupancy_rate"].isna().sum() == 636   # raw frame unchanged


def test_exact_reconstructions_are_exact(cleaned):
    b = cleaned[0].bookings
    assert b[["occupancy_rate", "booking_duration_hours", "price_per_hour", "distance_km"]].notna().all().all()
    assert np.allclose(b["occupancy_rate"], (b["occupied_slots"] / b["slot_capacity"] * 100).round(2))
    assert np.allclose(b["total_amount"], b["price_per_hour"] * b["booking_duration_hours"], atol=0.011)


def test_demand_target_is_not_guessed(cleaned):
    data, report = cleaned
    info = report["bookings"]["demand_level"]
    assert info["left_missing"] == data.bookings["demand_level"].isna().sum() > 0
    assert set(data.bookings["demand_level"].dropna()) == set(config.DEMAND_LEVELS)


def test_distance_imputation_uses_training_period_only(raw, cleaned):
    train = raw.bookings[raw.bookings["booking_date"] <= pd.Timestamp(config.TRAIN_END)]
    expected = train.groupby("parking_zone")["distance_km"].median().round(2).to_dict()
    assert cleaned[1]["bookings"]["distance_km_zone_medians"] == expected


def test_vehicle_imputation_respects_compatibility(cleaned):
    data, _ = cleaned
    vehicle = data.bookings["driver_id"].map(data.users.set_index("user_id")["preferred_vehicle_type"])
    supported = data.bookings["slot_id"].map(data.slots.set_index("slot_id")["vehicle_type_supported"])
    fits = [s in config.VEHICLE_COMPATIBILITY[v] for v, s in zip(vehicle, supported)]
    assert all(fits)


# ---------------------------------------------------------------- features
def test_feature_lists_exclude_leaky_columns():
    leaky = {"occupancy_rate", "occupied_slots", "available_slots"}
    assert not leaky & set(BASE_FEATURES)
    assert not leaky & set(PRICE_FEATURES)
    assert "price_per_hour" not in BASE_FEATURES and "price_ratio" not in BASE_FEATURES
    assert "demand_level" not in BASE_FEATURES and "demand_num" not in BASE_FEATURES


def test_history_features_use_only_earlier_days(table):
    rng = np.random.default_rng(config.RANDOM_SEED)
    for i in rng.choice(len(table), 60, replace=False):
        row = table.iloc[i]
        past = table[(table["slot_id"] == row["slot_id"]) & (table["booking_date"] < row["booking_date"])]
        expected = past["occupancy_rate"].mean() if len(past) else np.nan
        actual = row["slot_hist_occupancy"]
        assert (np.isnan(expected) and np.isnan(actual)) or abs(expected - actual) < 1e-6


def test_first_day_has_no_history(table):
    first = table[table["booking_date"] == table["booking_date"].min()]
    assert first[HISTORY_FEATURES].isna().all().all()


def test_split_is_chronological(table):
    order = table.groupby("split")["booking_date"].agg(["min", "max"])
    assert order.loc["train", "max"] < order.loc["validation", "min"]
    assert order.loc["validation", "max"] < order.loc["test", "min"]


# --------------------------------------------------------------- analytics
def test_overview_matches_the_data(cleaned):
    data, _ = cleaned
    overview = dataset_overview(data)
    completed = data.bookings[data.bookings["booking_status"] == "Completed"]
    assert overview["totals"]["bookings"] == 42378
    assert overview["totals"]["completed_revenue"] == pytest.approx(completed["total_amount"].sum())
    assert sum(z["bookings"] for z in overview["zones"]) == 42378
    assert sum(z["completed_revenue"] for z in overview["zones"]) == pytest.approx(completed["total_amount"].sum())
    assert len(overview["insights"]) >= 6


def test_owner_revenue_counts_completed_bookings_only(cleaned):
    b = cleaned[0].bookings
    mine = b[b["owner_id"] == "OWN0028"]
    result = owner_analytics(mine, 7)
    assert result["completed_revenue"] == pytest.approx(
        mine.loc[mine["booking_status"] == "Completed", "total_amount"].sum())
    assert result["completed_revenue"] < mine["total_amount"].sum()


def test_analytics_empty_states(cleaned):
    empty = cleaned[0].bookings.iloc[0:0]
    assert driver_analytics(empty) == {"has_data": False, "total_bookings": 0}
    assert owner_analytics(empty, 2)["has_data"] is False


# -------------------------------------------------------------- prediction
def test_availability_prediction_is_bounded_and_consistent(predictor):
    result = predictor.availability(LINKED, DAY, config.SERVICE_HOURS)
    for hour in result["hours"]:
        assert hour["available"] and 0 <= hour["predicted_occupancy"] <= 100
        assert hour["occupancy_low"] <= hour["predicted_occupancy"] <= hour["occupancy_high"]
        assert 0 <= hour["available_low"] <= hour["available_high"] <= LINKED["total_slots"]


def test_no_prediction_outside_the_history_hours(predictor):
    hour = predictor.availability(LINKED, DAY, [3])["hours"][0]
    assert hour["available"] is False and "predicted_occupancy" not in hour


def test_predictions_are_deterministic(predictor):
    first = predictor.demand(NEW_SPOT, DAY)
    second = predictor.demand(NEW_SPOT, DAY)
    assert first["hours"] == second["hours"]


def test_predictions_respond_to_inputs(predictor):
    """A model, not a constant: different hours and spots give different answers."""
    hours = predictor.availability(LINKED, DAY, config.SERVICE_HOURS)["hours"]
    assert len({h["predicted_occupancy"] for h in hours}) > 5
    other = predictor.availability(NEW_SPOT, DAY, [18])["hours"][0]["predicted_occupancy"]
    assert other != [h for h in hours if h["hour"] == 18][0]["predicted_occupancy"]
    levels = {h["level"] for h in predictor.demand(LINKED, DAY)["hours"]}
    assert len(levels) >= 2


def test_demand_probabilities_sum_to_one(predictor):
    for hour in predictor.demand(LINKED, DAY)["hours"]:
        assert sum(hour["probabilities"].values()) == pytest.approx(1.0, abs=0.01)
        assert hour["level"] == max(hour["probabilities"], key=hour["probabilities"].get)


def test_zone_matching(predictor):
    assert predictor.describe_spot(LINKED)["zone_match"]["method"] == "history"
    assert predictor.describe_spot(NEW_SPOT)["zone_match"]["method"] == "location"
    assert predictor.describe_spot(FAR_SPOT)["zone_match"]["method"] == "price_profile"


def test_single_space_listing_uses_documented_fallback(predictor):
    hour = predictor.availability(FAR_SPOT, DAY, [18])["hours"][0]
    assert hour["method"] == "zone_baseline"


def test_price_recommendation_respects_the_rules(predictor):
    for spot in (LINKED, NEW_SPOT, dict(NEW_SPOT, price_per_hour=20), dict(LINKED, price_per_hour=200)):
        for hour in (None, 9, 13, 22):
            result = predictor.price_recommendation(spot, DAY, hour)
            current, suggested = result["current_price"], result["recommended_price"]
            assert suggested % config.PRICE_STEP == 0 or suggested == current
            assert suggested <= current * (1 + config.PRICE_MAX_INCREASE) + config.PRICE_STEP / 2
            assert suggested >= current * (1 - config.PRICE_MAX_DECREASE) - config.PRICE_STEP / 2
            if suggested > current:
                assert suggested <= result["peer_median_price"] * config.PRICE_PEER_CEILING
            assert result["reasons"] and result["owner_decides"] is True


def test_price_recommendation_without_a_price(predictor):
    assert predictor.price_recommendation(dict(NEW_SPOT, price_per_hour=0), DAY)["available"] is False


# ---------------------------------------------------------- recommendation
def _recommend(predictor, **kwargs):
    spots = [LINKED, NEW_SPOT, dict(NEW_SPOT, id=4, price_per_hour=30, latitude=13.045),
             dict(NEW_SPOT, id=5, vehicle_type="bike"), dict(NEW_SPOT, id=6, is_active=False),
             dict(NEW_SPOT, id=7, current_available=0), FAR_SPOT]
    origin = {"latitude": 13.04, "longitude": 80.23}
    return predictor.recommend(spots, DAY, 18, origin=origin, vehicle="car",
                               radius_km=config.RECOMMENDATION_RADIUS_KM, **kwargs)


def test_recommendation_score_is_the_documented_formula(predictor):
    result = _recommend(predictor)
    weights = result["weights"]
    assert sum(weights.values()) == pytest.approx(1.0, abs=0.01)
    scores = [r["score"] for r in result["recommendations"]]
    assert scores == sorted(scores, reverse=True)
    for item in result["recommendations"]:
        recomputed = 100 * sum(weights[k] * item["components"][k] for k in weights)
        assert item["score"] == pytest.approx(recomputed, abs=0.2)
        assert all(0 <= v <= 1 for v in item["components"].values())


def test_recommendation_filters(predictor):
    result = _recommend(predictor)
    ids = {r["spot_id"] for r in result["recommendations"]}
    assert ids == {1, 2, 4}
    assert result["excluded"] == {"inactive": 1, "vehicle": 1, "too_far": 1,
                                  "fully_booked": 1, "no_prediction": 0}


def test_recommendation_weights_are_configurable(predictor):
    by_price = _recommend(predictor, weights={"availability": 0, "distance": 0, "price": 1, "history": 0})
    assert by_price["recommendations"][0]["spot_id"] == 4          # the cheapest
    by_distance = _recommend(predictor, weights={"availability": 0, "distance": 1, "price": 0, "history": 0})
    distances = [r["distance_km"] for r in by_distance["recommendations"]]
    assert distances == sorted(distances)


def test_recommendation_without_location_drops_distance(predictor):
    result = predictor.recommend([LINKED, NEW_SPOT], DAY, 18)
    assert result["weights"]["distance"] == 0
    assert sum(result["weights"].values()) == pytest.approx(1.0, abs=0.01)


# --------------------------------------------------------------------- API
def test_api_health_and_static_reports(client):
    assert client.get("/health").json()["models_ready"] is True
    for path in ("/analytics/overview", "/models/performance", "/dataset/validation", "/demo/links"):
        assert client.get(path).status_code == 200, path


def test_api_predictions(client):
    body = {"spot": LINKED, "date": "2026-10-06"}
    assert len(client.post("/predict/availability", json=body).json()["hours"]) == 18
    assert len(client.post("/predict/demand", json=body).json()["hours"]) == 18
    assert client.post("/recommend/price", json=body).json()["available"] is True
    ranked = client.post("/recommend/parking", json={"spots": [LINKED, NEW_SPOT], "hour": 18}).json()
    assert len(ranked["recommendations"]) == 2


def test_api_rejects_bad_input(client):
    assert client.post("/recommend/price", json={"spot": LINKED, "hour": 30}).status_code == 422
    assert client.post("/predict/availability", json={}).status_code == 422


def test_api_live_analytics(client):
    booking = {"id": 1, "spot_id": 2, "start_time": "2026-10-05T04:30:00Z",
               "duration_hours": 2, "total_amount": 100, "status": "completed"}
    result = client.post("/analytics/driver", json={"bookings": [booking], "spots": [NEW_SPOT]}).json()
    assert result["has_data"] and result["total_bookings"] == 1 and result["source"] == "live"
    assert result["preferred_hour"] == 10                 # 04:30 UTC is 10:00 in India
    empty = client.post("/analytics/owner", json={"bookings": [], "spots": [NEW_SPOT]}).json()
    assert empty["has_data"] is False and empty["listings"] == 1


def test_models_missing_gives_a_clear_error_not_numbers(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "MODELS_DIR", tmp_path)
    blank = Predictor()
    assert blank.ready is False and "train_all" in blank.load_error
    from ml.prediction.predictor import ModelsNotReady
    with pytest.raises(ModelsNotReady):
        blank.availability(LINKED, DAY, [9])
