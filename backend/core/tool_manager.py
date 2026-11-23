"""Background health checks and transactional updates for desktop media tools.

Only the three pure-Python discovery/download packages and standalone Windows
media executables are updated independently. Native DSP/ML libraries remain a
tested part of the application bundle.
"""
from __future__ import annotations

import copy
import csv
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
from typing import Any, Callable
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
# Packages that move together. A failure in one group never blocks another.
PACKAGE_GROUPS = {"yt-dlp": ("yt-dlp", "yt-dlp-ejs"), "ytmusicapi": ("ytmusicapi",)}
# Pure-Python dependencies that may be staged next to an updated package when
# the copy bundled with the app is too old (for example certifi's CA bundle).
# Native/compiled dependencies are never staged; they ship with app releases.
STAGEABLE_DEPENDENCIES = set(managed_tools.STAGEABLE_MODULES) - set(UPDATABLE_PACKAGES)
# Optional extras that are still required for YouTube to work.
ESSENTIAL_DEPENDENCIES = {"yt-dlp-ejs"}
PURE_WHEEL = re.compile(r"-(?:py3|py2\.py3)-none-any\.whl$")
ALLOWED_HOSTS = {"pypi.org", "files.pythonhosted.org", "nodejs.org", "www.gyan.dev"}
FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"


