"""Child-process helpers shared by the media engine.

* ``install_kill_on_close_job`` puts the sidecar in a Windows Job Object so
  every child (ffmpeg, demucs, the inner PyInstaller process) is killed by the
  OS when the sidecar exits for any reason, including ``os._exit`` or a crash.
* ``terminate_tree`` stops a child *and its descendants*. In the one-file
  frozen build the direct child is only the PyInstaller bootloader, so killing
  just that process would leave the real worker running.
"""
from __future__ import annotations

import logging
import signal
import subprocess
import sys
from typing import Any

_log = logging.getLogger("cratedigger.proc")
_job_handle: Any = None

CREATE_NO_WINDOW = 0x08000000


def no_window_kwargs() -> dict[str, int]:
    """Popen/run keyword arguments that hide console windows on Windows."""
    return {"creationflags": CREATE_NO_WINDOW} if sys.platform == "win32" else {}


def install_kill_on_close_job() -> bool:
    """Assign this process to a kill-on-close Job Object (Windows only).

    Children inherit job membership, so when the last handle closes at exit
    the OS terminates them all. Returns True when the job is active.
    """
    global _job_handle
    if sys.platform != "win32" or _job_handle is not None:
        return _job_handle is not None
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in (
                "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class BASIC_LIMIT(ctypes.Structure):
            _fields_ = [
                ("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", wintypes.DWORD),
                ("SchedulingClass", wintypes.DWORD),
            ]

        class EXTENDED_LIMIT(ctypes.Structure):
            _fields_ = [
                ("BasicLimitInformation", BASIC_LIMIT),
                ("IoInfo", IO_COUNTERS),
                ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t),
            ]

        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE

        job = kernel32.CreateJobObjectW(None, None)
        if not job:
            raise ctypes.WinError(ctypes.get_last_error())
        info = EXTENDED_LIMIT()
        job_object_limit_kill_on_job_close = 0x2000
        info.BasicLimitInformation.LimitFlags = job_object_limit_kill_on_job_close
        job_object_extended_limit_information = 9
        if not kernel32.SetInformationJobObject(job, job_object_extended_limit_information,
                                                ctypes.byref(info), ctypes.sizeof(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel32.AssignProcessToJobObject(job, kernel32.GetCurrentProcess()):
            raise ctypes.WinError(ctypes.get_last_error())
        # Deliberately never closed: the OS closes it when this process ends.
        _job_handle = job
        return True
    except OSError as exc:
        _log.warning("Could not create a process job; child cleanup relies on cancel handling: %s", exc)
        return False


def terminate_tree(proc: subprocess.Popen, grace: float = 3.0) -> None:
    """Stop ``proc`` and every process it started. Never raises."""
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                           capture_output=True, timeout=15, **no_window_kwargs())
        else:
            proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=grace)
    except (OSError, subprocess.SubprocessError):
        try:
            proc.kill()
            proc.wait(timeout=2.0)
        except (OSError, subprocess.SubprocessError):
            pass


def wait_or_kill(proc: subprocess.Popen, timeout: float) -> int:
    """Wait for ``proc``; kill its tree and raise TimeoutExpired if it hangs."""
    try:
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        terminate_tree(proc)
        raise
