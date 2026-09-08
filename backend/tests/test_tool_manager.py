import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from core import tool_manager as tm
from utils import managed_tools


def item(name="yt-dlp", status="update_available"):
    return {"id": name, "name": name, "status": status, "update_supported": True,
            "installed_version": "2026.7.4", "latest_version": None, "optional": False, "detail": "Installed"}


def test_offline_check_preserves_installed_health(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    monkeypatch.setattr(manager, "_local_tools", lambda: [item(status="ready")])
    monkeypatch.setattr(manager, "_latest", lambda _: (_ for _ in ()).throw(OSError("offline")))
    manager._check()
    result = manager.snapshot()
    assert result["state"] == "ready"
    assert result["tools"][0]["status"] == "ready"
    assert result["tools"][0]["latest_unavailable"]
    assert result["checked_at"]


def test_missing_tool_can_be_repaired_when_latest_is_known(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    monkeypatch.setattr(manager, "_local_tools", lambda: [{**item(status="missing"), "installed_version": None}])
    monkeypatch.setattr(manager, "_latest", lambda _: "2026.8.19")
    manager._check()
    assert manager.snapshot()["tools"][0]["status"] == "missing"
    assert "attention" in manager.snapshot()["message"]


@pytest.mark.parametrize("member", ["../escape.py", "C:/escape.py", "root/../../escape.py", "root\\..\\..\\escape.py"])
def test_archive_cannot_escape_stage(tmp_path, member):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr(member, "bad")
    with pytest.raises(ValueError):
        tm.extract_checked(archive, tmp_path / "stage")
    assert not (tmp_path / "escape.py").exists()


def test_checksum_failure_does_not_accept_download(tmp_path, monkeypatch):
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def iter_content(self, *_): yield b"altered bytes"
    monkeypatch.setattr(tm, "get_response", lambda *args, **kwargs: Response())
    with pytest.raises(ValueError, match="checksum"):
        tm.download_verified("https://pypi.org/file", tmp_path / "download", hashlib.sha256(b"expected").hexdigest())


def test_wheel_keeps_python_package_and_skips_shell_completions(tmp_path):
    archive = tmp_path / "package.whl"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("yt_dlp/__init__.py", "value = 1")
        bundle.writestr("yt_dlp-1.data/data/share/man/man1/yt-dlp.1", "manual")
    tm.extract_checked(archive, tmp_path / "packages")
    assert (tmp_path / "packages/yt_dlp/__init__.py").exists()
    assert not (tmp_path / "packages/yt_dlp-1.data").exists()


def test_failed_update_keeps_active_release(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    manager.root.mkdir()
    old = {"release": "a" * 32}
    (manager.root / "active.json").write_text(json.dumps(old))
    manager._set(tools=[item()])
    monkeypatch.setattr(managed_tools, "active_release", lambda: None)
    monkeypatch.setattr(manager, "_install_packages", lambda _: (_ for _ in ()).throw(ValueError("bad checksum")))
    manager._update()
    assert json.loads((manager.root / "active.json").read_text()) == old
    assert not manager.snapshot()["restart_required"]
    assert manager.snapshot()["state"] == "error"


def test_verified_update_activates_only_after_restart_and_can_rollback(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    manager._set(tools=[item()])
    monkeypatch.setattr(managed_tools, "active_release", lambda: None)
    monkeypatch.setattr(manager, "_install_packages", lambda _: None)
    validated = []
    monkeypatch.setattr(manager, "_validate_packages", lambda stage: validated.append(stage))
    manager._update()
    assert validated
    assert manager.snapshot()["restart_required"]
    assert managed_tools.active_release() is None
    assert managed_tools.release_from_manifest(manager.root, json.loads((manager.root / "active.json").read_text())) == validated[0]
    manager.rollback()
    assert json.loads((manager.root / "active.json").read_text())["release"] is None


def test_manifest_rejects_paths_outside_releases(tmp_path):
    assert managed_tools.release_from_manifest(tmp_path, {"release": "../../elsewhere"}) is None
    assert managed_tools.release_from_manifest(tmp_path, {"release": None}) is None


def test_updates_reject_unknown_publishers():
    for url in ["http://pypi.org/file", "https://evil.example/file", "https://pypi.org.evil.example/file"]:
        with pytest.raises(ValueError): tm.checked_url(url)


def test_incompatible_dependency_keeps_tools(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    monkeypatch.setattr(tm, "json_from", lambda _: {"info": {"version": "1.0", "requires_dist": ["missing-dependency>=99"]}})
    monkeypatch.setattr(tm, "installed_version", lambda _: None)
    with pytest.raises(ValueError, match="newer app build"):
        manager._install_packages(tmp_path)


def test_version_comparison_accepts_ffmpeg_build_suffix():
    assert tm.newer("9.0.1", "8.0-essentials_build-www.gyan.dev")
    assert not tm.newer("24.15.0", "v24.15.0")
