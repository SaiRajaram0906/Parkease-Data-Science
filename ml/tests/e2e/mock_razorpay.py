"""A tiny stand-in for the Razorpay REST API, for automated tests only."""
import base64, json, sys, time, secrets
from http.server import BaseHTTPRequestHandler, HTTPServer

KEY = sys.argv[1]; SECRET = sys.argv[2]; PORT = int(sys.argv[3])
LOG = []
FAILED_ONCE = set()

class H(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self, *a): pass
    def do_GET(self):
        if self.path == "/_log": return self._send(200, LOG)
        self._send(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        auth = self.headers.get("Authorization", "")
        ok = auth == "Basic " + base64.b64encode(f"{KEY}:{SECRET}".encode()).decode()
        LOG.append({"path": self.path, "body": body, "auth_ok": ok})
        if not ok:
            return self._send(401, {"error": {"code": "BAD_REQUEST_ERROR", "description": "Authentication failed"}})
        if self.path == "/v1/orders":
            return self._send(200, {"id": "order_" + secrets.token_hex(7), "entity": "order", "amount": body["amount"],
                                    "currency": body["currency"], "receipt": body.get("receipt"), "status": "created"})
        if self.path.startswith("/v1/payments/") and self.path.endswith("/refund"):
            pid = self.path.split("/")[3]
            if pid.startswith("pay_FAIL") and pid not in FAILED_ONCE:
                FAILED_ONCE.add(pid)
                return self._send(400, {"error": {"code": "BAD_REQUEST_ERROR", "description": "The payment has not been captured yet"}})
            return self._send(200, {"id": "rfnd_" + secrets.token_hex(7), "entity": "refund", "payment_id": pid,
                                    "amount": body.get("amount", 0), "status": "processed", "created_at": int(time.time())})
        self._send(404, {"error": {"description": "not found"}})

HTTPServer(("127.0.0.1", PORT), H).serve_forever()
