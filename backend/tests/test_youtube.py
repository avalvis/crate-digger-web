from pathlib import Path

from utils import youtube


def test_frozen_downloads_use_bundled_node_without_system_path(tmp_path: Path, monkeypatch):
    node = tmp_path / "tools" / "node.exe"
    node.parent.mkdir()
    node.touch()
    monkeypatch.setattr(youtube.sys, "frozen", True, raising=False)
    monkeypatch.setattr(youtube.sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setenv("PATH", "")
    assert youtube.youtube_options()["js_runtimes"]["node"]["path"] == str(node)


def test_development_downloads_enable_available_node(monkeypatch):
    monkeypatch.setattr(youtube.sys, "frozen", False, raising=False)
    monkeypatch.setattr(youtube.shutil, "which", lambda name: "/usr/bin/node" if name == "node" else None)
    assert youtube.youtube_options()["js_runtimes"]["node"]["path"] == "/usr/bin/node"


def test_deno_remains_available_when_node_is_absent(monkeypatch):
    monkeypatch.setattr(youtube.sys, "frozen", False, raising=False)
    monkeypatch.setattr(youtube.shutil, "which", lambda _: None)
    assert youtube.youtube_options()["js_runtimes"] == {"deno": {}}
