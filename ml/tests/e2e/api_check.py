"""End-to-end API checks for ParkEase: role permissions, rewards, entry
passes, the parking assistant and the start/end messages.

Needs the database, the API server (port 5000) and the Data Science service
(port 8000) running on a freshly prepared demo database. See README.md here.
"""
import datetime as dt
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

import os
import shutil

B = "http://localhost:5000/api"
# Used only to move a test booking's end time into the past (end message).
DB = os.environ.get("PARKEASE_TEST_DB", "postgresql://parkease:parkease@localhost:5433/parkease")
results = []


def call(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        B + path, method=method, headers=headers,
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(request) as response:
            text = response.read().decode()
            return response.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        try:
            return error.code, json.loads(text)
        except Exception:
            return error.code, text


def check(name, condition, detail=""):
    results.append(bool(condition))
    print("PASS" if condition else "FAIL", name, detail)


IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
now = dt.datetime.now(IST)
hour = now.hour
start = now.replace(minute=0, second=0, microsecond=0)
end = start + dt.timedelta(hours=1)
stamp = int(time.time())


def book(spot, token, s=start, e=end, user_id=None, **extra):
    return call("POST", "/bookings", {
        "spotId": spot, "userId": user_id, "vehicleNumber": "TN01AB1234", "vehicleType": "car",
        "startTime": s.isoformat(), "endTime": e.isoformat(), "durationHours": "1",
        "totalAmount": "50.00", **extra}, token)


# ------------------------------------------------------------ authentication
st, _ = call("GET", "/healthz"); check("health endpoint is public", st == 200)
st, _ = call("GET", "/spots"); check("spot list is public", st == 200)
st, r = call("POST", "/auth/register", {"name": "Dee Driver", "email": f"driver{stamp}@example.com", "password": "weak", "role": "driver"})
check("weak password is refused", st == 400, r.get("error", ""))
st, r = call("POST", "/auth/register", {"name": "Dee Driver", "email": f"driver{stamp}@example.com", "password": "Passw0rd!", "role": "driver"})
check("register a driver", st == 201 and r["user"]["role"] == "driver" and r["token"]); driver, D = r["user"], r["token"]
check("password hash is never returned", "passwordHash" not in r["user"] and "password_hash" not in json.dumps(r))
st, r = call("POST", "/auth/register", {"name": "Dee Driver", "email": f"driver{stamp}@example.com", "password": "Passw0rd!", "role": "driver"})
check("duplicate email is refused", st == 409)
st, r = call("POST", "/auth/register", {"name": "Olu Owner", "email": f"owner{stamp}@example.com", "password": "Passw0rd!", "role": "owner"})
check("register an owner", st == 201 and r["user"]["role"] == "owner"); owner, O = r["user"], r["token"]
st, r = call("POST", "/auth/register", {"name": "Eve", "email": f"eve{stamp}@example.com", "password": "Passw0rd!", "role": "admin"})
check("nobody can register as admin", st == 201 and r["user"]["role"] == "driver"); E = r["token"]
st, r = call("POST", "/auth/login", {"email": f"driver{stamp}@example.com", "password": "Wrong123!"}); check("wrong password is refused", st == 401)
st, r = call("POST", "/auth/login", {"email": f"driver{stamp}@example.com", "password": "Passw0rd!"}); check("correct password signs in", st == 200 and r["user"]["id"] == driver["id"])
st, r = call("POST", "/auth/login", {"email": "nobody@example.com", "password": "Passw0rd!"}); check("unknown email is refused", st == 401)
st, r = call("POST", "/auth/login", {"email": "muthu@example.com", "password": "Passw0rd!"})
check("account from before passwords: first sign-in sets one", st == 200 and r.get("passwordSet") is True); legacy, L = r["user"], r["token"]
st, r = call("POST", "/auth/login", {"email": "muthu@example.com", "password": "Other123!"}); check("...and after that only that password works", st == 401)
st, r = call("POST", "/auth/demo", {"role": "admin"}); check("demo admin", st == 200 and r["user"]["role"] == "admin"); admin, A = r["user"], r["token"]
st, r = call("POST", "/auth/demo", {"role": "owner"}); check("demo owner", st == 200 and r["user"]["role"] == "owner"); demo_owner, DO = r["user"], r["token"]
st, r = call("POST", "/auth/demo", {"role": "driver"}); check("demo driver", st == 200 and r["user"]["role"] == "driver"); demo_driver, DD = r["user"], r["token"]
st, r = call("POST", "/auth/login", {"email": "rajesh.kumar@gmail.com", "password": "Passw0rd!"}); check("a demo account cannot be taken over by setting a password", st == 400)
st, r = call("GET", "/auth/me", token=D); check("token identifies the user", st == 200 and r["user"]["id"] == driver["id"])
st, r = call("GET", "/auth/me", token=D[:-4] + "0000"); check("a tampered token is rejected", st == 401)
st, r = call("GET", "/auth/me"); check("no token: 401", st == 401)

# ------------------------------------------------------------------ demo data
st, r = call("POST", "/datascience/seed-demo", token=D); check("driver cannot load demo data", st == 403)
st, r = call("POST", "/datascience/seed-demo"); check("anonymous cannot load demo data", st == 401)
st, r = call("POST", "/datascience/seed-demo", token=DO); check("owner loads demo data", st == 200 and r["spotsCreated"] == 66, str(r.get("spotsCreated")))
st, spots = call("GET", "/spots"); check("72 active spots: 1 existing + 66 demo + 5 large places", len(spots) == 72, str(len(spots)))
mine = [s for s in spots if s["ownerId"] == demo_owner["id"] and s["datasetSlotId"]]; other = next(s for s in spots if s["ownerId"] not in (demo_owner["id"], legacy["id"], None))
big = [s for s in spots if s.get("isLargeFacility")]
check("large places exist, owned by the demo owner, with Saravana Stores and Jeyachandran in T. Nagar",
      len(big) == 5 and all(s["ownerId"] == demo_owner["id"] for s in big)
      and any("Saravana Stores" in s["name"] for s in big) and any("Jeyachandran" in s["name"] for s in big))
SPOT = mine[0]["id"]; BIG = next(s for s in big if "Saravana" in s["name"])

# ---------------------------------------------------------------- anonymous
for method, path, body in (("GET", "/bookings", None), ("POST", "/bookings", {}), ("GET", "/users", None),
                           ("GET", f"/users/{driver['id']}", None), ("POST", "/spots", {}), ("PATCH", f"/spots/{SPOT}", {}),
                           ("DELETE", f"/spots/{SPOT}", None), ("POST", "/reviews", {}), ("GET", "/dashboard/stats", None),
                           ("GET", f"/analytics/driver/{driver['id']}", None), ("GET", "/recommendations/parking", None),
                           ("GET", "/analytics/parking-overview", None), ("GET", "/admin/users", None)):
    st, _ = call(method, path, body); check(f"anonymous is refused: {method} {path}", st == 401, str(st))

# ------------------------------------------------------------------- driver
st, r = call("GET", f"/recommendations/parking?lat=13.06&lng=80.24&hour=18", token=D); check("driver: parking recommendation", st == 200 and len(r["recommendations"]) > 0)
st, r = call("GET", f"/predictions/availability?spotId={SPOT}&hour=18", token=D); check("driver: availability prediction", st == 200 and "live" in r)
st, b1 = book(SPOT, D, user_id=admin["id"]); check("driver: booking is recorded under the signed-in user, not the id sent", st == 201 and b1["userId"] == driver["id"] and b1["userEmail"] == driver["email"])
st, r = call("GET", "/bookings", token=D); check("driver: sees own bookings", st == 200 and [x["id"] for x in r] == [b1["id"]])
st, r = call("GET", f"/bookings?userId={admin['id']}", token=D); check("driver: cannot list another user's bookings", st == 200 and r == [])
st, r = call("GET", f"/bookings/{b1['id']}", token=E); check("another driver cannot open the booking", st == 403)
st, r = call("PATCH", f"/bookings/{b1['id']}", {"status": "cancelled"}, E); check("another driver cannot cancel it", st == 403)
st, r = call("PATCH", f"/bookings/{b1['id']}", {"status": "completed"}, D); check("driver cannot mark own booking completed", st == 403)
st, r = call("PATCH", f"/bookings/{b1['id']}", {"paymentStatus": "paid"}, D); check("driver cannot mark own booking paid", st == 403)
st, r = call("GET", f"/analytics/driver/{driver['id']}", token=D); check("driver: own analytics", st == 200 and r["total_bookings"] == 1 and r["source"] == "live")
st, r = call("GET", f"/analytics/driver/{demo_driver['id']}", token=D); check("driver: cannot read another driver's analytics", st == 403)
st, r = call("GET", f"/analytics/owner/{demo_owner['id']}", token=D); check("driver: cannot read an owner's analytics", st == 403)
st, r = call("GET", f"/predictions/demand?spotId={SPOT}", token=D); check("driver: no demand forecast for someone else's spot", st == 403)
st, r = call("GET", f"/recommendations/price?spotId={SPOT}", token=D); check("driver: no price recommendation for someone else's spot", st == 403)
st, r = call("PATCH", f"/spots/{SPOT}", {"pricePerHour": "1.00"}, D); check("driver: cannot change a spot's price", st == 403)
st, r = call("PATCH", f"/spots/{SPOT}", {"isActive": False}, D); check("driver: cannot deactivate a spot", st == 403)
st, r = call("DELETE", f"/spots/{SPOT}", token=D); check("driver: cannot delete a spot", st == 403)
for path in ("/analytics/parking-overview", "/models/performance", "/analytics/data-quality", "/dashboard/stats", "/users", "/admin/users", "/admin/spots"):
    st, _ = call("GET", path, token=D); check(f"driver is refused: {path}", st == 403, str(st))
st, r = call("GET", f"/users/{driver['id']}", token=D); check("driver: own profile", st == 200 and r["email"] == driver["email"])
st, r = call("GET", f"/users/{admin['id']}", token=D); check("driver: cannot read another profile", st == 403)
st, r = call("PATCH", f"/users/{admin['id']}", {"name": "Hacked"}, D); check("driver: cannot edit another profile", st == 403)
st, r = call("PATCH", f"/users/{driver['id']}", {"name": "Dee D", "phone": "9999999999"}, D); check("driver: edits own profile", st == 200 and r["name"] == "Dee D")
st, r = call("PATCH", f"/admin/users/{driver['id']}/role", {"role": "admin"}, D); check("driver: cannot promote themselves", st == 403)
st, r = call("POST", "/reviews", {"spotId": SPOT, "userId": admin["id"], "userName": "Fake", "rating": 5, "comment": "Good"}, D)
check("review is recorded under the signed-in user", st == 201 and r["userId"] == driver["id"] and r["userName"] == "Dee D")

# -------------------------------------------------------------------- owner
st, r = call("GET", f"/analytics/owner/{demo_owner['id']}", token=DO); check("owner: own slot analytics (linked history)", st == 200 and r["total_bookings"] == 605 and r["listings"] == 7 and len(r["spots"]) == 12)
st, r = call("GET", f"/analytics/owner/{owner['id']}", token=DO); check("owner: cannot read another owner's analytics", st == 403)
st, r = call("GET", f"/predictions/demand?spotId={SPOT}", token=DO); check("owner: demand forecast for own spot", st == 200 and len(r["hours"]) == 18)
st, p = call("GET", f"/recommendations/price?spotId={SPOT}&hour=18", token=DO); check("owner: price recommendation for own spot", st == 200 and p["recommended_price"] % 5 == 0)
st, r = call("GET", f"/predictions/demand?spotId={other['id']}", token=DO); check("owner: no demand forecast for another owner's spot", st == 403)
st, r = call("GET", f"/recommendations/price?spotId={other['id']}", token=DO); check("owner: no price recommendation for another owner's spot", st == 403)
st, r = call("PATCH", f"/spots/{SPOT}", {"pricePerHour": "55.00"}, DO); check("owner: changes own spot's price", st == 200 and r["pricePerHour"] == "55.00")
st, r = call("PATCH", f"/spots/{other['id']}", {"pricePerHour": "1.00"}, DO); check("owner: cannot change another owner's spot", st == 403)
st, r = call("DELETE", f"/spots/{other['id']}", token=DO); check("owner: cannot delete another owner's spot", st == 403)
st, r = call("GET", f"/bookings?spotId={SPOT}", token=DO); check("owner: sees bookings on own spot", st == 200 and [x["id"] for x in r] == [b1["id"]])
st, r = call("GET", f"/bookings?spotId={other['id']}", token=DO); check("owner: cannot list bookings on another owner's spot", st == 200 and r == [])
st, r = call("GET", f"/bookings/{b1['id']}", token=DO); check("owner: opens a booking on own spot", st == 200)
st, r = call("PATCH", f"/bookings/{b1['id']}", {"status": "completed"}, DO); check("owner: completes a booking on own spot", st == 200 and r["status"] == "completed")
for path in ("/analytics/parking-overview", "/models/performance", "/analytics/data-quality"):
    st, _ = call("GET", path, token=DO); check(f"owner is allowed: {path}", st == 200, str(st))
for path in ("/dashboard/stats", "/dashboard/recent-bookings", "/users", "/admin/users", "/admin/spots"):
    st, _ = call("GET", path, token=DO); check(f"owner is refused: {path}", st == 403, str(st))
# An owner account lists parking; it does not find or book it.
st, r = call("GET", "/recommendations/parking?hour=18", token=DO); check("owner: no parking recommendation (driver feature)", st == 403)
st, r = book(SPOT, DO); check("owner: cannot book a spot", st == 403)
st, r = call("POST", "/reviews", {"spotId": SPOT, "rating": 5, "comment": "Mine"}, DO); check("owner: cannot write a review", st == 403)
st, r = call("GET", f"/predictions/availability?spotId={SPOT}&hour=18", token=DO); check("owner: still sees the availability forecast of a spot", st == 200)
st, ns = call("POST", "/spots", {"ownerId": admin["id"], "name": "Olu's Garage", "address": "1 Test Street, Area", "city": "Pune", "state": "Maharashtra", "pricePerHour": "40", "pricePerDay": "", "vehicleType": "car", "totalSlots": 3, "latitude": "", "longitude": ""}, O)
check("owner lists a spot (empty day price accepted) and owns it", st == 201 and ns["ownerId"] == owner["id"] and ns["pricePerDay"] is None)
st, r = call("PATCH", f"/spots/{ns['id']}", {"isActive": False}, O); check("owner deactivates own spot", st == 200 and r["isActive"] is False)
st, r = book(ns["id"], D); check("a deactivated spot cannot be booked", st == 400)
st, r = call("DELETE", f"/spots/{ns['id']}", token=O); check("owner deletes own spot", st == 204)

# ------------------------------------------- a driver account cannot list
st, ds = call("POST", "/spots", {"name": "Dee's Driveway", "address": "2 Test Street, Area", "city": "Chennai", "state": "Tamil Nadu", "latitude": "13.05", "longitude": "80.23", "pricePerHour": "30", "vehicleType": "both", "totalSlots": 2}, D)
check("driver: cannot list a spot", st == 403)
st, r = call("GET", "/auth/me", token=D); check("...and stays a driver", r["user"]["role"] == "driver")
st, lf = call("POST", "/spots", {"name": "Olu's Car Park", "address": "3 Test Street, Area", "city": "Chennai", "state": "Tamil Nadu", "latitude": "13.0500000", "longitude": "80.2300000", "pricePerHour": "30", "vehicleType": "both", "totalSlots": 2, "isLargeFacility": True}, O)
check("owner lists a large facility", st == 201 and lf["isLargeFacility"] is True and lf["ownerId"] == owner["id"])

# -------------------------------------------------------------------- admin
st, r = call("GET", "/dashboard/stats", token=A); check("admin: platform dashboard", st == 200 and r["totalSpots"] >= 67)
for path in ("/dashboard/recent-bookings", "/dashboard/city-breakdown", "/dashboard/top-spots", "/analytics/parking-overview", "/models/performance"):
    st, _ = call("GET", path, token=A); check(f"admin is allowed: {path}", st == 200, str(st))
st, users = call("GET", "/admin/users", token=A); check("admin: lists all users with counts, no hashes", st == 200 and len(users) >= 20 and "passwordHash" not in json.dumps(users) and any(u["listings"] == 12 for u in users))
st, r = call("GET", "/admin/spots", token=A); check("admin: lists all listings", st == 200 and len(r) == 73 and any(s["ownerName"] == "Rajesh Kumar" for s in r))
st, r = call("PATCH", f"/admin/users/{owner['id']}/role", {"role": "driver"}, A); check("admin: changes a user's role", st == 200 and r["role"] == "driver")
st, r = call("GET", "/analytics/parking-overview", token=O); check("...and the change takes effect at once", st == 403)
st, r = call("PATCH", f"/admin/users/{owner['id']}/role", {"role": "superuser"}, A); check("admin: invalid role refused", st == 400)
st, r = call("PATCH", f"/admin/users/{admin['id']}/role", {"role": "driver"}, A); check("admin: cannot remove own admin role", st == 400)
st, r = call("GET", f"/analytics/driver/{driver['id']}", token=A); check("admin: any driver's analytics", st == 200)
st, r = call("GET", f"/analytics/owner/{demo_owner['id']}", token=A); check("admin: any owner's analytics", st == 200)
st, r = call("GET", f"/recommendations/price?spotId={other['id']}", token=A); check("admin: price recommendation for any spot", st == 200)
st, r = call("PATCH", f"/spots/{other['id']}", {"isActive": False}, A); check("admin: deactivates any listing", st == 200 and r["isActive"] is False)
st, r = call("GET", "/spots", token=D); check("deactivated listing disappears from search", all(s["id"] != other["id"] for s in r))
st, r = call("PATCH", f"/spots/{other['id']}", {"isActive": True}, A); check("admin: reactivates it", st == 200)
st, r = call("GET", "/bookings", token=A); check("admin: sees all bookings", st == 200 and len(r) >= 1)
st, r = call("GET", f"/users/{driver['id']}", token=A); check("admin: reads any profile", st == 200)

# ------------------------------------------- large facility: slot + QR pass
st, v1 = book(BIG["id"], D, totalAmount="1.00"); st2, v2 = book(BIG["id"], E)
check("large facility: each booking keeps its own numbered slot", st == 201 and st2 == 201 and v1["slotLabel"] == "P-001" and v2["slotLabel"] == "P-002")
check("every booking gets a pass code", v1["verifyCode"].startswith("PE-") and len(v1["verifyCode"]) == 11 and v1["verifyCode"] != v2["verifyCode"])
check("the price is worked out by the server, not taken from the browser", v1["totalAmount"] == f"{float(BIG['pricePerHour']):.2f}", v1["totalAmount"])
check("an ordinary spot keeps no numbered slot", b1["slotLabel"] is None and b1["verifyCode"].startswith("PE-"))
st, r = book(BIG["id"], D, s=end, e=start); check("end time before start time is refused", st == 400)
CODE = v1["verifyCode"]
st, r = call("GET", f"/bookings/verify/{CODE}"); check("pass check: anonymous refused", st == 401)
st, r = call("GET", f"/bookings/verify/{CODE}", token=D); check("pass check: a driver cannot verify passes", st == 403)
st, r = call("GET", f"/bookings/verify/{CODE}", token=L); check("pass check: another owner sees nothing", st == 404)
st, r = call("GET", f"/bookings/verify/PE-NOTAREAL", token=DO); check("pass check: unknown code", st == 404)
st, r = call("GET", f"/bookings/verify/{CODE.lower()}", token=DO)
check("pass check: the owner sees a valid pass with vehicle and slot", st == 200 and r["valid"] and r["state"] == "valid" and r["booking"]["slotLabel"] == "P-001" and r["booking"]["vehicleNumber"] == "TN01AB1234" and r["booking"]["driverName"] == "Dee D")
st, r = call("POST", f"/bookings/verify/{CODE}/check-in", token=DO); check("owner lets the vehicle in", st == 200 and r["state"] == "checked_in" and r["booking"]["checkedInAt"])
st, r = call("POST", f"/bookings/verify/{CODE}/check-in", token=DO); check("the same pass cannot be used twice", st == 409 and r["state"] == "checked_in")
st, r = call("GET", f"/bookings/verify/{CODE}", token=A); check("admin can check any pass", st == 200 and r["state"] == "checked_in")
st, r = call("PATCH", f"/bookings/{v2['id']}", {"status": "cancelled"}, E)
st, r = call("GET", f"/bookings/verify/{v2['verifyCode']}", token=DO); check("a cancelled booking's pass is refused", st == 200 and not r["valid"] and r["state"] == "cancelled")
st, r = call("POST", f"/bookings/verify/{v2['verifyCode']}/check-in", token=DO); check("...and cannot be used to enter", st == 409)
day2 = start + dt.timedelta(days=2)
st, v3 = book(BIG["id"], E, s=day2, e=day2 + dt.timedelta(hours=1)); check("a cancelled slot number is free again for another time", st == 201 and v3["slotLabel"] == "P-001")
st, r = call("GET", f"/bookings/verify/{v3['verifyCode']}", token=DO); check("a pass for a later day is too early", st == 200 and r["state"] == "early" and not r["valid"])

# ----------------------------------------------------------------- rewards
st, r = call("POST", "/auth/register", {"name": "Rita Rewards", "email": f"rita{stamp}@example.com", "password": "Passw0rd!", "role": "driver"}); rita, R = r["user"], r["token"]
st, r = call("GET", "/rewards"); check("rewards: anonymous refused", st == 401)
st, r = call("GET", "/rewards", token=R); check("rewards: a new driver starts at 0 of 10", st == 200 and r == {"bookingsPerReward": 10, "qualifyingBookings": 0, "earned": 0, "redeemed": 0, "available": 0, "progress": 0, "remaining": 10}, json.dumps(r))
st, r = book(BIG["id"], R, useReward=True); check("rewards: cannot use a free booking before earning one", st == 400)
paid = []
for i in range(9):
    s_i = start + dt.timedelta(days=3 + i)
    st, r = book(BIG["id"], R, s=s_i, e=s_i + dt.timedelta(hours=1)); paid.append(r)
st, r = call("GET", "/rewards", token=R); check("rewards: 9 bookings, no reward yet", r["progress"] == 9 and r["available"] == 0 and r["remaining"] == 1)
s_i = start + dt.timedelta(days=12); st, tenth = book(BIG["id"], R, s=s_i, e=s_i + dt.timedelta(hours=1)); paid.append(tenth)
st, r = call("GET", "/rewards", token=R); check("rewards: the 10th booking earns a free one", r["earned"] == 1 and r["available"] == 1 and r["progress"] == 0)
s_i = start + dt.timedelta(days=13); st, free = book(BIG["id"], R, s=s_i, e=s_i + dt.timedelta(hours=2), useReward=True)
check("rewards: the free booking costs 0 and is marked paid by reward", st == 201 and free["totalAmount"] == "0.00" and free["isReward"] is True and free["paymentStatus"] == "paid" and free["paymentId"] == "REWARD")
st, r = call("GET", "/rewards", token=R); check("rewards: the reward is used up, and the free booking does not count towards the next", r["available"] == 0 and r["redeemed"] == 1 and r["qualifyingBookings"] == 10)
s_i = start + dt.timedelta(days=14); st, r = book(BIG["id"], R, s=s_i, e=s_i + dt.timedelta(hours=1), useReward=True); check("rewards: one reward cannot be used twice", st == 400)
st, r = call("PATCH", f"/bookings/{free['id']}", {"status": "cancelled"}, R)
st, r = call("GET", "/rewards", token=R); check("rewards: cancelling the free booking gives the reward back", r["available"] == 1 and r["redeemed"] == 0)
st, r = call("PATCH", f"/bookings/{tenth['id']}", {"status": "cancelled"}, R)
st, r = call("GET", "/rewards", token=R); check("rewards: cancelling a paid booking takes it out of the count", r["qualifyingBookings"] == 9 and r["available"] == 0)
st, r = call("GET", "/rewards", token=D); check("rewards: each driver has their own count", r["qualifyingBookings"] == 2, json.dumps(r))

# ----------------------------------------------------- parking assistant
st, r = call("GET", "/assistant/search?q=spot+near+Rajalakshmi+engineering+college")
check("assistant: 'spot near Rajalakshmi engineering college' finds the college, nearest spot first",
      st == 200 and "Rajalakshmi" in r["place"]["name"] and "Rajalakshmi" in r["spots"][0]["name"] and r["spots"][0]["distanceKm"] < 1 and r["nearbyCount"] == 1)
check("assistant: spots are sorted by distance from the place", [s["distanceKm"] for s in r["spots"]] == sorted(s["distanceKm"] for s in r["spots"]))
st, r = call("GET", "/assistant/search?q=jayachandran+parking"); check("assistant: the common spelling 'Jayachandran' is understood", st == 200 and "Jeyachandran" in r["spots"][0]["name"])
st, r = call("GET", "/assistant/search?q=saravana+store"); check("assistant: Saravana Stores", st == 200 and "Saravana" in r["spots"][0]["name"] and r["nearbyCount"] >= 4)
st, r = call("GET", "/assistant/search?q=kamakoti"); check("assistant: a listing's own name works as the place", st == 200 and r["place"]["source"] == "listing" and r["spots"][0]["id"] == 1)
st, r = call("GET", "/assistant/search?q=x&lat=13.0827&lng=80.2757&label=Chennai+Central"); check("assistant: coordinates found by the browser are used as given", st == 200 and r["place"] == {"name": "Chennai Central", "lat": 13.0827, "lng": 80.2757, "source": "browser"})
st, r = call("GET", "/assistant/search?q=tambaram"); check("assistant: says when nothing is close instead of pretending", st == 200 and r["nearbyCount"] == 0 and r["spots"][0]["distanceKm"] > 3)
st, r = call("GET", "/assistant/search?q=t+nagar&vehicleType=bike"); check("assistant: bike search leaves out car-only spots", st == 200 and all(s["vehicleType"] in ("bike", "both") for s in r["spots"]))
st, r = call("GET", "/assistant/search?q=qwertyuiop"); check("assistant: unknown place is reported", st == 404)

# ---------------------------------------------------- messages and email
st, r = call("GET", "/notifications"); check("messages: anonymous refused", st == 401)
st, r = call("GET", "/notifications/email-status", token=D); email_on = bool(r.get("configured")); check("messages: email status readable", st == 200)
st, r = call("POST", "/notifications/test", token=D)
check("test email goes to the signed-in user's own address", st == 200 and r["toEmail"] == driver["email"] and r["emailStatus"] == ("sent" if email_on else "not_configured"), r.get("emailStatus"))
st, r = call("POST", "/notifications/test", token=DD); check("demo accounts are never emailed", st == 200 and r["emailStatus"] == "skipped_demo")
print("... waiting up to 75 s for the 'parking started' message (the server checks once a minute)")
started = []
for _ in range(25):
    st, r = call("GET", f"/notifications?bookingId={v1['id']}", token=D); started = [n for n in r if n["kind"] == "booking_started"]
    if started: break
    time.sleep(3)
check("'parking started' message is created once, for the driver's registered email",
      len(started) == 1 and started[0]["toEmail"] == driver["email"] and "ready" in started[0]["subject"].lower() and started[0]["emailStatus"] == ("sent" if email_on else "not_configured"))
st, r = call("GET", f"/notifications?bookingId={v1['id']}", token=E); check("messages: another driver cannot read them", st == 200 and r == [])
st, r = call("GET", f"/notifications?bookingId={v3['id']}", token=E); check("no message for a booking that has not started", r == [])
st, r = call("GET", f"/notifications?bookingId={v2['id']}", token=E); check("no message for a cancelled booking", r == [])
if shutil.which("psql"):
    subprocess.run(["psql", DB, "-q", "-c", f"UPDATE bookings SET end_time = now() - interval '1 minute' WHERE id = {v1['id']}"], check=True)
    print("... waiting up to 75 s for the 'parking ended' message")
    kinds = []
    for _ in range(25):
        st, r = call("GET", f"/notifications?bookingId={v1['id']}", token=D); kinds = sorted(n["kind"] for n in r)
        if "booking_ended" in kinds: break
        time.sleep(3)
    check("'parking ended' message is created once the time is over", kinds == ["booking_ended", "booking_started"], str(kinds))
    st, r = call("GET", f"/bookings/{v1['id']}", token=D); check("...and the booking is completed", r["status"] == "completed")
    time.sleep(65)
    st, r = call("GET", f"/notifications?bookingId={v1['id']}", token=D); check("messages are not repeated on the next run", len(r) == 2, str(len(r)))

# ------------------------------------------------- booking rules still hold
st, s1 = call("GET", "/spots/1"); check("availability from live bookings", s1["availableSlots"] == 2)
st, b2 = book(1, DD); st, b3 = book(1, DD); st, b4 = book(1, DD)
check("capacity respected, overbooking refused", b2["status"] == "confirmed" and st == 400 and "already booked" in b4["error"])
st, s1 = call("GET", "/spots/1"); check("spot shows full", s1["availableSlots"] == 0)
if 6 <= hour <= 23:
    st, r = call("GET", f"/recommendations/parking?lat=13.0382255&lng=80.2285458&hour={hour}", token=DD)
    check("fully booked spot is not recommended", r["excluded"]["fully_booked"] >= 1 and all(x["spot_id"] != 1 for x in r["recommendations"]))
check("demo payment mode: bookings are marked paid, without real money", b2["paymentStatus"] == "paid" and b2["paymentMode"] == "simulated" and b2["paymentId"].startswith("SIM-"))
st, r = call("PATCH", f"/bookings/{b3['id']}", {"status": "cancelled"}, DD); check("driver cancels own booking", st == 200 and r["status"] == "cancelled")
check("...after its start time: no refund, and the reason is recorded", r["paymentStatus"] == "paid" and "No refund" in (r["refundError"] or ""))
st, r = call("GET", "/payments/config"); check("payment config says demo mode when no Razorpay keys are set", st == 200 and r["mode"] == "simulated" and r["keyId"] is None)
st, s1 = call("GET", "/spots/1"); check("availability returns after cancellation", s1["availableSlots"] == 1)
st, r = call("GET", f"/analytics/owner/{legacy['id']}", token=L); check("owner analytics from live bookings: no revenue before completion", r["has_data"] and r["completed_revenue"] == 0)
st, r = call("PATCH", f"/bookings/{b2['id']}", {"status": "completed"}, L)
st, r = call("GET", f"/analytics/owner/{legacy['id']}", token=L); check("...and revenue counts the completed booking only", r["completed_revenue"] == 50 and r["cancellation_rate"] == 50.0)
st, r = call("GET", f"/analytics/driver/{demo_driver['id']}", token=DD); check("linked demo driver shows history", r["source"] == "history" and r["total_bookings"] == 60)
fut = start + dt.timedelta(days=30); st, fb = book(1, DD, s=fut, e=fut + dt.timedelta(hours=1))
st, r = call("PATCH", f"/bookings/{fb['id']}", {"status": "cancelled"}, DD); check("cancelling before the start refunds (demo refund)", r["paymentStatus"] == "refunded" and r["refundId"] == "SIMULATED")
for path, code in (("/predictions/availability?spotId=1&hour=99", 400), ("/predictions/availability", 400), ("/predictions/demand?spotId=99999", 404), ("/predictions/availability?spotId=1&date=nonsense", 400)):
    st, _ = call("GET", path, token=A); check(f"bad request handled: {path}", st == code, str(st))
st, a = call("GET", "/predictions/availability?spotId=1&hour=3", token=D); check("no prediction outside 06-23", all("predicted_occupancy" not in h for h in a["hours"] if h["hour"] == 3))

# --------------------------------------------- Data Science service down
if "--keep-service" not in sys.argv:
    subprocess.run(["pkill", "-f", "[u]vicorn ml.service"]); time.sleep(1.5)
    st, e = call("GET", "/recommendations/parking?hour=18", token=D); check("ML service down: 503 with a hint, no numbers", st == 503 and "hint" in e and "recommendations" not in e)
    st, _ = call("GET", "/spots"); check("ML service down: spot search unaffected", st == 200)
    s_i = start + dt.timedelta(days=20); st, r = book(5, D, s=s_i, e=s_i + dt.timedelta(hours=1)); check("ML service down: booking unaffected", st == 201)
print(sum(results), "of", len(results), "passed")
