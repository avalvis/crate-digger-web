from __future__ import annotations

import os
import shutil
from pathlib import Path

import imageio_ffmpeg

from utils.ffmpeg_setup import probe_ffmpeg, provision_ffmpeg


def test_bundled_ffmpeg_gets_canonical_private_name_and_runtime_path(
    tmp_path: Path,
    monkeypatch,
) -> None:
    # Reproduce a clean friend's PC: no system ffmpeg can be discovered.
    monkeypatch.setenv("PATH", "")

    result = provision_ffmpeg(tools_dir=tmp_path / "tools")

    expected_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    assert Path(result.ffmpeg_path).name == expected_name
    assert Path(result.ffmpeg_path).is_file()
    assert Path(result.ffmpeg_path).stat().st_size == Path(
        imageio_ffmpeg.get_ffmpeg_exe(),
    ).stat().st_size
    assert probe_ffmpeg(result.ffmpeg_path)
    assert Path(shutil.which("ffmpeg") or "").resolve() == Path(result.ffmpeg_path).resolve()

    # yt-dlp's partial-range downloader performs this PATH-only probe.
    from yt_dlp.downloader.external import FFmpegFD

    assert FFmpegFD.available()


def test_private_ffmpeg_is_reused_without_recopying(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("PATH", "")
    first = provision_ffmpeg(tools_dir=tmp_path / "tools")
    first_mtime = Path(first.ffmpeg_path).stat().st_mtime_ns

    second = provision_ffmpeg(tools_dir=tmp_path / "tools")

    assert Path(second.ffmpeg_path).resolve() == Path(first.ffmpeg_path).resolve()
    assert Path(second.ffmpeg_path).stat().st_mtime_ns == first_mtime
