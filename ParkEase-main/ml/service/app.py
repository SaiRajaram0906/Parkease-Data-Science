"""ParkEase Data Science service (FastAPI).

Start it from the project root:

    python -m uvicorn ml.service.app:app --port 8000

The ParkEase Node backend is the only caller. It adds live data (spots,
bookings, who is logged in) and forwards the request here. This service never
touches the live database and never trains a model while serving.

Interactive API documentation: http://localhost:8000/docs
"""
from __future__ import annotations

import json
from datetime import date as Date, datetime
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from ml import config
from ml.eda.analytics import dataset_overview, driver_analytics, owner_analytics
from ml.prediction.predictor import ModelsNotReady, Predictor
from ml.preprocessing.clean_data import load_cleaned

app = FastAPI(
    title="ParkEase Data Science service",
    description="Analytics and model predictions for ParkEase. "
                "Trained on a SYNTHETIC historical dataset.",
    version="1.0.0",
)


# --------------------------------------------------------------------------
# State loaded once at start-up
# --------------------------------------------------------------------------
class Store:
    def __init__(self) -> None:
        self.predictor = Predictor()
        self.cleaned = None
        self.data_error: Optional[str] = None
        self._overview: Optional[Dict[str, object]] = None
        try:
            self.cleaned = load_cleaned()
        except FileNotFoundError:
            self.data_error = ("Processed data not found. "
                               "Run: python -m ml.training.train_all")

    def overview(self) -> Dict[str, object]:
        if self._overview is None:
            self._overview = dataset_overview(self.require_data())
        return self._overview

    def require_data(self):
        if self.cleaned is None:
            raise HTTPException(status_code=503, detail=self.data_error)
        return self.cleaned


store = Store()


def _now() -> datetime:
    return datetime.now(ZoneInfo(config.LOCAL_TIMEZONE))


def _resolve_day(day: Optional[Date]) -> Date:
    return day or _now().date()


def _resolve_hour(hour: Optional[int]) -> int:
    return _now().hour if hour is None else hour


