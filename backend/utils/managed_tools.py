"""Activate verified, per-user media-tool releases before importing the engine."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

_release: Path | None = None

# Distribution name -> import name for every pure-Python package the tool
# updater may stage. The staged-tools probe imports each of these.
STAGEABLE_MODULES = {
    "yt-dlp": "yt_dlp",
    "yt-dlp-ejs": "yt_dlp_ejs",
    "ytmusicapi": "ytmusicapi",
    "certifi": "certifi",
    "requests": "requests",
    "urllib3": "urllib3",
    "idna": "idna",
    "charset-normalizer": "charset_normalizer",
    "websockets": "websockets",
    "mutagen": "mutagen",
}


def referenced_releases(root: Path) -> set[str]:
    """Release folder names named by the active or previous manifest."""
    names = set()
    for manifest in ("active.json", "previous.json"):
        try:
            name = json.loads((root / manifest).read_text(encoding="utf-8")).get("release")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(name, str):
            names.add(name)
    return names


def release_from_manifest(root: Path, manifest: dict) -> Path | None:
    name = manifest.get("release", "")
    if not isinstance(name, str) or not re.fullmatch(r"[a-f0-9]{32}", name):
        return None
    path = (root / "releases" / name).resolve()
    if path.parent != (root / "releases").resolve() or not path.is_dir():
        return None
    return path


def activate(data_dir: Path) -> None:
    global _release
    root = Path(data_dir) / "media-tools"
    try:
        manifest = json.loads((root / "active.json").read_text(encoding="utf-8"))
        _release = release_from_manifest(root, manifest)
    except (OSError, ValueError, TypeError):
        _release = None
    if _release is not None:
        packages = _release / "packages"
        if packages.is_dir():
            sys.path.insert(0, str(packages))


def active_release() -> Path | None:
    return _release


def executable(name: str) -> str | None:
    if _release is None:
        return None
    candidate = _release / "bin" / name
    return str(candidate) if candidate.is_file() else None


def default_data_dir() -> Path:
    if os.environ.get("CRATEDIGGER_DATA_DIR"):
        return Path(os.environ["CRATEDIGGER_DATA_DIR"]).expanduser().resolve()
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "com.cratedigger.desktop"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/com.cratedigger.desktop"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "com.cratedigger.desktop"
