"""Feature engineering for the ParkEase models.

Unit of analysis
----------------
One row per (slot, date, hour) in which at least one booking was made, called
a "slot-hour". Demand level and price are constant inside a slot-hour (data
dictionary), and occupancy is taken from the FIRST booking of the hour, i.e.
how full the listing was before ParkEase bookings in that hour were added.

Leakage rules
-------------
1. Every historical feature of a row uses only days strictly BEFORE that row's
   date. Same-day information is never used.
2. occupied_slots, available_slots and occupancy_rate are the same quantity,
   so none of them is a feature for another.
3. price_per_hour already reflects demand, so it is not a feature of the
   demand model. It is the target of the price model.

The same definitions are reused at prediction time through the "serving
state": the latest value of each historical feature at the end of the data.

Run from the project root:

    python -m ml.preprocessing.features
"""
from __future__ import annotations

import json
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from ml import config
from ml.preprocessing.clean_data import clean_dataset
from ml.preprocessing.load_data import ParkEaseData

# Columns that identify a slot-hour or hold targets; never used as features.
ID_COLUMNS = ["slot_id", "owner_id", "booking_date", "split"]
TARGET_COLUMNS = ["occupancy_rate", "available_slots", "demand_level",
                  "demand_num", "price_per_hour", "price_ratio"]

TIME_FEATURES = ["hour", "day_of_week_num", "is_weekend", "is_holiday",
                 "is_off_day", "peak_hour", "morning_peak", "evening_peak"]
# Engineered for EDA but not given to the models: one year of data cannot
# separate a seasonal effect from the growth trend, and the test months never
# appear in the training period.
CALENDAR_ONLY_FEATURES = ["day_of_month", "month_num", "week_of_year"]
SLOT_FEATURES = ["slot_capacity", "base_price_per_hour", "price_rel_peers"]
CATEGORICAL_FEATURES = ["parking_zone", "vehicle_type_supported"]
HISTORY_FEATURES = [
    "slot_hist_occupancy",        # mean occupancy of the slot on earlier days
    "slot_prev_day_occupancy",    # occupancy on the slot's previous booked day
    "slot_rolling_occupancy",     # mean over the slot's previous 7 booked days
    "slot_hist_bookings_per_day",  # booking frequency of the slot so far
    "slot_hist_demand",           # mean demand (0 low .. 2 high) so far
    "slot_hist_duration",         # mean booking length so far
    "zone_hour_hist_occupancy",   # zone x hour x day-type occupancy so far
    "zone_hour_hist_demand",      # zone x hour x day-type demand so far
    "zone_hour_hist_bookings",    # zone x hour x day-type bookings per day
]


def split_label(dates: pd.Series) -> pd.Series:
    """train / validation / test by calendar date."""
    label = pd.Series("test", index=dates.index)
    label[dates <= pd.Timestamp(config.VALIDATION_END)] = "validation"
    label[dates <= pd.Timestamp(config.TRAIN_END)] = "train"
    return label


def add_time_features(df: pd.DataFrame, date_column: str = "booking_date") -> pd.DataFrame:
    """Calendar features from the date and hour. Safe to use for future dates."""
    date = df[date_column]
    df["day_of_week_num"] = date.dt.dayofweek          # Monday = 0
    df["day_of_month"] = date.dt.day
    df["month_num"] = date.dt.month
    df["week_of_year"] = date.dt.isocalendar().week.astype(int)
    df["is_weekend"] = (df["day_of_week_num"] >= 5).astype(int)
    # Holidays behave like weekends in the hourly profile.
    df["is_off_day"] = ((df["is_weekend"] == 1) | (df["is_holiday"] == 1)).astype(int)
    working = df["is_off_day"] == 0
    df["morning_peak"] = (working & df["hour"].isin(config.MORNING_PEAK_HOURS)).astype(int)
    df["evening_peak"] = (working & df["hour"].isin(config.EVENING_PEAK_HOURS)).astype(int)
    df["peak_hour"] = ((df["morning_peak"] == 1) | (df["evening_peak"] == 1)).astype(int)
    return df


