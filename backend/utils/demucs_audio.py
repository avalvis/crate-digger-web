"""Reliable audio I/O adapters for Demucs in the packaged sidecar.

Torchaudio 2.11 delegates ``load`` and ``save`` to optional TorchCodec.
Demucs also tries an FFmpeg/FFprobe loader first, but imageio-ffmpeg ships
FFmpeg without FFprobe.  The desktop build therefore patches Torchaudio before
Demucs imports it: decoding is performed by our bundled FFmpeg executable and
stem WAV files are written with SoundFile.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


DEMUCS_SAMPLE_RATE = 44_100
DEMUCS_CHANNELS = 2


def load_with_ffmpeg(
    uri: Any,
    frame_offset: int = 0,
    num_frames: int = -1,
    normalize: bool = True,
    channels_first: bool = True,
    format: str | None = None,
    buffer_size: int = 4096,
    backend: str | None = None,
):
    """Implement the Torchaudio load contract using bundled FFmpeg only."""
    del normalize, format, buffer_size, backend
    import numpy as np
    import torch

    ffmpeg = os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("Crate Digger's bundled FFmpeg is unavailable.")

    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-i", str(Path(uri)),
        "-map", "0:a:0",
        "-vn",
        "-threads", "1",
        "-f", "f32le",
        "-acodec", "pcm_f32le",
        "-ar", str(DEMUCS_SAMPLE_RATE),
        "-ac", str(DEMUCS_CHANNELS),
        "pipe:1",
    ]
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        **_subprocess_platform_kwargs(),
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(
            f"Bundled FFmpeg could not decode {uri}: {detail[-1200:]}"
        )

    samples = np.frombuffer(completed.stdout, dtype=np.float32)
    usable = samples.size - (samples.size % DEMUCS_CHANNELS)
    if usable <= 0:
        raise RuntimeError(f"Bundled FFmpeg decoded no audio from {uri}.")
    audio = samples[:usable].reshape(-1, DEMUCS_CHANNELS)
    start = max(0, int(frame_offset))
    end = None if int(num_frames) < 0 else start + max(0, int(num_frames))
    audio = audio[start:end]
    # frombuffer points at immutable subprocess bytes; copy before Torch wraps it.
    tensor = torch.from_numpy(audio.copy())
    if channels_first:
        tensor = tensor.t().contiguous()
    return tensor, DEMUCS_SAMPLE_RATE


def save_with_soundfile(
    uri: Any,
    src: Any,
    sample_rate: int,
    channels_first: bool = True,
    format: str | None = None,
    encoding: str | None = None,
    bits_per_sample: int | None = None,
    compression: Any = None,
    backend: str | None = None,
) -> None:
    """Implement the Torchaudio save contract without TorchCodec."""
    del format, encoding, bits_per_sample, compression, backend
    import soundfile as sf

    waveform = src.detach().cpu().numpy()
    if channels_first:
        waveform = waveform.T
    sf.write(str(uri), waveform, sample_rate, subtype="FLOAT")


def patch_torchaudio_io() -> None:
    """Install deterministic packaged audio I/O before Demucs imports it."""
    import torchaudio

    torchaudio.load = load_with_ffmpeg
    torchaudio.save = save_with_soundfile


def _subprocess_platform_kwargs() -> dict[str, int]:
    if sys.platform != "win32":
        return {}
    return {"creationflags": 0x08000000}  # CREATE_NO_WINDOW
