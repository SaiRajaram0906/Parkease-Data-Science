"""Validate the ParkEase historical dataset.

Runs every rule the data dictionary states and writes a report. Rules are
checked on the RAW data: a field that was intentionally left blank is skipped
by the rules that need it, never filled in here (filling is Phase 3).

Run from the project root:

    python -m ml.preprocessing.validate_data

Exit code 0 means every check passed, 1 means at least one failed.

Outputs
-------
data/reports/validation_report.json   machine-readable, used by the API later
data/reports/validation_report.txt    human-readable

The data is SYNTHETIC. See data/docs/DATASET_README.md.
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd

from ml import config
from ml.preprocessing.load_data import DatasetError, ParkEaseData, load_dataset


@dataclass
class CheckResult:
    group: str
    name: str
    violations: int
    passed: bool
    detail: str = ""


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def _count(mask) -> int:
    return int(np.asarray(mask).sum())


def _haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km between points given in degrees."""
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = (np.sin((lat2 - lat1) / 2) ** 2
         + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2)
    return 6371.0 * 2 * np.arcsin(np.sqrt(a))


def _effective_duration(bookings: pd.DataFrame) -> pd.Series:
    """Duration used only for the overlap check.

    Where the duration was blanked it is recovered from total / price, as the
    data dictionary allows. Rows where neither is known stay missing.
    """
    duration = bookings["booking_duration_hours"].copy()
    recoverable = duration.isna() & bookings["price_per_hour"].gt(0)
    duration[recoverable] = (
        bookings.loc[recoverable, "total_amount"]
        / bookings.loc[recoverable, "price_per_hour"]
    )
    return duration


