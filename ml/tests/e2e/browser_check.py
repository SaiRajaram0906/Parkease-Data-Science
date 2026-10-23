"""Browser checks for ParkEase: one journey per role, plus the fallback when
the Data Science service is down.

Usage: python browser_check.py <screenshot-folder> [command that restarts the service]
Needs `pip install playwright`, a Chromium install, and the whole stack running
on a freshly prepared database (see README.md here).
"""
import asyncio
import datetime as dt
import json
import re
import subprocess
import sys
import time
import urllib.request

from playwright.async_api import async_playwright

OUT = sys.argv[1]
U = "http://127.0.0.1:5173"
STAMP = int(time.time())
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print("PASS" if ok else "FAIL", name, detail)


async def sign_out(page):
    await page.evaluate("localStorage.clear()")
    await page.goto(U + "/login", wait_until="networkidle")


async def demo(page, label):
    await sign_out(page)
    await page.get_by_role("button", name=label).click()
    await page.wait_for_function("!location.pathname.endsWith('/login')")
    await page.wait_for_timeout(500)


async def sign_in(page, email, password="Passw0rd!"):
    await sign_out(page)
    await page.get_by_label("Email address").fill(email)
    await page.get_by_label("Password", exact=True).fill(password)
    await page.get_by_role("button", name="Continue").click()
    await page.wait_for_function("!location.pathname.endsWith('/login')")
    await page.wait_for_timeout(500)


