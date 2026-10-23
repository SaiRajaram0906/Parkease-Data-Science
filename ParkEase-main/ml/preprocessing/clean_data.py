"""Clean the ParkEase dataset and handle missing values.

Nothing is deleted. Every filled value is marked in a `<column>_imputed` flag
so later analysis can tell an observed value from a reconstructed one.

Strategy per column (see data/docs/DATASET_README.md):

occupancy_rate          exact: occupied_slots / slot_capacity * 100
booking_duration_hours  exact: total_amount / price_per_hour
price_per_hour          exact: total_amount / booking_duration_hours
distance_km             median distance of the same parking zone, learned
                        from the TRAINING period only (no leakage)
demand_level            copied from another booking in the same slot, date and
                        hour (the data dictionary guarantees they share one
                        level). Anything still missing stays missing: it is the
                        target of Model 2 and a target must not be guessed.
preferred_vehicle_type  inferred from the listings the user booked or owns,
                        otherwise the most common type
vehicle_type_supported  inferred from the vehicles of drivers who booked the
                        listing, otherwise the most common type in its zone

Run from the project root:

    python -m ml.preprocessing.clean_data
"""
from __future__ import annotations

import json
from typing import Dict, Optional, Tuple

import numpy as np
import pandas as pd

from ml import config
from ml.preprocessing.load_data import ParkEaseData, load_dataset


def _mode(series: pd.Series) -> Optional[str]:
    counts = series.dropna().value_counts()
    return None if counts.empty else str(counts.index[0])


# --------------------------------------------------------------------------
# Bookings
# --------------------------------------------------------------------------
def clean_bookings(bookings: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, object]]:
    df = bookings.copy()
    report: Dict[str, object] = {}

    # --- exact reconstructions ------------------------------------------
    for column in ("occupancy_rate", "booking_duration_hours", "price_per_hour"):
        df[f"{column}_imputed"] = df[column].isna().astype(int)

    missing = df["occupancy_rate"].isna()
    df.loc[missing, "occupancy_rate"] = (
        df.loc[missing, "occupied_slots"] / df.loc[missing, "slot_capacity"] * 100
    ).round(2)

    missing = df["booking_duration_hours"].isna()
    df.loc[missing, "booking_duration_hours"] = (
        df.loc[missing, "total_amount"] / df.loc[missing, "price_per_hour"]
    ).round(2)

    missing = df["price_per_hour"].isna()
    df.loc[missing, "price_per_hour"] = (
        df.loc[missing, "total_amount"] / df.loc[missing, "booking_duration_hours"]
    ).round(0)

    # --- distance: zone median fitted on the training period only --------
    df["distance_km_imputed"] = df["distance_km"].isna().astype(int)
    train = df[df["booking_date"] <= pd.Timestamp(config.TRAIN_END)]
    zone_median = train.groupby("parking_zone")["distance_km"].median()
    overall_median = float(train["distance_km"].median())
    missing = df["distance_km"].isna()
    df.loc[missing, "distance_km"] = (
        df.loc[missing, "parking_zone"].map(zone_median).fillna(overall_median)
    )
    report["distance_km_zone_medians"] = {k: round(float(v), 2) for k, v in zone_median.items()}

    # --- demand level: fill from the same slot, date and hour ------------
    before = int(df["demand_level"].isna().sum())
    group_level = (df.groupby(["slot_id", "booking_date", "hour"])["demand_level"]
                   .transform("first"))          # first non-missing in the group
    df["demand_level_imputed"] = (df["demand_level"].isna() & group_level.notna()).astype(int)
    df["demand_level"] = df["demand_level"].fillna(group_level)
    after = int(df["demand_level"].isna().sum())
    report["demand_level"] = {
        "missing_before": before,
        "filled_from_same_slot_hour": before - after,
        "left_missing": after,
    }

    # --- derived columns used everywhere --------------------------------
    df["month"] = df["booking_date"].dt.strftime("%Y-%m")
    df["is_cancelled"] = (df["booking_status"] == "Cancelled").astype(int)
    return df, report


