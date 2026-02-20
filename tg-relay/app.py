import os, json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

TOKEN = os.environ.get("TG_BOT_TOKEN", "")
CHAT_ID = os.environ.get("TG_CHAT_ID", "")

def tg_send(text: str):
    if not TOKEN or not CHAT_ID:
        raise RuntimeError("TG_BOT_TOKEN or TG_CHAT_ID is empty")
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = json.dumps({
        "chat_id": CHAT_ID,
        "text": text,
        "disable_web_page_preview": True
    }).encode("utf-8")
    req = Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=10) as r:
        return r.read()

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body.decode("utf-8"))
        except Exception:
            data = {}

        alerts = data.get("alerts", [])
        if not alerts:
            msg = "Alertmanager: webhook received (no alerts in payload)."
        else:
            lines = []
            for a in alerts[:20]:
                status = a.get("status", "?")
                labels = a.get("labels", {}) or {}
                ann = a.get("annotations", {}) or {}

                name = labels.get("alertname", "unknown")
                sev = labels.get("severity", "n/a")
                inst = labels.get("instance", "n/a")
                inst_name = labels.get("instance_name", "")

                summary = (ann.get("summary") or "").strip()
                descr = (ann.get("description") or "").strip()

                header = f"[{status}] {name} sev={sev} instance={inst}"
                if inst_name:
                    header += f" name={inst_name}"

                block = header
                if summary:
                    block += "\n" + summary
                if descr and descr != summary:
                    block += "\n" + descr

                lines.append(block.strip())

            msg = "\n\n---\n\n".join(lines)

        print(f"webhook alerts={len(alerts)}", flush=True)

        try:
            tg_send(msg)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK\n")
        except (RuntimeError, URLError, HTTPError) as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f"ERR {e}\n".encode("utf-8"))

    def log_message(self, fmt, *args):
        return

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()
