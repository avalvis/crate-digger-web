from __future__ import annotations

import asyncio
import dataclasses
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


def _json_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if dataclasses.is_dataclass(value):
        return {k: _json_value(v) for k, v in dataclasses.asdict(value).items()}
    if isinstance(value, dict):
        return {str(k): _json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(v) for v in value]
    return value


class EventHub:
    """Fan core worker-thread events out to async WebSocket clients."""

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    def bind(self) -> None:
        self._loop = asyncio.get_running_loop()

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=128)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: Any) -> None:
        payload = _json_value(event)
        if not isinstance(payload, dict):
            payload = {"type": "message", "message": str(payload)}
        payload.setdefault(
            "timestamp", datetime.now(timezone.utc).isoformat(timespec="seconds")
        )
        loop = self._loop
        if loop and loop.is_running():
            loop.call_soon_threadsafe(self._deliver, payload)

    def _deliver(self, payload: dict[str, Any]) -> None:
        for queue in tuple(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(payload)

