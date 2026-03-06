from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError

from .alert_format import format_alerts_message, parse_payload, truncate_message
from .config import Settings
from .logging_json import log
from .telegram import TelegramClient


def make_handler(settings: Settings, tg: TelegramClient) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))

            if length > settings.max_payload_bytes:
                log("payload_rejected", reason="too_large", length=length, max=settings.max_payload_bytes)
                self.send_response(413)
                self.end_headers()
                self.wfile.write(b"PAYLOAD TOO LARGE\n")
                return

            body = self.rfile.read(length) if length else b"{}"

            payload, alerts = parse_payload(body)
            msg = format_alerts_message(payload, max_alerts=settings.max_alerts)
            msg = truncate_message(msg, settings.max_msg)

            log(
                "webhook_received",
                alerts=len(alerts),
                bytes=len(body),
                msg_len=len(msg),
                dry_run=settings.dry_run,
            )

            try:
                if not settings.dry_run:
                    tg.send_message(msg)
                    log("telegram_sent", ok=True, alerts=len(alerts), msg_len=len(msg))
                else:
                    log("telegram_skipped", reason="dry_run", alerts=len(alerts), msg_len=len(msg))

                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"OK\n")
            except (RuntimeError, URLError, HTTPError) as e:
                log("telegram_sent", ok=False, error=str(e))
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f"ERR {e}\n".encode("utf-8"))

        def do_GET(self) -> None:
            if self.path in ("/healthz", "/health"):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"OK\n")
                return

            if self.path == "/readyz":
                if settings.dry_run:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"READY (dry-run)\n")
                    return

                ok = bool(settings.tg_bot_token and settings.tg_chat_id)
                self.send_response(200 if ok else 503)
                self.end_headers()
                self.wfile.write(b"READY\n" if ok else b"NOT READY: TG creds missing\n")
                return

            if self.path == "/version":
                self.send_response(200)
                self.end_headers()
                self.wfile.write((settings.version + "\n").encode("utf-8"))
                return

            if self.path == "/":
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"tg-relay\n")
                return

            self.send_response(404)
            self.end_headers()

        def log_message(self, fmt: str, *args) -> None:
            return

    return Handler


def serve_forever(settings: Settings) -> None:
    tg = TelegramClient(token=settings.tg_bot_token, chat_id=settings.tg_chat_id)
    handler = make_handler(settings, tg)
    log("server_start", port=settings.port, version=settings.version, dry_run=settings.dry_run)
    ThreadingHTTPServer(("0.0.0.0", settings.port), handler).serve_forever()
