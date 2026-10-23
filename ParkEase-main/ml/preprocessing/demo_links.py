"""Choose which historical records the ParkEase demo accounts are linked to.

The live ParkEase database starts almost empty, so the demo driver and demo
owner are linked to one driver and a few owners of the historical dataset.
Their dashboards then show a real year of (synthetic) history. Accounts that
are not linked use their own live bookings, or an empty state.

The choice is deterministic: same data, same links. The result is written to
data/processed/demo_links.json and read by scripts/src/seed-demo.ts.
"""
from __future__ import annotations

import json
from typing import Dict

import pandas as pd

from ml import config
from ml.preprocessing.load_data import ParkEaseData

OWNERS_PER_ZONE = 2      # extra owners whose listings populate the demo map
DEMO_DRIVER_TARGET_BOOKINGS = 60


def build_demo_links(cleaned: ParkEaseData) -> Dict[str, object]:
    bookings, slots = cleaned.bookings, cleaned.slots
    active = slots[slots["is_active"] == 1]

    # Demo driver: a regular user of several zones (about 60 bookings).
    per_driver = bookings.groupby("driver_id").agg(
        n=("booking_id", "count"), zones=("parking_zone", "nunique"),
        cancelled=("is_cancelled", "mean"))
    typical = float(bookings["is_cancelled"].mean())
    # ... with an ordinary cancellation rate, so the demo is representative.
    regular = per_driver[(per_driver["zones"] >= 3)
                         & ((per_driver["cancelled"] - typical).abs() <= 0.05)].copy()
    regular["gap"] = (regular["n"] - DEMO_DRIVER_TARGET_BOOKINGS).abs()
    driver_id = regular.sort_values(["gap"]).index[0]

    # Demo owner: the owner with the most active listings (ties: most bookings).
    per_owner = active.groupby("owner_id").size().to_frame("listings")
    per_owner["bookings"] = bookings.groupby("owner_id").size()
    owner_id = per_owner.sort_values(["listings", "bookings"], ascending=False).index[0]

    # Other owners: the busiest ones in each zone, so every zone has listings.
    main_zone = active.groupby("owner_id")["parking_zone"].agg(lambda s: s.mode().iloc[0])
    per_owner["zone"] = main_zone
    others = []
    for zone in config.ZONES:
        ranked = per_owner[(per_owner["zone"] == zone) & (per_owner.index != owner_id)]
        others += list(ranked.sort_values("bookings", ascending=False).index[:OWNERS_PER_ZONE])

    counters: Dict[str, int] = {}
    listings = []
    chosen = active[active["owner_id"].isin([owner_id] + others)].sort_values("slot_id")
    for _, slot in chosen.iterrows():
        zone = slot["parking_zone"]
        counters[zone] = counters.get(zone, 0) + 1
        listings.append({
            "dataset_slot_id": slot["slot_id"],
            "dataset_owner_id": slot["owner_id"],
            "parking_zone": zone,
            "name": f"{config.ZONE_CHARACTER[zone]} Parking {counters[zone]:02d} ({zone})",
            "latitude": float(slot["latitude"]), "longitude": float(slot["longitude"]),
            "capacity": int(slot["capacity"]),
            "base_price_per_hour": int(slot["base_price_per_hour"]),
            "vehicle_type_supported": slot["vehicle_type_supported"],
        })
    return {
        "synthetic_data": True,
        "note": "Demo links between ParkEase accounts and the synthetic history.",
        "demo_driver": {"dataset_user_id": driver_id,
                        "bookings": int(per_driver.loc[driver_id, "n"])},
        "demo_owner": {"dataset_user_id": owner_id,
                       "listings": int(per_owner.loc[owner_id, "listings"]),
                       "bookings": int(per_owner.loc[owner_id, "bookings"])},
        "other_owners": [{"dataset_user_id": o} for o in others],
        "listings": listings,
    }


def save_demo_links(links: Dict[str, object]) -> None:
    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    (config.PROCESSED_DIR / config.DEMO_LINKS_FILE).write_text(
        json.dumps(links, indent=1), encoding="utf-8")


if __name__ == "__main__":
    from ml.preprocessing.clean_data import clean_dataset

    cleaned_data, _ = clean_dataset()
    result = build_demo_links(cleaned_data)
    save_demo_links(result)
    print(json.dumps({k: v for k, v in result.items() if k != "listings"}, indent=1))
    print("listings:", len(result["listings"]))
