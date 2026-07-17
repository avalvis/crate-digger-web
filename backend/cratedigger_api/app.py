import dataclasses
import logging
import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any, AsyncIterator

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from core.database import RecordNotFoundError, TrackFilter

from .events import EventHub
from .models import (
    ConfigPatch,
    ConfigResponse,
    Crate,
    CrateCreate,
    CrateTracks,
    DiscoveryFilters,
    DiscoveryResponse,
    ExportRequest,
    ExportResponse,
    HealthResponse,
    PreviewResponse,
    PreviewPrefetchRequest,
    PreviewPrefetchResponse,
    QueueJob,
    QueuePage,
    QueueSummary,
    QueueActionResponse,
    QueueRequest,
    SecretPatch,
    Suggestion,
    Track,
    TrackPage,
    TrackPatch,
)
from .runtime import APP_VERSION, EngineRuntime, RuntimeUnavailable, default_data_dir


def _error(code: str, message: str, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _track(record: Any) -> Track:
    return Track(
        id=int(record.id),
        artist=record.artist,
        title=record.title,
        album=record.album,
        genre=record.genre,
        style=record.style,
        country=record.country,
        year=record.year,
        duration_seconds=record.duration_seconds,
        bpm=record.bpm,
        musical_key=record.musical_key,
        camelot_key=record.camelot_key,
        stems_separated=record.stems_separated,
        source_url=record.source_url,
        source_platform=record.source_platform,
        date_added=record.date_added,
        rating=record.rating,
        notes=record.notes,
        tags=record.tags,
        file_available=Path(record.file_path).exists(),
        artwork_url=(f"/api/tracks/{int(record.id)}/artwork" if record.artwork_embedded or (Path(record.file_path).parent / "cover.jpg").exists() else None),
        output_format=(Path(record.file_path).suffix.lower().lstrip(".") if Path(record.file_path).suffix.lower() in {".m4a", ".mp3", ".wav"} else "m4a"),
    )


def _queue_job(record: Any, queue_position: int | None = None) -> QueueJob:
    values = dataclasses.asdict(record)
    values.pop("request_payload", None)
    values["queue_position"] = queue_position
    return QueueJob(**values)


def _crate(record: Any) -> Crate:
    return Crate(**dataclasses.asdict(record))


def _stream_file(path: Path, range_header: str | None) -> StreamingResponse | FileResponse:
    size = path.stat().st_size
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
    if not range_header:
        return FileResponse(path, media_type=media_type, headers=headers)

    try:
        unit, value = range_header.split("=", 1)
        if unit.lower() != "bytes":
            raise ValueError
        start_text, end_text = value.split("-", 1)
        start = int(start_text) if start_text else 0
        end = int(end_text) if end_text else min(size - 1, start + 1024 * 1024 - 1)
        end = min(end, size - 1)
        if start < 0 or start > end:
            raise ValueError
    except (ValueError, TypeError):
        raise _error("invalid_range", "Invalid byte range", status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE)

    length = end - start + 1

    def iterator() -> Any:
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining:
                chunk = handle.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(length)})
    return StreamingResponse(iterator(), status_code=206, media_type=media_type, headers=headers)


