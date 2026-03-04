from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.request import Request, urlopen


@dataclass(frozen=True, slots=True)
class TelegramClient:
    token: str
    chat_id: str

    def send_message(self, text: str) -> bytes:
        if not self.token or not self.chat_id:
            raise RuntimeError("TG_BOT_TOKEN or TG_CHAT_ID is empty")

        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        payload = json.dumps(
            {
                "chat_id": self.chat_id,
                "text": text,
                "disable_web_page_preview": True,
            }
        ).encode("utf-8")

        req = Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urlopen(req, timeout=10) as r:
            return r.read()
