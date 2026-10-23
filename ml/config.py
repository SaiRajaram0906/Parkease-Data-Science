"""Central configuration for the ParkEase Data Science layer.

Everything that describes the dataset (file names, columns, allowed values,
valid ranges) lives here so that loading, validation, cleaning and modelling
all agree on one definition. The values come from data/docs/data_dictionary.md,
which is the source of truth for the schema.
"""
from __future__ import annotations

import os
from pathlib import Path

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("PARKEASE_DATA_DIR", PROJECT_ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"            # historical CSVs, read-only
PROCESSED_DIR = DATA_DIR / "processed"  # cleaned / feature tables (Phase 3)
REPORTS_DIR = DATA_DIR / "reports"    # validation and EDA outputs
MODELS_DIR = PROJECT_ROOT / "models"  # trained model files (Phase 5)

USERS_FILE = "users.csv"
SLOTS_FILE = "parking_slots.csv"
BOOKINGS_FILE = "parking_bookings.csv"

# Fixed seed for every random step in the pipeline (splits, models, sampling).
RANDOM_SEED = 42

# --------------------------------------------------------------------------
# Schema: exact column order of each CSV
# --------------------------------------------------------------------------
USERS_COLUMNS = ["user_id", "role", "registration_date", "preferred_vehicle_type"]

SLOTS_COLUMNS = [
    "slot_id", "owner_id", "parking_zone", "latitude", "longitude",
    "capacity", "base_price_per_hour", "vehicle_type_supported", "is_active",
]

BOOKINGS_COLUMNS = [
    "booking_id", "driver_id", "owner_id", "slot_id", "parking_zone",
    "booking_date", "day_of_week", "hour", "is_weekend", "is_holiday",
    "slot_capacity", "occupied_slots", "available_slots", "occupancy_rate",
    "booking_duration_hours", "price_per_hour", "total_amount", "distance_km",
    "booking_status", "demand_level",
]

# Expected row counts of the supplied dataset. A different count is reported
# as a warning, not an error, so the pipeline still works on a regenerated set.
EXPECTED_ROWS = {"users": 1800, "slots": 500, "bookings": 42378}

# --------------------------------------------------------------------------
# Allowed values
# --------------------------------------------------------------------------
ROLES = ["driver", "owner"]
ZONES = [f"Zone {c}" for c in "ABCDEFGH"]
DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday",
                "Friday", "Saturday", "Sunday"]
DEMAND_LEVELS = ["Low", "Medium", "High"]          # ordered
BOOKING_STATUSES = ["Completed", "Cancelled", "Active"]
DRIVER_VEHICLE_TYPES = ["Two-Wheeler", "Car", "SUV"]
SLOT_VEHICLE_TYPES = ["Two-Wheeler", "Car", "SUV", "All"]
CAPACITY_VALUES = [1, 2, 3, 4, 5, 6, 8, 10]
DURATION_VALUES = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12]

# Which slot types each driver vehicle may use (SUV listings also take cars).
VEHICLE_COMPATIBILITY = {
    "Two-Wheeler": {"Two-Wheeler", "All"},
    "Car": {"Car", "SUV", "All"},
    "SUV": {"SUV", "All"},
}

# --------------------------------------------------------------------------
# ID formats
# --------------------------------------------------------------------------
DRIVER_ID_PATTERN = r"^DRV\d{4}$"
OWNER_ID_PATTERN = r"^OWN\d{4}$"
SLOT_ID_PATTERN = r"^SLOT\d{4}$"
BOOKING_ID_PATTERN = r"^BOOK\d{6}$"

# --------------------------------------------------------------------------
# Valid ranges
# --------------------------------------------------------------------------
HOUR_RANGE = (0, 23)
OCCUPANCY_RATE_RANGE = (0.0, 100.0)
BOOKING_PRICE_RANGE = (5, 200)        # Rs per hour actually charged
BASE_PRICE_RANGE = (10, 100)          # Rs per hour listed by the owner
DISTANCE_RANGE_KM = (0.1, 10.0)
MAX_SLOT_DISTANCE_FROM_CENTRE_KM = 10.0
ACTIVE_STATUS_LAST_DAYS = 3           # 'Active' only in the final N days
FLOAT_TOLERANCE = 0.011               # values are stored to 2 decimals

# Columns that are intentionally incomplete in the supplied data. A missing
# value anywhere else is a validation failure.
ALLOWED_MISSING = {
    "users": ["preferred_vehicle_type"],
    "slots": ["vehicle_type_supported"],
    "bookings": ["occupancy_rate", "booking_duration_hours", "price_per_hour",
                 "distance_km", "demand_level"],
}

# --------------------------------------------------------------------------
# Phase 3: cleaning and feature engineering
# --------------------------------------------------------------------------
# Time-based split. Models learn from the past and are tested on the future,
# which is how they are used in the app. A random split would leak future
# information through the historical features.
TRAIN_END = "2026-06-30"        # train:      2025-10-01 .. 2026-06-30
VALIDATION_END = "2026-07-31"   # validation: 2026-07-01 .. 2026-07-31
                                # test:       2026-08-01 .. 2026-09-30