# --------------------------------------------------------------------------
# Users and slots
# --------------------------------------------------------------------------
def _driver_vehicle_from_bookings(supported_types: set, frequency: Dict[str, int]) -> Optional[str]:
    """A vehicle type that could have used every listing the driver booked.

    When more than one type fits, the most specific one wins (an SUV fits
    fewer listing types than a car), then the more common one. A driver who
    only ever booked SUV listings is therefore taken to drive an SUV. The
    result can never contradict a booking the driver actually made.
    """
    candidates = [v for v, fits in config.VEHICLE_COMPATIBILITY.items()
                  if supported_types <= fits]
    if not candidates:
        return None
    candidates.sort(key=lambda v: (len(config.VEHICLE_COMPATIBILITY[v]), -frequency.get(v, 0)))
    return candidates[0]


def clean_users(users: pd.DataFrame, slots: pd.DataFrame,
                bookings: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, object]]:
    df = users.copy()
    df["preferred_vehicle_type_imputed"] = df["preferred_vehicle_type"].isna().astype(int)
    supported = bookings["slot_id"].map(slots.set_index("slot_id")["vehicle_type_supported"])
    booked_types = supported.dropna().groupby(bookings["driver_id"]).agg(set)
    owned_types = slots.dropna(subset=["vehicle_type_supported"]).groupby("owner_id")[
        "vehicle_type_supported"].agg(_mode)

    drivers_known = df.loc[df["role"] == "driver", "preferred_vehicle_type"]
    frequency = drivers_known.value_counts().to_dict()
    driver_mode = _mode(drivers_known)
    owner_mode = _mode(df.loc[df["role"] == "owner", "preferred_vehicle_type"])
    methods = {"inferred": 0, "mode": 0}

    for index in df.index[df["preferred_vehicle_type"].isna()]:
        user_id, role = df.at[index, "user_id"], df.at[index, "role"]
        value = None
        if role == "driver" and user_id in booked_types.index:
            value = _driver_vehicle_from_bookings(booked_types[user_id], frequency)
        elif role == "owner" and owned_types.get(user_id) in config.DRIVER_VEHICLE_TYPES:
            value = owned_types[user_id]
        if value is None:
            value = driver_mode if role == "driver" else owner_mode
            methods["mode"] += 1
        else:
            methods["inferred"] += 1
        df.at[index, "preferred_vehicle_type"] = value
    return df, {"preferred_vehicle_type": methods}


def clean_slots(slots: pd.DataFrame, users: pd.DataFrame,
                bookings: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, object]]:
    df = slots.copy()
    df["vehicle_type_supported_imputed"] = df["vehicle_type_supported"].isna().astype(int)
    vehicle = bookings["driver_id"].map(users.set_index("user_id")["preferred_vehicle_type"])
    seen = vehicle.dropna().groupby(bookings["slot_id"]).agg(set)
    zone_mode = df.groupby("parking_zone")["vehicle_type_supported"].agg(_mode)
    methods = {"inferred": 0, "mode": 0}

    for index in df.index[df["vehicle_type_supported"].isna()]:
        vehicles = seen.get(df.at[index, "slot_id"], set())
        if not vehicles:
            value = zone_mode[df.at[index, "parking_zone"]]
            methods["mode"] += 1
        else:
            if vehicles == {"Two-Wheeler"}:
                value = "Two-Wheeler"
            elif vehicles == {"Car"}:
                value = "Car"
            elif vehicles <= {"Car", "SUV"}:
                value = "SUV"            # SUV listings also take cars
            else:
                value = "All"
            methods["inferred"] += 1
        df.at[index, "vehicle_type_supported"] = value

    # Price of a listing relative to similar listings (same zone and vehicle
    # type). Uses listing attributes only, so it carries no booking outcome.
    peer_median = df.groupby(["parking_zone", "vehicle_type_supported"])[
        "base_price_per_hour"].transform("median")
    df["peer_median_price"] = peer_median
    df["price_rel_peers"] = (df["base_price_per_hour"] / peer_median).round(4)
    return df, {"vehicle_type_supported": methods}


