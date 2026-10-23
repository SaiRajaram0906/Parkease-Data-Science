"""Reusable analytics for the ParkEase dataset and for live bookings.

Every function takes DataFrames and returns plain Python data (lists and
dictionaries) that can be sent as JSON to the ParkEase UI or plotted offline.
No function here trains a model.

All dataset results are SYNTHETIC-data findings, not real-world statistics.

Booking frames passed to driver_analytics() and owner_analytics() only need
these columns, so the same code serves the historical dataset and the live
ParkEase database:

    booking_date (datetime), hour, parking_zone, booking_duration_hours,
    total_amount, booking_status ('Completed' | 'Cancelled' | 'Active'),
    slot_id, and optionally occupancy_rate and demand_level.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from ml import config
from ml.preprocessing.load_data import ParkEaseData

DISTANCE_BANDS = [0, 0.5, 1, 2, 3, 5, 10]
DISTANCE_LABELS = ["0-0.5", "0.5-1", "1-2", "2-3", "3-5", "5-10"]
CORRELATION_COLUMNS = {
    "hour": "Hour",
    "is_weekend": "Weekend",
    "slot_capacity": "Capacity",
    "occupancy_rate": "Occupancy",
    "demand_num": "Demand",
    "price_per_hour": "Price",
    "price_ratio": "Price / base",
    "booking_duration_hours": "Duration",
    "total_amount": "Amount",
    "distance_km": "Distance",
    "is_cancelled": "Cancelled",
}


def _r(value, digits: int = 2):
    """Round to a JSON-safe float, or None when there is no value."""
    return None if value is None or pd.isna(value) else round(float(value), digits)


def _hour_label(hour: int) -> str:
    return f"{int(hour):02d}:00"


# ==========================================================================
# Dataset-wide EDA
# ==========================================================================
def summary_statistics(bookings: pd.DataFrame) -> List[Dict[str, object]]:
    """Mean, median, standard deviation and range of the main numeric columns."""
    columns = {
        "occupancy_rate": "Occupancy rate (%)",
        "booking_duration_hours": "Booking duration (h)",
        "price_per_hour": "Price per hour (₹)",
        "total_amount": "Booking amount (₹)",
        "distance_km": "Distance to slot (km)",
        "available_slots": "Free spaces seen",
    }
    rows = []
    for column, label in columns.items():
        s = bookings[column].dropna()
        rows.append({
            "column": column, "label": label, "count": int(s.size),
            "mean": _r(s.mean()), "median": _r(s.median()), "std": _r(s.std()),
            "min": _r(s.min()), "q1": _r(s.quantile(0.25)),
            "q3": _r(s.quantile(0.75)), "max": _r(s.max()),
            "skew": _r(s.skew()),
        })
    return rows


def bookings_by_hour(bookings: pd.DataFrame) -> List[Dict[str, object]]:
    """Average bookings per day in each hour, working days against off days."""
    off_day = (bookings["is_weekend"] == 1) | (bookings["is_holiday"] == 1)
    days = bookings.assign(off=off_day).groupby("off")["booking_date"].nunique()
    counts = bookings.assign(off=off_day).groupby(["hour", "off"]).size().unstack(fill_value=0)
    occupancy = (bookings.assign(off=off_day).groupby(["hour", "off"])["occupancy_rate"]
                 .mean().unstack())
    rows = []
    for hour in sorted(counts.index):
        rows.append({
            "hour": int(hour), "label": _hour_label(hour),
            "weekday": _r(counts.loc[hour].get(False, 0) / days.get(False, 1)),
            "weekend": _r(counts.loc[hour].get(True, 0) / days.get(True, 1)),
            "weekday_occupancy": _r(occupancy.loc[hour].get(False)),
            "weekend_occupancy": _r(occupancy.loc[hour].get(True)),
        })
    return rows


def bookings_by_day_of_week(bookings: pd.DataFrame) -> List[Dict[str, object]]:
    grouped = bookings.groupby("day_of_week").agg(
        bookings=("booking_id", "count"), days=("booking_date", "nunique"))
    return [{
        "day": day, "short": day[:3],
        "bookings": int(grouped.loc[day, "bookings"]),
        "per_day": _r(grouped.loc[day, "bookings"] / grouped.loc[day, "days"], 1),
    } for day in config.DAYS_OF_WEEK if day in grouped.index]


def monthly_trend(bookings: pd.DataFrame) -> List[Dict[str, object]]:
    completed = bookings[bookings["booking_status"] == "Completed"]
    counts = bookings.groupby("month").size()
    revenue = completed.groupby("month")["total_amount"].sum()
    drivers = bookings.groupby("month")["driver_id"].nunique()
    return [{
        "month": month,
        "label": pd.Timestamp(month + "-01").strftime("%b %y"),
        "bookings": int(counts[month]),
        "completed_revenue": _r(revenue.get(month, 0)),
        "active_drivers": int(drivers[month]),
    } for month in sorted(counts.index)]


def zone_summary(bookings: pd.DataFrame, slots: pd.DataFrame) -> List[Dict[str, object]]:
    """Occupancy, price, demand mix, cancellations and completed revenue by zone."""
    completed = bookings[bookings["booking_status"] == "Completed"]
    revenue = completed.groupby("parking_zone")["total_amount"].sum()
    listings = slots.groupby("parking_zone").size()
    rows = []
    for zone, group in bookings.groupby("parking_zone"):
        known = group["demand_level"].dropna()
        rows.append({
            "zone": zone,
            "bookings": int(len(group)),
            "listings": int(listings.get(zone, 0)),
            "occupancy": _r(group["occupancy_rate"].mean(), 1),
            "avg_price": _r(group["price_per_hour"].mean(), 1),
            "avg_duration": _r(group["booking_duration_hours"].mean()),
            "avg_distance": _r(group["distance_km"].mean()),
            "high_demand_share": _r((known == "High").mean() * 100, 1),
            "cancellation_rate": _r(group["is_cancelled"].mean() * 100, 1),
            "completed_revenue": _r(revenue.get(zone, 0)),
        })
    return rows


def demand_distribution(bookings: pd.DataFrame) -> List[Dict[str, object]]:
    """Class balance of demand_level, with what each level looks like."""
    rows = []
    total = len(bookings)
    for level in config.DEMAND_LEVELS:
        group = bookings[bookings["demand_level"] == level]
        rows.append({
            "level": level, "bookings": int(len(group)),
            "share": _r(len(group) / total * 100, 1),
            "occupancy": _r(group["occupancy_rate"].mean(), 1),
            "avg_price": _r(group["price_per_hour"].mean(), 1),
            "price_vs_base": _r(group["price_ratio"].mean(), 3),
            "avg_distance": _r(group["distance_km"].mean()),
            "cancellation_rate": _r(group["is_cancelled"].mean() * 100, 1),
        })
    unknown = int(bookings["demand_level"].isna().sum())
    if unknown:
        rows.append({"level": "Unknown", "bookings": unknown,
                     "share": _r(unknown / total * 100, 1)})
    return rows


def price_vs_demand(bookings: pd.DataFrame, sample_size: int = 900) -> Dict[str, object]:
    """Scatter sample of listed price against charged price, by demand level."""
    known = bookings.dropna(subset=["demand_level"])
    per_level = sample_size // len(config.DEMAND_LEVELS)
    points = []
    for level in config.DEMAND_LEVELS:
        group = known[known["demand_level"] == level]
        sample = group.sample(min(per_level, len(group)), random_state=config.RANDOM_SEED)
        points += [{"base_price": int(b), "price": _r(p, 0), "level": level,
                    "occupancy": _r(o, 0)}
                   for b, p, o in zip(sample["base_price_per_hour"], sample["price_per_hour"],
                                      sample["occupancy_rate"])]
    demand_num = known["demand_level"].map(config.DEMAND_TO_NUMBER)
    return {
        "points": points,
        "sampled_from": int(len(known)),
        "spearman_demand_price": _r(demand_num.corr(known["price_per_hour"], method="spearman"), 3),
        "spearman_demand_price_ratio": _r(demand_num.corr(known["price_ratio"], method="spearman"), 3),
    }


def distance_vs_cancellation(bookings: pd.DataFrame) -> List[Dict[str, object]]:
    # Bookings still 'Active' have no final outcome yet, so they are left out.
    finished = bookings[bookings["booking_status"] != "Active"]
    band = pd.cut(finished["distance_km"], DISTANCE_BANDS, labels=DISTANCE_LABELS)
    grouped = finished.groupby(band, observed=True)["is_cancelled"].agg(["count", "mean"])
    return [{"band": f"{label} km", "bookings": int(row["count"]),
             "cancellation_rate": _r(row["mean"] * 100, 1)}
            for label, row in grouped.iterrows()]


def status_distribution(bookings: pd.DataFrame) -> List[Dict[str, object]]:
    counts = bookings["booking_status"].value_counts()
    return [{"status": status, "bookings": int(count),
             "share": _r(count / len(bookings) * 100, 1)}
            for status, count in counts.items()]


def correlation_matrix(bookings: pd.DataFrame) -> Dict[str, object]:
    """Spearman correlations (rank based, so skew and outliers matter less)."""
    frame = bookings.copy()
    frame["demand_num"] = frame["demand_level"].map(config.DEMAND_TO_NUMBER)
    matrix = frame[list(CORRELATION_COLUMNS)].corr(method="spearman")
    labels = list(CORRELATION_COLUMNS.values())
    cells = [{"x": labels[j], "y": labels[i], "value": _r(matrix.iloc[i, j], 2)}
             for i in range(len(labels)) for j in range(len(labels))]
    return {"labels": labels, "cells": cells, "method": "spearman"}


def user_behaviour(cleaned: ParkEaseData) -> Dict[str, object]:
    bookings, users = cleaned.bookings, cleaned.users
    per_driver = bookings.groupby("driver_id").size()
    edges = [1, 6, 11, 21, 41, 81, 10_000]
    labels = ["1-5", "6-10", "11-20", "21-40", "41-80", "81+"]
    histogram = pd.cut(per_driver, edges, right=False, labels=labels).value_counts().reindex(labels)
    durations = bookings["booking_duration_hours"].value_counts().sort_index()
    drivers = users[users["role"] == "driver"]
    vehicle_bookings = bookings["driver_id"].map(
        users.set_index("user_id")["preferred_vehicle_type"]).value_counts()
    return {
        "bookings_per_driver": [{"band": b, "drivers": int(n)} for b, n in histogram.items()],
        "drivers_with_bookings": int(per_driver.size),
        "drivers_total": int(len(drivers)),
        "median_bookings_per_driver": _r(per_driver.median(), 0),
        "mean_bookings_per_driver": _r(per_driver.mean(), 1),
        "duration_distribution": [{"hours": _r(h, 1), "bookings": int(n)}
                                  for h, n in durations.items()],
        "vehicle_mix": [{"vehicle": v, "drivers": int((drivers["preferred_vehicle_type"] == v).sum()),
                         "bookings": int(vehicle_bookings.get(v, 0))}
                        for v in config.DRIVER_VEHICLE_TYPES],
    }


def price_elasticity(cleaned: ParkEaseData) -> Dict[str, object]:
    """Do listings priced above similar listings get fewer bookings?"""
    slots = cleaned.slots.set_index("slot_id")
    counts = cleaned.bookings.groupby("slot_id").size().reindex(slots.index, fill_value=0)
    frame = pd.DataFrame({"relative_price": slots["price_rel_peers"], "bookings": counts,
                          "zone": slots["parking_zone"]})
    # Compare each listing with the typical listing of its own zone.
    frame["relative_bookings"] = frame["bookings"] / frame.groupby("zone")["bookings"].transform("median")
    band = pd.cut(frame["relative_price"], [0, 0.8, 0.95, 1.05, 1.2, 10],
                  labels=["<0.8x", "0.8-0.95x", "0.95-1.05x", "1.05-1.2x", ">1.2x"])
    by_band = frame.groupby(band, observed=True)["relative_bookings"].agg(["count", "median"])
    return {
        "spearman": _r(frame["relative_price"].corr(frame["bookings"], method="spearman"), 3),
        "bands": [{"band": str(label), "listings": int(row["count"]),
                   "relative_bookings": _r(row["median"], 2)}
                  for label, row in by_band.iterrows()],
    }


def key_insights(overview: Dict[str, object]) -> List[str]:
    """Plain-language findings, each built from the numbers computed above."""
    hours = overview["bookings_by_hour"]
    busiest = max(hours, key=lambda r: r["weekday"])
    midday = [r["weekday"] for r in hours if 11 <= r["hour"] <= 15]
    days = overview["bookings_by_day_of_week"]
    top_day, low_day = max(days, key=lambda r: r["per_day"]), min(days, key=lambda r: r["per_day"])
    months = overview["monthly_trend"]
    zones = overview["zones"]
    busiest_zone = max(zones, key=lambda r: r["bookings"])
    quiet_zone = min(zones, key=lambda r: r["bookings"])
    rich_zone = max(zones, key=lambda r: r["completed_revenue"])
    demand = {r["level"]: r for r in overview["demand_distribution"]}
    distance = overview["distance_vs_cancellation"]
    elasticity = overview["price_elasticity"]
    return [
        f"Weekday bookings peak at {busiest['label']} ({busiest['weekday']} per day) "
        f"against about {np.mean(midday):.1f} per hour at midday; weekends have no morning peak.",
        f"{top_day['day']} is the busiest day ({top_day['per_day']} bookings per day) and "
        f"{low_day['day']} the quietest ({low_day['per_day']}).",
        f"Monthly bookings grew from {months[0]['bookings']:,} in {months[0]['label']} to "
        f"{months[-1]['bookings']:,} in {months[-1]['label']}.",
        f"{busiest_zone['zone']} has the most bookings ({busiest_zone['bookings']:,}) and "
        f"{quiet_zone['zone']} the fewest ({quiet_zone['bookings']:,}); "
        f"{rich_zone['zone']} earns the most completed revenue.",
        f"Average occupancy rises with demand: {demand['Low']['occupancy']}% at Low, "
        f"{demand['Medium']['occupancy']}% at Medium and {demand['High']['occupancy']}% at High.",
        f"Owners charge {demand['Low']['price_vs_base']}x, {demand['Medium']['price_vs_base']}x and "
        f"{demand['High']['price_vs_base']}x their base price at Low, Medium and High demand.",
        f"Cancellations rise with distance: {distance[0]['cancellation_rate']}% within 0.5 km "
        f"against {distance[-2]['cancellation_rate']}% at 3-5 km.",
        f"Listings priced above similar listings in their zone get fewer bookings "
        f"(Spearman {elasticity['spearman']}).",
    ]


def dataset_overview(cleaned: ParkEaseData) -> Dict[str, object]:
    """Everything the Data Science dashboard needs, in one call."""
    bookings, slots = cleaned.bookings, cleaned.slots
    completed = bookings[bookings["booking_status"] == "Completed"]
    overview: Dict[str, object] = {
        "synthetic_data": True,
        "notice": ("Synthetic dataset. These are findings about generated data, "
                   "not real-world parking statistics."),
        "totals": {
            "users": int(len(cleaned.users)),
            "drivers": int((cleaned.users["role"] == "driver").sum()),
            "owners": int((cleaned.users["role"] == "owner").sum()),
            "listings": int(len(slots)),
            "active_listings": int(slots["is_active"].sum()),
            "bookings": int(len(bookings)),
            "completed_revenue": _r(completed["total_amount"].sum()),
            "avg_occupancy": _r(bookings["occupancy_rate"].mean(), 1),
            "cancellation_rate": _r(
                bookings.loc[bookings["booking_status"] != "Active", "is_cancelled"].mean() * 100, 1),
            "date_from": bookings["booking_date"].min().strftime("%Y-%m-%d"),
            "date_to": bookings["booking_date"].max().strftime("%Y-%m-%d"),
        },
        "summary_statistics": summary_statistics(bookings),
        "bookings_by_hour": bookings_by_hour(bookings),
        "bookings_by_day_of_week": bookings_by_day_of_week(bookings),
        "monthly_trend": monthly_trend(bookings),
        "zones": zone_summary(bookings, slots),
        "demand_distribution": demand_distribution(bookings),
        "price_vs_demand": price_vs_demand(bookings),
        "distance_vs_cancellation": distance_vs_cancellation(bookings),
        "status_distribution": status_distribution(bookings),
        "correlation": correlation_matrix(bookings),
        "user_behaviour": user_behaviour(cleaned),
        "price_elasticity": price_elasticity(cleaned),
    }
    overview["insights"] = key_insights(overview)
    return overview


# ==========================================================================
# Per-user analytics (historical dataset or live ParkEase bookings)
# ==========================================================================
def _time_of_day(hour: float) -> str:
    if hour < 11:
        return "Morning (06-11)"
    if hour < 16:
        return "Midday (11-16)"
    if hour < 20:
        return "Evening (16-20)"
    return "Night (20-24)"


def _by_month(frame: pd.DataFrame, value: Optional[str] = None) -> pd.Series:
    month = frame["booking_date"].dt.strftime("%Y-%m")
    return frame.groupby(month).size() if value is None else frame.groupby(month)[value].sum()


def _month_rows(index) -> List[str]:
    return sorted(index)


def driver_analytics(bookings: pd.DataFrame, min_bookings: int = 1) -> Dict[str, object]:
    """Driver dashboard: five headline numbers and three chart series."""
    if len(bookings) < min_bookings:
        return {"has_data": False, "total_bookings": int(len(bookings))}
    paid = bookings[bookings["booking_status"] != "Cancelled"]
    basis = paid if len(paid) else bookings
    zone_counts = bookings["parking_zone"].value_counts()
    time_counts = bookings["hour"].map(_time_of_day).value_counts()
    hour_counts = bookings["hour"].value_counts()
    monthly = _by_month(bookings)
    monthly_spend = _by_month(basis, "total_amount")
    basis_month = basis["booking_date"].dt.strftime("%Y-%m")
    monthly_duration = basis.groupby(basis_month)["booking_duration_hours"].mean()
    monthly_avg_spend = basis.groupby(basis_month)["total_amount"].mean()
    return {
        "has_data": True,
        "total_bookings": int(len(bookings)),
        "completed_bookings": int((bookings["booking_status"] == "Completed").sum()),
        "cancelled_bookings": int((bookings["booking_status"] == "Cancelled").sum()),
        "avg_duration_hours": _r(basis["booking_duration_hours"].mean()),
        "avg_spending": _r(basis["total_amount"].mean()),
        "total_spending": _r(basis["total_amount"].sum()),
        "most_used_zone": str(zone_counts.index[0]),
        "preferred_time": str(time_counts.index[0]),
        "preferred_hour": int(hour_counts.index[0]),
        "first_booking": bookings["booking_date"].min().strftime("%Y-%m-%d"),
        "last_booking": bookings["booking_date"].max().strftime("%Y-%m-%d"),
        "by_month": [{
            "month": m, "label": pd.Timestamp(m + "-01").strftime("%b %y"),
            "bookings": int(monthly[m]),
            "spending": _r(monthly_spend.get(m, 0)),
            "avg_spending": _r(monthly_avg_spend.get(m)),
            "avg_duration": _r(monthly_duration.get(m)),
        } for m in _month_rows(monthly.index)],
        "by_zone": [{"zone": str(z), "bookings": int(n)} for z, n in zone_counts.items()],
        "by_time_of_day": [{"period": p, "bookings": int(n)} for p, n in time_counts.items()],
    }


def owner_analytics(bookings: pd.DataFrame, listings: int,
                    min_bookings: int = 1) -> Dict[str, object]:
    """Owner dashboard: six headline numbers and four chart series.

    Revenue counts Completed bookings only; a cancelled booking earned nothing.
    Occupancy is reported only when the bookings carry an occupancy reading.
    """
    if len(bookings) < min_bookings:
        return {"has_data": False, "total_bookings": int(len(bookings)), "listings": int(listings)}
    completed = bookings[bookings["booking_status"] == "Completed"]
    finished = bookings[bookings["booking_status"] != "Active"]
    hour_counts = bookings.groupby("hour").size()
    has_occupancy = "occupancy_rate" in bookings and bookings["occupancy_rate"].notna().any()
    # A single-space listing always reads 0 % when it is booked (it cannot be
    # booked while full), so it is left out of occupancy figures.
    measurable = (bookings[bookings["slot_capacity"] > 1]
                  if "slot_capacity" in bookings else bookings)
    has_occupancy = has_occupancy and len(measurable) > 0
    month = bookings["booking_date"].dt.strftime("%Y-%m")
    monthly_bookings = bookings.groupby(month).size()
    monthly_revenue = _by_month(completed, "total_amount")
    monthly_occupancy = (measurable.groupby(measurable["booking_date"].dt.strftime("%Y-%m"))[
        "occupancy_rate"].mean() if has_occupancy else pd.Series(dtype=float))
    status_counts = bookings["booking_status"].value_counts()

    per_slot = []
    for slot_id, group in bookings.groupby("slot_id"):
        done = group[group["booking_status"] == "Completed"]
        ended = group[group["booking_status"] != "Active"]
        per_slot.append({
            "slot_id": str(slot_id),
            "zone": str(group["parking_zone"].iloc[0]),
            "bookings": int(len(group)),
            "completed_revenue": _r(done["total_amount"].sum()),
            "occupancy": _r(group["occupancy_rate"].mean(), 1)
            if has_occupancy and group.index.isin(measurable.index).all() else None,
            "cancellation_rate": _r((ended["booking_status"] == "Cancelled").mean() * 100, 1)
            if len(ended) else None,
        })
    per_slot.sort(key=lambda r: r["completed_revenue"] or 0, reverse=True)

    return {
        "has_data": True,
        "listings": int(listings),
        "total_bookings": int(len(bookings)),
        "completed_revenue": _r(completed["total_amount"].sum()),
        "occupancy_rate": _r(measurable["occupancy_rate"].mean(), 1) if has_occupancy else None,
        "avg_duration_hours": _r(bookings["booking_duration_hours"].mean()),
        "peak_hour": int(hour_counts.idxmax()),
        "peak_hour_label": _hour_label(hour_counts.idxmax()),
        "cancellation_rate": _r((finished["booking_status"] == "Cancelled").mean() * 100, 1)
        if len(finished) else None,
        "revenue_by_month": [{
            "month": m, "label": pd.Timestamp(m + "-01").strftime("%b %y"),
            "revenue": _r(monthly_revenue.get(m, 0)),
            "bookings": int(monthly_bookings[m]),
            "occupancy": _r(monthly_occupancy.get(m), 1) if has_occupancy else None,
        } for m in _month_rows(monthly_bookings.index)],
        "bookings_by_hour": [{"hour": int(h), "label": _hour_label(h),
                              "bookings": int(hour_counts.get(h, 0))}
                             for h in range(int(hour_counts.index.min()),
                                            int(hour_counts.index.max()) + 1)],
        "status_distribution": [{"status": str(s), "bookings": int(n),
                                 "share": _r(n / len(bookings) * 100, 1)}
                                for s, n in status_counts.items()],
        "by_slot": per_slot,
    }