# --------------------------------------------------------------------------
# Slot-hour table
# --------------------------------------------------------------------------
def build_slot_hours(cleaned: ParkEaseData) -> pd.DataFrame:
    """Collapse bookings to one row per slot, date and hour."""
    b = cleaned.bookings.sort_values(["slot_id", "booking_date", "hour", "occupied_slots"])
    grouped = b.groupby(["slot_id", "booking_date", "hour"], sort=False)
    table = grouped.agg(
        owner_id=("owner_id", "first"),
        parking_zone=("parking_zone", "first"),
        is_holiday=("is_holiday", "first"),
        slot_capacity=("slot_capacity", "first"),
        occupied_slots=("occupied_slots", "min"),      # before this hour's bookings
        bookings=("booking_id", "count"),
        cancelled=("is_cancelled", "sum"),
        demand_level=("demand_level", "first"),        # first non-missing
        price_per_hour=("price_per_hour", "first"),
        duration_mean=("booking_duration_hours", "mean"),
    ).reset_index()

    table["available_slots"] = table["slot_capacity"] - table["occupied_slots"]
    table["occupancy_rate"] = (table["occupied_slots"] / table["slot_capacity"] * 100).round(2)
    table["demand_num"] = table["demand_level"].map(config.DEMAND_TO_NUMBER)

    slot_columns = ["slot_id", "base_price_per_hour", "vehicle_type_supported",
                    "price_rel_peers", "peer_median_price"]
    table = table.merge(cleaned.slots[slot_columns], on="slot_id", how="left")
    table["price_ratio"] = (table["price_per_hour"] / table["base_price_per_hour"]).round(4)
    return table


# --------------------------------------------------------------------------
# History features (strictly earlier days only)
# --------------------------------------------------------------------------
def _prior_mean(df: pd.DataFrame, keys: List[str], value: str,
                weight: Optional[str] = None) -> pd.Series:
    """Mean of `value` within `keys` over all dates before the row's date.

    Works on daily totals: the running total up to and including a day minus
    that day's own total leaves exactly the earlier days.
    """
    work = df[keys + ["booking_date"]].copy()
    w = df[weight] if weight else 1.0
    valid = df[value].notna()
    work["_sum"] = (df[value] * w).where(valid, 0.0)
    work["_n"] = (w if weight else 1.0) * valid.astype(float)
    daily = (work.groupby(keys + ["booking_date"], sort=True)[["_sum", "_n"]].sum()
             .reset_index())
    cumulative = daily.groupby(keys)[["_sum", "_n"]].cumsum()
    daily["_prior_sum"] = cumulative["_sum"] - daily["_sum"]
    daily["_prior_n"] = cumulative["_n"] - daily["_n"]
    daily["_mean"] = daily["_prior_sum"] / daily["_prior_n"].where(daily["_prior_n"] > 0)
    merged = df[keys + ["booking_date"]].merge(
        daily[keys + ["booking_date", "_mean"]], on=keys + ["booking_date"], how="left")
    return pd.Series(merged["_mean"].to_numpy(), index=df.index)


def add_history_features(table: pd.DataFrame) -> pd.DataFrame:
    """Add the HISTORY_FEATURES columns. See the module docstring for the rules."""
    df = table.sort_values(["booking_date", "slot_id", "hour"]).reset_index(drop=True)

    # --- slot level ------------------------------------------------------
    df["slot_hist_occupancy"] = _prior_mean(df, ["slot_id"], "occupancy_rate")
    df["slot_hist_demand"] = _prior_mean(df, ["slot_id"], "demand_num")
    df["slot_hist_duration"] = _prior_mean(df, ["slot_id"], "duration_mean", weight="bookings")

    slot_day = (df.groupby(["slot_id", "booking_date"], sort=True)
                .agg(day_occupancy=("occupancy_rate", "mean"),
                     day_bookings=("bookings", "sum")).reset_index())
    by_slot = slot_day.groupby("slot_id")
    slot_day["slot_prev_day_occupancy"] = by_slot["day_occupancy"].shift(1)
    slot_day["slot_rolling_occupancy"] = by_slot["day_occupancy"].transform(
        lambda s: s.shift(1).rolling(config.ROLLING_DAYS, min_periods=1).mean())
    prior_bookings = by_slot["day_bookings"].cumsum() - slot_day["day_bookings"]
    first_seen = by_slot["booking_date"].transform("min")
    # Days the slot has been observed so far (at least one week, so a slot
    # seen for the first time yesterday does not get an inflated frequency).
    observed_days = (slot_day["booking_date"] - first_seen).dt.days.clip(lower=7)
    slot_day["slot_hist_bookings_per_day"] = (prior_bookings / observed_days).where(
        slot_day["booking_date"] > first_seen)
    df = df.merge(
        slot_day[["slot_id", "booking_date", "slot_prev_day_occupancy",
                  "slot_rolling_occupancy", "slot_hist_bookings_per_day"]],
        on=["slot_id", "booking_date"], how="left")

    # --- zone x hour x day-type level -----------------------------------
    keys = ["parking_zone", "hour", "is_off_day"]
    df["zone_hour_hist_occupancy"] = _prior_mean(df, keys, "occupancy_rate")
    df["zone_hour_hist_demand"] = _prior_mean(df, keys, "demand_num")

    # Bookings per day of that day-type, over earlier days only.
    calendar = (df[["booking_date", "is_off_day"]].drop_duplicates()
                .sort_values("booking_date"))
    calendar["days_before"] = calendar.groupby("is_off_day").cumcount()
    zone_day = (df.groupby(keys + ["booking_date"], sort=True)["bookings"].sum()
                .reset_index())
    zone_day["prior_bookings"] = (zone_day.groupby(keys)["bookings"].cumsum()
                                  - zone_day["bookings"])
    zone_day = zone_day.merge(calendar, on=["booking_date", "is_off_day"], how="left")
    zone_day["zone_hour_hist_bookings"] = (
        zone_day["prior_bookings"] / zone_day["days_before"].where(zone_day["days_before"] > 0))
    df = df.merge(zone_day[keys + ["booking_date", "zone_hour_hist_bookings"]],
                  on=keys + ["booking_date"], how="left")
    return df