def api(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request("http://localhost:5000/api" + path, method=method, headers=headers,
                                     data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode())


async def pick_tomorrow_10pm(page):
    """In the booking window: tomorrow, 10 PM to 11 PM (so the test works at any time of day)."""
    tomorrow = dt.date.today() + dt.timedelta(days=1)
    dialog = page.get_by_role("dialog")
    await dialog.get_by_role("button").filter(has_text=re.compile(r"\d{4}$")).first.click()
    await page.wait_for_timeout(300)
    if tomorrow.month != dt.date.today().month:
        await page.get_by_role("button", name=re.compile("next", re.I)).click()
        await page.wait_for_timeout(300)
    await page.locator("[role=gridcell] button:not([disabled]), button[role=gridcell]:not([disabled])").filter(
        has_text=re.compile(rf"^{tomorrow.day}$")).first.click()
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(300)
    combos = dialog.get_by_role("combobox")
    # Start defaults to 10 AM and end to 11 AM; move each 12 hours later with
    # the keyboard (the option list is longer than the screen).
    for index in (0, 1):
        await combos.nth(index).click()
        await page.wait_for_timeout(300)
        for _ in range(12):
            await page.keyboard.press("ArrowDown")
            await page.wait_for_timeout(80)
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(300)
    return "10:00 PM" in await combos.nth(0).inner_text() and "11:00 PM" in await combos.nth(1).inner_text()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1366, "height": 900},
                                        geolocation={"latitude": 13.0605, "longitude": 80.24},
                                        permissions=["geolocation"])
        # Google Maps cannot be reached from the test machine, so these checks
        # cover the paths that work without it (see the report for what that leaves out).
        await ctx.route("**/maps.googleapis.com/**", lambda r: r.abort())
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        # Record the address "Get Directions" opens instead of opening it.
        await page.add_init_script("window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };")

        # ---------------------------------------------------------- sign-up
        await page.goto(U + "/spots", wait_until="networkidle")
        check("signed-out visitor is sent to the login page", page.url.endswith("/login"))
        await page.get_by_text("Register", exact=True).click()
        await page.get_by_label("Full name").fill("Tara Tester")
        await page.get_by_label("Email address").fill(f"tara{STAMP}@example.com")
        password = page.get_by_label("Password", exact=True)
        confirm = page.get_by_label("Confirm password", exact=True)
        await password.fill("weak"); await confirm.fill("weak")
        await page.get_by_role("button", name="Register").click()
        check("weak password is refused in the form", await page.get_by_text("Password must be at least 8 characters").count() >= 1)
        await password.fill("Passw0rd!")
        check("password is hidden by default", await password.get_attribute("type") == "password")
        await page.get_by_role("button", name="Show password", exact=True).click()
        check("the eye shows the password", await password.get_attribute("type") == "text" and await password.input_value() == "Passw0rd!")
        check("...and only that field: confirm stays hidden", await confirm.get_attribute("type") == "password")
        await page.get_by_role("button", name="Hide password", exact=True).click()
        check("the eye hides it again", await password.get_attribute("type") == "password")
        await confirm.fill("Passw0rd?")
        await page.get_by_role("button", name="Register").click()
        await page.wait_for_timeout(500)
        check("different confirm password is refused", page.url.endswith("/login") and await page.get_by_text("The two passwords do not match.").count() == 1)
        await page.get_by_role("button", name="Show confirm password").click()
        check("confirm password has its own eye", await confirm.get_attribute("type") == "text")
        await confirm.fill("Passw0rd!")
        check("matching passwords are confirmed", await page.get_by_text("Passwords match.").count() == 1)
        check("sign-up offers Driver and Owner, not Admin", await page.get_by_role("button", name="Driver Find parking").count() == 1
              and await page.get_by_role("button", name="Owner List my parking space").count() == 1)
        await page.get_by_role("button", name="Register").click()
        await page.wait_for_url(U + "/")
        check("new driver account is signed in", "driver" in (await page.evaluate("localStorage.getItem('parkease_user')")))

        # ----------------------------------------------------------- driver
        links = await page.get_by_role("navigation").inner_text()
        check("driver menu: Find Parking, My Bookings, Dashboard only",
              all(x in links for x in ("Find Parking", "My Bookings", "Dashboard"))
              and all(x not in links for x in ("Analytics", "Admin", "Verify Entry", "List Your Spot")), links.replace("\n", " | "))
        check("driver home page does not invite listing a spot", await page.get_by_text("List Your Spot Today").count() == 0)
        for path in ("/analytics", "/admin", "/list-spot", "/verify"):
            await page.goto(U + path, wait_until="networkidle")
            check(f"driver typing {path} is sent to the dashboard", page.url.endswith("/dashboard"))
        await page.wait_for_timeout(800)
        check("new driver sees the empty state and no owner or platform tabs",
              await page.get_by_text("No parking history yet").count() == 1 and await page.get_by_role("tab").count() == 0)
        check("driver dashboard shows rewards at 0 of 10", await page.get_by_text("Parking rewards").count() == 1 and await page.get_by_text("0 of 10").count() == 1)
        await page.goto(U + "/profile", wait_until="networkidle"); await page.wait_for_timeout(800)
        await page.get_by_role("button", name="Send a test email").click(); await page.wait_for_timeout(1500)
        check("test email is sent to the registered address (or reported as not set up)",
              await page.get_by_text(f"Emailed to tara{STAMP}@example.com").count() == 1
              or await page.get_by_text("Not emailed: email sending is not set up on this server").count() == 1)
        await sign_out(page)
        await page.get_by_label("Email address").fill(f"tara{STAMP}@example.com")
        await page.get_by_label("Password", exact=True).fill("Wrong999!")
        await page.get_by_role("button", name="Continue").click()
        await page.wait_for_timeout(800)
        check("wrong password does not sign in", page.url.endswith("/login") and await page.get_by_text("Incorrect email or password").count() >= 1)
        await page.get_by_role("button", name="Show password", exact=True).click()
        check("the sign-in form has the eye too", await page.get_by_label("Password", exact=True).get_attribute("type") == "text")
        await page.get_by_label("Password", exact=True).fill("Passw0rd!")
        await page.get_by_role("button", name="Continue").click()
        await page.wait_for_url(U + "/")
        check("correct password signs in", True)

        # ------------------------------------------------------------ owner
        await demo(page, "Owner Rajesh")
        check("owner lands on the dashboard after signing in", page.url.endswith("/dashboard"))
        await page.goto(U + "/analytics", wait_until="networkidle")
        await page.get_by_role("button", name="Load demo data").click()
        await page.get_by_text("Demo data loaded", exact=True).first.wait_for(timeout=15000)
        check("owner loads the demo data", True)
        links = await page.get_by_role("navigation").inner_text()
        check("owner menu: Dashboard, Analytics, Verify Entry, List Your Spot only",
              all(x in links for x in ("Dashboard", "Analytics", "Verify Entry", "List Your Spot"))
              and all(x not in links for x in ("Find Parking", "My Bookings", "Admin")), links.replace("\n", " | "))
        check("owner gets no parking assistant", await page.get_by_role("button", name="Open the parking assistant").count() == 0)
        for path in ("/admin", "/spots", "/bookings"):
            await page.goto(U + path, wait_until="networkidle")
            check(f"owner typing {path} is sent to the dashboard", page.url.endswith("/dashboard"))
        await page.wait_for_timeout(1200)
        tabs = [await t.inner_text() for t in await page.get_by_role("tab").all()]
        check("owner dashboard: listings only, no driver insights or platform overview",
              "Demand & pricing" in tabs and "My parking insights" not in tabs and "Platform overview" not in tabs
              and await page.get_by_text("Parking rewards").count() == 0, str(tabs))
        check("owner dashboard shows six performance tiles", all([await page.get_by_text(t, exact=True).count() >= 1 for t in
              ["Total bookings", "Occupancy rate", "Completed revenue", "Avg parking duration", "Peak demand time", "Cancellation rate"]]))
        await page.get_by_role("link", name="Central business district Parking 14").click()
        await page.wait_for_url("**/spots/*"); await page.wait_for_timeout(1000)
        own_spot = page.url
        check("owner sees Deactivate and Edit location on their own spot",
              await page.get_by_role("button", name="Deactivate").count() == 1 and await page.get_by_role("button", name="Edit location").count() == 1)
        check("owner cannot book: no Book Now button", await page.get_by_role("button", name="Book Now").count() == 0
              and await page.get_by_text("This is your listing.").count() == 1)
        await page.goto(U + "/spots/1", wait_until="networkidle"); await page.wait_for_timeout(800)
        check("owner sees no Deactivate on someone else's spot", await page.get_by_role("button", name="Deactivate").count() == 0)
        await page.goto(U + "/dashboard", wait_until="networkidle"); await page.wait_for_timeout(1000)
        await page.get_by_role("tab", name="Demand & pricing").click(); await page.wait_for_timeout(1200)
        await page.get_by_role("combobox").first.click()
        await page.get_by_role("option").filter(has_text="Parking 14").click(); await page.wait_for_timeout(1500)
        check("demand forecast and price recommendation render", await page.get_by_text("Busiest hour:").count() == 1 and await page.get_by_text("Recommended price").count() == 1)
        apply = page.get_by_role("button", name="Apply ₹")
        if await apply.count():
            label = await apply.inner_text(); await apply.click()
            await page.get_by_text("Price updated", exact=True).first.wait_for(timeout=8000)
            check("owner applies the suggested price by choice", True, label)
        await page.goto(U + "/analytics", wait_until="networkidle"); await page.wait_for_timeout(1000)
        for tab in ["Parking demand", "Occupancy", "Revenue", "User behaviour", "Predictions", "Model performance"]:
            await page.get_by_role("tab", name=tab).click(); await page.wait_for_timeout(900)
            check(f"analytics tab renders for the owner: {tab}", await page.get_by_text("could not be loaded").count() == 0
                  and await page.get_by_text("insights are unavailable").count() == 0)

        # --------------------------------- owner lists a spot (auto-fill)
        await page.goto(U + "/list-spot", wait_until="networkidle"); await page.wait_for_timeout(800)
        await page.get_by_placeholder("e.g. Secure Basement Parking near Metro").fill("Rajesh's Test Car Park")
        await page.get_by_placeholder("Street address, building name, landmark...").fill("14 Test Street, Sample Nagar")
        await page.locator("input[name='pricePerHour']").fill("40")
        await page.get_by_role("button", name="List Parking Spot").click(); await page.wait_for_timeout(800)
        check("a listing without a map pin is refused", page.url.endswith("/list-spot") and await page.get_by_text("Place the pin on the map").count() == 1)
        await page.get_by_role("button", name="Use my location").click(); await page.wait_for_timeout(1200)
        check("placing the pin fills latitude and longitude",
              await page.locator("input[name='latitude']").input_value() == "13.0605000" and await page.locator("input[name='longitude']").input_value() == "80.2400000")
        check("...and the city and state", await page.locator("input[name='city']").input_value() == "Chennai"
              and await page.locator("input[name='state']").input_value() == "Tamil Nadu")
        check("...and clears the pin message", await page.get_by_text("Place the pin on the map").count() == 0)
        await page.get_by_text("Large parking facility (QR entry check)").click()
        await page.get_by_role("button", name="List Parking Spot").click()
        await page.wait_for_url("**/spots/*", timeout=10000); await page.wait_for_timeout(1000)
        new_spot = page.url
        check("owner lists a large facility with the day price left empty", await page.get_by_text("Large facility · QR entry").count() == 1)
        await page.get_by_role("button", name="Get Directions").click()
        opened = await page.evaluate("window.__opened")
        check("Get Directions goes to the listing's exact pin", opened[-1:] == ["https://www.google.com/maps/dir/?api=1&destination=13.0605%2C80.24&travelmode=driving"], str(opened[-1:]))

        # ----------------------------------------------------- demo driver
        await demo(page, "Driver Priya")
        check("driver lands on the home page", page.url == U + "/")
        token = await page.evaluate("localStorage.getItem('parkease_token')")
        spots = api("GET", "/spots")
        saravana = next(s for s in spots if "Saravana Stores" in s["name"])
        await page.goto(U + "/spots", wait_until="networkidle"); await page.wait_for_timeout(1500)
        check("driver sees ranked recommendations", await page.get_by_text("Best match").count() == 1 and await page.get_by_text("Why recommended?").count() == 3)
        before = await page.locator("section[aria-label='Smart parking recommendations'] h3").first.inner_text() + await page.get_by_text("Score = ").inner_text()
        await page.get_by_role("button", name="Priorities").click()
        await page.get_by_role("slider", name="Price").focus()
        for _ in range(16):
            await page.keyboard.press("ArrowRight")
        await page.wait_for_timeout(2500); await page.keyboard.press("Escape")
        after = await page.locator("section[aria-label='Smart parking recommendations'] h3").first.inner_text() + await page.get_by_text("Score = ").inner_text()
        check("changing priorities recalculates the ranking", before != after)

        # parking assistant: spots near a named place
        await page.get_by_role("button", name="Open the parking assistant").click()
        box = page.get_by_label("Message to the parking assistant")
        await box.fill("spot near Rajalakshmi engineering college"); await box.press("Enter"); await page.wait_for_timeout(2000)
        chat = page.locator("div.fixed.bottom-6")
        text = await chat.inner_text()
        check("assistant answers for the named place, not the driver's own position",
              "of Rajalakshmi Engineering College, Thandalam" in text and "your current location" not in text)
        first = await chat.locator("h4").first.inner_text()
        check("...with the spot next to the college first", first.startswith("Thandalam Parking near Rajalakshmi"), first)
        await box.fill("parking in tambaram"); await box.press("Enter"); await page.wait_for_timeout(2000)
        check("assistant says so when nothing is listed near the place", "is listed within 3 km of Tambaram yet" in await chat.inner_text())
        await box.fill("bike parking near saravana stores"); await box.press("Enter"); await page.wait_for_timeout(2000)
        check("assistant finds parking near Saravana Stores", "bike parking spots within 3 km of Saravana Stores, T. Nagar" in await chat.inner_text())
        await page.screenshot(path=f"{OUT}/assistant.png")
        await chat.locator("h4", has_text="Saravana Stores Parking").last.locator("xpath=..").get_by_role("button", name="View & Book").click()
        await page.wait_for_url(f"**/spots/{saravana['id']}"); await page.wait_for_timeout(1200)
        check("the assistant's link opens that spot", await page.get_by_role("heading", name="Saravana Stores Parking, T. Nagar").count() == 1)

        # large facility: booking, slot, QR pass, directions
        await page.get_by_role("button", name="Get Directions").click()
        opened = await page.evaluate("window.__opened")
        check("Get Directions for a well-known place searches Google Maps for it by name",
              opened[-1:] == ["https://www.google.com/maps/dir/?api=1&destination=Super%20Saravana%20Stores%2C%20Ranganathan%20Street%2C%20T.%20Nagar%2C%20Chennai&travelmode=driving"], str(opened[-1:]))
        await page.get_by_role("button", name="Book Now").click()
        check("booking times chosen", await pick_tomorrow_10pm(page))
        await page.get_by_placeholder("e.g. MH 01 AB 1234").fill("TN09XY4321")
        await page.get_by_role("button", name="Proceed to Payment").click()
        await page.get_by_role("button", name="Pay ₹").click()
        await page.get_by_text("Booking Confirmed!").wait_for(timeout=10000)
        check("booking a large facility keeps a numbered slot", await page.get_by_role("dialog").get_by_text("P-001").count() == 1)
        await page.get_by_role("button", name="Show QR Code").click()
        await page.wait_for_url("**/bookings/*"); await page.wait_for_timeout(1500)
        pass_box = page.get_by_test_id("entry-pass")
        code_later = (await pass_box.get_by_text(re.compile(r"^PE-[A-Z0-9]{8}$")).inner_text()).strip()
        check("the booking shows a QR entry pass with slot and pass code",
              await pass_box.locator("svg[role=img], svg:has(title)").count() >= 1 and await pass_box.get_by_text("P-001").count() == 1 and code_later.startswith("PE-"))
        await page.screenshot(path=f"{OUT}/entry_pass.png", full_page=True)
        await page.get_by_role("button", name="Get Directions").click()
        opened = await page.evaluate("window.__opened")
        check("Get Directions on the booking page uses the same destination", "Super%20Saravana%20Stores" in opened[-1])
        await page.goto(own_spot, wait_until="networkidle"); await page.wait_for_timeout(1200)
        check("spot page shows actual and predicted availability", await page.get_by_text("Actual · live bookings").count() == 1 and await page.get_by_text("Model prediction").count() == 1)
        check("driver sees no owner controls on a spot", await page.get_by_role("button", name="Deactivate").count() == 0 and await page.get_by_role("button", name="Edit location").count() == 0)
        check("an ordinary spot shows no QR badge", await page.get_by_text("Large facility · QR entry").count() == 0)
        own = api("GET", f"/spots/{own_spot.rsplit('/', 1)[1]}")
        await page.get_by_role("button", name="Get Directions").click()
        opened = await page.evaluate("window.__opened")
        check("Get Directions for an ordinary spot ends at its exact map pin",
              opened[-1] == f"https://www.google.com/maps/dir/?api=1&destination={float(own['latitude'])}%2C{float(own['longitude'])}&travelmode=driving", opened[-1])
        await page.goto(U + "/bookings", wait_until="networkidle"); await page.wait_for_timeout(800)
        check("My Bookings shows the driver's booking and rewards progress", await page.get_by_text("TN09XY4321").count() == 1 and await page.get_by_text("1 of 10").count() == 1)

        # rewards: nine more bookings, then a free one
        now = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).replace(minute=0, second=0, microsecond=0)
        live = None
        for i in range(9):
            s_i = now + dt.timedelta(days=2 * i)
            made = api("POST", "/bookings", {"spotId": saravana["id"], "vehicleNumber": "TN09XY4321", "vehicleType": "car", "startTime": s_i.isoformat(),
                                              "endTime": (s_i + dt.timedelta(hours=1)).isoformat(), "durationHours": "1", "totalAmount": "0"}, token)
            live = live or made  # the first one is running right now
        await page.goto(U + "/dashboard", wait_until="networkidle"); await page.wait_for_timeout(1500)
        check("after ten bookings the dashboard offers a free booking", await page.get_by_text("1 free booking ready").count() == 1)
        check("driver dashboard shows analytics tiles", await page.get_by_text("Most used zone").count() == 1 and await page.get_by_text("Preferred time").count() == 1)
        await page.screenshot(path=f"{OUT}/rewards.png")
        await page.get_by_role("link", name="Use it").click(); await page.wait_for_url("**/spots")
        await page.goto(own_spot, wait_until="networkidle"); await page.wait_for_timeout(1000)
        await page.get_by_role("button", name="Book Now").click()
        check("free booking: times chosen", await pick_tomorrow_10pm(page))
        await page.get_by_placeholder("e.g. MH 01 AB 1234").fill("TN09XY4321")
        await page.get_by_text("Use a free parking reward").click()
        check("using the reward makes the total zero", await page.get_by_role("dialog").get_by_text("₹0.00").count() == 1)
        await page.get_by_role("button", name="Confirm Free Booking").click()
        await page.get_by_text("Booking Confirmed!").wait_for(timeout=10000)
        check("the free booking is confirmed without a payment step", await page.get_by_text("₹0.00 (free reward)").count() == 1)
        await page.get_by_role("button", name="View Booking").click(); await page.wait_for_url("**/bookings/*"); await page.wait_for_timeout(1000)
        check("the booking is marked as a free parking reward", await page.get_by_text("Free parking reward").count() == 1
              and await page.get_by_test_id("entry-pass").count() == 0)
        await page.goto(U + "/dashboard", wait_until="networkidle"); await page.wait_for_timeout(1200)
        check("the reward is used up", await page.get_by_text("1 free booking ready").count() == 0 and await page.get_by_text("1 reward earned · 1 used").count() == 1)

        # start message for the booking that is running now (checked once a minute)
        got = False
        for _ in range(26):
            await page.goto(U + f"/bookings/{live['id']}", wait_until="networkidle"); await page.wait_for_timeout(600)
            if await page.get_by_text("Your parking spot is ready: Saravana Stores Parking, T. Nagar").count() >= 1:
                got = True
                break
            await page.wait_for_timeout(2500)
        check("the booking page shows the 'parking started' message", got)
        check("...and says the demo address was not emailed", await page.get_by_text("Not emailed: demo address").count() >= 1)
        await page.get_by_role("button", name=re.compile("^Messages")).click(); await page.wait_for_timeout(500)
        check("the bell lists the message", await page.get_by_role("dialog").get_by_text("Your parking spot is ready").count() >= 1)
        await page.keyboard.press("Escape")
        await page.goto(U + "/profile", wait_until="networkidle"); await page.wait_for_timeout(800)
        check("profile shows the signed-in user", await page.get_by_text("priya.sharma@gmail.com").count() >= 1)

        # ------------------------------------------- owner verifies passes
        await sign_out(page)
        await page.goto(U + f"/verify/{live['verifyCode']}", wait_until="networkidle")
        check("a scanned QR code asks a signed-out person to sign in first", "/login" in page.url)
        await page.get_by_role("button", name="Owner Rajesh").click()
        await page.wait_for_url(f"**/verify/{live['verifyCode']}"); await page.wait_for_timeout(1200)
        result = page.get_by_test_id("pass-result")
        check("...and then shows the pass: valid, with vehicle and slot",
              await result.get_by_text("Valid pass", exact=True).count() == 1 and await result.get_by_text("TN09XY4321").count() == 1 and await result.get_by_text(live["slotLabel"]).count() == 1)
        await page.screenshot(path=f"{OUT}/verify_entry.png")
        await page.get_by_role("button", name="Allow entry").click(); await page.wait_for_timeout(1200)
        check("owner allows entry and the pass becomes used", await result.get_by_text("Already entered").count() == 1
              and await page.get_by_role("button", name="Allow entry").count() == 0)
        await page.get_by_role("link", name="Verify Entry").click(); await page.wait_for_timeout(500)
        await page.get_by_label("Pass code").fill(code_later.lower())
        await page.get_by_role("button", name="Check pass").click(); await page.wait_for_timeout(1000)
        check("a typed code for tomorrow's booking is too early", await page.get_by_test_id("pass-result").get_by_text("Too early", exact=True).count() == 1)
        await page.get_by_label("Pass code").fill("PE-AAAAAAAA")
        await page.get_by_role("button", name="Check pass").click(); await page.wait_for_timeout(1000)
        check("an unknown code is not valid", await page.get_by_text("No booking with this code at your parking places.").count() == 1)

        # ------------------------------------------------------------ admin
        await demo(page, "Admin Vikram")
        links = await page.get_by_role("navigation").inner_text()
        check("admin menu has everything", all(x in links for x in ("Find Parking", "My Bookings", "Dashboard", "Analytics", "Verify Entry", "Admin", "List Your Spot")))
        await page.goto(U + "/dashboard", wait_until="networkidle"); await page.wait_for_timeout(1200)
        check("admin dashboard opens on the platform overview", await page.get_by_text("Revenue by City").count() == 1 and await page.get_by_text("Top Performing Spots").count() == 1)
        await page.goto(U + "/admin", wait_until="networkidle"); await page.wait_for_timeout(1200)
        check("admin console lists users", await page.get_by_text("Users and roles").count() == 1 and await page.get_by_text("Tara Tester").count() == 1)
        await page.get_by_role("combobox", name="Role of Tara Tester").click()
        await page.get_by_role("option", name="owner").click()
        await page.get_by_text("Role updated", exact=True).first.wait_for(timeout=8000)
        check("admin changes a user's role", True)
        check("admin cannot change their own role", await page.get_by_role("combobox", name="Role of Vikram Nair").is_disabled())
        await page.get_by_role("tab", name="Listings").click(); await page.wait_for_timeout(800)
        row = page.get_by_role("row").filter(has_text="Rajesh's Test Car Park")
        await row.get_by_role("button", name="Deactivate").click()
        await page.get_by_text("Listing deactivated", exact=True).first.wait_for(timeout=8000)
        check("admin deactivates any listing", await row.get_by_text("Deactivated").count() == 1)
        await page.screenshot(path=f"{OUT}/admin_console.png", full_page=True)
        page.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await row.get_by_role("button", name="Delete Rajesh's Test Car Park").click()
        await page.get_by_text("Listing deleted", exact=True).first.wait_for(timeout=8000)
        check("admin deletes any listing", True)
        await page.goto(own_spot, wait_until="networkidle"); await page.wait_for_timeout(800)
        check("admin sees owner controls on any spot", await page.get_by_role("button", name="Deactivate").count() == 1)

        # the role change above takes effect: Tara is now an owner
        await sign_in(page, f"tara{STAMP}@example.com")
        links = await page.get_by_role("navigation").inner_text()
        check("an account changed to owner gets the owner menu", "Verify Entry" in links and "Find Parking" not in links and page.url.endswith("/dashboard"))

        # ----------------------------------- Data Science service switched off
        subprocess.run(["pkill", "-f", "[u]vicorn ml.service"]); time.sleep(1.5)
        await demo(page, "Driver Priya")
        await page.goto(U + "/spots", wait_until="networkidle"); await page.wait_for_timeout(2500)
        check("ML down: recommendation area shows the fallback, not numbers", await page.get_by_text("Data Science insights are unavailable right now").count() >= 1)
        check("ML down: regular spot list still renders", await page.get_by_text("Kamakoti Appartments").count() >= 1)
        check("no script errors during the whole run", not errors, str(errors[:2]))
        await browser.close()
    print(sum(results), "of", len(results), "passed")


asyncio.run(main())
