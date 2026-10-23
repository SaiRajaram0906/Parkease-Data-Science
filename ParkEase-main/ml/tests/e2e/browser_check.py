"""Browser checks for ParkEase: one journey per role, plus the fallback when
the Data Science service is down.

Usage: python browser_check.py <screenshot-folder> [command that restarts the service]
Needs `pip install playwright`, a Chromium install, and the whole stack running
on a freshly prepared database (see README.md here).
"""
import asyncio
import subprocess
import sys
import time

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
    await page.wait_for_url(U + "/")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1366, "height": 900},
                                        geolocation={"latitude": 13.0605, "longitude": 80.24},
                                        permissions=["geolocation"])
        await ctx.route("**/maps.googleapis.com/**", lambda r: r.abort())
        page = await ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---------------------------------------------------------- sign-up
        await page.goto(U + "/spots", wait_until="networkidle")
        check("signed-out visitor is sent to the login page", page.url.endswith("/login"))
        await page.get_by_text("Register", exact=True).click()
        await page.get_by_label("Full name").fill("Tara Tester")
        await page.get_by_label("Email address").fill(f"tara{STAMP}@example.com")
        await page.get_by_label("Password").fill("weak")
        await page.get_by_role("button", name="Register").click()
        check("weak password is refused in the form", await page.get_by_text("Password must be at least 8 characters").count() >= 1)
        await page.get_by_label("Password").fill("Passw0rd!")
        check("sign-up offers Driver and Owner, not Admin", await page.get_by_role("button", name="Driver Find parking").count() == 1
              and await page.get_by_role("button", name="Owner List my parking space").count() == 1)
        await page.get_by_role("button", name="Register").click()
        await page.wait_for_url(U + "/")
        check("new driver account is signed in", "driver" in (await page.evaluate("localStorage.getItem('parkease_user')")))

        # ----------------------------------------------------------- driver
        links = await page.get_by_role("navigation").inner_text()
        check("driver menu has no Analytics or Admin", "Analytics" not in links and "Admin" not in links)
        await page.goto(U + "/analytics", wait_until="networkidle")
        check("driver typing /analytics is sent to the dashboard", page.url.endswith("/dashboard"))
        await page.goto(U + "/admin", wait_until="networkidle")
        check("driver typing /admin is sent to the dashboard", page.url.endswith("/dashboard"))
        await page.wait_for_timeout(800)
        check("new driver sees the empty state and no owner or platform tabs",
              await page.get_by_text("No parking history yet").count() == 1 and await page.get_by_role("tab").count() == 0)
        await sign_out(page)
        await page.get_by_label("Email address").fill(f"tara{STAMP}@example.com")
        await page.get_by_label("Password").fill("Wrong999!")
        await page.get_by_role("button", name="Continue").click()
        await page.wait_for_timeout(800)
        check("wrong password does not sign in", page.url.endswith("/login") and await page.get_by_text("Incorrect email or password").count() >= 1)
        await page.get_by_label("Password").fill("Passw0rd!")
        await page.get_by_role("button", name="Continue").click()
        await page.wait_for_url(U + "/")
        check("correct password signs in", True)

        # ------------------------------------------------------------ owner
        await demo(page, "Owner Rajesh")
        await page.goto(U + "/analytics", wait_until="networkidle")
        await page.get_by_role("button", name="Load demo data").click()
        await page.get_by_text("Demo data loaded", exact=True).first.wait_for(timeout=15000)
        check("owner loads the demo data", True)
        links = await page.get_by_role("navigation").inner_text()
        check("owner menu has Analytics but no Admin", "Analytics" in links and "Admin" not in links)
        await page.goto(U + "/admin", wait_until="networkidle")
        check("owner typing /admin is sent to the dashboard", page.url.endswith("/dashboard"))
        await page.wait_for_timeout(1200)
        tabs = [await t.inner_text() for t in await page.get_by_role("tab").all()]
        check("owner dashboard: My listings and My parking insights, no Platform overview",
              "My listings" in tabs and "My parking insights" in tabs and "Platform overview" not in tabs, str(tabs))
        check("owner dashboard shows six performance tiles", all([await page.get_by_text(t, exact=True).count() >= 1 for t in
              ["Total bookings", "Occupancy rate", "Completed revenue", "Avg parking duration", "Peak demand time", "Cancellation rate"]]))
        await page.get_by_role("link", name="Central business district Parking 14").click()
        await page.wait_for_url("**/spots/*"); await page.wait_for_timeout(1000)
        own_spot = page.url
        check("owner sees Deactivate on their own spot", await page.get_by_role("button", name="Deactivate").count() == 1)
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

        # ----------------------------------------------------- demo driver
        await demo(page, "Driver Priya")
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
        await page.goto(own_spot, wait_until="networkidle"); await page.wait_for_timeout(1200)
        check("spot page shows actual and predicted availability", await page.get_by_text("Actual · live bookings").count() == 1 and await page.get_by_text("Model prediction").count() == 1)
        check("driver sees no owner controls on a spot", await page.get_by_role("button", name="Deactivate").count() == 0)
        await page.get_by_role("button", name="Book Now").click()
        combos = page.get_by_role("dialog").get_by_role("combobox")
        # Start defaults to 10 AM and end to 11 AM; move each 12 hours later
        # with the keyboard (the option list is longer than the screen).
        for index in (0, 1):
            await combos.nth(index).click()
            await page.wait_for_timeout(300)
            for _ in range(12):
                await page.keyboard.press("ArrowDown")
                await page.wait_for_timeout(80)
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(300)
        check("booking times chosen", "10:00 PM" in await combos.nth(0).inner_text() and "11:00 PM" in await combos.nth(1).inner_text())
        await page.get_by_placeholder("e.g. MH 01 AB 1234").fill("TN09XY4321")
        await page.get_by_role("button", name="Proceed to Payment").click()
        await page.get_by_role("button", name="Pay ₹").click()
        await page.get_by_text("Booking Confirmed!").wait_for(timeout=10000)
        check("booking completes through the UI", True)
        await page.get_by_role("button", name="Done").click()
        await page.goto(U + "/bookings", wait_until="networkidle")
        check("My Bookings shows the driver's booking", await page.get_by_text("TN09XY4321").count() == 1)
        await page.goto(U + "/profile", wait_until="networkidle"); await page.wait_for_timeout(800)
        check("profile shows the signed-in user", await page.get_by_text("priya.sharma@gmail.com").count() >= 1)
        await page.goto(U + "/dashboard", wait_until="networkidle"); await page.wait_for_timeout(1200)
        check("driver dashboard shows analytics tiles", await page.get_by_text("Most used zone").count() == 1 and await page.get_by_text("Preferred time").count() == 1)

        # ------------------------------- a driver lists a spot through the UI
        await sign_out(page)
        await page.get_by_label("Email address").fill(f"tara{STAMP}@example.com")
        await page.get_by_label("Password").fill("Passw0rd!")
        await page.get_by_role("button", name="Continue").click(); await page.wait_for_url(U + "/")
        await page.goto(U + "/list-spot", wait_until="networkidle")
        await page.get_by_placeholder("e.g. Secure Basement Parking near Metro").fill("Tara's Test Driveway")
        await page.get_by_placeholder("Street address, building name, landmark...").fill("14 Test Street, Sample Nagar")
        await page.get_by_role("combobox").filter(has_text="Select city").click()
        await page.get_by_role("option").first.click()
        await page.locator("input[name='pricePerHour']").fill("40")
        await page.get_by_role("button", name="List Parking Spot").click()
        await page.wait_for_url("**/spots/*", timeout=10000)
        check("driver lists a spot with the day price left empty", "/spots/" in page.url)
        await page.wait_for_timeout(1000)
        check("...their account becomes an owner account", '"role":"owner"' in (await page.evaluate("localStorage.getItem('parkease_user')")))
        check("...and they get owner controls on it", await page.get_by_role("button", name="Deactivate").count() == 1)
        await page.goto(U + "/dashboard", wait_until="networkidle"); await page.wait_for_timeout(1000)
        check("...and the My listings tab", await page.get_by_role("tab", name="My listings").count() == 1)

        # ------------------------------------------------------------ admin
        await demo(page, "Admin Vikram")
        links = await page.get_by_role("navigation").inner_text()
        check("admin menu has Analytics and Admin", "Analytics" in links and "Admin" in links)
        await page.goto(U + "/dashboard", wait_until="networkidle"); await page.wait_for_timeout(1200)
        check("admin dashboard opens on the platform overview", await page.get_by_text("Revenue by City").count() == 1 and await page.get_by_text("Top Performing Spots").count() == 1)
        await page.goto(U + "/admin", wait_until="networkidle"); await page.wait_for_timeout(1200)
        check("admin console lists users", await page.get_by_text("Users and roles").count() == 1 and await page.get_by_text("Tara Tester").count() == 1)
        await page.get_by_role("combobox", name="Role of Tara Tester").click()
        await page.get_by_role("option", name="driver").click()
        await page.get_by_text("Role updated", exact=True).first.wait_for(timeout=8000)
        check("admin changes a user's role", True)
        check("admin cannot change their own role", await page.get_by_role("combobox", name="Role of Vikram Nair").is_disabled())
        await page.get_by_role("tab", name="Listings").click(); await page.wait_for_timeout(800)
        row = page.get_by_role("row").filter(has_text="Tara's Test Driveway")
        await row.get_by_role("button", name="Deactivate").click()
        await page.get_by_text("Listing deactivated", exact=True).first.wait_for(timeout=8000)
        check("admin deactivates any listing", await row.get_by_text("Deactivated").count() == 1)
        await page.screenshot(path=f"{OUT}/admin_console.png", full_page=True)
        page.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await row.get_by_role("button", name="Delete Tara's Test Driveway").click()
        await page.get_by_text("Listing deleted", exact=True).first.wait_for(timeout=8000)
        check("admin deletes any listing", True)
        await page.goto(own_spot, wait_until="networkidle"); await page.wait_for_timeout(800)
        check("admin sees owner controls on any spot", await page.get_by_role("button", name="Deactivate").count() == 1)

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