def build_feature_table(cleaned: Optional[ParkEaseData] = None) -> pd.DataFrame:
    """Full modelling table: slot-hours + time features + history features."""
    if cleaned is None:
        cleaned, _ = clean_dataset()
    table = build_slot_hours(cleaned)
    table = add_time_features(table)
    table = add_history_features(table)
    table["split"] = split_label(table["booking_date"])
    return table


# --------------------------------------------------------------------------
# Serving state: the history features as they stand at the end of the data
# --------------------------------------------------------------------------
def _round(value, digits: int = 4):
    return None if value is None or pd.isna(value) else round(float(value), digits)


def build_serving_state(cleaned: ParkEaseData, table: pd.DataFrame) -> Dict[str, object]:
    """Latest value of every history feature, for predictions after the data ends.

    Slot features exist for listings that appear in the history. A live
    ParkEase spot with no history falls back to the average of listings in the
    same zone and capacity, then the zone, then the whole dataset.
    """
    last_date = table["booking_date"].max()
    days_total = (last_date - table["booking_date"].min()).days + 1

    # --- per slot --------------------------------------------------------
    slot_day = (table.groupby(["slot_id", "booking_date"])
                .agg(day_occupancy=("occupancy_rate", "mean")).reset_index()
                .sort_values(["slot_id", "booking_date"]))
    last_day = slot_day.groupby("slot_id")["day_occupancy"].last()
    rolling = slot_day.groupby("slot_id")["day_occupancy"].apply(
        lambda s: s.tail(config.ROLLING_DAYS).mean())
    first_seen = table.groupby("slot_id")["booking_date"].min()
    per_slot = table.groupby("slot_id").agg(
        slot_hist_occupancy=("occupancy_rate", "mean"),
        slot_hist_demand=("demand_num", "mean"),
        bookings=("bookings", "sum"),
        cancelled=("cancelled", "sum"),
        duration_weighted=("duration_mean", lambda s: np.average(
            s, weights=table.loc[s.index, "bookings"])),
    )
    observed = ((last_date - first_seen).dt.days + 1).clip(lower=7)
    per_slot["slot_hist_bookings_per_day"] = per_slot["bookings"] / observed
    per_slot["slot_prev_day_occupancy"] = last_day
    per_slot["slot_rolling_occupancy"] = rolling
    per_slot["slot_hist_duration"] = per_slot["duration_weighted"]
    per_slot["completion_rate"] = 1 - per_slot["cancelled"] / per_slot["bookings"]

    slot_info = cleaned.slots.set_index("slot_id")
    slots_state: Dict[str, Dict[str, object]] = {}
    for slot_id, info in slot_info.iterrows():
        entry: Dict[str, object] = {
            "parking_zone": info["parking_zone"],
            "capacity": int(info["capacity"]),
            "base_price_per_hour": int(info["base_price_per_hour"]),
            "vehicle_type_supported": info["vehicle_type_supported"],
            "price_rel_peers": _round(info["price_rel_peers"]),
            "is_active": int(info["is_active"]),
            "owner_id": info["owner_id"],
            "latitude": float(info["latitude"]), "longitude": float(info["longitude"]),
        }
        if slot_id in per_slot.index:
            row = per_slot.loc[slot_id]
            entry["bookings"] = int(row["bookings"])
            entry["completion_rate"] = _round(row["completion_rate"])
            for name in ("slot_hist_occupancy", "slot_prev_day_occupancy",
                         "slot_rolling_occupancy", "slot_hist_bookings_per_day",
                         "slot_hist_demand", "slot_hist_duration"):
                entry[name] = _round(row[name])
        slots_state[slot_id] = entry

    # --- fallbacks for spots with no history -----------------------------
    per_slot = per_slot.join(slot_info[["parking_zone", "capacity"]])
    fallback_columns = ["slot_hist_occupancy", "slot_prev_day_occupancy",
                        "slot_rolling_occupancy", "slot_hist_bookings_per_day",
                        "slot_hist_demand", "slot_hist_duration", "completion_rate"]
    zone_capacity = {
        f"{zone}|{int(capacity)}": {c: _round(v) for c, v in values.items()}
        for (zone, capacity), values in
        per_slot.groupby(["parking_zone", "capacity"])[fallback_columns].mean().iterrows()
    }
    zone_only = {
        zone: {c: _round(v) for c, v in values.items()}
        for zone, values in per_slot.groupby("parking_zone")[fallback_columns].mean().iterrows()
    }
    overall = {c: _round(per_slot[c].mean()) for c in fallback_columns}

    # --- zone x hour x day-type -----------------------------------------
    day_counts = (table[["booking_date", "is_off_day"]].drop_duplicates()
                  .groupby("is_off_day").size())
    zone_hour: Dict[str, Dict[str, object]] = {}
    for (zone, hour, off_day), group in table.groupby(["parking_zone", "hour", "is_off_day"]):
        zone_hour[f"{zone}|{int(hour)}|{int(off_day)}"] = {
            "zone_hour_hist_occupancy": _round(group["occupancy_rate"].mean()),
            "zone_hour_hist_demand": _round(group["demand_num"].mean()),
            "zone_hour_hist_bookings": _round(group["bookings"].sum() / day_counts[off_day]),
        }
    zone_hour_default = {
        "zone_hour_hist_occupancy": _round(table["occupancy_rate"].mean()),
        "zone_hour_hist_demand": _round(table["demand_num"].mean()),
        "zone_hour_hist_bookings": _round(
            table["bookings"].sum() / days_total / (len(config.ZONES) * len(config.SERVICE_HOURS))),
    }

    # --- zone profile, used to place a live spot in a zone ---------------
    zones: Dict[str, Dict[str, object]] = {}
    for zone, group in cleaned.slots.groupby("parking_zone"):
        peers = (group.groupby("vehicle_type_supported")["base_price_per_hour"]
                 .median().to_dict())
        zones[zone] = {
            "centre_latitude": _round(group["latitude"].mean(), 6),
            "centre_longitude": _round(group["longitude"].mean(), 6),
            "median_base_price": _round(group["base_price_per_hour"].median(), 2),
            "peer_median_price": {k: _round(v, 2) for k, v in peers.items()},
            "listings": int(len(group)),
        }

    holidays = sorted(cleaned.bookings.loc[cleaned.bookings["is_holiday"] == 1,
                                           "booking_date"].dt.strftime("%Y-%m-%d").unique())
    return {
        "synthetic_data": True,
        "history_ends": last_date.strftime("%Y-%m-%d"),
        "slots": slots_state,
        "fallback_zone_capacity": zone_capacity,
        "fallback_zone": zone_only,
        "fallback_overall": overall,
        "zone_hour": zone_hour,
        "zone_hour_default": zone_hour_default,
        "zones": zones,
        "holidays": holidays,
    }


def save_features(table: pd.DataFrame, state: Dict[str, object]) -> None:
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    table.to_csv(config.PROCESSED_DIR / config.FEATURES_FILE, index=False)
    (config.PROCESSED_DIR / config.SERVING_STATE_FILE).write_text(
        json.dumps(state), encoding="utf-8")


def load_features() -> pd.DataFrame:
    return pd.read_csv(config.PROCESSED_DIR / config.FEATURES_FILE,
                       parse_dates=["booking_date"])


def load_serving_state() -> Dict[str, object]:
    path = config.PROCESSED_DIR / config.SERVING_STATE_FILE
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    from ml.preprocessing.clean_data import save_cleaned

    cleaned_data, cleaning_report = clean_dataset()
    save_cleaned(cleaned_data, cleaning_report)
    features = build_feature_table(cleaned_data)
    save_features(features, build_serving_state(cleaned_data, features))
    print("Slot-hour rows:", len(features))
    print(features["split"].value_counts().to_string())
    print("Missing history features (first observations have no past):")
    print(features[HISTORY_FEATURES].isna().sum().to_string())
