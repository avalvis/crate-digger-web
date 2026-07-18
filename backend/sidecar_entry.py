"""PyInstaller entry point for the Crate Digger desktop sidecar.

The imports in ``_bundle_lazy_engine_modules`` are intentionally visible to
PyInstaller while remaining lazy at runtime.  The API loads the media engine
only when a command needs it, which keeps desktop startup quick.
"""

from __future__ import annotations

import os
import sys
import threading


def _exit_when_desktop_parent_closes() -> None:
    """Prevent PyInstaller's inner process from surviving the Tauri shell."""
    raw_pid = os.environ.get("CRATEDIGGER_PARENT_PID", "").strip()
    if os.name != "nt" or not raw_pid.isdigit():
        return

    import ctypes
    from ctypes import wintypes

    parent_pid = int(raw_pid)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    synchronize = 0x00100000
    infinite = 0xFFFFFFFF
    handle = kernel32.OpenProcess(synchronize, False, parent_pid)
    if not handle:
        return

    def watch() -> None:
        try:
            kernel32.WaitForSingleObject(handle, infinite)
        finally:
            kernel32.CloseHandle(handle)
        os._exit(0)

    threading.Thread(target=watch, name="desktop-parent-watch", daemon=True).start()


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


def _run_internal_worker() -> bool:
    """Dispatch private subprocess modes used by the frozen media engine."""
    if len(sys.argv) < 2:
        return False

    mode = sys.argv[1]
    if mode == "--internal-runtime-probe":
        import json
        import demucs
        import torch
        import torchaudio

        print(json.dumps({
            "torch": torch.__version__,
            "torchaudio": torchaudio.__version__,
            "demucs": demucs.__version__,
            "python": sys.version.split()[0],
        }))
        return True

    if mode == "--internal-import-probe":
        if len(sys.argv) != 3:
            raise SystemExit("--internal-import-probe requires a module name")
        import importlib

        importlib.import_module(sys.argv[2])
        return True

    if mode == "--internal-demucs":
        from utils.demucs_audio import patch_torchaudio_io

        patch_torchaudio_io()
        sys.argv = ["demucs", *sys.argv[2:]]
        from demucs.__main__ import main as demucs_main

        demucs_main()
        return True

    return False


def main() -> None:
    _exit_when_desktop_parent_closes()
    if _run_internal_worker():
        return

    import uvicorn
    from cratedigger_api.app import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("CRATEDIGGER_PORT", "8000")),
        log_level=os.environ.get("CRATEDIGGER_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
