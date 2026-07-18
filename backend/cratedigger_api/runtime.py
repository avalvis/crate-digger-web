from __future__ import annotations

import dataclasses
import logging
from logging.handlers import RotatingFileHandler
import os
import sys
import threading
from pathlib import Path
from typing import Any

from core.database import DiscoveryRecord, RecordNotFoundError, TrackFilter, VaultDatabase
from utils.config import ConfigManager

from .events import EventHub


APP_VERSION = "0.2.4"


class RuntimeUnavailable(RuntimeError):
    pass


def configure_file_logging(data_dir: Path) -> None:
    """Keep web-sidecar diagnostics beside the user's database and config."""
    path = Path(data_dir) / "crate-digger-desktop.log"
    logger = logging.getLogger("cratedigger")
    logger.setLevel(logging.DEBUG)
    for handler in logger.handlers:
        if getattr(handler, "_crate_log_path", None) == str(path):
            return
    handler = RotatingFileHandler(path, maxBytes=3 * 1024 * 1024, backupCount=3, encoding="utf-8")
    handler._crate_log_path = str(path)  # type: ignore[attr-defined]
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-8s %(name)-34s %(message)s"))
    logger.addHandler(handler)


def default_data_dir() -> Path:
    override = os.environ.get("CRATEDIGGER_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
        return base / "com.cratedigger.desktop"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "com.cratedigger.desktop"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "com.cratedigger.desktop"


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
        configure_file_logging(self.data_dir)
        self.log = logger or logging.getLogger("cratedigger.web")
        self.events = event_hub
        self.config = ConfigManager(self.data_dir / "config.json", logger=self.log.getChild("config"))
        self.config.load()
        self.db = VaultDatabase(self.data_dir / "vault.db", logger=self.log.getChild("db"))
        self.db.reset_stuck_jobs()

        self._lock = threading.RLock()
        self._queue: Any = None
        self._pipeline: Any = None
        self._discovery: Any = None
        self._preview: Any = None
        self._preview_prefetch: Any = None
        self._metadata: Any = None
        self._exporter: Any = None
        self._stem_separator: Any = None
        self._mpc_manager: Any = None
        self._media_error: str | None = None
        self._preview_paths: dict[str, Path] = {}

    @property
    def engine_ready(self) -> bool:
        return self._queue is not None

    @property
    def engine_error(self) -> str | None:
        return self._media_error

    def close(self) -> None:
        if self._mpc_manager is not None:
            self._mpc_manager.shutdown(cancel_pending=True)
        if self._preview_prefetch is not None:
            self._preview_prefetch.shutdown(cancel_pending=True)
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
                from core.mpc_export_manager import MpcExportManager
                from core.pipeline import IngestionPipeline
                from core.preview import PreviewService
                from core.preview_prefetch import PreviewPrefetchService
                from core.queue_manager import QueueManager
                from core.stems import StemModel, StemSeparator
                from utils.ffmpeg_setup import provision_ffmpeg

                snap = self.config.snapshot()
                binaries = provision_ffmpeg(
                    tools_dir=self.data_dir / "tools",
                    logger=self.log.getChild("ffmpeg"),
                )
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
                    ffmpeg_path=binaries.ffmpeg_path,
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
                queue.events.subscribe(self._publish_queue_event, weak=False)
                queue.start()
                self._preview = PreviewService(
                    ffmpeg_path=binaries.ffmpeg_path,
                    cache_dir=self.data_dir / "preview_cache",
                    logger=self.log.getChild("preview"),
                )
                self._preview.clear_stale_cache(max_age_days=14)
                self._preview_prefetch = PreviewPrefetchService(
                    self._preview,
                    max_workers=1,
                    keep_decoded=True,
                    logger=self.log.getChild("preview_prefetch"),
                )
                self._preview_prefetch.subscribe(self._publish_preview_event, weak=False)
                self._preview_prefetch.start()
                self._metadata = metadata
                self._exporter = MPCExporter(
                    ffmpeg_path=binaries.ffmpeg_path,
                    target_sample_rate=snap.config.export.sample_rate,
                    target_bit_depth=snap.config.export.bit_depth,
                    logger=self.log.getChild("exporter"),
                )
                self._stem_separator = stems
                self._mpc_manager = MpcExportManager(
                    preview=self._preview,
                    stem_separator=stems,
                    exporter=self._exporter,
                    destination_root=lambda: Path(
                        self.config.snapshot().config.general.mpc_samples_root
                    ).expanduser(),
                    staging_root=lambda: Path(
                        self.config.snapshot().config.general.staging_root
                    ).expanduser(),
                    max_workers=snap.config.general.mpc_export_max_concurrent,
                    logger=self.log.getChild("mpc_export"),
                )
                self._mpc_manager.subscribe(self._publish_mpc_event, weak=False)
                self._mpc_manager.start()
                self._queue = queue
                self._pipeline = pipeline
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

    def retry_job(self, job_id: int) -> int:
        self.ensure_media_engine()
        return int(self._queue.retry(job_id))

    def cancel_all_jobs(self) -> int:
        self.ensure_media_engine()
        return int(self._queue.cancel_all())

    def _publish_queue_event(self, event: Any) -> None:
        """Attach the durable DB snapshot used by live frontend updates."""
        payload = dataclasses.asdict(event)
        job_id = payload.get("job_id")
        if job_id is not None:
            try:
                job = dataclasses.asdict(self.db.get_queue_job(int(job_id)))
                job.pop("request_payload", None)
                job["queue_position"] = None
                payload["job"] = job
            except RecordNotFoundError:
                payload["job"] = None
        self.events.publish(payload)

    def _publish_preview_event(self, event: Any) -> None:
        payload = dataclasses.asdict(event)
        payload.pop("data", None)
        payload["type"] = f"preview_{event.type.value}"
        payload["state"] = event.state.value
        self.events.publish(payload)

    def _publish_mpc_event(self, event: Any) -> None:
        payload = dataclasses.asdict(event)
        payload["type"] = f"mpc_{event.type.value}"
        if event.job_id:
            payload["job"] = self._mpc_job_payload(event.job_id)
        self.events.publish(payload)

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

    @staticmethod
    def _discovery_suggestion(values: dict[str, Any]) -> Any:
        from core.discovery import DiscoverySuggestion

        video_id = str(values.get("youtube_video_id") or "").strip()
        youtube_url = str(values.get("youtube_url") or "").strip()
        if not video_id or not youtube_url:
            raise ValueError("This result has no usable YouTube source")
        return DiscoverySuggestion(
            discogs_master_id=int(values["discogs_master_id"]),
            discogs_release_id=values.get("discogs_release_id"),
            artist=str(values.get("artist") or "Unknown artist"),
            title=str(values.get("title") or "Untitled"),
            year=values.get("year"),
            country=values.get("country"),
            genre=values.get("genre"),
            style=values.get("style"),
            youtube_url=youtube_url,
            youtube_video_id=video_id,
            youtube_title=str(values.get("youtube_title") or ""),
            youtube_duration_seconds=values.get("youtube_duration_seconds"),
            match_score=float(values.get("match_score") or 0),
            sample_score=float(values.get("sample_score") or 1),
            sample_reasons=tuple(values.get("sample_reasons") or ()),
            artwork_url=values.get("artwork_url"),
            discogs_url=values.get("discogs_url"),
        )

    def rematch_discovery(self, values: dict[str, Any], exclude_video_ids: list[str]) -> dict[str, Any]:
        engine = self.ensure_discovery()
        if engine is None:
            raise RuntimeUnavailable("Add a Discogs token in Settings to search for another source")
        suggestion = self._discovery_suggestion(values)
        replacement = engine.rematch_youtube(
            suggestion,
            exclude_video_ids=exclude_video_ids,
        )
        return dataclasses.asdict(replacement)

    def record_discovery_interaction(self, values: dict[str, Any], action: str) -> None:
        suggestion = self._discovery_suggestion(values)
        self.db.record_discovery(DiscoveryRecord(
            discogs_master_id=suggestion.discogs_master_id,
            discogs_release_id=suggestion.discogs_release_id,
            artist=suggestion.artist,
            title=suggestion.title,
            year=suggestion.year,
            country=suggestion.country,
            genre=suggestion.genre,
            style=suggestion.style,
            was_queued=action in {"queue", "mpc"},
        ))
        if action in {"queue", "mpc"}:
            self.db.mark_discovery_queued(suggestion.discogs_master_id)

    def _mpc_job_payload(self, job_id: str) -> dict[str, Any] | None:
        if self._mpc_manager is None:
            return None
        job = next((item for item in self._mpc_manager.list_jobs() if item.job_id == job_id), None)
        if job is None:
            return None
        return {
            "job_id": job.job_id,
            "video_id": job.suggestion.youtube_video_id,
            "display_name": job.suggestion.display_name,
            "mode": job.mode.value,
            "state": job.state,
            "message": job.message,
            "percent": job.percent,
            "error_message": job.error_message,
            "track_dir": job.track_dir,
        }

    def list_mpc_jobs(self) -> list[dict[str, Any]]:
        if self._mpc_manager is None:
            return []
        return [
            payload for job in self._mpc_manager.list_jobs()
            if (payload := self._mpc_job_payload(job.job_id)) is not None
        ]

    def enqueue_mpc(self, values: dict[str, Any], mode: str) -> dict[str, Any]:
        self.ensure_media_engine()
        from core.mpc_export import MpcExportMode

        snap = self.config.snapshot()
        destination = Path(snap.config.general.mpc_samples_root).expanduser()
        try:
            destination.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise RuntimeUnavailable(f"MPC destination is unavailable: {destination} ({exc})") from exc
        if not destination.is_dir() or not os.access(destination, os.W_OK):
            raise RuntimeUnavailable(f"MPC destination is not writable: {destination}")
        suggestion = self._discovery_suggestion(values)
        job_id = self._mpc_manager.enqueue(suggestion, MpcExportMode(mode))
        payload = self._mpc_job_payload(job_id)
        if payload is None:
            raise RuntimeUnavailable("MPC export did not enter the queue")
        return payload

    def cancel_mpc_job(self, job_id: str) -> bool:
        if self._mpc_manager is None:
            return False
        job = self._mpc_job_payload(job_id)
        if job is None or job["state"] not in {"queued", "running"}:
            return False
        self._mpc_manager.cancel_job(job_id)
        return True

    def clear_finished_mpc_jobs(self) -> int:
        if self._mpc_manager is None:
            return 0
        before = len(self._mpc_manager.list_jobs())
        self._mpc_manager.clear_finished()
        return before - len(self._mpc_manager.list_jobs())

    def prefetch_previews(self, video_ids: list[str]) -> list[dict[str, object]]:
        self.ensure_media_engine()
        normalized = [self._preview.normalize_video_id(value) for value in video_ids if value]
        self._preview_prefetch.cancel_batch()
        self._preview_prefetch.enqueue_batch(normalized)
        return self._preview_prefetch.get_status(normalized)

    def preview_status(self, video_ids: list[str]) -> list[dict[str, object]]:
        self.ensure_media_engine()
        return self._preview_prefetch.get_status(video_ids)

    def create_preview(self, video_id: str, mode: str = "quick") -> dict[str, Any]:
        self.ensure_media_engine()
        if mode == "full":
            self._preview_prefetch.prioritize(video_id)
            self._preview_prefetch.wait_ready(video_id, timeout=90)
            data = self._preview.fetch(video_id)
        else:
            data = self._preview_prefetch.get_decoded(video_id)
            if data is None:
                self._preview_prefetch.prioritize(video_id)
                data = self._preview_prefetch.wait_ready(video_id, timeout=90)
            if data is None:
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
            return self._preview.get_cached_path(video_id) or self._preview.get_quick_cached_path(video_id)
        return None

    def track_artwork_path(self, track_id: int) -> Path | None:
        track = self.db.get_track(track_id)
        audio_path = Path(track.file_path)
        cover = audio_path.parent / "cover.jpg"
        if cover.exists() and cover.stat().st_size > 0:
            return cover
        if not audio_path.exists() or not track.artwork_embedded:
            return None
        self.ensure_media_engine()
        artwork = self._metadata.read_artwork(audio_path)
        if not artwork:
            return None
        partial = cover.with_suffix(".jpg.partial")
        partial.write_bytes(artwork)
        os.replace(partial, cover)
        return cover

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

    def set_discogs_token(self, value: str | None) -> None:
        self.config.set_discogs_token(value)
        self._discovery = None

    def set_deepseek_key(self, value: str | None) -> None:
        snapshot = self.config.set_deepseek_key(value)
        if self._pipeline is None:
            return
        from core.ai_metadata import make_ai_enricher

        enricher = make_ai_enricher(
            snapshot.deepseek_key,
            logger=self.log.getChild("ai"),
        ) if snapshot.deepseek_key else None
        self._pipeline.update_ai_enricher(enricher)

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
