"""End-to-end API checks for ParkEase, including the role permissions.

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

B = "http://localhost:5000/api"
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


def book(spot, token, s=start, e=end, user_id=None):
    return call("POST", "/bookings", {
        "spotId": spot, "userId": user_id, "vehicleNumber": "TN01AB1234", "vehicleType": "car",
        "startTime": s.isoformat(), "endTime": e.isoformat(), "durationHours": "1",
        "totalAmount": "50.00"}, token)


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
st, spots = call("GET", "/spots"); check("67 active spots", len(spots) == 67)
mine = [s for s in spots if s["ownerId"] == demo_owner["id"]]; other = next(s for s in spots if s["ownerId"] not in (demo_owner["id"], legacy["id"], None))
SPOT = mine[0]["id"]

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
st, r = call("GET", f"/analytics/owner/{demo_owner['id']}", token=DO); check("owner: own slot analytics (linked history)", st == 200 and r["total_bookings"] == 605 and len(r["spots"]) == 7)
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
st, r = call("GET", "/recommendations/parking?hour=18", token=DO); check("owner can also use driver features", st == 200)
st, ns = call("POST", "/spots", {"ownerId": admin["id"], "name": "Olu's Garage", "address": "1 Test Street, Area", "city": "Pune", "state": "Maharashtra", "pricePerHour": "40", "pricePerDay": "", "vehicleType": "car", "totalSlots": 3, "latitude": "", "longitude": ""}, O)
check("owner lists a spot (empty day price accepted) and owns it", st == 201 and ns["ownerId"] == owner["id"] and ns["pricePerDay"] is None)
st, r = call("PATCH", f"/spots/{ns['id']}", {"isActive": False}, O); check("owner deactivates own spot", st == 200 and r["isActive"] is False)
st, r = book(ns["id"], D); check("a deactivated spot cannot be booked", st == 400)
st, r = call("DELETE", f"/spots/{ns['id']}", token=O); check("owner deletes own spot", st == 204)

# ------------------------------------------------ driver who lists a spot
st, ds = call("POST", "/spots", {"name": "Dee's Driveway", "address": "2 Test Street, Area", "city": "Chennai", "state": "Tamil Nadu", "latitude": "13.05", "longitude": "80.23", "pricePerHour": "30", "vehicleType": "both", "totalSlots": 2}, D)
check("driver lists a spot", st == 201 and ds["ownerId"] == driver["id"])
st, r = call("GET", "/auth/me", token=D); check("...and becomes an owner", r["user"]["role"] == "owner")
st, r = call("GET", f"/analytics/owner/{driver['id']}", token=D); check("...and gets owner analytics for it", st == 200 and r["listings"] == 1)
st, r = call("GET", f"/predictions/demand?spotId={ds['id']}", token=D); check("...and a demand forecast for it", st == 200)

# -------------------------------------------------------------------- admin
st, r = call("GET", "/dashboard/stats", token=A); check("admin: platform dashboard", st == 200 and r["totalSpots"] >= 67)
for path in ("/dashboard/recent-bookings", "/dashboard/city-breakdown", "/dashboard/top-spots", "/analytics/parking-overview", "/models/performance"):
    st, _ = call("GET", path, token=A); check(f"admin is allowed: {path}", st == 200, str(st))
st, users = call("GET", "/admin/users", token=A); check("admin: lists all users with counts, no hashes", st == 200 and len(users) >= 20 and "passwordHash" not in json.dumps(users) and any(u["listings"] == 7 for u in users))
st, r = call("GET", "/admin/spots", token=A); check("admin: lists all listings", st == 200 and len(r) == 68 and any(s["ownerName"] == "Rajesh Kumar" for s in r))
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
st, r = call("DELETE", f"/spots/{ds['id']}", token=A); check("admin: deletes any listing", st == 204)

# ------------------------------------------------- booking rules still hold
st, s1 = call("GET", "/spots/1"); check("availability from live bookings", s1["availableSlots"] == 2)
st, b2 = book(1, DD); st, b3 = book(1, DD); st, b4 = book(1, DD)
check("capacity respected, overbooking refused", b2["status"] == "confirmed" and st == 400 and "already booked" in b4["error"])
st, s1 = call("GET", "/spots/1"); check("spot shows full", s1["availableSlots"] == 0)
if 6 <= hour <= 23:
    st, r = call("GET", f"/recommendations/parking?lat=13.0382255&lng=80.2285458&hour={hour}", token=DD)
    check("fully booked spot is not recommended", r["excluded"]["fully_booked"] >= 1 and all(x["spot_id"] != 1 for x in r["recommendations"]))
st, r = call("PATCH", f"/bookings/{b3['id']}", {"status": "cancelled"}, DD); check("driver cancels own booking", st == 200 and r["status"] == "cancelled")
st, s1 = call("GET", "/spots/1"); check("availability returns after cancellation", s1["availableSlots"] == 1)
st, r = call("GET", f"/analytics/owner/{legacy['id']}", token=L); check("owner analytics from live bookings: no revenue before completion", r["has_data"] and r["completed_revenue"] == 0)
st, r = call("PATCH", f"/bookings/{b2['id']}", {"status": "completed"}, L)
st, r = call("GET", f"/analytics/owner/{legacy['id']}", token=L); check("...and revenue counts the completed booking only", r["completed_revenue"] == 50 and r["cancellation_rate"] == 50.0)
st, r = call("GET", f"/analytics/driver/{demo_driver['id']}", token=DD); check("linked demo driver shows history", r["source"] == "history" and r["total_bookings"] == 60)
for path, code in (("/predictions/availability?spotId=1&hour=99", 400), ("/predictions/availability", 400), ("/predictions/demand?spotId=99999", 404), ("/predictions/availability?spotId=1&date=nonsense", 400)):
    st, _ = call("GET", path, token=A); check(f"bad request handled: {path}", st == code, str(st))
st, a = call("GET", "/predictions/availability?spotId=1&hour=3", token=D); check("no prediction outside 06-23", all("predicted_occupancy" not in h for h in a["hours"] if h["hour"] == 3))

# --------------------------------------------- Data Science service down
if "--keep-service" not in sys.argv:
    subprocess.run(["pkill", "-f", "[u]vicorn ml.service"]); time.sleep(1.5)
    st, e = call("GET", "/recommendations/parking?hour=18", token=D); check("ML service down: 503 with a hint, no numbers", st == 503 and "hint" in e and "recommendations" not in e)
    st, _ = call("GET", "/spots"); check("ML service down: spot search unaffected", st == 200)
    st, r = book(5, D); check("ML service down: booking unaffected", st == 201)
print(sum(results), "of", len(results), "passed")
