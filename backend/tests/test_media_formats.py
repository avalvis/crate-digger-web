from __future__ import annotations

import io
import wave
import time
from types import SimpleNamespace
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

from core.metadata import MetadataWriter, TrackTags
from core.pipeline import IngestionPipeline, PipelineError
from core.preview_prefetch import PrefetchState, PreviewPrefetchService


def audio_fixture(path: Path) -> Path:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(44100)
        handle.writeframes(b"\x00\x00\x00\x00" * 4410)
    return path


def cover_fixture() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), "#f4df00").save(buffer, "JPEG")
    return buffer.getvalue()


def converter() -> IngestionPipeline:
    pipeline = IngestionPipeline.__new__(IngestionPipeline)
    pipeline._ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    return pipeline


def test_mp3_and_wav_outputs_round_trip_producer_metadata(tmp_path: Path) -> None:
    source = audio_fixture(tmp_path / "source.wav")
    pipeline = converter()
    writer = MetadataWriter()
    tags = TrackTags(
        title="Basement Gem", artist="Test Pressing", album="Dusty Reels",
        genre="Funk / Soul", year=1974, bpm=92.0, musical_key="Am",
        camelot_key="8A", source_url="https://example.com/gem",
        artwork_jpeg=cover_fixture(),
    )

    mp3 = pipeline._prepare_output_format(source, "mp3", tmp_path, None)
    writer.apply(mp3, tags)
    mp3_tags = writer.read(mp3)
    assert mp3.suffix == ".mp3"
    assert 300_000 <= int(mp3_tags["bitrate_bps"]) <= 330_000
    assert mp3_tags["title"] == "Basement Gem"
    assert mp3_tags["camelot_key"] == "8A"
    assert int(mp3_tags["artwork_bytes"]) > 100

    # Use a separate staging folder because the converter intentionally has
    # one deterministic atomic target per ingestion job.
    wav_stage = tmp_path / "wav-job"
    wav_stage.mkdir()
    wav = pipeline._prepare_output_format(source, "wav", wav_stage, None)
    writer.apply(wav, tags)
    wav_tags = writer.read(wav)
    assert wav.suffix == ".wav"
    assert wav_tags["sample_rate_hz"] == 44100
    assert wav_tags["title"] == "Basement Gem"
    assert wav_tags["musical_key"] == "Am"
    assert int(wav_tags["artwork_bytes"]) > 100


def test_failed_transcode_leaves_no_partial_output(tmp_path: Path) -> None:
    source = audio_fixture(tmp_path / "source.wav")
    pipeline = converter()
    pipeline._ffmpeg = str(tmp_path / "missing-ffmpeg")

    try:
        pipeline._prepare_output_format(source, "mp3", tmp_path, None)
    except PipelineError:
        pass
    else:
        raise AssertionError("missing FFmpeg should fail conversion")

    assert not list(tmp_path.glob("*.partial.*"))


class FakePreview:
    def __init__(self) -> None:
        self.order: list[str] = []

    def normalize_video_id(self, value: str) -> str:
        return value

    def get_quick_cached_path(self, _value: str):
        return None

    def get_cached_path(self, _value: str):
        return None

    def warm_cache(self, value: str, **_kwargs):
        self.order.append(value)
        if value == "bad":
            raise RuntimeError("unavailable")
        return Path(value)

    def fetch_quick(self, value: str, **_kwargs):
        return SimpleNamespace(video_id=value)


def test_preview_prefetch_is_sequential_and_continues_after_failure() -> None:
    preview = FakePreview()
    service = PreviewPrefetchService(preview, max_workers=1, keep_decoded=True)
    service.start()
    try:
        service.enqueue_batch(["first", "bad", "third"])
        deadline = time.monotonic() + 3
        while not service.is_batch_idle() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert preview.order == ["first", "bad", "third"]
        assert service.get_state("first") is PrefetchState.READY
        assert service.get_state("bad") is PrefetchState.FAILED
        assert service.get_state("third") is PrefetchState.READY
    finally:
        service.shutdown()
