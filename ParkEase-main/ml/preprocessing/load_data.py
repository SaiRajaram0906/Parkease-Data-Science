"""Load the ParkEase historical dataset.

This module only READS the three CSV files in data/raw. It never writes to
them. It fixes the data types, parses dates, and confirms that each file has
exactly the columns the data dictionary describes. Deeper checks (keys,
ranges, arithmetic) are in validate_data.py.

Usage
-----
    from ml.preprocessing.load_data import load_dataset
    data = load_dataset()
    data.users, data.slots, data.bookings      # pandas DataFrames

The data is SYNTHETIC. See data/docs/DATASET_README.md.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

from ml import config


class DatasetError(Exception):
    """Raised when a dataset file is missing or does not match the schema."""


@dataclass
class ParkEaseData:
    """The three related tables plus information about where they came from."""

    users: pd.DataFrame
    slots: pd.DataFrame
    bookings: pd.DataFrame
    source_dir: Path
    # file name -> {"rows": int, "sha256": str, "bytes": int}
    files: Dict[str, Dict[str, object]] = field(default_factory=dict)

    def summary(self) -> Dict[str, object]:
        """Small overview used by the validation report and the API."""
        b = self.bookings
        return {
            "users": int(len(self.users)),
            "drivers": int((self.users["role"] == "driver").sum()),
            "owners": int((self.users["role"] == "owner").sum()),
            "slots": int(len(self.slots)),
            "bookings": int(len(b)),
            "booking_date_min": b["booking_date"].min().strftime("%Y-%m-%d"),
            "booking_date_max": b["booking_date"].max().strftime("%Y-%m-%d"),
            "distinct_booking_days": int(b["booking_date"].nunique()),
        }


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _sha256(path: Path) -> str:
    """Fingerprint of a file, so a report can say exactly which data it used."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_csv(path: Path, expected_columns: List[str], name: str) -> pd.DataFrame:
    """Read one CSV as text first, then check its header against the schema.

    Reading as text keeps IDs such as 'DRV0001' intact and lets the caller
    decide how each column is converted.
    """
    if not path.exists():
        raise DatasetError(
            f"{name}: file not found at {path}. "
            f"Place the supplied CSV files in {path.parent}."
        )
    frame = pd.read_csv(path, dtype=str, keep_default_na=True, encoding="utf-8")

    actual = list(frame.columns)
    if actual != expected_columns:
        missing = [c for c in expected_columns if c not in actual]
        extra = [c for c in actual if c not in expected_columns]
        raise DatasetError(
            f"{name}: columns do not match the data dictionary. "
            f"Missing: {missing or 'none'}. Unexpected: {extra or 'none'}. "
            f"Expected order: {expected_columns}."
        )
    if frame.empty:
        raise DatasetError(f"{name}: file has a header but no rows.")
    return frame


def _to_number(frame: pd.DataFrame, columns: List[str], name: str) -> None:
    """Convert text columns to numbers in place.

    A value that is present but not numeric is an error. A blank stays missing.
    """
    for column in columns:
        converted = pd.to_numeric(frame[column], errors="coerce")
        bad = frame[column].notna() & converted.isna()
        if bad.any():
            examples = frame.loc[bad, column].head(3).tolist()
            raise DatasetError(
                f"{name}.{column}: {int(bad.sum())} non-numeric value(s), "
                f"for example {examples}."
            )
        frame[column] = converted


def _to_int(frame: pd.DataFrame, columns: List[str], name: str) -> None:
    """Convert fully-populated whole-number columns to int64 in place."""
    _to_number(frame, columns, name)
    for column in columns:
        if frame[column].isna().any():
            raise DatasetError(f"{name}.{column}: missing values are not allowed.")
        if (frame[column] % 1 != 0).any():
            raise DatasetError(f"{name}.{column}: expected whole numbers.")
        frame[column] = frame[column].astype("int64")


def _to_date(frame: pd.DataFrame, column: str, name: str) -> None:
    """Parse a YYYY-MM-DD column in place. Unparseable dates are an error."""
    parsed = pd.to_datetime(frame[column], format="%Y-%m-%d", errors="coerce")
    bad = parsed.isna()
    if bad.any():
        examples = frame.loc[bad, column].head(3).tolist()
        raise DatasetError(
            f"{name}.{column}: {int(bad.sum())} invalid or missing date(s), "
            f"for example {examples}."
        )
    frame[column] = parsed


# --------------------------------------------------------------------------
# Table loaders
# --------------------------------------------------------------------------
def load_users(raw_dir: Optional[Path] = None) -> pd.DataFrame:
    raw_dir = Path(raw_dir or config.RAW_DIR)
    users = _read_csv(raw_dir / config.USERS_FILE, config.USERS_COLUMNS, "users")
    _to_date(users, "registration_date", "users")
    return users


def load_slots(raw_dir: Optional[Path] = None) -> pd.DataFrame:
    raw_dir = Path(raw_dir or config.RAW_DIR)
    slots = _read_csv(raw_dir / config.SLOTS_FILE, config.SLOTS_COLUMNS, "slots")
    _to_number(slots, ["latitude", "longitude"], "slots")
    _to_int(slots, ["capacity", "base_price_per_hour", "is_active"], "slots")
    return slots


def load_bookings(raw_dir: Optional[Path] = None) -> pd.DataFrame:
    raw_dir = Path(raw_dir or config.RAW_DIR)
    bookings = _read_csv(
        raw_dir / config.BOOKINGS_FILE, config.BOOKINGS_COLUMNS, "bookings"
    )
    _to_date(bookings, "booking_date", "bookings")
    _to_int(
        bookings,
        ["hour", "is_weekend", "is_holiday", "slot_capacity",
         "occupied_slots", "available_slots"],
        "bookings",
    )
    # These may contain intentional blanks, so they stay as float with NaN.
    _to_number(
        bookings,
        ["occupancy_rate", "booking_duration_hours", "price_per_hour",
         "total_amount", "distance_km"],
        "bookings",
    )
    return bookings


def load_dataset(raw_dir: Optional[Path] = None) -> ParkEaseData:
    """Load users, slots and bookings and return them together."""
    raw_dir = Path(raw_dir or config.RAW_DIR)
    users = load_users(raw_dir)
    slots = load_slots(raw_dir)
    bookings = load_bookings(raw_dir)

    files: Dict[str, Dict[str, object]] = {}
    for file_name, frame in (
        (config.USERS_FILE, users),
        (config.SLOTS_FILE, slots),
        (config.BOOKINGS_FILE, bookings),
    ):
        path = raw_dir / file_name
        files[file_name] = {
            "rows": int(len(frame)),
            "columns": int(frame.shape[1]),
            "bytes": int(path.stat().st_size),
            "sha256": _sha256(path),
        }

    return ParkEaseData(
        users=users, slots=slots, bookings=bookings,
        source_dir=raw_dir, files=files,
    )


if __name__ == "__main__":
    dataset = load_dataset()
    print("Loaded ParkEase synthetic dataset from", dataset.source_dir)
    for key, value in dataset.summary().items():
        print(f"  {key:24s} {value}")
