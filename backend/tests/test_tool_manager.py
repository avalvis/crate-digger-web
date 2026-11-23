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
    monkeypatch.setattr(manager, "_install_group", lambda *_: (_ for _ in ()).throw(ValueError("bad checksum")))
    manager._update()
    assert json.loads((manager.root / "active.json").read_text()) == old
    assert not manager.snapshot()["restart_required"]
    assert manager.snapshot()["state"] == "error"


def test_verified_update_activates_only_after_restart_and_can_rollback(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    manager._set(tools=[item()])
    monkeypatch.setattr(managed_tools, "active_release", lambda: None)
    monkeypatch.setattr(manager, "_install_group", lambda *_: [])
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
    monkeypatch.setattr(tm, "json_from", lambda _: {"info": {"name": "yt-dlp", "version": "1.0", "requires_dist": ["missing-dependency>=99"]}})
    monkeypatch.setattr(tm, "installed_version", lambda _: None)
    with pytest.raises(ValueError, match="newer app build"):
        manager._resolve_group("yt-dlp")


def test_version_comparison_accepts_ffmpeg_build_suffix():
    assert tm.newer("9.0.1", "8.0-essentials_build-www.gyan.dev")
    assert not tm.newer("24.15.0", "v24.15.0")


def wheel(name, version):
    return {"filename": f"{name.replace('-', '_')}-{version}-py3-none-any.whl", "url": f"https://files.pythonhosted.org/{name}.whl",
            "digests": {"sha256": "0" * 64}}


def pypi(name, version, requires=(), releases=None, pure=True):
    return {"info": {"name": name, "version": version, "requires_dist": list(requires), "requires_python": ">=3.10"},
            "urls": [wheel(name, version)] if pure else [{"filename": f"{name}-{version}-cp314-win_amd64.whl", "url": "x", "digests": {}}],
            "releases": {v: [{}] for v in (releases or [version])}}


def fake_index(monkeypatch, packages, installed):
    def json_from(url):
        parts = url.removeprefix("https://pypi.org/pypi/").strip("/").split("/")
        return packages[parts[0]] if len(parts) == 2 else packages[f"{parts[0]}=={parts[1]}"]
    monkeypatch.setattr(tm, "json_from", json_from)
    monkeypatch.setattr(tm, "installed_version", lambda name: installed.get(name))


YT_DLP_REQUIRES = [
    'certifi>=2026.10.19; extra == "default"',
    'brotli; implementation_name == "cpython" and extra == "default"',
    'websockets>=13.0; extra == "default"',
    'yt-dlp-ejs==0.8.0; extra == "default"',
    'deno>=2.9.8; extra == "deno"',
]


def test_outdated_bundled_certifi_is_staged_with_ytdlp(tmp_path, monkeypatch):
    """Regression: yt-dlp 2026.10.26 requires certifi newer than the bundled copy."""
    fake_index(monkeypatch, {
        "yt-dlp": pypi("yt-dlp", "2026.10.26", YT_DLP_REQUIRES),
        "certifi": pypi("certifi", "2026.11.20", releases=["2026.6.17", "2026.11.20", "2027.1.1rc1"]),
        "brotli": pypi("brotli", "1.2.1", pure=False),
    }, {"certifi": "2026.6.17", "websockets": "16.1", "yt-dlp-ejs": "0.8.0", "brotli": "1.2.0"})
    selected, notes = tm.ToolManager(tmp_path)._resolve_group("yt-dlp")
    assert {key: info["info"]["version"] for key, info in selected.items()} == {"yt-dlp": "2026.10.26", "certifi": "2026.11.20"}
    assert notes == []


def test_unstageable_optional_dependency_is_skipped_not_fatal(tmp_path, monkeypatch):
    fake_index(monkeypatch, {
        "yt-dlp": pypi("yt-dlp", "2026.10.26", ['brotli>=9; extra == "default"']),
        "brotli": pypi("brotli", "9.0", pure=False),
    }, {"brotli": "1.2.0"})
    selected, notes = tm.ToolManager(tmp_path)._resolve_group("yt-dlp")
    assert list(selected) == ["yt-dlp"]
    assert "brotli" in notes[0]


def test_essential_solver_without_package_fails_its_group(tmp_path, monkeypatch):
    fake_index(monkeypatch, {
        "yt-dlp": pypi("yt-dlp", "2026.10.26", ['yt-dlp-ejs==0.9.0; extra == "default"']),
        "yt-dlp-ejs": pypi("yt-dlp-ejs", "0.8.0", releases=["0.8.0"]),
    }, {"yt-dlp-ejs": "0.8.0"})
    with pytest.raises(ValueError, match="newer app build"):
        tm.ToolManager(tmp_path)._resolve_group("yt-dlp")


def test_one_failing_group_does_not_block_others(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    manager._set(tools=[item("yt-dlp"), item("ytmusicapi")])
    monkeypatch.setattr(managed_tools, "active_release", lambda: None)

    def install(root, stage):
        if root == "yt-dlp":
            raise ValueError("solver unavailable")
        return []
    monkeypatch.setattr(manager, "_install_group", install)
    monkeypatch.setattr(manager, "_validate_packages", lambda stage: None)
    manager._update()
    result = manager.snapshot()
    assert result["state"] == "ready" and result["restart_required"]
    assert "ytmusicapi" in result["message"]
    statuses = {tool["id"]: tool for tool in result["tools"]}
    assert statuses["yt-dlp"]["status"] == "update_failed"
    assert statuses["yt-dlp"]["detail"] == "solver unavailable"


def test_failed_update_removes_its_stage(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    manager._set(tools=[item()])
    monkeypatch.setattr(managed_tools, "active_release", lambda: None)
    monkeypatch.setattr(manager, "_install_group", lambda *_: [])
    monkeypatch.setattr(manager, "_validate_packages", lambda stage: (_ for _ in ()).throw(ValueError("probe failed")))
    manager._update()
    assert manager.snapshot()["state"] == "error"
    assert list((manager.root / "releases").iterdir()) == []


def test_garbage_collection_keeps_active_and_previous(tmp_path, monkeypatch):
    manager = tm.ToolManager(tmp_path)
    releases = manager.root / "releases"
    names = {key: key * 32 for key in "abcd"}
    for name in names.values():
        (releases / name).mkdir(parents=True)
    (manager.root / "active.json").write_text(json.dumps({"release": names["a"]}))
    (manager.root / "previous.json").write_text(json.dumps({"release": names["b"]}))
    monkeypatch.setattr(managed_tools, "active_release", lambda: releases / names["c"])
    manager.collect_garbage()
    assert sorted(path.name for path in releases.iterdir()) == sorted([names["a"], names["b"], names["c"]])


def test_remove_distribution_uses_record(tmp_path):
    packages = tmp_path / "packages"
    (packages / "certifi").mkdir(parents=True)
    (packages / "certifi/__init__.py").write_text("")
    (packages / "certifi/cacert.pem").write_text("")
    (packages / "certifi/__pycache__").mkdir()
    (packages / "certifi/__pycache__/x.pyc").write_text("")
    dist = packages / "certifi-2026.6.17.dist-info"
    dist.mkdir()
    (dist / "RECORD").write_text("certifi/__init__.py,,\ncertifi/cacert.pem,,\ncertifi-2026.6.17.dist-info/RECORD,,\n../outside.txt,,\n")
    (tmp_path / "outside.txt").write_text("keep")
    (packages / "yt_dlp").mkdir()
    (packages / "yt_dlp/__init__.py").write_text("")
    tm.remove_distribution(packages, "certifi")
    assert not (packages / "certifi").exists() and not dist.exists()
    assert (packages / "yt_dlp/__init__.py").exists()
    assert (tmp_path / "outside.txt").exists()


@pytest.mark.skipif(not __import__("os").environ.get("CRATEDIGGER_LIVE_TESTS"), reason="live PyPI check runs on the CI schedule")
def test_live_tool_updates_still_resolve(tmp_path, monkeypatch):
    """Worst case: every stageable dependency in the app is outdated.

    The resolver must still find an installable plan for each tool group;
    a failure here means upstream added a dependency that needs an app release.
    """
    stageable = set(managed_tools.STAGEABLE_MODULES)
    real = tm.installed_version
    monkeypatch.setattr(tm, "installed_version", lambda name: None if tm.canonical(name) in stageable else real(name))
    for channel in ("stable", "nightly"):
        manager = tm.ToolManager(tmp_path, channel=lambda: channel)
        for root in tm.PACKAGE_GROUPS:
            selected, _ = manager._resolve_group(root)
            assert tm.canonical(root) in selected


def test_nightly_channel_picks_the_newest_dev_build(tmp_path, monkeypatch):
    stable = pypi("yt-dlp", "2026.10.26", releases=["2026.10.26", "2026.11.22.232654.dev0"])
    nightly = pypi("yt-dlp", "2026.11.22.232654.dev0")
    fake_index(monkeypatch, {"yt-dlp": stable, "yt-dlp==2026.11.22.232654.dev0": nightly}, {})
    assert tm.ToolManager(tmp_path)._latest("yt-dlp") == "2026.10.26"
    manager = tm.ToolManager(tmp_path, channel=lambda: "nightly")
    assert manager._latest("yt-dlp") == "2026.11.22.232654.dev0"
    selected, _ = manager._resolve_group("yt-dlp")
    assert selected["yt-dlp"]["info"]["version"] == "2026.11.22.232654.dev0"
    assert tm.newer("2026.11.22.232654.dev0", "2026.10.26")
