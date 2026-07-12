"""
Inventory (AMAP) stock lookup — pluggable service layer.

The search route depends only on the ``StockProvider`` interface, so the mock
JSON-backed provider used for the hackathon can be swapped for a real AMAP API
client (HTTP, gRPC, DB) without changing any business logic.

Configure via environment:
    STOCK_SOURCE_PATH   Path to the JSON inventory file
                        (default: <backend>/data/mock_stock.json)

The JSON provider hot-reloads when the file changes on disk, so stock levels
are dynamic at runtime — edit the file and the next request reflects it.
"""

from __future__ import annotations

import json
import os
import threading
from abc import ABC, abstractmethod
from datetime import datetime, timezone


class StockProvider(ABC):
    """Abstract inventory source. Implementations return on-hand quantity."""

    @abstractmethod
    def get_stock(self, part_number: str) -> int:
        """Return the available quantity for a part (0 if unknown)."""

    @property
    def source_name(self) -> str:
        return "inventory"


class JsonFileStockProvider(StockProvider):
    """Reads stock from a JSON map ``{part_number: quantity}``.

    Reloads automatically when the file's modification time changes, keeping
    the last known-good data if a read/parse fails.
    """

    def __init__(self, path: str) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._cache: dict[str, int] = {}
        self._mtime: float | None = None

    def _refresh(self) -> None:
        try:
            mtime = os.path.getmtime(self._path)
        except OSError:
            return  # file missing; keep whatever we have (defaults to empty)
        if mtime == self._mtime:
            return
        with self._lock:
            try:
                with open(self._path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                self._cache = {str(k): int(v) for k, v in data.items()}
                self._mtime = mtime
            except (OSError, ValueError, json.JSONDecodeError):
                # Preserve the previous good cache on a bad read.
                pass

    def get_stock(self, part_number: str) -> int:
        self._refresh()
        return self._cache.get(part_number, 0)

    @property
    def source_name(self) -> str:
        return "AMAP (mock)"


def get_stock_provider() -> StockProvider:
    """Factory: build the configured stock provider."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    default_path = os.path.join(base_dir, "data", "mock_stock.json")
    path = os.getenv("STOCK_SOURCE_PATH", default_path)
    return JsonFileStockProvider(path)


def now_iso() -> str:
    """UTC timestamp for 'stock checked at' freshness display."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
