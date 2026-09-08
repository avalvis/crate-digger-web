from __future__ import annotations

import sys
from pathlib import Path
import pytest

BACKEND_ROOT = Path(__file__).parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture(autouse=True)
def no_background_tool_network(monkeypatch):
    # API tests stay offline; tool-manager tests exercise _check explicitly.
    from core.tool_manager import ToolManager
    monkeypatch.setattr(ToolManager, "start_check", lambda self: self.snapshot())
