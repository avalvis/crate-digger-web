from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
import pytest

BACKEND_ROOT = Path(__file__).parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Never read the developer's real app profile: importing the API activates
# whatever media-tool release is installed there, which would leak updated
# tools (and their paths) into the tests. Set before any app import.
os.environ["CRATEDIGGER_DATA_DIR"] = tempfile.mkdtemp(prefix="cratedigger-tests-")


@pytest.fixture(autouse=True)
def no_active_tool_release(monkeypatch):
    from utils import managed_tools
    monkeypatch.setattr(managed_tools, "_release", None)


@pytest.fixture(autouse=True)
def no_background_tool_network(monkeypatch):
    # API tests stay offline; tool-manager tests exercise _check explicitly.
    from core.tool_manager import ToolManager
    monkeypatch.setattr(ToolManager, "start_check", lambda self: self.snapshot())