# --------------------------------------------------------------------------
# Checks. Each returns the number of violating rows (0 = pass).
# --------------------------------------------------------------------------
def _checks(data: ParkEaseData) -> List[CheckResult]:
    users, slots, bookings = data.users, data.slots, data.bookings
    results: List[CheckResult] = []

    def add(group: str, name: str, violations: int, detail: str = "") -> None:
        results.append(CheckResult(group, name, int(violations), violations == 0, detail))

    drivers = users.loc[users["role"] == "driver"]
    owners = users.loc[users["role"] == "owner"]
    driver_ids, owner_ids = set(drivers["user_id"]), set(owners["user_id"])
    slot_by_id = slots.set_index("slot_id")

    # ---- 1. Keys --------------------------------------------------------
    g = "Keys"
    add(g, "Duplicate primary IDs (users / slots / bookings)",
        _count(users["user_id"].duplicated())
        + _count(slots["slot_id"].duplicated())
        + _count(bookings["booking_id"].duplicated()))
    add(g, "Missing primary or foreign IDs",
        _count(users["user_id"].isna())
        + int(slots[["slot_id", "owner_id"]].isna().sum().sum())
        + int(bookings[["booking_id", "driver_id", "owner_id", "slot_id"]]
              .isna().sum().sum()))
    add(g, "ID formats (DRV0001 / OWN0001 / SLOT0001 / BOOK000001)",
        _count(~drivers["user_id"].str.match(config.DRIVER_ID_PATTERN, na=False))
        + _count(~owners["user_id"].str.match(config.OWNER_ID_PATTERN, na=False))
        + _count(~slots["slot_id"].str.match(config.SLOT_ID_PATTERN, na=False))
        + _count(~bookings["booking_id"].str.match(config.BOOKING_ID_PATTERN, na=False)))

    # ---- 2. Relationships ----------------------------------------------
    g = "Relationships"
    add(g, "Slot owner_id is not a registered owner",
        _count(~slots["owner_id"].isin(owner_ids)))
    add(g, "Booking driver_id is not a registered driver",
        _count(~bookings["driver_id"].isin(driver_ids)))
    add(g, "Booking owner_id is not a registered owner",
        _count(~bookings["owner_id"].isin(owner_ids)))
    add(g, "Booking slot_id does not exist",
        _count(~bookings["slot_id"].isin(slot_by_id.index)))

    known = bookings["slot_id"].isin(slot_by_id.index)
    joined = bookings.loc[known]
    slot_owner = joined["slot_id"].map(slot_by_id["owner_id"])
    slot_zone = joined["slot_id"].map(slot_by_id["parking_zone"])
    slot_capacity = joined["slot_id"].map(slot_by_id["capacity"])
    add(g, "Booking owner_id differs from the slot's owner",
        _count(joined["owner_id"] != slot_owner))
    add(g, "Booking parking_zone differs from the slot's zone",
        _count(joined["parking_zone"] != slot_zone))
    add(g, "Booking slot_capacity differs from the slot's capacity",
        _count(joined["slot_capacity"] != slot_capacity))

    # ---- 3. Dates and time ---------------------------------------------
    g = "Dates and time"
    date = bookings["booking_date"]
    add(g, "day_of_week does not match booking_date",
        _count(bookings["day_of_week"] != date.dt.day_name()))
    add(g, "is_weekend does not match booking_date",
        _count(bookings["is_weekend"] != (date.dt.dayofweek >= 5).astype(int)))
    add(g, "is_holiday not constant within a date",
        _count(bookings.groupby("booking_date")["is_holiday"].nunique() > 1))
    low, high = config.HOUR_RANGE
    add(g, f"hour outside {low}-{high}", _count(~bookings["hour"].between(low, high)))
    driver_reg = bookings["driver_id"].map(users.set_index("user_id")["registration_date"])
    owner_reg = bookings["owner_id"].map(users.set_index("user_id")["registration_date"])
    add(g, "Booking dated before its driver registered", _count(date < driver_reg))
    add(g, "Booking dated before its owner registered", _count(date < owner_reg))

    # ---- 4. Occupancy ---------------------------------------------------
    g = "Occupancy"
    occupied, available = bookings["occupied_slots"], bookings["available_slots"]
    capacity, rate = bookings["slot_capacity"], bookings["occupancy_rate"]
    low, high = config.OCCUPANCY_RATE_RANGE
    add(g, "Invalid occupancy values (negative, above capacity, rate not 0-100)",
        _count((occupied < 0) | (occupied > capacity))
        + _count(rate.notna() & ~rate.between(low, high)))
    add(g, "occupied_slots + available_slots != slot_capacity",
        _count(occupied + available != capacity))
    expected_rate = occupied / capacity * 100
    add(g, "occupancy_rate != occupied_slots / slot_capacity * 100",
        _count(rate.notna() & ((rate - expected_rate).abs() > config.FLOAT_TOLERANCE)))
    add(g, "Booking made with no free space (available_slots < 1)",
        _count(available < 1))

    # ---- 5. Money and duration -----------------------------------------
    g = "Price and duration"
    price, duration = bookings["price_per_hour"], bookings["booking_duration_hours"]
    total = bookings["total_amount"]
    both = price.notna() & duration.notna()
    add(g, "total_amount != price_per_hour x booking_duration_hours",
        _count(both & ((total - price * duration).abs() > config.FLOAT_TOLERANCE)))
    add(g, "total_amount missing or not positive", _count(total.isna() | (total <= 0)))
    add(g, "price_per_hour and booking_duration_hours both missing (unrecoverable)",
        _count(price.isna() & duration.isna()))
    low, high = config.BOOKING_PRICE_RANGE
    add(g, f"Booking price outside Rs {low}-{high}",
        _count(price.notna() & ~price.between(low, high)))
    low, high = config.BASE_PRICE_RANGE
    add(g, f"Slot base price outside Rs {low}-{high}",
        _count(~slots["base_price_per_hour"].between(low, high)))
    add(g, "Booking duration is not one of the allowed values",
        _count(duration.notna() & ~duration.isin(config.DURATION_VALUES)))

    # ---- 6. Categories and flags ---------------------------------------
    g = "Categories"
    add(g, "Invalid role", _count(~users["role"].isin(config.ROLES)))
    add(g, "Invalid parking_zone",
        _count(~slots["parking_zone"].isin(config.ZONES))
        + _count(~bookings["parking_zone"].isin(config.ZONES)))
    add(g, "Invalid demand_level",
        _count(bookings["demand_level"].notna()
               & ~bookings["demand_level"].isin(config.DEMAND_LEVELS)))
    add(g, "Invalid booking_status",
        _count(~bookings["booking_status"].isin(config.BOOKING_STATUSES)))
    cutoff = date.max() - pd.Timedelta(days=config.ACTIVE_STATUS_LAST_DAYS - 1)
    add(g, f"'Active' status outside the final {config.ACTIVE_STATUS_LAST_DAYS} days",
        _count((bookings["booking_status"] == "Active") & (date < cutoff)))
    add(g, "Invalid vehicle type",
        _count(users["preferred_vehicle_type"].notna()
               & ~users["preferred_vehicle_type"].isin(config.DRIVER_VEHICLE_TYPES))
        + _count(slots["vehicle_type_supported"].notna()
                 & ~slots["vehicle_type_supported"].isin(config.SLOT_VEHICLE_TYPES)))
    add(g, "Invalid capacity value",
        _count(~slots["capacity"].isin(config.CAPACITY_VALUES)))
    add(g, "Invalid is_active / is_weekend / is_holiday flag",
        _count(~slots["is_active"].isin([0, 1]))
        + _count(~bookings["is_weekend"].isin([0, 1]))
        + _count(~bookings["is_holiday"].isin([0, 1])))

    # ---- 7. Geography ---------------------------------------------------
    g = "Geography"
    centre_lat, centre_lon = slots["latitude"].mean(), slots["longitude"].mean()
    from_centre = _haversine_km(slots["latitude"], slots["longitude"],
                                centre_lat, centre_lon)
    limit = config.MAX_SLOT_DISTANCE_FROM_CENTRE_KM
    add(g, f"Slot coordinates missing or more than {limit:g} km from the centre",
        _count(slots[["latitude", "longitude"]].isna().any(axis=1))
        + _count(from_centre > limit),
        detail=f"farthest slot is {float(from_centre.max()):.2f} km from the centre")
    low, high = config.DISTANCE_RANGE_KM
    distance = bookings["distance_km"]
    add(g, f"distance_km outside {low:g}-{high:g} km",
        _count(distance.notna() & ~distance.between(low, high)))

    # ---- 8. Behaviour rules --------------------------------------------
    g = "Behaviour"
    vehicle = bookings["driver_id"].map(users.set_index("user_id")["preferred_vehicle_type"])
    supported = bookings["slot_id"].map(slot_by_id["vehicle_type_supported"])
    comparable = vehicle.notna() & supported.notna()
    fits = pd.Series(
        [s in config.VEHICLE_COMPATIBILITY.get(v, set())
         for v, s in zip(vehicle[comparable], supported[comparable])],
        index=vehicle[comparable].index, dtype=bool,
    )
    add(g, "Driver's vehicle does not fit the slot's supported type",
        _count(~fits), detail=f"{int(comparable.sum())} bookings compared")

    timeline = pd.DataFrame({
        "driver_id": bookings["driver_id"],
        "start": date + pd.to_timedelta(bookings["hour"], unit="h"),
    })
    timeline["end"] = timeline["start"] + pd.to_timedelta(
        _effective_duration(bookings), unit="h")
    timeline = timeline.dropna(subset=["end"]).sort_values(["driver_id", "start"])
    # Latest end time among the driver's earlier bookings.
    previous_end = (timeline.groupby("driver_id")["end"]
                    .transform(lambda s: s.cummax().shift()))
    add(g, "Same driver has overlapping bookings",
        _count(timeline["start"] < previous_end))

    slot_hour = bookings.groupby(["slot_id", "booking_date", "hour"])
    add(g, "More than one demand_level within a slot, date and hour",
        _count(slot_hour["demand_level"].nunique() > 1))
    add(g, "More than one price_per_hour within a slot, date and hour",
        _count(slot_hour["price_per_hour"].nunique() > 1))
    add(g, "Bookings in one slot-hour do not fill it one space at a time",
        _count(slot_hour["occupied_slots"].nunique() != slot_hour.size()))

    return results


