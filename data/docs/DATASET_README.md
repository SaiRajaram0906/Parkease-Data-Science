# ParkEase — Synthetic Dataset

> **This is synthetic data.** Every user, parking listing and booking was produced by a script. It does not describe real people, real parking lots or real transactions, and no result drawn from it is a real-world finding.

## Purpose

A relational dataset for the ParkEase Smart Parking Management System, built for a Principles of Data Science project: data cleaning, EDA, statistics, visualisation, feature engineering, machine learning, recommendation and model evaluation.

## Contents

```text
README.md
generate_parkease_data.py     generator (pandas + NumPy, seed 42)
validate_parkease_data.py     validation and profiling
validation_report.txt         output of the validation script
parkease_data/
├── users.csv
├── parking_slots.csv
├── parking_bookings.csv
└── data_dictionary.md
```

| Item | Value |
|---|---|
| Users | 1,800 |
| Drivers | 1,500 (1,472 have at least one booking) |
| Owners | 300 (all have at least one listing and one booking) |
| Parking slots (listings) | 500 (458 active, 42 deactivated) |
| Bookings | 42,378 |
| Booking date range | 2025-10-01 to 2026-09-30 (365 days, bookings on every day) |
| Driver registrations | 2025-03-01 to 2026-09-15 |
| Owner registrations | 2024-11-01 to 2025-09-20 |
| Holidays | 15 dates |

To regenerate: `python generate_parkease_data.py` then `python validate_parkease_data.py`. The same seed gives byte-identical CSVs.

## Relationships between the datasets

```text
users (role = owner)  1 ──< parking_slots  1 ──< parking_bookings >── 1  users (role = driver)
        user_id = owner_id          slot_id = slot_id          driver_id = user_id
```

- `parking_bookings.owner_id`, `parking_zone` and `slot_capacity` are copied from the booked slot, so they always agree with `parking_slots.csv`.
- A booking is never dated before its driver or its owner registered.
- A driver's vehicle type fits the slot's `vehicle_type_supported`.

## How the data was generated

Nothing is drawn independently column by column. Each booking is the result of a chain of decisions, each depending on the previous ones.

1. **Zones.** Eight zones with different popularity, price level, capacity mix and time-of-day behaviour (business district, IT corridor, shopping district, transit hub, campus, hospital, two residential areas), laid out inside one city area about 9 km across.
2. **Users.** Drivers join over time (55% before the booking window, the rest during it), which produces a growing platform. Each driver has hidden traits: how often they book, the zones they usually visit, how far they are willing to walk, and how prone they are to cancel.
3. **Slots.** Each owner gets at least one listing, mostly in one zone. Base price depends on zone, capacity, vehicle type, how attractive the spot is, and the owner's own pricing choice.
4. **Calendar.** Daily booking volume depends on day of week, month, a growth trend and holidays. Each zone also gets a daily demand shock, with about 2% of zone-days being large "event days".
5. **Booking events.** For each day: choose the slot (popular zone, attractive spot, more spaces, fair price), then the hour from that zone type's weekday or weekend profile, then a registered driver with a compatible vehicle who favours that zone.
6. **Demand.** A latent demand score combines hour profile, zone popularity, slot popularity, zone-day and slot-day conditions and noise. It is cut into Low / Medium / High. The slot-day component carries over from day to day, so past occupancy helps predict the present.
7. **Occupancy.** The share of spaces already taken is drawn from the demand score with extra noise. Several bookings in the same slot and hour fill it one space at a time; a booking that would exceed capacity is removed.
8. **Price.** Base price adjusted by demand. Owners differ in how strongly they reprice, so the link is noisy rather than a formula.
9. **Duration.** Depends on why people park there: long stays for weekday-morning office and campus parking, short ones near the hospital, medium for leisure.
10. **Distance.** Mostly under 1.5 km (83% of bookings). Longer in spread-out zones, when demand is high, and for under-priced slots.
11. **Status.** Cancellation probability rises with distance, surge pricing, a nearly full lot (a proxy for waiting), long bookings and the driver's own tendency. Uncancelled bookings from the last 3 days are `Active`.
12. **Cleaning.** Bookings that overlap for the same driver are removed (43,500 raw events → 42,378 kept).

## Data quality

**Intentional missing values** (never in IDs or foreign keys):

