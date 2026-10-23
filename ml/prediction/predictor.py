"""Predictions and recommendations for live ParkEase spots.

The predictor loads the three trained models and the serving state once, then
answers questions about any spot, whether or not it exists in the history:

    availability(spot, date, hours)      Model 1
    demand(spot, date, hours)            Model 2
    price_recommendation(spot, date)     Model 2 + Model 3 + explainable rules
    recommend(spots, origin, ...)        transparent ranking score

A "spot" is a dictionary describing a live ParkEase listing:

    id, name, latitude, longitude, price_per_hour, total_slots,
    vehicle_type ('car' | 'bike' | 'both'), is_active,
    dataset_slot_id (optional link to the historical data),
    current_available (optional, real free spaces right now)

Nothing here invents numbers. When a model cannot answer (no trained model,
an hour outside the history, a single-space listing) the result says so and
names the fallback that was used, if any.
"""
from __future__ import annotations

import json
import math
from datetime import date as Date
from typing import Dict, List, Optional, Sequence

import joblib
import numpy as np
import pandas as pd

from ml import config
from ml.preprocessing.features import add_time_features, load_serving_state
from ml.training.common import BASE_FEATURES, PRICE_FEATURES

SLOT_HISTORY = ["slot_hist_occupancy", "slot_prev_day_occupancy", "slot_rolling_occupancy",
                "slot_hist_bookings_per_day", "slot_hist_demand", "slot_hist_duration"]
ZONE_HOUR_HISTORY = ["zone_hour_hist_occupancy", "zone_hour_hist_demand",
                     "zone_hour_hist_bookings"]


class ModelsNotReady(Exception):
    """Raised when a prediction is requested before the models are trained."""


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    a = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2)
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _hour_label(hour: int) -> str:
    return f"{int(hour):02d}:00"


def _round_to_step(value: float, step: int) -> int:
    return int(round(value / step) * step)