# --------------------------------------------------------------------------
# Profiling (information, not pass/fail)
# --------------------------------------------------------------------------
def _missing_values(data: ParkEaseData) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    for table, frame in (("users", data.users), ("slots", data.slots),
                         ("bookings", data.bookings)):
        for column, missing in frame.isna().sum().items():
            if missing == 0:
                continue
            rows.append({
                "table": table,
                "column": column,
                "missing": int(missing),
                "percent": round(float(missing) / len(frame) * 100, 2),
                "expected": column in config.ALLOWED_MISSING[table],
            })
    return rows


def _class_distribution(series: pd.Series) -> Dict[str, int]:
    counts = series.fillna("(missing)").value_counts()
    return {str(k): int(v) for k, v in counts.items()}


def validate(data: Optional[ParkEaseData] = None) -> Dict[str, object]:
    """Run all checks and return the full report as a dictionary."""
    data = data or load_dataset()
    results = _checks(data)

    missing = _missing_values(data)
    unexpected_missing = [m for m in missing if not m["expected"]]
    results.append(CheckResult(
        "Missing values", "Missing values outside the documented columns",
        sum(int(m["missing"]) for m in unexpected_missing),
        not unexpected_missing,
        ", ".join(f"{m['table']}.{m['column']}" for m in unexpected_missing),
    ))

    warnings: List[str] = []
    actual_rows = {"users": len(data.users), "slots": len(data.slots),
                   "bookings": len(data.bookings)}
    for table, expected in config.EXPECTED_ROWS.items():
        if actual_rows[table] != expected:
            warnings.append(
                f"{table}: {actual_rows[table]} rows, the supplied dataset has {expected}."
            )

    passed = sum(r.passed for r in results)
    return {
        "synthetic_data": True,
        "notice": ("All data is synthetic. Results describe the generated "
                   "dataset only and are not real-world parking statistics."),
        "source_dir": str(data.source_dir),
        "files": data.files,
        "summary": data.summary(),
        "checks_total": len(results),
        "checks_passed": int(passed),
        "checks_failed": int(len(results) - passed),
        "all_passed": passed == len(results),
        "checks": [asdict(r) for r in results],
        "missing_values": missing,
        "class_distribution": {
            "demand_level": _class_distribution(data.bookings["demand_level"]),
            "booking_status": _class_distribution(data.bookings["booking_status"]),
            "role": _class_distribution(data.users["role"]),
            "parking_zone": _class_distribution(data.bookings["parking_zone"]),
        },
        "warnings": warnings,
    }


