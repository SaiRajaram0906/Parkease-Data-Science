"""Payment checks: Razorpay orders, signature check, refunds and owner payouts.

Run against an API server started with Razorpay keys that point at a local
stand-in for the Razorpay API (RAZORPAY_API_BASE), on a fresh demo database:
  RAZORPAY_KEY_ID=rzp_test_PARKEASE RAZORPAY_KEY_SECRET=secretPARKEASE123
  RAZORPAY_API_BASE=http://127.0.0.1:9099/v1
Real Razorpay is never contacted.
"""
import datetime as dt
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request

B = "http://localhost:5000/api"
MOCK = "http://127.0.0.1:9099"
SECRET = os.environ.get("RZP_SECRET", "secretPARKEASE123")
DB = os.environ.get("PARKEASE_TEST_DB", "postgresql://parkease:parkease@localhost:5433/parkease")
results = []


def call(method, path, body=None, token=None, base=B):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base + path, method=method, headers=headers, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req) as r:
            text = r.read().decode()
            return r.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except Exception:
            return e.code, text


def check(name, ok, detail=""):
    results.append(bool(ok))
    print("PASS" if ok else "FAIL", name, detail)


def sign(order_id, payment_id):
    return hmac.new(SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
now = dt.datetime.now(IST).replace(minute=0, second=0, microsecond=0)
stamp = int(time.time())


def times(day_offset, hours=2, start_hour_offset=0):
    s = now + dt.timedelta(days=day_offset, hours=start_hour_offset)
    return s.isoformat(), (s + dt.timedelta(hours=hours)).isoformat()


def req(spot, day, hours=2, **extra):
    s, e = times(day, hours)
    return {"spotId": spot, "vehicleNumber": "TN09PAY001", "vehicleType": "car", "startTime": s, "endTime": e,
            "durationHours": str(hours), "totalAmount": "1.00", **extra}


st, cfg = call("GET", "/payments/config")
check("payment mode is Razorpay when keys are set; the secret is never sent", st == 200 and cfg["mode"] == "razorpay"
      and cfg["keyId"] == "rzp_test_PARKEASE" and "secret" not in json.dumps(cfg).lower() and cfg["commissionPercent"] == 10)

st, r = call("POST", "/auth/register", {"name": "Pay Driver", "email": f"pay{stamp}@example.com", "password": "Passw0rd!", "role": "driver"}); D = r["token"]; driver = r["user"]
st, r = call("POST", "/auth/register", {"name": "Other Driver", "email": f"pay2{stamp}@example.com", "password": "Passw0rd!", "role": "driver"}); E = r["token"]
st, r = call("POST", "/auth/demo", {"role": "owner"}); O = r["token"]; owner = r["user"]
st, r = call("POST", "/auth/demo", {"role": "admin"}); A = r["token"]
st, spots = call("GET", "/spots")
big = next(s for s in spots if "Saravana" in s["name"])          # owned by the demo owner, ₹40/h
small = next(s for s in spots if s["id"] == 1)                    # 2 slots, ₹50/h, another owner

st, r = call("POST", "/bookings", req(big["id"], 1), D)
check("with real payments on, a paid booking cannot skip checkout", st == 400 and r.get("code") == "PAYMENT_REQUIRED")

st, co = call("POST", "/payments/checkout", req(big["id"], 1, 2), D)
check("checkout creates a Razorpay order for the server's price (₹40 × 2 h = 8000 paise)", st == 201 and co["orderId"].startswith("order_") and co["amount"] == 8000 and co["currency"] == "INR" and co["keyId"] == "rzp_test_PARKEASE")
st, log = call("GET", "/_log", base=MOCK)
check("...sent to Razorpay with the key id and secret (Basic auth) and a receipt", log[-1]["path"] == "/v1/orders" and log[-1]["auth_ok"] and log[-1]["body"]["receipt"] == f"booking_{co['bookingId']}")
st, b = call("GET", f"/bookings/{co['bookingId']}", token=D)
check("while paying, the booking is pending and holds its slot", b["status"] == "pending" and b["paymentStatus"] == "pending" and b["slotLabel"] == "P-001")

st, r = call("POST", "/payments/verify", {"bookingId": co["bookingId"], "razorpay_order_id": co["orderId"], "razorpay_payment_id": "pay_TEST1", "razorpay_signature": "0" * 64}, D)
check("a wrong signature is refused", st == 400)
st, r = call("POST", "/payments/verify", {"bookingId": co["bookingId"], "razorpay_order_id": co["orderId"], "razorpay_payment_id": "pay_TEST1", "razorpay_signature": sign(co["orderId"], "pay_TEST1")}, E)
check("another user cannot confirm someone else's payment", st == 404)
st, r = call("POST", "/payments/verify", {"bookingId": co["bookingId"], "razorpay_order_id": "order_FAKE", "razorpay_payment_id": "pay_TEST1", "razorpay_signature": sign("order_FAKE", "pay_TEST1")}, D)
check("a signature made for a different order is refused (the order id comes from the server)", st == 400)
st, paid = call("POST", "/payments/verify", {"bookingId": co["bookingId"], "razorpay_order_id": co["orderId"], "razorpay_payment_id": "pay_TEST1", "razorpay_signature": sign(co["orderId"], "pay_TEST1")}, D)
check("a correct signature confirms the booking as paid", st == 200 and paid["status"] == "confirmed" and paid["paymentStatus"] == "paid" and paid["paymentId"] == "pay_TEST1" and paid["paymentMode"] == "razorpay")
st, again = call("POST", "/payments/verify", {"bookingId": co["bookingId"], "razorpay_order_id": co["orderId"], "razorpay_payment_id": "pay_TEST1", "razorpay_signature": sign(co["orderId"], "pay_TEST1")}, D)
check("repeating the confirmation is harmless", st == 200 and again["paymentStatus"] == "paid")

# slot holding and releasing on the 2-slot spot
st, h1 = call("POST", "/payments/checkout", req(small["id"], 2, 1), D)
st, h2 = call("POST", "/payments/checkout", req(small["id"], 2, 1), E)
st, r = call("POST", "/payments/checkout", req(small["id"], 2, 1), E)
check("two drivers paying hold both slots; a third cannot start", st == 400 and "already booked" in r["error"])
st, r = call("POST", "/payments/abandon", {"bookingId": h2["bookingId"], "reason": "Payment window closed"}, D)
check("a driver cannot release someone else's payment", st == 200 and r["released"] is False)
st, r = call("POST", "/payments/abandon", {"bookingId": h2["bookingId"], "reason": "Payment window closed"}, E)
check("closing the payment window releases the slot", st == 200 and r["released"] is True)
st, r = call("POST", "/payments/checkout", req(small["id"], 2, 1), E)
check("...so someone else can book it", st == 201)

# refunds
st, r = call("PATCH", f"/bookings/{co['bookingId']}", {"status": "cancelled"}, D)
st, log = call("GET", "/_log", base=MOCK)
check("cancelling before the start refunds in full through Razorpay", st == 200 and r["paymentStatus"] == "refunded" and r["refundId"].startswith("rfnd_")
      and log[-1]["path"] == "/v1/payments/pay_TEST1/refund" and log[-1]["body"]["receipt"] == f"refund_booking_{co['bookingId']}" and "amount" not in log[-1]["body"])

s0, e0 = (now - dt.timedelta(hours=1)).isoformat(), (now + dt.timedelta(hours=2)).isoformat()
st, started = call("POST", "/payments/checkout", {**req(big["id"], 0), "startTime": s0, "endTime": e0}, D)
st, r = call("POST", "/payments/verify", {"bookingId": started["bookingId"], "razorpay_order_id": started["orderId"], "razorpay_payment_id": "pay_TEST2", "razorpay_signature": sign(started["orderId"], "pay_TEST2")}, D)
st, r = call("PATCH", f"/bookings/{started['bookingId']}", {"status": "cancelled"}, D)
check("a driver cancelling after the start gets no refund, and is told why", st == 200 and r["paymentStatus"] == "paid" and "No refund" in (r["refundError"] or ""))

st, c3 = call("POST", "/payments/checkout", {**req(big["id"], 0), "startTime": s0, "endTime": e0}, E)
st, r = call("POST", "/payments/verify", {"bookingId": c3["bookingId"], "razorpay_order_id": c3["orderId"], "razorpay_payment_id": "pay_FAIL3", "razorpay_signature": sign(c3["orderId"], "pay_FAIL3")}, E)
st, r = call("PATCH", f"/bookings/{c3['bookingId']}", {"status": "cancelled"}, O)
check("the spot owner cancelling always refunds; a refund Razorpay rejects is recorded", st == 200 and r["paymentStatus"] == "refund_failed" and "captured" in r["refundError"])
st, r = call("POST", f"/bookings/{c3['bookingId']}/retry-refund", token=O)
check("only an admin can retry a refund", st == 403)
st, r = call("POST", f"/bookings/{c3['bookingId']}/retry-refund", token=A)
check("the admin retries it and it goes through", st == 200 and r["paymentStatus"] == "refunded" and r["refundId"].startswith("rfnd_"))

# rewards still bypass the gateway
st, r = call("POST", "/bookings", req(big["id"], 5, useReward=True), D)
check("a reward booking without a reward is still refused", st == 400)

# owner earnings and payouts
st, c4 = call("POST", "/payments/checkout", req(big["id"], 6, 3), D)
st, r = call("POST", "/payments/verify", {"bookingId": c4["bookingId"], "razorpay_order_id": c4["orderId"], "razorpay_payment_id": "pay_TEST4", "razorpay_signature": sign(c4["orderId"], "pay_TEST4")}, D)
st, r = call("PATCH", f"/bookings/{c4['bookingId']}", {"status": "completed"}, O)
st, s1 = call("GET", "/payouts/summary", token=O)
check("owner earnings: completed paid booking, 10% commission, balance", st == 200 and s1["gross"] == 120 and s1["commission"] == 12 and s1["net"] == 108 and s1["balance"] == 108 and s1["completedPaidBookings"] == 1, json.dumps({k: s1.get(k) for k in ("gross", "commission", "net", "balance")}))
st, r = call("GET", "/payouts/summary", token=D); check("drivers have no earnings page", st == 403)
st, r = call("PATCH", "/payouts/details", {"payoutUpi": "not a upi", "payoutName": "Rajesh"}, O); check("an invalid UPI ID is refused", st == 400)
st, r = call("PATCH", "/payouts/details", {"payoutUpi": "rajesh@okhdfcbank", "payoutName": "Rajesh Kumar"}, O); check("owner saves a UPI ID for payouts", st == 200 and r["payoutUpi"] == "rajesh@okhdfcbank")
st, r = call("POST", "/payouts", {"ownerId": owner["id"], "amount": 50, "reference": "UPI123"}, O); check("an owner cannot record their own payout", st == 403)
st, r = call("POST", "/payouts", {"ownerId": owner["id"], "amount": 500, "reference": "UPI123"}, A); check("a payout above the balance is refused", st == 400)
st, r = call("POST", "/payouts", {"ownerId": owner["id"], "amount": 100, "reference": "UPI4567890"}, A); check("admin records a payout", st == 201)
st, s2 = call("GET", "/payouts/summary", token=O); check("...and the owner sees it and the new balance", s2["paidOut"] == 100 and s2["balance"] == 8 and s2["payouts"][0]["reference"] == "UPI4567890")
st, rows = call("GET", "/payouts/owners", token=A); check("admin sees every owner's balance and UPI ID", st == 200 and any(r["ownerId"] == owner["id"] and r["balance"] == 8 and r["payoutUpi"] == "rajesh@okhdfcbank" for r in rows))
st, r = call("GET", "/payouts/owners", token=O); check("owners cannot see other owners' balances", st == 403)

# unpaid holds expire
if shutil.which("psql"):
    st, c5 = call("POST", "/payments/checkout", req(small["id"], 9, 1), D)
    subprocess.run(["psql", DB, "-q", "-c", f"UPDATE bookings SET created_at = now() - interval '20 minutes' WHERE id = {c5['bookingId']}"], check=True)
    print("... waiting up to 75 s for the unpaid hold to expire")
    for _ in range(25):
        st, b = call("GET", f"/bookings/{c5['bookingId']}", token=D)
        if b["status"] == "cancelled": break
        time.sleep(3)
    check("a slot held for an unfinished payment is released after 15 minutes", b["status"] == "cancelled" and b["paymentStatus"] == "failed")

print(sum(results), "of", len(results), "passed")
