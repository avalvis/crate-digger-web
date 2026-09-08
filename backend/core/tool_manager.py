"""Background health checks and transactional updates for desktop media tools.

Only the three pure-Python discovery/download packages and standalone Windows
media executables are updated independently. Native DSP/ML libraries remain a
tested part of the application bundle.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.metadata
import importlib.util
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse

import requests
from packaging.requirements import Requirement
from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version

from utils import managed_tools
from utils.ffmpeg_setup import provision_ffmpeg, probe_ffmpeg, verify_encoders
from utils.youtube import youtube_options

PACKAGES = {
    "yt-dlp": ("YouTube downloader", "yt_dlp", True),
    "yt-dlp-ejs": ("YouTube challenge solver", "yt_dlp_ejs", True),
    "ytmusicapi": ("Music discovery", "ytmusicapi", True),
    "mutagen": ("Audio tags", "mutagen", False),
    "numpy": ("Audio processing", "numpy", False),
    "scipy": ("Signal processing", "scipy", False),
    "librosa": ("BPM and key analysis", "librosa", False),
    "soundfile": ("Audio file support", "soundfile", False),
    "torch": ("Stem engine", "torch", False),
    "torchaudio": ("Stem audio support", "torchaudio", False),
    "demucs": ("Stem separation", "demucs", False),
}
UPDATABLE_PACKAGES = ("yt-dlp", "yt-dlp-ejs", "ytmusicapi")
ALLOWED_HOSTS = {"pypi.org", "files.pythonhosted.org", "nodejs.org", "www.gyan.dev"}
FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def version_number(value: str | None) -> Version | None:
    if not value:
        return None
    try:
        return Version(value.removeprefix("v"))
    except InvalidVersion:
        match = re.match(r"n?(\d+(?:\.\d+){1,3})", value)
        return Version(match.group(1)) if match else None


def newer(latest: str | None, installed: str | None) -> bool:
    a, b = version_number(latest), version_number(installed)
    return a is not None and (b is None or a > b)


def installed_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        try:
            path = Path(getattr(sys, "_MEIPASS", "")) / "tools" / "bundled-versions.json"
            return json.loads(path.read_text(encoding="utf-8")).get(name.lower().replace("_", "-"))
        except (OSError, ValueError):
            return None


def checked_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS or parsed.username or parsed.password:
        raise ValueError("The update source is not an approved tool publisher.")
    return url


def get_response(url: str, **kwargs: Any) -> requests.Response:
    response = requests.get(checked_url(url), timeout=(5, 20), allow_redirects=False, **kwargs)
    # Resolve only publisher-to-publisher redirects; never follow arbitrary URLs.
    for _ in range(4):
        if not response.is_redirect:
            response.raise_for_status()
            return response
        from urllib.parse import urljoin
        target = checked_url(urljoin(response.url, response.headers["Location"]))
        response.close()
        response = requests.get(target, timeout=(5, 20), allow_redirects=False, **kwargs)
    response.close()
    raise ValueError("Too many redirects from the update source.")


def json_from(url: str) -> Any:
    with get_response(url) as response:
        return response.json()


def text_from(url: str) -> str:
    with get_response(url) as response:
        return response.text.strip()


def download_verified(url: str, target: Path, digest: str, limit: int = 200 * 1024 * 1024) -> None:
    if not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
        raise ValueError("Publisher did not provide a valid SHA-256 checksum.")
    hashed = hashlib.sha256()
    size = 0
    with get_response(url, stream=True) as response, target.open("wb") as output:
        for chunk in response.iter_content(256 * 1024):
            size += len(chunk)
            if size > limit:
                raise ValueError("Tool download exceeded its size limit.")
            hashed.update(chunk)
            output.write(chunk)
    if hashed.hexdigest() != digest.lower():
        raise ValueError("Tool download failed its checksum check. The current tools were kept.")


def extract_checked(archive: Path, target: Path, *, binaries: bool = False) -> None:
    """Extract wheels, or only known executable/license files from binary ZIPs."""
    total = 0
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            relative = PurePosixPath(info.filename.replace("\\", "/"))
            if relative.is_absolute() or ".." in relative.parts or any(":" in part for part in relative.parts):
                raise ValueError("Unsafe path in tool archive.")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Links are not allowed in tool archives.")
            if info.is_dir():
                continue
            total += info.file_size
            if total > 800 * 1024 * 1024:
                raise ValueError("Expanded tool archive is too large.")
            if binaries:
                if relative.name.lower() not in {"ffmpeg.exe", "ffprobe.exe", "node.exe", "license", "license.txt"}:
                    continue
                destination = target / relative.name
            else:
                if len(relative.parts) > 1 and relative.parts[0].endswith(".data") and relative.parts[1] == "data":
                    # Wheel data/share contains shell completions and manuals,
                    # which are not used by the embedded Python downloader.
                    continue
                # Wheels in this updater must be ordinary pure-Python packages.
                if relative.suffix.lower() in {".pth", ".exe", ".dll", ".pyd"} or any(part.endswith(".data") for part in relative.parts):
                    raise ValueError("This package needs a full application update.")
                destination = target.joinpath(*relative.parts)
            if not destination.resolve().is_relative_to(target.resolve()):
                raise ValueError("Tool archive escapes its destination.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(info) as source, destination.open("wb") as output:
                shutil.copyfileobj(source, output)


def binary_version(path: str, *args: str) -> str:
    result = subprocess.run([path, *args], capture_output=True, text=True, timeout=15,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise ValueError("The media tool did not pass its startup check.")
    return result.stdout.strip().splitlines()[0]


class ToolManager:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.root = self.data_dir / "media-tools"
        self.log = logging.getLogger("cratedigger.tools")
        self._lock = threading.RLock()
        self._worker: threading.Thread | None = None
        self._closed = False
        self._state: dict[str, Any] = {"state": "idle", "checked_at": None, "message": "Checking media tools on startup…",
                                      "tools": [], "restart_required": False, "can_rollback": False}

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._state)

    def _set(self, **values: Any) -> None:
        with self._lock:
            self._state.update(values)

    def close(self) -> None:
        self._closed = True

    def _start(self, target: Any) -> dict[str, Any]:
        with self._lock:
            if self._worker and self._worker.is_alive():
                return self.snapshot()
            self._worker = threading.Thread(target=target, daemon=True, name="media-tool-check")
            self._worker.start()
            return self.snapshot()

    def start_check(self) -> dict[str, Any]:
        with self._lock:
            if self._state["restart_required"] or (self._worker and self._worker.is_alive()):
                return self.snapshot()
            self._set(state="checking", message="Checking installed tools and latest releases…")
            return self._start(self._check)

    def _local_tools(self) -> list[dict[str, Any]]:
        items = []
        for name, (label, module, updateable) in PACKAGES.items():
            version = installed_version(name)
            try:
                present = importlib.util.find_spec(module) is not None
            except (ImportError, ValueError):
                present = False
            items.append({"id": name, "name": label, "installed_version": version if present else None,
                          "latest_version": None, "status": "ready" if present else "missing",
                          "update_supported": updateable, "optional": name in {"torch", "torchaudio", "demucs"},
                          "detail": "Included with the app" if not updateable else "Installed"})
        for name, label in (("ffmpeg", "FFmpeg / FFprobe"), ("node", "YouTube JavaScript runtime")):
            version, error = None, None
            try:
                if name == "ffmpeg":
                    result = provision_ffmpeg(config_hint=managed_tools.executable("ffmpeg.exe"), tools_dir=self.data_dir / "tools")
                    version = result.version
                else:
                    path = youtube_options()["js_runtimes"].get("node", {}).get("path")
                    if not path:
                        raise ValueError("JavaScript runtime is missing")
                    version = binary_version(path, "--version").removeprefix("v")
                    if version_number(version) is None or version_number(version) < Version("22"):
                        raise ValueError("Node.js 22 or newer is required")
            except Exception as exc:
                error = str(exc)
            items.insert(0, {"id": name, "name": label, "installed_version": version, "latest_version": None,
                             "status": "error" if error else "ready", "optional": False,
                             "update_supported": sys.platform == "win32" and platform.machine().lower() in {"amd64", "x86_64"},
                             "detail": error or "Verified executable"})
        return items

    def _latest(self, name: str) -> str:
        if name == "ffmpeg":
            return text_from(FFMPEG_URL + ".ver")
        if name == "node":
            releases = json_from("https://nodejs.org/dist/index.json")
            # Node LTS is the supported production channel, not experimental/current.
            return next(item["version"].removeprefix("v") for item in releases if item.get("lts") and "win-x64-zip" in item.get("files", []))
        metadata = json_from(f"https://pypi.org/pypi/{name}/json")
        if name == "yt-dlp-ejs":
            downloader = json_from("https://pypi.org/pypi/yt-dlp/json")
            for text in downloader["info"].get("requires_dist") or []:
                requirement = Requirement(text)
                if requirement.name == name:
                    candidates = [version for version in metadata["releases"] if requirement.specifier.contains(version)]
                    if not candidates:
                        raise ValueError("No matching YouTube solver release is available.")
                    return str(max(map(Version, candidates)))
        return metadata["info"]["version"]

    def _check(self) -> None:
        try:
            items = self._local_tools()
            self._set(tools=items)
            def check(item: dict[str, Any]) -> dict[str, Any]:
                try:
                    item["latest_version"] = self._latest(item["id"])
                    if item["status"] == "ready" and newer(item["latest_version"], item["installed_version"]):
                        item["status"] = "update_available"
                        item["detail"] = "Update available" if item["update_supported"] else "Newer release available; updated with the app to preserve compatibility"
                except Exception:
                    item["detail"] += ". Latest release check unavailable; try again when online."
                    item["latest_unavailable"] = True
                return item
            with ThreadPoolExecutor(max_workers=4) as pool:
                items = list(pool.map(check, items))
            missing = any(item["status"] in {"missing", "error"} and not item["optional"] for item in items)
            updates = any(item["status"] == "update_available" and item["update_supported"] for item in items)
            offline = any(item.get("latest_unavailable") for item in items)
            message = ("Some essential tools need attention." if missing else "Media tool updates are available." if updates
                       else "Installed tools checked. Some release checks could not connect." if offline else "Essential media tools are ready and up to date.")
            self._set(state="ready", tools=items, checked_at=utc_now(), message=message,
                      can_rollback=(self.root / "previous.json").exists())
        except Exception as exc:
            self.log.exception("Tool check failed")
            self._set(state="error", message=f"Could not finish tool checks: {exc}")

    def start_update(self) -> dict[str, Any]:
        with self._lock:
            if self._state["state"] in {"checking", "updating"} or self._state["restart_required"] or (self._worker and self._worker.is_alive()):
                return self.snapshot()
            if not self._state["tools"]:
                raise ValueError("Check for tool updates first.")
            self._set(state="updating", message="Downloading and verifying media tools…")
            return self._start(self._update)

    def _write_manifest(self, path: Path, manifest: dict[str, Any]) -> None:
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest), encoding="utf-8")
        os.replace(temporary, path)

    def _install_packages(self, stage: Path) -> None:
        metadata = {name: json_from(f"https://pypi.org/pypi/{name}/json") for name in UPDATABLE_PACKAGES}
        # The solver must match the downloader's declared dependency, which may
        # differ from the solver's newest independent release.
        for text in metadata["yt-dlp"]["info"].get("requires_dist") or []:
            requirement = Requirement(text)
            if requirement.name == "yt-dlp-ejs" and not requirement.specifier.contains(metadata["yt-dlp-ejs"]["info"]["version"]):
                candidates = [v for v in metadata["yt-dlp-ejs"]["releases"] if requirement.specifier.contains(v)]
                if not candidates:
                    raise ValueError("No compatible YouTube challenge solver is available.")
                version = str(max(map(Version, candidates)))
                metadata["yt-dlp-ejs"] = json_from(f"https://pypi.org/pypi/yt-dlp-ejs/{version}/json")
        selected = {name: info["info"]["version"] for name, info in metadata.items()}
        for name, info in metadata.items():
            requires_python = info["info"].get("requires_python")
            if requires_python and not SpecifierSet(requires_python).contains(platform.python_version()):
                raise ValueError(f"The latest {name} needs a newer application Python runtime. Current tools were kept.")
            for text in info["info"].get("requires_dist") or []:
                dependency = Requirement(text)
                if dependency.marker and not any(dependency.marker.evaluate({"extra": extra}) for extra in ("", "default")):
                    continue
                version = selected.get(dependency.name) or installed_version(dependency.name)
                if not version or not dependency.specifier.contains(version, prereleases=True):
                    raise ValueError(f"Updating {name} requires a compatible {dependency.name}. Install a newer app build first.")
            wheel = next((file for file in info["urls"] if file["filename"].endswith("-py3-none-any.whl") and not file.get("yanked")), None)
            if wheel is None:
                raise ValueError(f"No compatible {name} package is available.")
            archive = stage / f"{name}.whl"
            download_verified(wheel["url"], archive, wheel["digests"]["sha256"], 25 * 1024 * 1024)
            extract_checked(archive, stage / "packages")
            archive.unlink()

    def _install_binary(self, name: str, stage: Path) -> None:
        if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
            raise ValueError("Standalone tool updates currently support Windows x64.")
        if name == "ffmpeg":
            url = FFMPEG_URL
            digest = text_from(url + ".sha256").split()[0]
        else:
            version = self._latest("node")
            filename = f"node-v{version}-win-x64.zip"
            base = f"https://nodejs.org/dist/v{version}/"
            sums = text_from(base + "SHASUMS256.txt")
            digest = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == filename)
            url = base + filename
        archive = stage / f"{name}.zip"
        download_verified(url, archive, digest)
        extract_checked(archive, stage / "bin", binaries=True)
        archive.unlink()
        if name == "ffmpeg":
            path = str(stage / "bin" / "ffmpeg.exe")
            if not probe_ffmpeg(path) or not verify_encoders(path)[0]:
                raise ValueError("Updated FFmpeg is missing required audio encoders.")
            binary_version(str(stage / "bin" / "ffprobe.exe"), "-version")
        else:
            binary_version(str(stage / "bin" / "node.exe"), "--version")

    def _validate_packages(self, stage: Path) -> None:
        if getattr(sys, "frozen", False):
            command = [sys.executable, "--internal-tools-probe", str(stage)]
        else:
            command = [sys.executable, str(Path(__file__).parents[1] / "sidecar_entry.py"), "--internal-tools-probe", str(stage)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=90,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            self.log.error("Staged tools probe failed: %s", result.stderr[-3000:])
            raise ValueError("The updated tools did not pass validation. Current tools were kept.")

    def _update(self) -> None:
        stage = None
        try:
            items = self.snapshot()["tools"]
            needed = {item["id"] for item in items if item["update_supported"] and item["status"] in {"missing", "error", "update_available"}}
            if not needed:
                self._set(state="ready", message="No independently updatable tools need an update.")
                return
            name = uuid.uuid4().hex
            stage = self.root / "releases" / name
            stage.mkdir(parents=True)
            active = managed_tools.active_release()
            if active:
                shutil.copytree(active, stage, dirs_exist_ok=True)
            if needed.intersection(UPDATABLE_PACKAGES):
                packages = stage / "packages"
                if packages.exists():
                    if not packages.resolve().is_relative_to((self.root / "releases").resolve()):
                        raise ValueError("Invalid staging path")
                    shutil.rmtree(packages)
                self._install_packages(stage)
            for binary in ("ffmpeg", "node"):
                if binary in needed:
                    self._set(message=f"Downloading and verifying {binary}…")
                    self._install_binary(binary, stage)
            self._set(message="Testing the downloaded tools…")
            self._validate_packages(stage)
            if self._closed:
                return
            old = {"release": None}
            active_file = self.root / "active.json"
            if active_file.exists():
                old = json.loads(active_file.read_text(encoding="utf-8"))
            self._write_manifest(self.root / "previous.json", old)
            self._write_manifest(active_file, {"release": name, "installed_at": utc_now()})
            self._set(state="ready", restart_required=True, can_rollback=True,
                      message="Tools downloaded and verified. Close and reopen Crate Digger to use them.")
        except Exception as exc:
            self.log.exception("Media tool update failed")
            self._set(state="error", message=str(exc))
        # Immutable release folders are retained for rollback. Failed stages
        # are never referenced by active.json and cannot replace working tools.

    def rollback(self) -> dict[str, Any]:
        with self._lock:
            if self._state["state"] in {"checking", "updating"}:
                raise ValueError("Wait for the current tool operation to finish.")
            previous = self.root / "previous.json"
            if not previous.exists():
                raise ValueError("No previous tool release is available.")
            manifest = json.loads(previous.read_text(encoding="utf-8"))
            if manifest.get("release") is not None and managed_tools.release_from_manifest(self.root, manifest) is None:
                raise ValueError("Previous tool release is missing.")
            self._write_manifest(self.root / "active.json", manifest)
            self._set(state="ready", restart_required=True, message="Previous tools selected. Close and reopen Crate Digger to use them.")
            return self.snapshot()
