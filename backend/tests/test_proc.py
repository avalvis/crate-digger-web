import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

from utils.proc import terminate_tree

BACKEND = Path(__file__).resolve().parents[1]


def _alive(pid: int) -> bool:
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
    return str(pid) in out


@pytest.mark.skipif(sys.platform != "win32", reason="Job Objects are Windows-only")
def test_children_die_when_sidecar_exits_abruptly(tmp_path):
    pid_file = tmp_path / "grandchild.pid"
    script = textwrap.dedent(f"""
        import os, subprocess, sys
        sys.path.insert(0, {str(BACKEND)!r})
        from utils.proc import install_kill_on_close_job
        assert install_kill_on_close_job()
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        open({str(pid_file)!r}, "w").write(str(child.pid))
        os._exit(0)  # the abrupt exit used when the desktop shell goes away
    """)
    subprocess.run([sys.executable, "-c", script], check=True, timeout=30)
    grandchild = int(pid_file.read_text())
    deadline = time.monotonic() + 10
    while _alive(grandchild) and time.monotonic() < deadline:
        time.sleep(0.2)
    assert not _alive(grandchild)


@pytest.mark.skipif(sys.platform != "win32", reason="tree kill is exercised on Windows")
def test_terminate_tree_stops_grandchildren(tmp_path):
    pid_file = tmp_path / "grandchild.pid"
    script = textwrap.dedent(f"""
        import subprocess, sys, time
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        open({str(pid_file)!r}, "w").write(str(child.pid))
        time.sleep(60)
    """)
    proc = subprocess.Popen([sys.executable, "-c", script])
    deadline = time.monotonic() + 15
    while not pid_file.exists() and time.monotonic() < deadline:
        time.sleep(0.1)
    grandchild = int(pid_file.read_text())
    terminate_tree(proc)
    assert proc.poll() is not None
    deadline = time.monotonic() + 10
    while _alive(grandchild) and time.monotonic() < deadline:
        time.sleep(0.2)
    assert not _alive(grandchild)
