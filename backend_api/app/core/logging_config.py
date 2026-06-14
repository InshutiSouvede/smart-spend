import logging
import sys

from app.core.config import settings


def configure_logging() -> None:
    """Configure structured console logging for the application."""
    level = logging.DEBUG if settings.app_env == "development" else logging.INFO
    fmt = "%(asctime)s [%(levelname)-8s] %(name)s: %(message)s"
    datefmt = "%Y-%m-%dT%H:%M:%S"

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(fmt=fmt, datefmt=datefmt))

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    # Suppress noisy access logs and multipart debug in non-dev environments
    if settings.app_env != "development":
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
        logging.getLogger("multipart").setLevel(logging.WARNING)