def canonical(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


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


UPDATE_STATUSES = {"missing", "error", "update_available", "update_failed"}


def dependency_kind(dependency: Requirement) -> str | None:
    """``hard`` for required, ``soft`` for yt-dlp's default extra, else None."""
    if dependency.marker is None or dependency.marker.evaluate({"extra": ""}):
        return "hard"
    if dependency.marker.evaluate({"extra": "default"}):
        return "soft"
    return None


def pure_wheel(info: dict[str, Any]) -> dict[str, Any] | None:
    return next((file for file in info.get("urls", [])
                 if PURE_WHEEL.search(file["filename"]) and not file.get("yanked")), None)


def python_supported(info: dict[str, Any]) -> bool:
    requires_python = info["info"].get("requires_python")
    return not requires_python or SpecifierSet(requires_python).contains(platform.python_version())


def remove_distribution(packages: Path, name: str) -> None:
    """Uninstall a previously staged wheel using its RECORD file."""
    if not packages.is_dir():
        return
    root = packages.resolve()
    for dist_info in list(packages.glob("*.dist-info")):
        if canonical(dist_info.name.removesuffix(".dist-info").rsplit("-", 1)[0]) != name:
            continue
        tops = set()
        record = dist_info / "RECORD"
        if record.is_file():
            for row in csv.reader(record.read_text(encoding="utf-8").splitlines()):
                if not row:
                    continue
                relative = PurePosixPath(row[0])
                target = (packages / Path(*relative.parts)).resolve()
                if not target.is_relative_to(root) or target == root:
                    continue
                tops.add(relative.parts[0])
                if target.is_file():
                    target.unlink()
        shutil.rmtree(dist_info, ignore_errors=True)
        for top in tops:
            folder = packages / top
            if folder.is_dir() and not folder.name.endswith(".dist-info"):
                for cache in list(folder.rglob("__pycache__")):
                    shutil.rmtree(cache, ignore_errors=True)
                for directory in sorted((p for p in [folder, *folder.rglob("*")] if p.is_dir()),
                                        key=lambda p: len(p.parts), reverse=True):
                    try:
                        directory.rmdir()
                    except OSError:
                        pass


def binary_version(path: str, *args: str) -> str:
    result = subprocess.run([path, *args], capture_output=True, text=True, timeout=15,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise ValueError("The media tool did not pass its startup check.")
    return result.stdout.strip().splitlines()[0]


class ToolManager:
    def __init__(self, data_dir: Path, channel: Callable[[], str] = lambda: "stable"):
        self.data_dir = Path(data_dir)
        # "stable" or "nightly"; read on every check so Settings apply at once.
        self._channel = channel
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
        if name == "yt-dlp":
            return self._root_metadata(name)["info"]["version"]
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
            try:
                self.collect_garbage()
            except OSError:
                self.log.warning("Could not remove unused tool releases", exc_info=True)
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

    def nightly(self) -> bool:
        try:
            return self._channel() == "nightly"
        except Exception:
            return False

    def _root_metadata(self, root: str) -> dict[str, Any]:
        """PyPI metadata for the release of ``root`` this channel installs."""
        metadata = json_from(f"https://pypi.org/pypi/{root}/json")
        if root != "yt-dlp" or not self.nightly():
            return metadata
        # yt-dlp publishes nightly builds to PyPI as dev pre-releases.
        versions = []
        for text, files in metadata.get("releases", {}).items():
            try:
                version = Version(text)
            except InvalidVersion:
                continue
            if files and not all(file.get("yanked") for file in files):
                versions.append(version)
        newest = max(versions, default=None)
        if newest is None or str(newest) == metadata["info"]["version"]:
            return metadata
        return json_from(f"https://pypi.org/pypi/{root}/{newest}/json")

    def _release_matching(self, dependency: Requirement) -> dict[str, Any] | None:
        """Newest stable PyPI release of a pure-Python dependency that fits."""
        metadata = json_from(f"https://pypi.org/pypi/{dependency.name}/json")
        versions = []
        for text, files in metadata.get("releases", {}).items():
            try:
                version = Version(text)
            except InvalidVersion:
                continue
            if files and not version.is_prerelease and dependency.specifier.contains(version):
                versions.append(version)
        for version in sorted(versions, reverse=True)[:5]:
            info = metadata if Version(metadata["info"]["version"]) == version else json_from(
                f"https://pypi.org/pypi/{dependency.name}/{version}/json")
            if pure_wheel(info) and python_supported(info):
                return info
        return None

    def _resolve_group(self, root: str) -> tuple[dict[str, dict[str, Any]], list[str]]:
        """Choose every distribution to stage for one package group.

        Dependencies already satisfied by the app are left alone. Unsatisfied
        pure-Python ones are staged too; optional ones that cannot be staged
        keep the bundled copy, which the package treats as a soft feature.
        """
        selected = {canonical(root): self._root_metadata(root)}
        pending = [selected[canonical(root)]]
        notes: list[str] = []
        while pending:
            info = pending.pop()
            owner = info["info"]["name"]
            for text in info["info"].get("requires_dist") or []:
                dependency = Requirement(text)
                kind = dependency_kind(dependency)
                if kind is None:
                    continue
                key = canonical(dependency.name)
                if key in selected:
                    if not dependency.specifier.contains(selected[key]["info"]["version"], prereleases=True):
                        raise ValueError(f"{owner} needs {dependency}, which conflicts with the other tool updates.")
                    continue
                current = installed_version(dependency.name)
                if current and dependency.specifier.contains(current, prereleases=True):
                    continue
                if key in STAGEABLE_DEPENDENCIES or key in UPDATABLE_PACKAGES:
                    found = self._release_matching(dependency)
                    if found is not None:
                        selected[key] = found
                        pending.append(found)
                        continue
                if kind == "hard" or key in ESSENTIAL_DEPENDENCIES:
                    raise ValueError(f"{owner} needs {dependency}, which can only ship with a newer app build. "
                                     "Current tools were kept.")
                notes.append(f"{owner}: optional {dependency.name} support stays at the bundled version.")
        for key, info in selected.items():
            if not python_supported(info):
                raise ValueError(f"The latest {info['info']['name']} needs a newer application Python runtime. "
                                 "Current tools were kept.")
            if pure_wheel(info) is None:
                raise ValueError(f"No compatible {info['info']['name']} package is available.")
        return selected, notes

    def _install_group(self, root: str, stage: Path) -> list[str]:
        """Resolve, download and verify one package group into ``stage``."""
        selected, notes = self._resolve_group(root)
        packages = stage / "packages"
        downloads = stage / "downloads"
        downloads.mkdir(parents=True, exist_ok=True)
        try:
            # Every archive is verified before the stage is modified.
            archives = []
            for key, info in selected.items():
                wheel = pure_wheel(info)
                archive = downloads / f"{key}.whl"
                download_verified(wheel["url"], archive, wheel["digests"]["sha256"], 25 * 1024 * 1024)
                archives.append((key, archive))
            packages.mkdir(exist_ok=True)
            for key, archive in archives:
                remove_distribution(packages, key)
                extract_checked(archive, packages)
        finally:
            shutil.rmtree(downloads, ignore_errors=True)
        staged = ", ".join(f"{info['info']['name']} {info['info']['version']}" for info in selected.values())
        self.log.info("Staged %s", staged)
        return notes

    def collect_garbage(self) -> None:
        """Remove tool releases that are neither active, previous, nor loaded."""
        releases = self.root / "releases"
        if not releases.is_dir():
            return
        keep = managed_tools.referenced_releases(self.root)
        loaded = managed_tools.active_release()
        if loaded is not None:
            keep.add(loaded.name)
        for path in releases.iterdir():
            if path.is_dir() and re.fullmatch(r"[a-f0-9]{32}", path.name) and path.name not in keep:
                shutil.rmtree(path, ignore_errors=True)

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
        activated = False
        failures: dict[str, str] = {}
        try:
            items = self.snapshot()["tools"]
            needed = {item["id"] for item in items if item["update_supported"] and item["status"] in UPDATE_STATUSES}
            if not needed:
                self._set(state="ready", message="No independently updatable tools need an update.")
                return
            name = uuid.uuid4().hex
            stage = self.root / "releases" / name
            stage.mkdir(parents=True)
            active = managed_tools.active_release()
            if active:
                shutil.copytree(active, stage, dirs_exist_ok=True)
            updated: list[str] = []
            notes: list[str] = []
            # Each group and binary is independent: one failure never blocks the rest.
            for root, members in PACKAGE_GROUPS.items():
                if not needed.intersection(members):
                    continue
                self._set(message=f"Downloading and verifying {root}…")
                try:
                    notes += self._install_group(root, stage)
                    updated.append(root)
                except Exception as exc:
                    self.log.warning("Could not update %s: %s", root, exc)
                    failures.update({member: str(exc) for member in members if member in needed})
            for binary in ("ffmpeg", "node"):
                if binary not in needed:
                    continue
                self._set(message=f"Downloading and verifying {binary}…")
                try:
                    self._install_binary(binary, stage)
                    updated.append(binary)
                except Exception as exc:
                    self.log.warning("Could not update %s: %s", binary, exc)
                    failures[binary] = str(exc)
            if not updated:
                raise ValueError(next(iter(failures.values()), "No tools could be updated."))
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
            activated = True
            for note in notes:
                self.log.info(note)
            message = f"Updated {', '.join(updated)}. Close and reopen Crate Digger to use them."
            if failures:
                message += f" {len(failures)} tool(s) could not be updated; see details below."
            self._set(state="ready", restart_required=True, can_rollback=True, message=message,
                      tools=self._mark_failures(failures))
        except Exception as exc:
            self.log.exception("Media tool update failed")
            self._set(state="error", message=f"Update failed: {exc}", tools=self._mark_failures(failures))
        finally:
            # Only the activated release is kept; failed stages are discarded.
            if stage is not None and not activated:
                shutil.rmtree(stage, ignore_errors=True)

    def _mark_failures(self, failures: dict[str, str]) -> list[dict[str, Any]]:
        tools = self.snapshot()["tools"]
        for tool in tools:
            if tool["id"] in failures:
                tool["status"] = "update_failed"
                tool["detail"] = failures[tool["id"]]
        return tools

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