# --------------------------------------------------------------------------
# Whole dataset
# --------------------------------------------------------------------------
def clean_dataset(data: Optional[ParkEaseData] = None
                  ) -> Tuple[ParkEaseData, Dict[str, object]]:
    """Return a cleaned copy of the dataset and a report of what was filled."""
    data = data or load_dataset()
    report: Dict[str, object] = {
        "missing_before": {
            "users": {k: int(v) for k, v in data.users.isna().sum().items() if v},
            "slots": {k: int(v) for k, v in data.slots.isna().sum().items() if v},
            "bookings": {k: int(v) for k, v in data.bookings.isna().sum().items() if v},
        }
    }
    bookings, bookings_report = clean_bookings(data.bookings)
    # Slots first (uses the drivers' known vehicles), then users (uses the
    # completed slot types).
    slots, slots_report = clean_slots(data.slots, data.users, data.bookings)
    users, users_report = clean_users(data.users, slots, data.bookings)

    base_price = bookings["slot_id"].map(slots.set_index("slot_id")["base_price_per_hour"])
    bookings["base_price_per_hour"] = base_price
    bookings["price_ratio"] = (bookings["price_per_hour"] / base_price).round(4)

    report.update({"bookings": bookings_report, "users": users_report, "slots": slots_report})
    report["missing_after"] = {
        "users": {k: int(v) for k, v in users.isna().sum().items() if v},
        "slots": {k: int(v) for k, v in slots.isna().sum().items() if v},
        "bookings": {k: int(v) for k, v in bookings.isna().sum().items() if v},
    }
    report["rows"] = {"users": len(users), "slots": len(slots), "bookings": len(bookings)}

    # The exact reconstructions must reproduce the documented arithmetic.
    check = (bookings["total_amount"]
             - bookings["price_per_hour"] * bookings["booking_duration_hours"]).abs()
    report["max_total_amount_error_after_cleaning"] = round(float(check.max()), 4)

    cleaned = ParkEaseData(users=users, slots=slots, bookings=bookings,
                           source_dir=data.source_dir, files=data.files)
    return cleaned, report


def save_cleaned(cleaned: ParkEaseData, report: Dict[str, object]) -> None:
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    cleaned.users.to_csv(config.PROCESSED_DIR / config.CLEAN_USERS_FILE, index=False)
    cleaned.slots.to_csv(config.PROCESSED_DIR / config.CLEAN_SLOTS_FILE, index=False)
    cleaned.bookings.to_csv(config.PROCESSED_DIR / config.CLEAN_BOOKINGS_FILE, index=False)
    (config.PROCESSED_DIR / config.CLEANING_REPORT_FILE).write_text(
        json.dumps(report, indent=2), encoding="utf-8")


def load_cleaned() -> ParkEaseData:
    """Read the cleaned tables written by save_cleaned()."""
    users = pd.read_csv(config.PROCESSED_DIR / config.CLEAN_USERS_FILE,
                        parse_dates=["registration_date"])
    slots = pd.read_csv(config.PROCESSED_DIR / config.CLEAN_SLOTS_FILE)
    bookings = pd.read_csv(config.PROCESSED_DIR / config.CLEAN_BOOKINGS_FILE,
                           parse_dates=["booking_date"])
    return ParkEaseData(users=users, slots=slots, bookings=bookings,
                        source_dir=config.PROCESSED_DIR)


if __name__ == "__main__":
    cleaned_data, cleaning_report = clean_dataset()
    save_cleaned(cleaned_data, cleaning_report)
    print(json.dumps(cleaning_report, indent=2))
    print("Cleaned tables written to", config.PROCESSED_DIR)
