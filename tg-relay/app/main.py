from __future__ import annotations

from .config import Settings
from .http_server import serve_forever


def main() -> None:
    settings = Settings.load()
    serve_forever(settings)


if __name__ == "__main__":
    main()
