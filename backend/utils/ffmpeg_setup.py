"""
utils/ffmpeg_setup.py
──────────────────────────────────────────────────────────────────────
Crate Digger — Zero-Friction ffmpeg Provisioning

Resolves a working ffmpeg binary path at app startup. Strategy:

    1. Check config.json for a user-pinned ffmpeg path. If present
       and executable, use it.
    2. Check the system PATH. Fast common case on most dev machines.
    3. Fall back to `imageio-ffmpeg`, which bundles a static binary
       per-platform and exposes it via `get_ffmpeg_exe()`. For the
       desktop app it is copied once to the isolated application-data
       tools directory under the canonical `ffmpeg(.exe)` name.

Never asks the user for permission. Never requires PATH editing.
Never blocks the UI — callers invoke `provision_ffmpeg()` from the
bootstrap phase (before the Tk mainloop starts) via a brief
progress callback so the splash screen can show "Preparing ffmpeg…".

The companion `probe_ffmpeg(path)` function verifies that a given
binary actually runs and supports the codecs we need — pcm_s16le
for the exporter, aac for the downloader's fallback postprocessor.
If the probe fails on a user-pinned path, we log and try the next
strategy rather than fail outright.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional


# ─── Public types ────────────────────────────────────────────────────

@dataclass(slots=True, frozen=True)
class FFmpegBinaries:
    """
    Resolved paths to ffmpeg + ffprobe. `ffprobe_path` may be None on
    exotic installations; modules that need it fall back gracefully.
    """
    ffmpeg_path: str
    ffprobe_path: Optional[str]
    source: str              # 'config' | 'system_path' | 'imageio_bundle'
    version: Optional[str]   # parsed from `ffmpeg -version`


class FFmpegProvisioningError(Exception):
    """Could not locate or bootstrap a working ffmpeg binary."""


# Supported codecs we verify are built into whatever binary we use.
# pcm_s16le is required by the MPC exporter; aac is required by the
# downloader's fallback postprocessor for non-AAC YouTube sources.
_REQUIRED_ENCODERS = ("pcm_s16le", "aac")


# ─── Public API ──────────────────────────────────────────────────────

def provision_ffmpeg(
    *,
    config_hint: Optional[str] = None,
    tools_dir: Optional[Path] = None,
    progress_callback: Optional[Callable[[str], None]] = None,
    logger: Optional[logging.Logger] = None,
) -> FFmpegBinaries:
    """
    Locate a working ffmpeg, in the order specified in the module
    docstring. Returns a fully-verified FFmpegBinaries, or raises
    FFmpegProvisioningError on total failure.

    Args:
        config_hint: A user-pinned path from config.json, or None.
        tools_dir: Private application tools directory. When supplied,
            the bundled imageio binary is atomically materialized here as
            `ffmpeg.exe` (Windows) or `ffmpeg` (other platforms). The
            directory is added to this process's PATH because yt-dlp's
            partial-download availability check ignores `ffmpeg_location`.
        progress_callback: Optional (message) callback for splash UI.
            Called at most a few times; messages are short ("Checking
            ffmpeg", "Downloading ffmpeg (first run)", etc.).
        logger: Stdlib logger. Defaults to 'cratedigger.ffmpeg'.

    Never blocks on network unless the imageio fallback fires AND the
    binary isn't already cached — which only happens on first run.
    """
    log = logger or logging.getLogger("cratedigger.ffmpeg")

    _emit(progress_callback, "Checking ffmpeg…")

    # ── Strategy 1: user-pinned path ──
    if config_hint:
        hinted = Path(config_hint).expanduser()
        result = _try_path(str(hinted), "config", log)
        if result is not None:
            log.info("Using ffmpeg from config: %s", result.ffmpeg_path)
            return result
        log.warning(
            "Config-pinned ffmpeg at %s did not verify; trying fallbacks.",
            hinted,
        )

    # ── Strategy 2: system PATH ──
    path_ffmpeg = shutil.which("ffmpeg")
    if path_ffmpeg:
        result = _try_path(path_ffmpeg, "system_path", log)
        if result is not None:
            log.info("Using ffmpeg from PATH: %s", result.ffmpeg_path)
            return result
        log.warning(
            "ffmpeg on PATH at %s did not verify; falling back to bundled.",
            path_ffmpeg,
        )

    # ── Strategy 3: imageio-ffmpeg bundle ──
    _emit(progress_callback, "Preparing bundled ffmpeg (first run)…")
    try:
        bundled_path = _resolve_imageio_ffmpeg(log)
        if tools_dir is not None:
            bundled_path = _materialize_named_ffmpeg(
                bundled_path, Path(tools_dir), log,
            )
    except FFmpegProvisioningError:
        raise
    except Exception as e:
        raise FFmpegProvisioningError(
            f"Could not provision bundled ffmpeg: {e}"
        ) from e

    result = _try_path(bundled_path, "imageio_bundle", log)
    if result is None:
        # A prior application run may have been interrupted while antivirus
        # inspected the executable. Refresh once from the packaged source.
        if tools_dir is not None:
            source_path = _resolve_imageio_ffmpeg(log)
            bundled_path = _materialize_named_ffmpeg(
                source_path, Path(tools_dir), log, force=True,
            )
            result = _try_path(bundled_path, "imageio_bundle", log)
        if result is None:
            raise FFmpegProvisioningError(
                f"Bundled ffmpeg at {bundled_path} failed verification. "
                f"Reinstalling the application may fix this."
            )
    _expose_ffmpeg_to_child_processes(result.ffmpeg_path)
    log.info("Using bundled ffmpeg: %s", result.ffmpeg_path)
    _emit(progress_callback, "ffmpeg ready.")
    return result


def probe_ffmpeg(ffmpeg_path: str, timeout: float = 10.0) -> Optional[str]:
    """
    Run `ffmpeg -version` against a path. Returns the parsed version
    string on success, None on any failure. Never raises — used in
    fallback decision-making where "doesn't work, try next" is fine.
    """
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-version"],
            capture_output=True, text=True, timeout=timeout,
            **_subprocess_platform_kwargs(),
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return None

    if result.returncode != 0:
        return None

    # First line looks like: "ffmpeg version N-118283-g0abc456 Copyright..."
    first_line = (result.stdout or "").splitlines()
    if not first_line:
        return None

    parts = first_line[0].split()
    if len(parts) >= 3 and parts[0] == "ffmpeg" and parts[1] == "version":
        return parts[2]
    # Non-standard build output — still counts as "runs"
    return "unknown"


def verify_encoders(
    ffmpeg_path: str,
    required: tuple[str, ...] = _REQUIRED_ENCODERS,
    timeout: float = 10.0,
) -> tuple[bool, list[str]]:
    """
    Confirm the binary has the encoders we need. Returns
    `(all_present, missing_list)`. Missing encoders are rare in
    modern ffmpeg builds but do occur in stripped-down LGPL-only
    distributions (some Alpine package variants).
    """
    try:
        result = subprocess.run(
            [ffmpeg_path, "-hide_banner", "-encoders"],
            capture_output=True, text=True, timeout=timeout,
            **_subprocess_platform_kwargs(),
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return False, list(required)

    if result.returncode != 0:
        return False, list(required)

    # The -encoders output has a header block then lines like:
    #   " A....D pcm_s16le            PCM signed 16-bit little-endian"
    # Simple substring match is reliable across ffmpeg versions.
    output = (result.stdout or "") + (result.stderr or "")
    missing = [enc for enc in required if f" {enc} " not in output]
    return (len(missing) == 0, missing)


# ─── Internals ──────────────────────────────────────────────────────

def _try_path(
    ffmpeg_path: str, source: str, log: logging.Logger,
) -> Optional[FFmpegBinaries]:
    """Version-check, encoder-check, ffprobe-resolve, assemble result."""
    version = probe_ffmpeg(ffmpeg_path)
    if version is None:
        return None

    all_present, missing = verify_encoders(ffmpeg_path)
    if not all_present:
        log.warning(
            "ffmpeg at %s is missing encoders %s; skipping this source.",
            ffmpeg_path, missing,
        )
        return None

    ffprobe_path = _resolve_ffprobe_next_to(ffmpeg_path)
    return FFmpegBinaries(
        ffmpeg_path=ffmpeg_path,
        ffprobe_path=ffprobe_path,
        source=source,
        version=version,
    )


def _resolve_ffprobe_next_to(ffmpeg_path: str) -> Optional[str]:
    """ffprobe is conventionally shipped as a sibling of ffmpeg."""
    candidate = Path(ffmpeg_path).with_name(
        "ffprobe.exe" if sys.platform == "win32" else "ffprobe"
    )
    if candidate.exists() and os.access(candidate, os.X_OK):
        return str(candidate)
    # imageio-ffmpeg historically doesn't ship ffprobe. Fall back to
    # system PATH; the exporter tolerates ffprobe being None.
    path_probe = shutil.which("ffprobe")
    return path_probe


def _resolve_imageio_ffmpeg(log: logging.Logger) -> str:
    """
    Call into `imageio_ffmpeg.get_ffmpeg_exe()`, which returns a path
    to the static binary included in the platform wheel. PyInstaller also
    collects this binary into the desktop sidecar, so no runtime download
    or system FFmpeg installation is required.
    """
    try:
        import imageio_ffmpeg
    except ImportError as e:
        raise FFmpegProvisioningError(
            "imageio-ffmpeg is not installed. "
            "Add it to requirements.txt or install ffmpeg manually."
        ) from e

    try:
        path = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        # imageio_ffmpeg can raise RuntimeError on network failure
        # during first-run download, or on unsupported platforms.
        raise FFmpegProvisioningError(
            f"imageio-ffmpeg could not provide a binary: {e}"
        ) from e

    if not Path(path).exists():
        raise FFmpegProvisioningError(
            f"imageio-ffmpeg returned non-existent path: {path}"
        )

    # Linux: ensure executable bit is set. imageio-ffmpeg usually
    # handles this, but belt-and-suspenders is cheap.
    if sys.platform != "win32":
        try:
            current_mode = os.stat(path).st_mode
            os.chmod(path, current_mode | 0o111)
        except OSError:
            pass

    return path


def _materialize_named_ffmpeg(
    source: str,
    tools_dir: Path,
    log: logging.Logger,
    *,
    force: bool = False,
) -> str:
    """Copy imageio's versioned executable to an app-private canonical name."""
    source_path = Path(source).resolve()
    tools_dir.mkdir(parents=True, exist_ok=True)
    target = tools_dir / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")

    try:
        if source_path == target.resolve():
            return str(target)
    except OSError:
        pass

    try:
        current = target.stat() if target.exists() else None
        packaged = source_path.stat()
        if not force and current is not None and current.st_size == packaged.st_size:
            _ensure_executable(target)
            return str(target)

        temporary = tools_dir / f".{target.name}.{os.getpid()}.tmp"
        try:
            shutil.copy2(source_path, temporary)
            _ensure_executable(temporary)
            os.replace(temporary, target)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    except OSError as exc:
        raise FFmpegProvisioningError(
            f"Could not prepare private ffmpeg executable in {tools_dir}: {exc}"
        ) from exc

    log.info("Prepared private ffmpeg executable: %s", target)
    return str(target)


def _ensure_executable(path: Path) -> None:
    if sys.platform == "win32":
        return
    try:
        os.chmod(path, path.stat().st_mode | 0o111)
    except OSError:
        pass


def _expose_ffmpeg_to_child_processes(ffmpeg_path: str) -> None:
    """Make bundled FFmpeg discoverable to yt-dlp and spawned media workers."""
    resolved = Path(ffmpeg_path).resolve()
    directory = str(resolved.parent)
    existing = os.environ.get("PATH", "")
    entries = [part for part in existing.split(os.pathsep) if part]
    normalized = os.path.normcase(os.path.normpath(directory))
    if all(os.path.normcase(os.path.normpath(part)) != normalized for part in entries):
        os.environ["PATH"] = directory + (os.pathsep + existing if existing else "")
    os.environ["FFMPEG_BINARY"] = str(resolved)
    os.environ["IMAGEIO_FFMPEG_EXE"] = str(resolved)


def _emit(cb: Optional[Callable[[str], None]], message: str) -> None:
    if cb is not None:
        try:
            cb(message)
        except Exception:
            pass


def _subprocess_platform_kwargs() -> dict:
    """CREATE_NO_WINDOW on Windows so subprocess calls don't flash consoles."""
    if sys.platform != "win32":
        return {}
    CREATE_NO_WINDOW = 0x08000000
    return {"creationflags": CREATE_NO_WINDOW}