def create_app(*, data_dir: Path | None = None, api_token: str | None = None) -> FastAPI:
    token = api_token or os.environ.get("CRATEDIGGER_TOKEN", "cratedigger-local")
    event_hub = EventHub()
    runtime_holder: dict[str, EngineRuntime] = {}

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        event_hub.bind()
        runtime_holder["runtime"] = EngineRuntime(data_dir or default_data_dir(), event_hub)
        yield
        runtime_holder["runtime"].close()

    app = FastAPI(
        title="Crate Digger API",
        description="Loopback API for the Crate Digger desktop web interface.",
        version=APP_VERSION,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "tauri://localhost",
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def runtime() -> EngineRuntime:
        return runtime_holder["runtime"]

    def authorize(
        x_crate_token: Annotated[str | None, Header()] = None,
        bearer: Annotated[str | None, Header(alias="Authorization")] = None,
        query_token: Annotated[str | None, Query(alias="token")] = None,
    ) -> None:
        supplied = x_crate_token or query_token
        if not supplied and bearer and bearer.startswith("Bearer "):
            supplied = bearer[7:]
        if supplied != token:
            raise _error("unauthorized", "Missing or invalid local session token", status.HTTP_401_UNAUTHORIZED)

    Guard = Annotated[None, Depends(authorize)]
    Runtime = Annotated[EngineRuntime, Depends(runtime)]

    @app.get("/api/health", response_model=HealthResponse)
    def health(_: Guard, core: Runtime) -> HealthResponse:
        return HealthResponse(version=APP_VERSION, engine_ready=core.engine_ready, engine_error=core.engine_error)

    @app.get("/api/config", response_model=ConfigResponse)
    def get_config(_: Guard, core: Runtime) -> ConfigResponse:
        return ConfigResponse(**core.config_payload())

    @app.patch("/api/config", response_model=ConfigResponse)
    def patch_config(payload: ConfigPatch, _: Guard, core: Runtime) -> ConfigResponse:
        try:
            core.update_config(payload.section, payload.values)
        except Exception as exc:
            raise _error("invalid_config", str(exc), 422) from exc
        return ConfigResponse(**core.config_payload())

    @app.put("/api/config/secrets/discogs", response_model=ConfigResponse)
    def set_discogs(payload: SecretPatch, _: Guard, core: Runtime) -> ConfigResponse:
        core.set_discogs_token(payload.value)
        return ConfigResponse(**core.config_payload())

    @app.put("/api/config/secrets/deepseek", response_model=ConfigResponse)
    def set_deepseek(payload: SecretPatch, _: Guard, core: Runtime) -> ConfigResponse:
        core.set_deepseek_key(payload.value)
        return ConfigResponse(**core.config_payload())

    @app.get("/api/tracks", response_model=TrackPage)
    def list_tracks(
        _: Guard,
        core: Runtime,
        query: str | None = None,
        genre: str | None = None,
        decade: int | None = None,
        min_bpm: float | None = None,
        max_bpm: float | None = None,
        camelot_key: str | None = None,
        has_stems: bool | None = None,
        min_rating: int | None = None,
        tag: str | None = None,
        crate_id: int | None = None,
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        order_by: str = "date_added",
        order_desc: bool = True,
    ) -> TrackPage:
        filters = dict(
            query=query, genre=genre, decade=decade, min_bpm=min_bpm, max_bpm=max_bpm,
            camelot_key=camelot_key, has_stems=has_stems, min_rating=min_rating, tag=tag,
            crate_id=crate_id, limit=limit, offset=offset, order_by=order_by, order_desc=order_desc,
        )
        records, total = core.list_tracks(**filters)
        return TrackPage(items=[_track(item) for item in records], total=total, limit=limit, offset=offset)

    @app.get("/api/tracks/{track_id}", response_model=Track)
    def get_track(track_id: int, _: Guard, core: Runtime) -> Track:
        try:
            return _track(core.db.get_track(track_id))
        except RecordNotFoundError as exc:
            raise _error("track_not_found", "Track not found", 404) from exc

    @app.patch("/api/tracks/{track_id}", response_model=Track)
    def patch_track(track_id: int, payload: TrackPatch, _: Guard, core: Runtime) -> Track:
        try:
            core.db.get_track(track_id)
            fields = payload.model_fields_set
            if "rating" in fields:
                core.db.set_track_rating(track_id, payload.rating)
            if "notes" in fields or "tags" in fields:
                core.db.set_track_annotations(track_id, notes=payload.notes, tags=payload.tags)
            return _track(core.db.get_track(track_id))
        except RecordNotFoundError as exc:
            raise _error("track_not_found", "Track not found", 404) from exc

    @app.get("/api/tracks/{track_id}/audio")
    def track_audio(track_id: int, request: Request, _: Guard, core: Runtime) -> Any:
        try:
            path = Path(core.db.get_track(track_id).file_path)
        except RecordNotFoundError as exc:
            raise _error("track_not_found", "Track not found", 404) from exc
        if not path.exists():
            raise _error("audio_missing", "The indexed audio file is missing", 404)
        return _stream_file(path, request.headers.get("range"))

    @app.get("/api/tracks/{track_id}/artwork")
    def track_artwork(track_id: int, _: Guard, core: Runtime) -> FileResponse:
        try:
            path = core.track_artwork_path(track_id)
        except RecordNotFoundError as exc:
            raise _error("track_not_found", "Track not found", 404) from exc
        if path is None:
            raise _error("artwork_missing", "This track has no artwork", 404)
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})

    @app.get("/api/tracks/{track_id}/waveform")
    async def track_waveform(track_id: int, _: Guard, core: Runtime) -> dict[str, Any]:
        try:
            return await run_in_threadpool(core.waveform_for_track, track_id)
        except RuntimeUnavailable as exc:
            raise _error("engine_unavailable", str(exc), 503) from exc

    @app.get("/api/jobs", response_model=QueuePage)
    def list_jobs(
        _: Guard,
        core: Runtime,
        view: str = Query(default="queue", pattern="^(queue|history|all)$"),
        status_filter: str | None = Query(default=None, alias="status"),
        query: str = Query(default="", max_length=300),
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
    ) -> QueuePage:
        statuses = tuple(value for value in (status_filter or "").split(",") if value) or None
        records = core.db.list_queue_jobs(
            statuses=statuses, limit=limit, view=view, query=query, offset=offset,
        )
        pending = sorted(
            (job for job in core.db.list_queue_jobs(statuses=("pending",), limit=500, view="queue")),
            key=lambda job: job.created_at or "",
        )
        positions = {job.id: index + 1 for index, job in enumerate(pending)}
        live = core.db.list_queue_jobs(limit=500, view="queue")
        running_statuses = {"downloading", "analyzing", "tagging", "separating_stems"}
        running = sorted(
            (job for job in live if job.status in running_statuses),
            key=lambda job: job.started_at or job.created_at or "",
        )
        summary = QueueSummary(
            running=len(running),
            waiting=sum(job.status == "pending" for job in live),
            completed=sum(job.status == "complete" for job in live),
            attention=sum(job.status in {"failed", "complete_with_warnings"} for job in live),
            current_job_id=running[0].id if running else None,
        )
        return QueuePage(
            items=[_queue_job(job, positions.get(job.id)) for job in records],
            total=core.db.count_queue_jobs(view=view, statuses=statuses, query=query),
            limit=limit,
            offset=offset,
            summary=summary,
        )

    @app.post("/api/jobs", response_model=QueueJob, status_code=202)
    async def create_job(payload: QueueRequest, _: Guard, core: Runtime) -> QueueJob:
        values = payload.model_dump(mode="python")
        values["source_url"] = str(values["source_url"])
        try:
            job_id = await run_in_threadpool(core.enqueue, values)
        except RuntimeUnavailable as exc:
            raise _error("engine_unavailable", str(exc), 503) from exc
        return _queue_job(core.db.get_queue_job(job_id))

    @app.post("/api/jobs/cancel-all", response_model=QueueActionResponse)
    def cancel_all_jobs(_: Guard, core: Runtime) -> QueueActionResponse:
        return QueueActionResponse(affected=core.cancel_all_jobs())

    @app.post("/api/jobs/archive-completed", response_model=QueueActionResponse)
    def archive_completed_jobs(_: Guard, core: Runtime) -> QueueActionResponse:
        return QueueActionResponse(affected=core.db.archive_completed_jobs())

    @app.delete("/api/jobs/history", response_model=QueueActionResponse)
    def delete_job_history(_: Guard, core: Runtime) -> QueueActionResponse:
        return QueueActionResponse(affected=core.db.delete_archived_job_history())

    @app.post("/api/jobs/{job_id}/retry", response_model=QueueJob, status_code=202)
    async def retry_job(job_id: int, _: Guard, core: Runtime) -> QueueJob:
        try:
            retry_id = await run_in_threadpool(core.retry_job, job_id)
        except (RecordNotFoundError, RuntimeUnavailable) as exc:
            raise _error("job_retry_unavailable", str(exc), 409) from exc
        except Exception as exc:
            raise _error("job_not_retryable", str(exc), 409) from exc
        return _queue_job(core.db.get_queue_job(retry_id))

    @app.post("/api/jobs/{job_id}/archive", status_code=204)
    def archive_job(job_id: int, _: Guard, core: Runtime) -> None:
        if not core.db.archive_queue_job(job_id):
            raise _error("job_not_archivable", "Only finished jobs can be dismissed", 409)

    @app.delete("/api/jobs/{job_id}", status_code=204)
    def cancel_job(job_id: int, _: Guard, core: Runtime) -> None:
        if not core.cancel_job(job_id):
            raise _error("job_not_active", "Job is not pending or active", 409)

    @app.post("/api/discovery/dig", response_model=DiscoveryResponse)
    async def dig(payload: DiscoveryFilters, _: Guard, core: Runtime) -> DiscoveryResponse:
        try:
            items, demo, message = await run_in_threadpool(core.discover, payload.model_dump())
        except RuntimeUnavailable as exc:
            raise _error("discovery_unavailable", str(exc), 503) from exc
        except Exception as exc:
            logging.getLogger("cratedigger.web").exception("Dig failed")
            raise _error("dig_failed", str(exc), 502) from exc
        return DiscoveryResponse(items=[Suggestion(**item) for item in items], demo=demo, message=message)

    @app.post("/api/previews/prefetch", response_model=PreviewPrefetchResponse, status_code=202)
    async def prefetch_previews(payload: PreviewPrefetchRequest, _: Guard, core: Runtime) -> PreviewPrefetchResponse:
        try:
            items = await run_in_threadpool(core.prefetch_previews, payload.video_ids)
            return PreviewPrefetchResponse(items=items)
        except RuntimeUnavailable as exc:
            raise _error("preview_unavailable", str(exc), 503) from exc

    @app.get("/api/previews/prefetch", response_model=PreviewPrefetchResponse)
    async def preview_status(video_ids: str, _: Guard, core: Runtime) -> PreviewPrefetchResponse:
        values = [value for value in video_ids.split(",") if value]
        return PreviewPrefetchResponse(items=await run_in_threadpool(core.preview_status, values))

    @app.post("/api/previews/{video_id}", response_model=PreviewResponse)
    async def create_preview(video_id: str, _: Guard, core: Runtime, mode: str = Query(default="quick", pattern="^(quick|full)$")) -> PreviewResponse:
        try:
            return PreviewResponse(**await run_in_threadpool(core.create_preview, video_id, mode))
        except RuntimeUnavailable as exc:
            raise _error("preview_unavailable", str(exc), 503) from exc
        except Exception as exc:
            raise _error("preview_failed", str(exc), 502) from exc

    @app.get("/api/previews/{video_id}/audio")
    def preview_audio(video_id: str, request: Request, _: Guard, core: Runtime) -> Any:
        path = core.preview_path(video_id)
        if not path:
            raise _error("preview_missing", "Preview has not been prepared", 404)
        return _stream_file(path, request.headers.get("range"))

    @app.get("/api/crates", response_model=list[Crate])
    def list_crates(_: Guard, core: Runtime) -> list[Crate]:
        return [_crate(item) for item in core.db.list_crates()]

    @app.post("/api/crates", response_model=Crate, status_code=201)
    def create_crate(payload: CrateCreate, _: Guard, core: Runtime) -> Crate:
        crate_id = core.db.create_crate(payload.name, payload.description)
        return next(_crate(item) for item in core.db.list_crates() if item.id == crate_id)

    @app.post("/api/crates/{crate_id}/tracks")
    def add_crate_tracks(crate_id: int, payload: CrateTracks, _: Guard, core: Runtime) -> dict[str, int]:
        return {"added": core.db.add_tracks_to_crate(crate_id, payload.track_ids)}

    @app.delete("/api/crates/{crate_id}", status_code=204)
    def delete_crate(crate_id: int, _: Guard, core: Runtime) -> None:
        core.db.delete_crate(crate_id)

    @app.post("/api/exports", response_model=ExportResponse)
    async def export(payload: ExportRequest, _: Guard, core: Runtime) -> ExportResponse:
        if payload.chop_kit:
            raise _error("chop_plan_required", "Open a track and define chop regions before chop-kit export", 409)
        try:
            accepted = await run_in_threadpool(core.export_tracks, payload.track_ids, payload.destination)
        except RuntimeUnavailable as exc:
            raise _error("engine_unavailable", str(exc), 503) from exc
        return ExportResponse(accepted=accepted, destination=payload.destination, message=f"Exported {accepted} track(s)")

    @app.websocket("/api/events")
    async def events_socket(websocket: WebSocket) -> None:
        supplied = websocket.query_params.get("token") or websocket.headers.get("x-crate-token")
        if supplied != token:
            await websocket.close(code=4401)
            return
        await websocket.accept()
        queue = event_hub.subscribe()
        try:
            while True:
                await websocket.send_json(await queue.get())
        except WebSocketDisconnect:
            pass
        finally:
            event_hub.unsubscribe(queue)

    frontend_dir = os.environ.get("CRATEDIGGER_FRONTEND_DIR")
    if frontend_dir and Path(frontend_dir).exists():
        app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

    return app


app = create_app()