def _predict(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except ModelsNotReady as error:
        raise HTTPException(status_code=503, detail=str(error))


# --------------------------------------------------------------------------
# Request bodies
# --------------------------------------------------------------------------
class Spot(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    city: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    price_per_hour: Optional[float] = None
    total_slots: Optional[int] = None
    vehicle_type: Optional[str] = None
    is_active: Optional[bool] = True
    dataset_slot_id: Optional[str] = None
    current_available: Optional[int] = None


class Origin(BaseModel):
    latitude: float
    longitude: float


class HoursRequest(BaseModel):
    spot: Spot
    date: Optional[Date] = None
    hours: Optional[List[int]] = Field(default=None, description="0-23; default all service hours")


class PriceRequest(BaseModel):
    spot: Spot
    date: Optional[Date] = None
    hour: Optional[int] = Field(default=None, ge=0, le=23)


class RecommendRequest(BaseModel):
    spots: List[Spot]
    date: Optional[Date] = None
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    origin: Optional[Origin] = None
    vehicle: Optional[str] = None
    weights: Optional[Dict[str, float]] = None
    limit: int = Field(default=5, ge=1, le=50)
    radius_km: Optional[float] = Field(default=config.RECOMMENDATION_RADIUS_KM, gt=0)


class LiveBooking(BaseModel):
    id: Optional[int] = None
    spot_id: int
    start_time: datetime
    duration_hours: float
    total_amount: float
    status: str


class LiveAnalyticsRequest(BaseModel):
    bookings: List[LiveBooking]
    spots: List[Spot] = []


def _live_bookings_frame(request: LiveAnalyticsRequest) -> pd.DataFrame:
    """Put live ParkEase bookings into the column layout the analytics use."""
    areas: Dict[int, str] = {}
    for spot in request.spots:
        label = spot.city or "Unknown area"
        if store.predictor.ready:
            described = store.predictor.describe_spot(spot.model_dump())
            if described["zone_match"]["method"] != "price_profile":
                label = described["zone"]
        areas[spot.id] = label
    zone = ZoneInfo(config.LOCAL_TIMEZONE)
    rows = []
    for booking in request.bookings:
        start = booking.start_time
        local = start.astimezone(zone) if start.tzinfo else start
        rows.append({
            "booking_id": booking.id, "slot_id": booking.spot_id,
            "booking_date": pd.Timestamp(local.date()), "hour": local.hour,
            "parking_zone": areas.get(booking.spot_id, "Unknown area"),
            "booking_duration_hours": booking.duration_hours,
            "total_amount": booking.total_amount,
            "booking_status": config.LIVE_TO_DATASET_STATUS.get(booking.status.lower(), "Active"),
        })
    columns = ["booking_id", "slot_id", "booking_date", "hour", "parking_zone",
               "booking_duration_hours", "total_amount", "booking_status"]
    return pd.DataFrame(rows, columns=columns)


# --------------------------------------------------------------------------
# Health and metadata
# --------------------------------------------------------------------------
@app.get("/health")
def health() -> Dict[str, object]:
    predictor = store.predictor
    return {
        "status": "ok",
        "models_ready": predictor.ready,
        "models_error": predictor.load_error,
        "data_ready": store.cleaned is not None,
        "data_error": store.data_error,
        "history_ends": predictor.state["history_ends"] if predictor.state else None,
        "trained_at": predictor.metrics["trained_at"] if predictor.metrics else None,
        "synthetic_data": True,
    }


@app.get("/models/performance")
def models_performance() -> Dict[str, object]:
    if store.predictor.metrics is None:
        raise HTTPException(status_code=503, detail=store.predictor.load_error)
    return {**store.predictor.metrics,
            "recommendation": {
                "type": "transparent weighted score, not a trained model",
                "weights": config.RECOMMENDATION_WEIGHTS,
                "max_distance_km": config.RECOMMENDATION_MAX_DISTANCE_KM,
                "radius_km": config.RECOMMENDATION_RADIUS_KM,
            },
            "price_rules": {
                "step": config.PRICE_STEP, "max_increase": config.PRICE_MAX_INCREASE,
                "max_decrease": config.PRICE_MAX_DECREASE,
                "peer_ceiling": config.PRICE_PEER_CEILING,
            }}


@app.get("/dataset/validation")
def dataset_validation() -> Dict[str, object]:
    path = config.REPORTS_DIR / "validation_report.json"
    if not path.exists():
        raise HTTPException(status_code=503, detail="Validation report not found. "
                            "Run: python -m ml.training.train_all")
    report = json.loads(path.read_text(encoding="utf-8"))
    cleaning_path = config.PROCESSED_DIR / config.CLEANING_REPORT_FILE
    cleaning = json.loads(cleaning_path.read_text(encoding="utf-8")) if cleaning_path.exists() else None
    report.pop("source_dir", None)
    return {"validation": report, "cleaning": cleaning}


@app.get("/demo/links")
def demo_links() -> Dict[str, object]:
    path = config.PROCESSED_DIR / config.DEMO_LINKS_FILE
    if not path.exists():
        raise HTTPException(status_code=503, detail="Demo links not built yet.")
    return json.loads(path.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# Analytics
# --------------------------------------------------------------------------
@app.get("/analytics/overview")
def analytics_overview() -> Dict[str, object]:
    return store.overview()


@app.get("/analytics/driver/{dataset_user_id}")
def analytics_driver_history(dataset_user_id: str) -> Dict[str, object]:
    bookings = store.require_data().bookings
    mine = bookings[bookings["driver_id"] == dataset_user_id]
    return {**driver_analytics(mine), "source": "history", "synthetic_data": True,
            "dataset_user_id": dataset_user_id}


@app.post("/analytics/driver")
def analytics_driver_live(request: LiveAnalyticsRequest) -> Dict[str, object]:
    return {**driver_analytics(_live_bookings_frame(request)), "source": "live",
            "synthetic_data": False}


@app.get("/analytics/owner/{dataset_user_id}")
def analytics_owner_history(dataset_user_id: str) -> Dict[str, object]:
    data = store.require_data()
    mine = data.bookings[data.bookings["owner_id"] == dataset_user_id]
    listings = int((data.slots["owner_id"] == dataset_user_id).sum())
    return {**owner_analytics(mine, listings), "source": "history", "synthetic_data": True,
            "dataset_user_id": dataset_user_id}


@app.post("/analytics/owner")
def analytics_owner_live(request: LiveAnalyticsRequest) -> Dict[str, object]:
    return {**owner_analytics(_live_bookings_frame(request), len(request.spots)),
            "source": "live", "synthetic_data": False}


# --------------------------------------------------------------------------
# Predictions and recommendations
# --------------------------------------------------------------------------
@app.post("/predict/availability")
def predict_availability(request: HoursRequest) -> Dict[str, object]:
    hours = request.hours or config.SERVICE_HOURS
    return _predict(store.predictor.availability, request.spot.model_dump(),
                    _resolve_day(request.date), hours)


@app.post("/predict/demand")
def predict_demand(request: HoursRequest) -> Dict[str, object]:
    return _predict(store.predictor.demand, request.spot.model_dump(),
                    _resolve_day(request.date), request.hours)


@app.post("/recommend/price")
def recommend_price(request: PriceRequest) -> Dict[str, object]:
    return _predict(store.predictor.price_recommendation, request.spot.model_dump(),
                    _resolve_day(request.date), request.hour)


@app.post("/recommend/parking")
def recommend_parking(request: RecommendRequest) -> Dict[str, object]:
    origin = request.origin.model_dump() if request.origin else None
    return _predict(
        store.predictor.recommend, [s.model_dump() for s in request.spots],
        _resolve_day(request.date), _resolve_hour(request.hour), origin=origin,
        vehicle=request.vehicle, weights=request.weights, limit=request.limit,
        radius_km=request.radius_km)
