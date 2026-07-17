from __future__ import annotations

import os

import uvicorn


def main() -> None:
    uvicorn.run(
        "cratedigger_api.app:app",
        host="127.0.0.1",
        port=int(os.environ.get("CRATEDIGGER_PORT", "8000")),
        log_level=os.environ.get("CRATEDIGGER_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()

