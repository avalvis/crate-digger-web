"""PyInstaller entry point for the Crate Digger desktop sidecar.

The imports in ``_bundle_lazy_engine_modules`` are intentionally visible to
PyInstaller while remaining lazy at runtime.  The API loads the media engine
only when a command needs it, which keeps desktop startup quick.
"""

from __future__ import annotations

import os

import uvicorn

from cratedigger_api.app import app


def _bundle_lazy_engine_modules() -> None:
    """Declare modules imported lazily by ``EngineRuntime`` for PyInstaller."""
    import core.ai_metadata  # noqa: F401
    import core.analyzer  # noqa: F401
    import core.artwork  # noqa: F401
    import core.discovery  # noqa: F401
    import core.downloader  # noqa: F401
    import core.exporter  # noqa: F401
    import core.metadata  # noqa: F401
    import core.pipeline  # noqa: F401
    import core.preview  # noqa: F401
    import core.queue_manager  # noqa: F401
    import core.stems  # noqa: F401
    import utils.ffmpeg_setup  # noqa: F401


def main() -> None:
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("CRATEDIGGER_PORT", "8000")),
        log_level=os.environ.get("CRATEDIGGER_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
