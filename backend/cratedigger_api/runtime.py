from __future__ import annotations

import dataclasses
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Any

from core.database import RecordNotFoundError, TrackFilter, VaultDatabase
from utils.config import ConfigManager

from .events import EventHub


APP_VERSION = "0.1.1"


class RuntimeUnavailable(RuntimeError):
    pass


def default_data_dir() -> Path:
    override = os.environ.get("CRATEDIGGER_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        return base / "CrateDigger"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "CrateDigger"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "CrateDigger"


DEMO_SUGGESTIONS: tuple[dict[str, Any], ...] = (
    {
        "discogs_master_id": -101,
        "artist": "Maher Shalal Hash Baz",
        "title": "C'est La Dernière Chanson",
        "year": 2009,
        "country": "JP",
        "genre": "Jazz",
        "style": "Avantgarde",
        "sample_friendly": True,
        "demo": True,
    },
    {
        "discogs_master_id": -102,
        "artist": "Tony Schwartz",
        "title": "Music in the Streets",
        "year": 1957,
        "country": "US",
        "genre": "Non-Music",
        "style": "Field Recording",
        "sample_friendly": True,
        "demo": True,
    },
    {
        "discogs_master_id": -103,
        "artist": "Marijata",
        "title": "Mother Africa",
        "year": 1976,
        "country": "Ghana",
        "genre": "Funk / Soul",
        "style": "Afrobeat",
        "sample_friendly": True,
        "demo": True,
    },
    {
        "discogs_master_id": -104,
        "artist": "Lena Platonos",
        "title": "Bloody Shadows From Afar",
        "year": 1985,
        "country": "Greece",
        "genre": "Electronic",
        "style": "Synth-pop",
        "sample_friendly": True,
        "demo": True,
    },
)


class EngineRuntime:
    """Owns the legacy core and exposes a web-safe service facade."""

    def __init__(self, data_dir: Path, event_hub: EventHub, logger: logging.Logger | None = None) -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.log = logger or logging.getLogger("cratedigger.web")
        self.events = event_hub
        self.config = ConfigManager(self.data_dir / "config.json", logger=self.log.getChild("config"))
        self.config.load()
        self.db = VaultDatabase(self.data_dir / "vault.db", logger=self.log.getChild("db"))
        self.db.reset_stuck_jobs()

        self._lock = threading.RLock()
        self._queue: Any = None
        self._discovery: Any = None
        self._preview: Any = None
        self._exporter: Any = None
        self._media_error: str | None = None
        self._preview_paths: dict[str, Path] = {}

    @property
    def engine_ready(self) -> bool:
        return self._queue is not None

    @property
    def engine_error(self) -> str | None:
        return self._media_error

    def close(self) -> None:
        if self._queue is not None:
            self._queue.shutdown(timeout=8, cancel_in_flight=True)
        self.db.close()

    def ensure_media_engine(self) -> None:
        if self._queue is not None:
            return
        with self._lock:
            if self._queue is not None:
                return
            try:
                from core.ai_metadata import make_ai_enricher
                from core.analyzer import AudioAnalyzer
                from core.artwork import ArtworkProcessor
                from core.downloader import Downloader
                from core.exporter import MPCExporter
                from core.metadata import MetadataWriter
                from core.pipeline import IngestionPipeline
                from core.preview import PreviewService
                from core.queue_manager import QueueManager
                from core.stems import StemModel, StemSeparator
                from utils.ffmpeg_setup import provision_ffmpeg

                snap = self.config.snapshot()
                binaries = provision_ffmpeg(logger=self.log.getChild("ffmpeg"))
                downloader = Downloader(
                    ffmpeg_path=binaries.ffmpeg_path,
                    retries=snap.config.downloader.retries,
                    fragment_retries=snap.config.downloader.fragment_retries,
                    concurrent_fragments=snap.config.downloader.concurrent_fragments,
                    logger=self.log.getChild("downloader"),
                )
                analyzer = AudioAnalyzer(ffmpeg_path=binaries.ffmpeg_path, logger=self.log.getChild("analyzer"))
                artwork = ArtworkProcessor(logger=self.log.getChild("artwork"))
                metadata = MetadataWriter(logger=self.log.getChild("metadata"))
                try:
                    model = StemModel(snap.config.stems.model)
                except ValueError:
                    model = StemModel.HTDEMUCS
                stems = StemSeparator(
                    model=model,
                    device=snap.config.stems.device,
                    ffmpeg_path=binaries.ffmpeg_path,
                    logger=self.log.getChild("stems"),
                )
                deepseek_key = snap.deepseek_key or os.environ.get("DEEPSEEK_API_KEY")
                enricher = make_ai_enricher(deepseek_key, logger=self.log.getChild("ai")) if deepseek_key else None
                pipeline = IngestionPipeline(
                    downloader=downloader,
                    artwork=artwork,
                    analyzer=analyzer,
                    metadata_writer=metadata,
                    stem_separator=stems,
                    database=self.db,
                    vault_root=Path(snap.config.general.vault_root).expanduser(),
                    staging_root=Path(snap.config.general.staging_root).expanduser(),
                    ai_enricher=enricher,
                    folder_scheme=snap.config.general.vault_folder_scheme,
                    logger=self.log.getChild("pipeline"),
                )
                queue = QueueManager(
                    pipeline=pipeline,
                    database=self.db,
                    num_workers=snap.config.general.concurrent_workers,
                    logger=self.log.getChild("queue"),
                )
                queue.events.subscribe(self.events.publish, weak=False)
                queue.start()
                self._preview = PreviewService(
                    ffmpeg_path=binaries.ffmpeg_path,
                    cache_dir=self.data_dir / "preview_cache",
                    logger=self.log.getChild("preview"),
                )
                self._exporter = MPCExporter(
                    ffmpeg_path=binaries.ffmpeg_path,
                    target_sample_rate=snap.config.export.sample_rate,
                    target_bit_depth=snap.config.export.bit_depth,
                    logger=self.log.getChild("exporter"),
                )
                self._queue = queue
                self._media_error = None
            except Exception as exc:
                self._media_error = f"{type(exc).__name__}: {exc}"
                self.log.exception("Media engine initialization failed")
                raise RuntimeUnavailable(self._media_error) from exc

    def ensure_discovery(self) -> Any:
        snap = self.config.snapshot()
        if not snap.discogs_token:
            return None
        if self._discovery is not None:
            return self._discovery
        with self._lock:
            if self._discovery is None:
                try:
                    from core.discovery import DiscoveryEngine

                    self._discovery = DiscoveryEngine(
                        db=self.db,
                        discogs_token=snap.discogs_token,
                        logger=self.log.getChild("discovery"),
                    )
                except Exception as exc:
                    raise RuntimeUnavailable(f"Discovery runtime unavailable: {exc}") from exc
        return self._discovery

    def enqueue(self, request: Any) -> int:
        self.ensure_media_engine()
        from core.pipeline import PipelineRequest

        return int(self._queue.enqueue(PipelineRequest(**request)))

    def cancel_job(self, job_id: int) -> bool:
        if self._queue is not None:
            return bool(self._queue.cancel(job_id))
        jobs = self.db.list_queue_jobs()
        pending = next((job for job in jobs if job.id == job_id and job.status == "pending"), None)
        if pending:
            self.db.update_queue_job(job_id, status="cancelled", error_message="Cancelled", completed_at="cancelled")
            return True
        return False

    def discover(self, values: dict[str, Any]) -> tuple[list[dict[str, Any]], bool, str | None]:
        engine = self.ensure_discovery()
        if engine is None:
            count = int(values.pop("count", 8))
            items = [dict(item) for item in DEMO_SUGGESTIONS]
            return (items[:count], True, "Add a Discogs token in Settings to dig live records.")
        from core.discovery import DiscoveryFilters

        count = int(values.pop("count", 8))
        suggestions = engine.dig_many(DiscoveryFilters(**values), count=count)
        return ([dataclasses.asdict(item) for item in suggestions], False, None)

    def create_preview(self, video_id: str) -> dict[str, Any]:
        self.ensure_media_engine()
        data = self._preview.fetch_quick(video_id)
        if data.source_path is None:
            raise RuntimeUnavailable("Preview audio was not cached")
        self._preview_paths[video_id] = data.source_path
        return {
            "video_id": video_id,
            "audio_url": f"/api/previews/{video_id}/audio",
            "peaks": [round(float(value), 5) for value in data.peaks],
            "duration_seconds": data.duration_seconds,
            "partial": data.is_partial,
        }

    def preview_path(self, video_id: str) -> Path | None:
        path = self._preview_paths.get(video_id)
        if path and path.exists():
            return path
        if self._preview is not None:
            return self._preview.get_quick_cached_path(video_id) or self._preview.get_cached_path(video_id)
        return None

    def waveform_for_track(self, track_id: int) -> dict[str, Any]:
        cache = self.data_dir / "waveforms"
        cache.mkdir(parents=True, exist_ok=True)
        cache_file = cache / f"{track_id}.json"
        if cache_file.exists():
            import json

            return json.loads(cache_file.read_text(encoding="utf-8"))
        self.ensure_media_engine()
        track = self.db.get_track(track_id)
        data = self._preview.load_file(Path(track.file_path))
        payload = {
            "peaks": [round(float(value), 5) for value in data.peaks],
            "duration_seconds": data.duration_seconds,
        }
        import json

        cache_file.write_text(json.dumps(payload), encoding="utf-8")
        return payload

    def export_tracks(self, track_ids: list[int], destination: str) -> int:
        self.ensure_media_engine()
        sources = [Path(self.db.get_track(track_id).file_path) for track_id in track_ids]
        result = self._exporter.export_batch(sources, Path(destination).expanduser())
        return len(result.exported)

    def update_config(self, section: str, values: dict[str, Any]) -> None:
        updater = getattr(self.config, f"update_{section}")
        updater(**values)
        if section == "discovery":
            self._discovery = None

    def config_payload(self) -> dict[str, Any]:
        snap = self.config.snapshot()
        return {
            "config": snap.config.model_dump(mode="json"),
            "has_discogs_token": bool(snap.discogs_token),
            "has_deepseek_key": bool(snap.deepseek_key),
            "keyring_available": snap.keyring_available,
            "engine_ready": self.engine_ready,
            "engine_error": self.engine_error,
        }

    def get_track_or_404(self, track_id: int) -> Any:
        try:
            return self.db.get_track(track_id)
        except RecordNotFoundError as exc:
            raise KeyError(track_id) from exc

    def list_tracks(self, **kwargs: Any) -> tuple[list[Any], int]:
        filt = TrackFilter(**kwargs)
        return self.db.list_tracks(filt), self.db.count_tracks(filt)
