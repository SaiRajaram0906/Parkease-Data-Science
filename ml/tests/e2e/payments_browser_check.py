"""Browser check of the Razorpay booking flow with a stand-in Checkout script."""
import asyncio, re, datetime as dt
from playwright.async_api import async_playwright
U = "http://127.0.0.1:5173"
STUB = """
window.Razorpay = class {
  constructor(o) { this.o = o; this.h = {}; window.__rzpOptions = o; }
  on(e, f) { this.h[e] = f; }
  async open() {
    if (window.__rzpMode === 'dismiss') { setTimeout(() => this.o.modal.ondismiss(), 200); return; }
    const pid = 'pay_UI' + Math.floor(Math.random() * 1e9);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secretPARKEASE123'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(this.o.order_id + '|' + pid));
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    setTimeout(() => this.o.handler({ razorpay_payment_id: pid, razorpay_order_id: this.o.order_id, razorpay_signature: hex }), 200);
  }
};
"""
results = []
def check(n, ok, d=""):
    results.append(bool(ok)); print("PASS" if ok else "FAIL", n, d)

async def book(page, spot_id, mode):
    await page.evaluate(f"window.__rzpMode = '{mode}'")
    await page.goto(U + f"/spots/{spot_id}", wait_until="networkidle"); await page.wait_for_timeout(800)
    await page.evaluate(f"window.__rzpMode = '{mode}'")
    await page.get_by_role("button", name="Book Now").click()
    tomorrow = dt.date.today() + dt.timedelta(days=1)
    dialog = page.get_by_role("dialog")
    await dialog.get_by_role("button").filter(has_text=re.compile(r"\d{4}$")).first.click(); await page.wait_for_timeout(300)
    if tomorrow.month != dt.date.today().month:
        await page.get_by_role("button", name=re.compile("next", re.I)).click()
    await page.locator("[role=gridcell] button:not([disabled]), button[role=gridcell]:not([disabled])").filter(has_text=re.compile(rf"^{tomorrow.day}$")).first.click()
    await page.keyboard.press("Escape"); await page.wait_for_timeout(300)
    await page.locator("#start-time").select_option("9"); await page.locator("#end-time").select_option("11")
    await page.get_by_placeholder("e.g. TN 09 AB 1234").fill("TN09RZ0001")
    await page.get_by_role("button", name="Proceed to Payment").click(); await page.wait_for_timeout(400)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        await ctx.route("**/maps.googleapis.com/**", lambda r: r.abort())
        await ctx.route("https://checkout.razorpay.com/v1/checkout.js", lambda r: r.fulfill(status=200, content_type="application/javascript", body=STUB))
        page = await ctx.new_page()
        await page.goto(U + "/login", wait_until="networkidle")
        await page.get_by_role("button", name="Driver Priya").click(); await page.wait_for_url(U + "/")
        await book(page, 2, "pay")
        check("real payment mode: Razorpay option shown, no demo warning", await page.get_by_text("Pay securely with Razorpay").count() == 1 and await page.get_by_text("Demo payment").count() == 0)
        await page.get_by_role("button", name="Pay ₹80.00").click()
        await page.get_by_text("Booking Confirmed!").wait_for(timeout=15000)
        opts = await page.evaluate("window.__rzpOptions")
        check("Checkout opened with the server's order (8000 paise) and prefilled details", opts["amount"] == 8000 and opts["order_id"].startswith("order_") and opts["prefill"]["email"] == "priya.sharma@gmail.com")
        check("after paying, the booking is confirmed with the paid amount", await page.get_by_text("₹80.00").count() >= 1 and await page.get_by_text("(demo)").count() == 0)
        await page.get_by_role("button", name="Show QR Code").click(); await page.wait_for_url("**/bookings/*"); await page.wait_for_timeout(1000)
        check("booking page shows Paid with the Razorpay payment id", await page.get_by_text("Paid", exact=True).count() == 1 and await page.get_by_text(re.compile(r"^pay_UI")).count() == 1)
        await page.get_by_role("button", name="Cancel Booking").click(); await page.wait_for_timeout(300)
        check("cancel asks first and states the full refund", "full refund of ₹80.00" in await page.get_by_role("alertdialog").inner_text())
        await page.get_by_role("alertdialog").get_by_role("button", name="Cancel booking").click(); await page.wait_for_timeout(1500)
        check("after cancelling, the booking shows Refunded with the refund id", await page.get_by_text("Refunded", exact=True).count() == 1 and await page.get_by_text(re.compile(r"^rfnd_")).count() == 1)
        await book(page, 3, "dismiss")
        await page.get_by_role("button", name="Pay ₹80.00").click()
        await page.get_by_text("Payment cancelled", exact=True).first.wait_for(timeout=15000)
        check("closing Checkout tells the driver nothing was charged and the slot is released", await page.get_by_text("No money was taken and the slot was released", exact=False).count() >= 1)
        await page.screenshot(path="rzp_dismiss.png")
        await b.close()
    print(sum(results), "of", len(results), "passed")
asyncio.run(main())