# Weekday peak hours, read from the hourly booking profile in the EDA
# (about 10-12 bookings per hour at 08-09 and 17-19 against 5-6 at midday).
MORNING_PEAK_HOURS = [8, 9]
EVENING_PEAK_HOURS = [17, 18, 19]

ROLLING_DAYS = 7                # window for rolling slot occupancy
DEMAND_TO_NUMBER = {"Low": 0, "Medium": 1, "High": 2}

# Service hours covered by the historical data (bookings start 06:00-23:00).
SERVICE_HOURS = list(range(6, 24))

CLEAN_USERS_FILE = "users_clean.csv"
CLEAN_SLOTS_FILE = "slots_clean.csv"
CLEAN_BOOKINGS_FILE = "bookings_clean.csv"
FEATURES_FILE = "slot_hour_features.csv"
SERVING_STATE_FILE = "serving_state.json"
CLEANING_REPORT_FILE = "cleaning_report.json"

# --------------------------------------------------------------------------
# Phase 5: models
# --------------------------------------------------------------------------
AVAILABILITY_MODEL_FILE = "availability_model.joblib"
DEMAND_MODEL_FILE = "demand_model.joblib"
PRICE_MODEL_FILE = "price_model.joblib"
METRICS_FILE = "metrics.json"

# Listings with one space always show 0 % occupancy when booked (a full
# listing cannot be booked), so they carry no signal for the availability
# model and are left out of it, as the dataset README advises.
AVAILABILITY_MIN_CAPACITY = 2

# Central share of test-set errors used for the prediction interval shown in
# the app (0.80 = "8 in 10 past predictions were within this range").
PREDICTION_INTERVAL = 0.80

# --------------------------------------------------------------------------
# Smart parking recommendation (driver)
# --------------------------------------------------------------------------
# Weights of the four score components; they must sum to 1. Reasoning:
#   availability 0.40  the point of the feature is finding a free space
#   distance     0.30  distance is the strongest cancellation driver in the
#                      EDA (7.6 % cancelled within 0.5 km, 27.6 % at 3-5 km)
#   price        0.20  listings priced above similar ones get fewer bookings
#                      (Spearman -0.24), a real but weaker effect
#   history      0.10  completion rates differ little between listings, so
#                      this component can only break ties
# Callers may override the weights per request.
RECOMMENDATION_WEIGHTS = {
    "availability": 0.40, "distance": 0.30, "price": 0.20, "history": 0.10,
}
# Distance at which the distance score reaches zero. 97.9 % of historical
# bookings were made within 3 km and cancellations climb steeply beyond it.
RECOMMENDATION_MAX_DISTANCE_KM = 3.0
# A component counts as a "reason" when its normalised score is at least this.
RECOMMENDATION_REASON_THRESHOLD = 0.6

# --------------------------------------------------------------------------
# Smart price recommendation (owner)
# --------------------------------------------------------------------------
PRICE_STEP = 5                 # owners list prices in steps of Rs 5
PRICE_MAX_INCREASE = 0.25      # never suggest more than +25 % in one step
PRICE_MAX_DECREASE = 0.15      # or less than -15 %
# Above this multiple of the typical price of similar listings, a further
# increase is not suggested: the EDA shows such listings lose bookings.
PRICE_PEER_CEILING = 1.20

# --------------------------------------------------------------------------
# Matching a live ParkEase spot to a zone of the historical data
# --------------------------------------------------------------------------
# A spot within this distance of a zone centre takes that zone. Farther spots
# (another city) take the zone whose typical price is closest to theirs.
ZONE_MATCH_MAX_KM = 8.0

# Live app vehicle types -> dataset vehicle types
LIVE_TO_DATASET_VEHICLE = {"bike": "Two-Wheeler", "car": "Car", "both": "All"}

# Zone character, from the data dictionary (the CSVs only carry the label).
ZONE_CHARACTER = {
    "Zone A": "Central business district",
    "Zone B": "IT / office corridor",
    "Zone C": "Shopping and leisure district",
    "Zone D": "Transit hub",
    "Zone E": "University campus",
    "Zone F": "Hospital area",
    "Zone G": "Residential north",
    "Zone H": "Suburban outskirts",
}
DEMO_LINKS_FILE = "demo_links.json"

# --------------------------------------------------------------------------
# Phase 6: service
# --------------------------------------------------------------------------
LOCAL_TIMEZONE = "Asia/Kolkata"       # hours in the app are local Indian time
RECOMMENDATION_RADIUS_KM = 5.0        # spots farther than this are not ranked
# Live booking statuses -> dataset statuses
LIVE_TO_DATASET_STATUS = {"completed": "Completed", "cancelled": "Cancelled",
                          "confirmed": "Active", "pending": "Active"}