class Predictor:
    def __init__(self) -> None:
        self.state: Optional[Dict[str, object]] = None
        self.metrics: Optional[Dict[str, object]] = None
        self.models: Dict[str, object] = {}
        self.load_error: Optional[str] = None
        self.reload()

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------
    def reload(self) -> None:
        self.models, self.load_error = {}, None
        try:
            self.state = load_serving_state()
            self.metrics = json.loads(
                (config.MODELS_DIR / config.METRICS_FILE).read_text(encoding="utf-8"))
            for name, file_name in (("availability", config.AVAILABILITY_MODEL_FILE),
                                    ("demand", config.DEMAND_MODEL_FILE),
                                    ("price", config.PRICE_MODEL_FILE)):
                self.models[name] = joblib.load(config.MODELS_DIR / file_name)
        except FileNotFoundError as error:
            self.models = {}
            self.load_error = (f"Trained models not found ({error.filename}). "
                               "Run: python -m ml.training.train_all")
        except Exception as error:  # version mismatch, corrupt file, ...
            self.models = {}
            self.load_error = (f"Models could not be loaded ({type(error).__name__}: {error}). "
                               "Retrain with: python -m ml.training.train_all")

    @property
    def ready(self) -> bool:
        return len(self.models) == 3 and self.state is not None

    def _require(self) -> None:
        if not self.ready:
            raise ModelsNotReady(self.load_error or "Models are not loaded.")

    # ------------------------------------------------------------------
    # Describing a live spot in the terms the models were trained on
    # ------------------------------------------------------------------
    def _match_zone(self, latitude, longitude, price: float) -> Dict[str, object]:
        zones = self.state["zones"]
        if latitude is not None and longitude is not None:
            distances = {zone: haversine_km(latitude, longitude, info["centre_latitude"],
                                            info["centre_longitude"])
                         for zone, info in zones.items()}
            zone = min(distances, key=distances.get)
            if distances[zone] <= config.ZONE_MATCH_MAX_KM:
                return {"zone": zone, "method": "location",
                        "detail": f"nearest zone centre, {distances[zone]:.1f} km away"}
        zone = min(zones, key=lambda z: abs(zones[z]["median_base_price"] - price))
        return {"zone": zone, "method": "price_profile",
                "detail": "outside the area covered by the history; matched to the zone "
                          "with the most similar typical price"}

    def describe_spot(self, spot: Dict[str, object]) -> Dict[str, object]:
        """Resolve zone, listing attributes and history features for a spot."""
        self._require()
        slots = self.state["slots"]
        linked = slots.get(str(spot.get("dataset_slot_id") or ""))
        price = spot.get("price_per_hour")
        capacity = spot.get("total_slots")
        vehicle = config.LIVE_TO_DATASET_VEHICLE.get(str(spot.get("vehicle_type")),
                                                    spot.get("vehicle_type"))

        if linked:
            zone_match = {"zone": linked["parking_zone"], "method": "history",
                          "detail": "this listing has its own booking history"}
            price = float(price if price is not None else linked["base_price_per_hour"])
            capacity = int(capacity if capacity is not None else linked["capacity"])
            vehicle = vehicle or linked["vehicle_type_supported"]
        else:
            price = float(price if price is not None else 0)
            capacity = int(capacity if capacity is not None else 1)
            vehicle = vehicle or "All"
            zone_match = self._match_zone(spot.get("latitude"), spot.get("longitude"), price)
        zone = zone_match["zone"]
        if vehicle not in config.SLOT_VEHICLE_TYPES:
            vehicle = "All"

        # History: the listing's own, else listings like it, else the zone.
        if linked and linked.get("bookings"):
            history = {name: linked.get(name) for name in SLOT_HISTORY}
            completion, history_source = linked.get("completion_rate"), "listing"
            history_bookings = linked["bookings"]
        else:
            by_capacity = self.state["fallback_zone_capacity"]
            options = [int(k.split("|")[1]) for k in by_capacity if k.startswith(zone + "|")]
            nearest = min(options, key=lambda c: abs(c - capacity)) if options else None
            fallback = (by_capacity.get(f"{zone}|{nearest}") or self.state["fallback_zone"].get(zone)
                        or self.state["fallback_overall"])
            history = {name: fallback.get(name) for name in SLOT_HISTORY}
            completion, history_source = fallback.get("completion_rate"), "similar listings in the zone"
            history_bookings = 0

        zone_info = self.state["zones"][zone]
        peer_median = (zone_info["peer_median_price"].get(vehicle)
                       or zone_info["median_base_price"])
        return {
            "id": spot.get("id"), "name": spot.get("name"),
            "zone": zone, "zone_character": config.ZONE_CHARACTER.get(zone, ""),
            "zone_match": zone_match,
            "capacity": capacity, "price_per_hour": price, "vehicle_type": vehicle,
            "peer_median_price": peer_median,
            "price_rel_peers": round(price / peer_median, 4) if peer_median else 1.0,
            "history": history, "history_source": history_source,
            "history_bookings": history_bookings, "completion_rate": completion,
        }

    def _feature_rows(self, described: Dict[str, object], day: Date,
                      hours: Sequence[int]) -> pd.DataFrame:
        date_text = pd.Timestamp(day).strftime("%Y-%m-%d")
        frame = pd.DataFrame({
            "booking_date": pd.Timestamp(day), "hour": list(hours),
            "is_holiday": int(date_text in self.state["holidays"]),
            "parking_zone": described["zone"],
            "vehicle_type_supported": described["vehicle_type"],
            "slot_capacity": described["capacity"],
            "base_price_per_hour": described["price_per_hour"],
            "price_rel_peers": described["price_rel_peers"],
        })
        frame = add_time_features(frame)
        for name in SLOT_HISTORY:
            value = described["history"].get(name)
            frame[name] = np.nan if value is None else value
        default = self.state["zone_hour_default"]
        lookups = [self.state["zone_hour"].get(f"{described['zone']}|{int(h)}|{int(off)}", default)
                   for h, off in zip(frame["hour"], frame["is_off_day"])]
        for name in ZONE_HOUR_HISTORY:
            frame[name] = [row.get(name) if row.get(name) is not None else default[name]
                           for row in lookups]
        return frame

    def _feature_rows_many(self, described_spots: List[Dict[str, object]], day: Date,
                           hour: int) -> pd.DataFrame:
        """One feature row per spot for a single hour (same columns as _feature_rows)."""
        date_text = pd.Timestamp(day).strftime("%Y-%m-%d")
        frame = pd.DataFrame({
            "booking_date": pd.Timestamp(day), "hour": int(hour),
            "is_holiday": int(date_text in self.state["holidays"]),
            "parking_zone": [d["zone"] for d in described_spots],
            "vehicle_type_supported": [d["vehicle_type"] for d in described_spots],
            "slot_capacity": [d["capacity"] for d in described_spots],
            "base_price_per_hour": [d["price_per_hour"] for d in described_spots],
            "price_rel_peers": [d["price_rel_peers"] for d in described_spots],
        })
        frame = add_time_features(frame)
        for name in SLOT_HISTORY:
            frame[name] = [np.nan if d["history"].get(name) is None else d["history"][name]
                           for d in described_spots]
        default = self.state["zone_hour_default"]
        off_day = int(frame["is_off_day"].iloc[0])
        lookups = [self.state["zone_hour"].get(f"{d['zone']}|{int(hour)}|{off_day}", default)
                   for d in described_spots]
        for name in ZONE_HOUR_HISTORY:
            frame[name] = [row.get(name) if row.get(name) is not None else default[name]
                           for row in lookups]
        return frame

    @staticmethod
    def _split_hours(hours: Sequence[int]):
        inside = [int(h) for h in hours if int(h) in config.SERVICE_HOURS]
        outside = [int(h) for h in hours if int(h) not in config.SERVICE_HOURS]
        return inside, outside

    # ------------------------------------------------------------------
    # Model 1: availability
    # ------------------------------------------------------------------
    def availability(self, spot: Dict[str, object], day: Date,
                     hours: Sequence[int]) -> Dict[str, object]:
        self._require()
        described = self.describe_spot(spot)
        inside, outside = self._split_hours(hours)
        info = self.metrics["models"]["availability"]
        interval = info["prediction_interval"]
        capacity = described["capacity"]
        rows: List[Dict[str, object]] = []

        for hour in inside:
            rows += self._availability_rows([described], day, hour)
        for hour in outside:
            rows.append({"hour": hour, "label": _hour_label(hour), "available": False,
                         "reason": "The history has no bookings starting at this hour "
                                   "(it covers 06:00 to 23:00), so no prediction is made."})
        rows.sort(key=lambda r: r["hour"])
        return {
            "spot": described, "date": pd.Timestamp(day).strftime("%Y-%m-%d"),
            "capacity": capacity, "hours": rows,
            "reliability": {
                "model": info["selected_model"],
                "mae_occupancy_points": info["test_metrics"]["mae"],
                "mae_spaces": info["test_mae_spaces"],
                "r2": info["test_metrics"]["r2"],
                "interval_coverage": interval["coverage"],
                "note": ("Typical error on the held-out test months. The range shown "
                         f"covered {int(interval['coverage'] * 100)}% of those test predictions."),
            },
            "is_prediction": True, "synthetic_training_data": True,
        }

    def _availability_rows(self, described_spots: List[Dict[str, object]], day: Date,
                           hour: int) -> List[Dict[str, object]]:
        """Availability for many spots at one hour, with a single model call."""
        if not described_spots:
            return []
        interval = self.metrics["models"]["availability"]["prediction_interval"]
        frame = self._feature_rows_many(described_spots, day, hour)
        modelled = np.clip(self.models["availability"].predict(frame[BASE_FEATURES]), 0, 100)
        baseline = frame["zone_hour_hist_occupancy"].to_numpy(dtype=float)
        rows = []
        for i, described in enumerate(described_spots):
            capacity = described["capacity"]
            use_model = capacity >= config.AVAILABILITY_MIN_CAPACITY
            occ = float(modelled[i] if use_model else baseline[i])
            low_occ = float(np.clip(occ + interval["lower"], 0, 100))
            high_occ = float(np.clip(occ + interval["upper"], 0, 100))
            rows.append({
                "hour": hour, "label": _hour_label(hour), "available": True,
                "method": "model" if use_model else "zone_baseline",
                "predicted_occupancy": round(occ, 1),
                "occupancy_low": round(low_occ, 1), "occupancy_high": round(high_occ, 1),
                "predicted_free_share": round(1 - occ / 100, 3),
                "predicted_available": round(capacity * (1 - occ / 100), 1),
                "available_low": int(math.floor(capacity * (1 - high_occ / 100))),
                "available_high": int(math.ceil(capacity * (1 - low_occ / 100))),
            })
        return rows

    # ------------------------------------------------------------------
    # Model 2: demand
    # ------------------------------------------------------------------
    def _demand_frame(self, described: Dict[str, object], day: Date, hours: Sequence[int]):
        frame = self._feature_rows(described, day, hours)
        model = self.models["demand"]
        probabilities = model.predict_proba(frame[BASE_FEATURES])
        classes = list(model.classes_)
        return frame, probabilities, classes

    def demand(self, spot: Dict[str, object], day: Date,
               hours: Optional[Sequence[int]] = None) -> Dict[str, object]:
        self._require()
        described = self.describe_spot(spot)
        inside, outside = self._split_hours(hours or config.SERVICE_HOURS)
        rows: List[Dict[str, object]] = []
        if inside:
            _, probabilities, classes = self._demand_frame(described, day, inside)
            for hour, row in zip(inside, probabilities):
                level = classes[int(np.argmax(row))]
                rows.append({
                    "hour": hour, "label": _hour_label(hour), "available": True,
                    "level": level, "confidence": round(float(np.max(row)), 3),
                    "probabilities": {c: round(float(p), 3) for c, p in zip(classes, row)},
                    "demand_score": round(float(sum(
                        p * config.DEMAND_TO_NUMBER[c] for c, p in zip(classes, row))), 3),
                })
        for hour in outside:
            rows.append({"hour": hour, "label": _hour_label(hour), "available": False,
                         "reason": "Outside the hours covered by the history (06:00 to 23:00)."})
        rows.sort(key=lambda r: r["hour"])
        info = self.metrics["models"]["demand"]
        known = [r for r in rows if r["available"]]
        peak = max(known, key=lambda r: r["demand_score"]) if known else None
        return {
            "spot": described, "date": pd.Timestamp(day).strftime("%Y-%m-%d"),
            "hours": rows, "peak": peak,
            "reliability": {
                "model": info["selected_model"],
                "accuracy": info["test_metrics"]["accuracy"],
                "f1_macro": info["test_metrics"]["f1_macro"],
                "within_one_level": info["test_within_one_level"],
                "note": "Scores on the held-out test months.",
            },
            "is_prediction": True, "synthetic_training_data": True,
        }

    # ------------------------------------------------------------------
    # Model 3 + rules: price recommendation
    # ------------------------------------------------------------------
    def _market_ratio(self, frame: pd.DataFrame, probabilities: np.ndarray,
                      classes: List[str]) -> np.ndarray:
        """Expected price ratio: the model's ratio at each demand level,
        weighted by how likely that level is."""
        expected = np.zeros(len(frame))
        for index, level in enumerate(classes):
            candidate = frame.copy()
            candidate["demand_num"] = config.DEMAND_TO_NUMBER[level]
            expected += probabilities[:, index] * self.models["price"].predict(
                candidate[PRICE_FEATURES])
        return expected

    def _apply_price_rules(self, current: float, ratio: float,
                           peer_median: float) -> Dict[str, object]:
        """Turn a market ratio into a suggestion an owner can act on."""
        notes: List[str] = []
        raw = current * ratio
        upper, lower = current * (1 + config.PRICE_MAX_INCREASE), current * (1 - config.PRICE_MAX_DECREASE)
        bounded = min(max(raw, lower), upper)
        if bounded != raw:
            notes.append("limited_step")
        ceiling = peer_median * config.PRICE_PEER_CEILING
        suggested = max(config.PRICE_STEP, _round_to_step(bounded, config.PRICE_STEP))
        if suggested > current and suggested > ceiling:
            # Do not push a listing further above what similar listings charge.
            floor_step = int(math.floor(ceiling / config.PRICE_STEP) * config.PRICE_STEP)
            suggested = max(current, floor_step)
            notes.append("peer_ceiling")
        if abs(suggested - current) < config.PRICE_STEP / 2:
            suggested = current
        action = "increase" if suggested > current else "decrease" if suggested < current else "keep"
        return {"recommended_price": float(suggested), "action": action, "rules": notes,
                "unrounded": round(raw, 2)}

    def price_recommendation(self, spot: Dict[str, object], day: Date,
                             hour: Optional[int] = None) -> Dict[str, object]:
        self._require()
        described = self.describe_spot(spot)
        current = float(described["price_per_hour"])
        if current <= 0:
            return {"spot": described, "available": False,
                    "reason": "This listing has no current price to adjust."}
        hours = config.SERVICE_HOURS
        frame, probabilities, classes = self._demand_frame(described, day, hours)
        ratios = self._market_ratio(frame, probabilities, classes)
        peer_median = float(described["peer_median_price"])

        by_hour = []
        for i, h in enumerate(hours):
            level = classes[int(np.argmax(probabilities[i]))]
            rule = self._apply_price_rules(current, float(ratios[i]), peer_median)
            by_hour.append({
                "hour": h, "label": _hour_label(h), "demand": level,
                "confidence": round(float(np.max(probabilities[i])), 3),
                "market_ratio": round(float(ratios[i]), 3),
                "recommended_price": rule["recommended_price"], "action": rule["action"],
            })

        if hour is None or int(hour) not in hours:
            # Default to the hour the listing is most likely to be in demand.
            scores = probabilities @ np.array([config.DEMAND_TO_NUMBER[c] for c in classes])
            chosen = int(np.argmax(scores))
            hour_note = "busiest predicted hour of the day"
        else:
            chosen, hour_note = hours.index(int(hour)), "selected hour"
        ratio = float(ratios[chosen])
        level = classes[int(np.argmax(probabilities[chosen]))]
        rule = self._apply_price_rules(current, ratio, peer_median)

        # One price for the whole day: hours weighted by how many bookings
        # the zone usually sees in them.
        weights = frame["zone_hour_hist_bookings"].to_numpy(dtype=float)
        weights = weights if weights.sum() > 0 else np.ones(len(hours))
        day_ratio = float(np.average(ratios, weights=weights))
        day_rule = self._apply_price_rules(current, day_ratio, peer_median)

        change = (rule["recommended_price"] - current) / current * 100
        position = described["price_rel_peers"]
        reasons = [
            f"Predicted demand at {_hour_label(hours[chosen])} is {level} "
            f"({int(round(float(np.max(probabilities[chosen])) * 100))}% likely).",
            f"In the history, similar listings were priced at {ratio:.2f}x their base price "
            f"in these conditions.",
            f"Your price is {position:.2f}x the typical ₹{peer_median:.0f}/h of similar "
            f"listings in {described['zone']}.",
        ]
        if "peer_ceiling" in rule["rules"]:
            reasons.append(
                f"Held at or below {config.PRICE_PEER_CEILING:.1f}x the typical price: listings "
                "priced well above similar ones got fewer bookings in the history.")
        if "limited_step" in rule["rules"]:
            reasons.append("The change is capped so a single adjustment stays moderate.")
        if rule["action"] == "keep" and "peer_ceiling" not in rule["rules"]:
            reasons.append(f"The suggested change is smaller than the ₹{config.PRICE_STEP} "
                           "pricing step, so the current price already fits.")

        info = self.metrics["models"]["price"]
        return {
            "available": True, "spot": described,
            "date": pd.Timestamp(day).strftime("%Y-%m-%d"),
            "hour": hours[chosen], "hour_label": _hour_label(hours[chosen]), "hour_basis": hour_note,
            "current_price": current,
            "predicted_demand": level,
            "demand_probabilities": {c: round(float(p), 3)
                                     for c, p in zip(classes, probabilities[chosen])},
            "market_ratio": round(ratio, 3),
            "recommended_price": rule["recommended_price"],
            "action": rule["action"], "change_percent": round(change, 1),
            "rules_applied": rule["rules"], "reasons": reasons,
            "peer_median_price": peer_median, "price_vs_peers": position,
            "all_day": {"market_ratio": round(day_ratio, 3),
                        "recommended_price": day_rule["recommended_price"],
                        "action": day_rule["action"]},
            "by_hour": by_hour,
            "reliability": {
                "model": info["selected_model"],
                "mae_rupees": info.get("test_metrics_with_predicted_demand_rupees",
                                       info["test_metrics_rupees"])["mae"],
                "mae_ratio": info.get("test_metrics_with_predicted_demand",
                                      info["test_metrics"])["mae"],
                "note": ("Typical error of the price model on the held-out test months "
                         "when demand comes from the demand model, as it does here."),
            },
            "owner_decides": True,
            "is_prediction": True, "synthetic_training_data": True,
        }

    # ------------------------------------------------------------------
    # Smart parking recommendation
    # ------------------------------------------------------------------
    @staticmethod
    def _vehicle_fits(driver_vehicle: Optional[str], spot_vehicle: str) -> bool:
        if not driver_vehicle:
            return True
        vehicle = config.LIVE_TO_DATASET_VEHICLE.get(driver_vehicle, driver_vehicle)
        if vehicle == "All":
            return True
        return spot_vehicle in config.VEHICLE_COMPATIBILITY.get(vehicle, {spot_vehicle})

    @staticmethod
    def _min_max(values: List[float], higher_is_better: bool) -> List[float]:
        low, high = min(values), max(values)
        if high - low < 1e-9:
            return [1.0] * len(values)      # no difference between the options
        scaled = [(v - low) / (high - low) for v in values]
        return scaled if higher_is_better else [1 - s for s in scaled]

    def recommend(self, spots: List[Dict[str, object]], day: Date, hour: int,
                  origin: Optional[Dict[str, float]] = None,
                  vehicle: Optional[str] = None,
                  weights: Optional[Dict[str, float]] = None,
                  limit: int = 5, radius_km: Optional[float] = None) -> Dict[str, object]:
        """Rank spots with a transparent weighted score (0-100).

        score = 100 x sum(weight x component), each component in 0..1:
          availability  predicted share of free spaces (Model 1)
          distance      1 at the driver's location, 0 at MAX_DISTANCE_KM
          price         cheapest option = 1, dearest = 0 (min-max over options)
          history       best completion rate = 1, worst = 0 (min-max)
        Without a driver location the distance component is dropped and the
        other weights are rescaled to sum to 1.

        Spots are left out, and counted in `excluded`, when they are inactive,
        do not take the driver's vehicle, are farther than `radius_km`, or
        are already fully booked for that hour (`current_available` <= 0).
        """
        self._require()
        weights = dict(config.RECOMMENDATION_WEIGHTS, **(weights or {}))
        weights = {k: max(float(v), 0.0) for k, v in weights.items()
                   if k in config.RECOMMENDATION_WEIGHTS}
        if origin is None:
            weights["distance"] = 0.0
        total = sum(weights.values()) or 1.0
        weights = {k: v / total for k, v in weights.items()}

        excluded = {"inactive": 0, "vehicle": 0, "too_far": 0, "fully_booked": 0,
                    "no_prediction": 0}
        hour_known = int(hour) in config.SERVICE_HOURS
        candidates = []
        for spot in spots:
            if spot.get("is_active") is False:
                excluded["inactive"] += 1
                continue
            described = self.describe_spot(spot)
            if not self._vehicle_fits(vehicle, described["vehicle_type"]):
                excluded["vehicle"] += 1
                continue
            if not hour_known:
                excluded["no_prediction"] += 1
                continue
            current = spot.get("current_available")
            if current is not None and int(current) <= 0:
                excluded["fully_booked"] += 1
                continue
            distance = None
            if origin and spot.get("latitude") is not None and spot.get("longitude") is not None:
                distance = haversine_km(origin["latitude"], origin["longitude"],
                                        float(spot["latitude"]), float(spot["longitude"]))
                if radius_km is not None and distance > radius_km:
                    excluded["too_far"] += 1
                    continue
            candidates.append({"spot": spot, "described": described, "distance": distance})

        # One model call for all remaining spots.
        for candidate, row in zip(candidates, self._availability_rows(
                [c["described"] for c in candidates], day, int(hour))):
            candidate["row"] = row

        if not candidates:
            return {"recommendations": [], "weights": weights, "excluded": excluded,
                    "candidates": 0, "hour": hour,
                    "date": pd.Timestamp(day).strftime("%Y-%m-%d")}

        availability = [c["row"]["predicted_free_share"] for c in candidates]
        max_km = config.RECOMMENDATION_MAX_DISTANCE_KM
        distance = [0.0 if c["distance"] is None else max(0.0, 1 - c["distance"] / max_km)
                    for c in candidates]
        price = self._min_max([c["described"]["price_per_hour"] for c in candidates], False)
        history = self._min_max([c["described"]["completion_rate"] or 0 for c in candidates], True)
        average_price = float(np.mean([c["described"]["price_per_hour"] for c in candidates]))
        threshold = config.RECOMMENDATION_REASON_THRESHOLD

        results = []
        for i, c in enumerate(candidates):
            parts = {"availability": availability[i], "distance": distance[i],
                     "price": price[i], "history": history[i]}
            score = 100 * sum(weights[k] * parts[k] for k in weights)
            described, row, spot = c["described"], c["row"], c["spot"]
            free_percent = int(round(row["predicted_free_share"] * 100))
            reasons, cautions = [], []
            if parts["availability"] >= threshold:
                reasons.append(f"High predicted availability ({free_percent}% of spaces free)")
            elif parts["availability"] < 0.35:
                cautions.append(f"Likely to be busy ({free_percent}% of spaces predicted free)")
            if c["distance"] is not None:
                if parts["distance"] >= threshold:
                    reasons.append(f"Close to your location ({c['distance']:.1f} km)")
                elif parts["distance"] < 0.2:
                    cautions.append(f"Far from your location ({c['distance']:.1f} km)")
            if len(candidates) > 1 and parts["price"] >= threshold and weights["price"] > 0:
                reasons.append(f"Competitive price (₹{described['price_per_hour']:.0f}/h against "
                               f"an average of ₹{average_price:.0f}/h)")
            if len(candidates) > 1 and parts["history"] >= threshold and described["completion_rate"]:
                whose = ("this listing's" if described["history_source"] == "listing"
                         else "similar listings'")
                reasons.append(f"Reliable: {described['completion_rate'] * 100:.0f}% of {whose} "
                               "past bookings were completed")
            results.append({
                "spot_id": spot.get("id"), "name": spot.get("name"),
                "score": round(score, 1),
                "components": {k: round(v, 3) for k, v in parts.items()},
                "contributions": {k: round(100 * weights[k] * parts[k], 1) for k in weights},
                "reasons": reasons, "cautions": cautions,
                "predicted_free_percent": free_percent,
                "predicted_occupancy": row["predicted_occupancy"],
                "available_low": row["available_low"], "available_high": row["available_high"],
                "prediction_method": row["method"],
                "current_available": spot.get("current_available"),
                "capacity": described["capacity"],
                "distance_km": None if c["distance"] is None else round(c["distance"], 2),
                "price_per_hour": described["price_per_hour"],
                "zone": described["zone"], "zone_match": described["zone_match"]["method"],
                "completion_rate": described["completion_rate"],
                "history_source": described["history_source"],
            })
        results.sort(key=lambda r: r["score"], reverse=True)
        for rank, item in enumerate(results, start=1):
            item["rank"] = rank
        return {
            "recommendations": results[:limit], "candidates": len(candidates),
            "excluded": excluded, "weights": {k: round(v, 3) for k, v in weights.items()},
            "max_distance_km": max_km, "hour": hour, "hour_label": _hour_label(hour),
            "date": pd.Timestamp(day).strftime("%Y-%m-%d"),
            "formula": "score = 100 x (w_availability x availability + w_distance x distance "
                       "+ w_price x price + w_history x history)",
            "is_prediction": True, "synthetic_training_data": True,
        }