# --------------------------------------------------------------------------
# Report writing
# --------------------------------------------------------------------------
def format_report(report: Dict[str, object]) -> str:
    line = "-" * 88
    out: List[str] = [
        "=" * 88,
        "PARKEASE DATA VALIDATION REPORT (synthetic dataset)",
        "=" * 88,
        str(report["notice"]),
        "",
    ]
    for name, info in report["files"].items():
        out.append(f"{name:24s} {info['rows']:>6} rows x {info['columns']:>2} cols"
                   f"   sha256 {str(info['sha256'])[:16]}...")
    summary = report["summary"]
    out += [
        f"drivers: {summary['drivers']}   owners: {summary['owners']}",
        f"booking dates: {summary['booking_date_min']} to {summary['booking_date_max']}"
        f" ({summary['distinct_booking_days']} distinct days)",
        "",
    ]

    group = None
    for check in report["checks"]:
        if check["group"] != group:
            group = check["group"]
            out += [line, group.upper(), line]
        status = "PASS" if check["passed"] else "FAIL"
        detail = f"  ({check['detail']})" if check["detail"] else ""
        out.append(f"[{status}] {check['name']:<70} {check['violations']:>6}{detail}")

    out += ["", line, "MISSING VALUES (raw data, not yet handled)", line]
    for item in report["missing_values"]:
        note = "documented" if item["expected"] else "UNEXPECTED"
        out.append(f"{item['table']:9s} {item['column']:26s} {item['missing']:>6}"
                   f"  ({item['percent']:.2f} %)  {note}")

    out += ["", line, "CLASS DISTRIBUTION", line]
    for column, counts in report["class_distribution"].items():
        total = sum(counts.values())
        parts = ", ".join(f"{k} {v} ({v / total * 100:.1f} %)" for k, v in counts.items())
        out.append(f"{column}: {parts}")

    if report["warnings"]:
        out += ["", line, "WARNINGS", line] + list(report["warnings"])

    out += [
        "",
        f"RESULT: {report['checks_passed']} of {report['checks_total']} checks passed, "
        f"{report['checks_failed']} failed.",
    ]
    return "\n".join(out) + "\n"


def write_report(report: Dict[str, object], reports_dir: Optional[Path] = None) -> Path:
    reports_dir = Path(reports_dir or config.REPORTS_DIR)
    reports_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / "validation_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8")
    text_path = reports_dir / "validation_report.txt"
    text_path.write_text(format_report(report), encoding="utf-8")
    return text_path


def main() -> int:
    try:
        report = validate()
    except DatasetError as error:
        print(f"DATASET ERROR: {error}")
        return 1
    path = write_report(report)
    print(format_report(report))
    print(f"Report written to {path.parent}")
    return 0 if report["all_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