| File | Column | Missing | Share | How to handle |
|---|---|---|---|---|
| users.csv | preferred_vehicle_type | 36 | 2.0% | Mode, or infer from the slots the driver booked |
| parking_slots.csv | vehicle_type_supported | 10 | 2.0% | Mode, or infer from the vehicles of drivers who booked it |
| parking_bookings.csv | distance_km | 848 | 2.0% | Median by zone |
| parking_bookings.csv | occupancy_rate | 636 | 1.5% | Recompute from `occupied_slots / slot_capacity` |
| parking_bookings.csv | demand_level | 636 | 1.5% | Other bookings in the same slot, date and hour, else mode or a model |
| parking_bookings.csv | booking_duration_hours | 509 | 1.2% | `total_amount / price_per_hour` |
| parking_bookings.csv | price_per_hour | 424 | 1.0% | `total_amount / booking_duration_hours` |

**Intentional outliers** (all possible, none corrupt): 210 long stays of 8, 10 or 12 hours; 162 bookings from 5 to 8.5 km away; 945 surge prices above ₹100 per hour.

**Validation.** `validate_parkease_data.py` re-reads the CSVs and runs 34 checks, covering the 14 requested ones (duplicate and missing IDs, foreign keys, dates, day of week, occupancy arithmetic, totals, prices, durations, roles, demand levels, statuses, geography) plus registration order, vehicle compatibility and overlapping bookings. **All 34 pass with 0 violations.** Full output is in `validation_report.txt`.

## What the data shows

| Relationship | Result |
|---|---|
| Demand → occupancy | Low 33%, Medium 59%, High 73% average occupancy (Spearman +0.60) |
| Demand → price | Price is 0.95×, 1.04×, 1.16× the base price at Low, Medium, High (Spearman +0.64 with the ratio) |
| Demand → cancellation | 6.6%, 9.8%, 17.0% cancelled |
| Distance → cancellation | 7.5% under 0.5 km, rising to 27% at 3–5 km |
| Weekday peaks | About 10–12 bookings per hour at 08–09 and 17–19, against 5–6 at midday |
| Weekends | No morning peak; a broad plateau from 11:00 to 19:00 |
| Day of week | Friday busiest (128 per day), Sunday quietest (95 per day) |
| Trend | 2,938 bookings in Oct 2025 rising to 4,294 in Sep 2026 |
| Zones | Zone C has the most bookings (10,636), Zone H the fewest (1,635); average price ₹68 in Zone A against ₹13 in Zone H |
| Price vs bookings | Slots priced above similar slots in their zone get fewer bookings (Spearman −0.24) |
| Persistence | A slot's occupancy correlates +0.28 with its previous booked day |

Class balance: `demand_level` Low 31.6%, Medium 43.3%, High 23.6%, missing 1.5%. `booking_status` Completed 88.6%, Cancelled 10.5%, Active 0.9%.

## Intended use

| Model | Target | Main inputs |
|---|---|---|
| 1. Availability prediction (driver) | `available_slots` or `occupancy_rate` | hour, day_of_week, is_weekend, is_holiday, parking_zone, slot_capacity, lagged slot occupancy |
| 2. Parking recommendation (driver) | Ranking score | Predicted availability, distance_km, price_per_hour, historical occupancy; `is_active` and vehicle type as filters |
| 3. Demand prediction (owner) | `demand_level` | Time features, zone, slot history |
| 4. Price recommendation (owner) | Suggested price | demand, occupancy, price, booking frequency, zone, base price |

## Assumptions and limitations

- **Occupancy is a snapshot.** `occupied_slots` is what the driver saw when booking, before their own booking is added. It includes vehicles that did not come through ParkEase. Because a full lot cannot be booked, `available_slots` is at least 1 and occupancy tops out at 90%.
- **Small lots look emptier.** For the same reason a capacity-1 listing always shows 0% occupancy and a capacity-2 listing at most 50%. Average occupancy rises with capacity (38% at capacity 2, 64% at capacity 10). Use `slot_capacity` as a feature, and consider leaving capacity-1 listings out of Model 1.
- **The data records bookings, not empty hours.** There is no row for a slot-hour in which nobody booked, so booking counts measure demand, and occupancy is only observed at times when someone booked.
- **`Active` is a snapshot artefact.** It appears only on 2026-09-28 to 2026-09-30. Drop those 375 rows for cancellation modelling.
- **`total_amount` is the booked value** and is filled for cancelled bookings too. Filter to `Completed` for revenue.
- **Avoid target leakage.** `occupied_slots`, `available_slots` and `occupancy_rate` are the same quantity; do not use one to predict another. `price_per_hour` already reflects demand, so it is a weak feature choice for Model 3.
- **One deactivated listing (SLOT0064) has no bookings.** 28 drivers have none either.
- **The holiday calendar is illustrative**: fixed-date public holidays plus approximate festival dates, not an official list.
- **Coordinates** fall in a real latitude/longitude range so distance formulas work, but the points are random and mark no real location.
- **Zone character** (business district, campus and so on) is described in the data dictionary; the CSV only carries the label `Zone A`–`Zone H`.
- The ParkEase application itself was not modified.
