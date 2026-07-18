from __future__ import annotations

import math
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import pytest

from utils.demucs_audio import DEMUCS_SAMPLE_RATE, load_with_ffmpeg, patch_torchaudio_io


def _write_tone(path: Path, duration: float = 0.4) -> None:
    frames = int(DEMUCS_SAMPLE_RATE * duration)
    values = np.array([
        int(math.sin(2 * math.pi * 330 * index / DEMUCS_SAMPLE_RATE) * 12000)
        for index in range(frames)
    ], dtype=np.int16)
    stereo = np.column_stack((values, values)).reshape(-1)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(DEMUCS_SAMPLE_RATE)
        output.writeframes(stereo.tobytes())


@pytest.mark.parametrize("extension,codec", [("mp3", "libmp3lame"), ("m4a", "aac")])
def test_ffmpeg_adapter_loads_packaged_input_formats(
    tmp_path: Path,
    monkeypatch,
    extension: str,
    codec: str,
) -> None:
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    source = tmp_path / "tone.wav"
    encoded = tmp_path / f"tone.{extension}"
    _write_tone(source)
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
         "-c:a", codec, str(encoded)],
        check=True,
    )
    monkeypatch.setenv("FFMPEG_BINARY", ffmpeg)

    waveform, sample_rate = load_with_ffmpeg(encoded)

    assert sample_rate == DEMUCS_SAMPLE_RATE
    assert waveform.ndim == 2
    assert waveform.shape[0] == 2
    assert waveform.shape[1] > 10_000
    assert waveform.isfinite().all()


def test_patch_replaces_torchcodec_dependent_torchaudio_functions() -> None:
    import torchaudio

    original_load, original_save = torchaudio.load, torchaudio.save
    try:
        patch_torchaudio_io()
        assert torchaudio.load is load_with_ffmpeg
        assert torchaudio.save.__module__ == "utils.demucs_audio"
    finally:
        torchaudio.load, torchaudio.save = original_load, original_save
