"""Shared YouTube runtime options for previews and full downloads."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from typing import Any

from utils.managed_tools import executable


def youtube_options() -> dict[str, Any]:
    # The desktop bundle carries Node so installed apps don't depend on the
    # caller's PATH (which can differ between Explorer and an admin terminal).
    bundled_node = Path(getattr(sys, "_MEIPASS", "")) / "tools" / "node.exe"
    node = executable("node.exe") or (str(bundled_node) if getattr(sys, "frozen", False) and bundled_node.is_file() else shutil.which("node"))
    runtimes: dict[str, dict[str, str]] = {"deno": {}}
    if node:
        runtimes["node"] = {"path": node}
    return {"js_runtimes": runtimes}
