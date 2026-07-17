from __future__ import annotations

import json
from pathlib import Path

from .app import create_app


def main() -> None:
    target = Path(__file__).parents[2] / "frontend" / "openapi.json"
    target.write_text(json.dumps(create_app().openapi(), indent=2), encoding="utf-8")
    print(target)


if __name__ == "__main__":
    main()

