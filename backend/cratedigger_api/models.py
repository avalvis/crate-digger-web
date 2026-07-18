from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(ApiModel):
    status: Literal["ok"] = "ok"
    version: str
    engine_ready: bool
    engine_error: str | None = None


class Track(ApiModel):
    id: int
    artist: str
    title: str
    album: str | None = None
    genre: str | None = None
    style: str | None = None
    country: str | None = None
    year: int | None = None
    duration_seconds: float | None = None
    bpm: float | None = None
    musical_key: str | None = None
    camelot_key: str | None = None
    stems_separated: bool = False
    source_url: str
    source_platform: str
    date_added: str | None = None
    rating: int | None = None
    notes: str | None = None
    tags: list[str] = Field(default_factory=list)
    file_available: bool = False
    artwork_url: str | None = None
    output_format: Literal["m4a", "mp3", "wav"] = "m4a"
    crate: CrateRef | None = None


class TrackPage(ApiModel):
    items: list[Track]
    total: int
    limit: int
    offset: int


class TrackPatch(ApiModel):
    rating: int | None = Field(default=None, ge=0, le=5)
    notes: str | None = Field(default=None, max_length=10_000)
    tags: list[str] | None = None


class QueueJob(ApiModel):
    id: int
    source_url: str
    display_name: str | None = None
    status: str
    operation: Literal["ingest", "stems"] = "ingest"
    origin: str = "manual_rip"
    progress_pct: float
    stage_percent: float = 0
    current_stage: str | None = None
    status_message: str | None = None
    error_message: str | None = None
    failure_stage: str | None = None
    track_id: int | None = None
    enable_stems: bool
    retry_of_job_id: int | None = None
    archived_at: str | None = None
    queue_position: int | None = None
    created_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


class QueueRequest(ApiModel):
    source_url: HttpUrl
    display_name: str | None = Field(default=None, max_length=500)
    origin: Literal["manual_rip", "digital_crate", "retry"] = "manual_rip"
    output_format: Literal["m4a", "mp3", "wav"] = "m4a"
    enable_stems: bool = False
    use_ai_metadata: bool = True
    hint_genre: str | None = None
    hint_country: str | None = None
    hint_year: int | None = Field(default=None, ge=1900, le=2100)
    hint_discogs_master_id: int | None = None
    hint_discogs_release_id: int | None = None
    source_platform_override: str | None = None


class QueueEvent(ApiModel):
    type: str
    job_id: int | None = None
    source_url: str | None = None
    display_name: str | None = None
    stage: str | None = None
    overall_percent: float = 0
    stage_percent: float = 0
    message: str = ""
    bpm: float | None = None
    musical_key: str | None = None
    camelot_key: str | None = None
    track_id: int | None = None
    final_path: str | None = None
    error_message: str | None = None
    job: QueueJob | None = None
    timestamp: str


class QueueSummary(ApiModel):
    running: int = 0
    waiting: int = 0
    completed: int = 0
    attention: int = 0
    current_job_id: int | None = None


class QueuePage(ApiModel):
    items: list[QueueJob]
    total: int
    limit: int
    offset: int
    summary: QueueSummary


class QueueActionResponse(ApiModel):
    affected: int


class DiscoveryFilters(ApiModel):
    year_min: int | None = Field(default=None, ge=1900, le=2100)
    year_max: int | None = Field(default=None, ge=1900, le=2100)
    country: str | None = None
    genre: str | None = None
    style: str | None = None
    query: str | None = None
    min_have: int = Field(default=10, ge=1)
    max_have: int = Field(default=3000, ge=1)
    prioritize_samples: bool = True
    sample_intensity: float = Field(default=0.9, ge=0, le=1)
    allow_compilations: bool = False
    profile: Literal["boom_bap", "lofi", "global", "cinematic"] = "boom_bap"
    count: int = Field(default=8, ge=1, le=24)


class Suggestion(ApiModel):
    discogs_master_id: int
    discogs_release_id: int | None = None
    artist: str
    title: str
    year: int | None = None
    country: str | None = None
    genre: str | None = None
    style: str | None = None
    youtube_url: str | None = None
    youtube_video_id: str | None = None
    youtube_title: str | None = None
    youtube_duration_seconds: int | None = None
    match_score: float | None = None
    sample_score: float = 1.0
    sample_reasons: list[str] = Field(default_factory=list)
    artwork_url: str | None = None
    discogs_url: str | None = None
    sample_friendly: bool = True
    demo: bool = False


class DiscoveryResponse(ApiModel):
    items: list[Suggestion]
    demo: bool = False
    message: str | None = None


class DiscoveryRematchRequest(ApiModel):
    suggestion: Suggestion
    exclude_video_ids: list[str] = Field(default_factory=list, max_length=50)


class DiscoveryInteractionRequest(ApiModel):
    suggestion: Suggestion
    action: Literal["preview", "queue", "mpc"]


class MpcExportRequest(ApiModel):
    suggestion: Suggestion
    mode: Literal["song", "stems", "both"] = "both"


class MpcJob(ApiModel):
    job_id: str
    video_id: str
    display_name: str
    mode: Literal["song", "stems", "both"]
    state: Literal["queued", "running", "completed", "failed", "cancelled"]
    message: str = ""
    percent: float = 0
    error_message: str | None = None
    track_dir: str | None = None


class CrateRef(ApiModel):
    id: int
    name: str
    color: str


class Crate(ApiModel):
    id: int
    name: str
    description: str | None = None
    color: str = "#F4DF00"
    created_at: str | None = None
    updated_at: str | None = None
    track_count: int = 0


class CrateCreate(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str = Field(default="#F4DF00", pattern=r"^#[0-9A-Fa-f]{6}$")


class CratePatch(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class CrateAssignmentRequest(ApiModel):
    track_ids: list[int] = Field(min_length=1)
    allow_moves: bool = False


class CrateTrackRemoval(ApiModel):
    track_ids: list[int] = Field(min_length=1)


class CrateAssignmentResult(ApiModel):
    assigned: int = 0
    moved: int = 0
    unchanged: int = 0


class CrateSuggestion(ApiModel):
    key: str
    kind: Literal["month", "genre", "mood"]
    label: str
    proposed_name: str
    track_ids: list[int]
    count: int


class CrateDetail(Crate):
    tracks: TrackPage


class CrateOverview(ApiModel):
    items: list[Crate]
    unassigned_count: int


class TrackLocation(ApiModel):
    file_path: str
    available: bool


class ConfigResponse(ApiModel):
    config: dict[str, Any]
    has_discogs_token: bool
    has_deepseek_key: bool
    keyring_available: bool
    engine_ready: bool
    engine_error: str | None = None


class ConfigPatch(ApiModel):
    section: Literal["general", "downloader", "stems", "discovery", "export", "ui"]
    values: dict[str, Any]


class SecretPatch(ApiModel):
    value: str | None = None


class PreviewResponse(ApiModel):
    video_id: str
    audio_url: str
    peaks: list[float]
    duration_seconds: float
    partial: bool


class PreviewPrefetchRequest(ApiModel):
    video_ids: list[str] = Field(min_length=1, max_length=24)


class PreviewPrefetchItem(ApiModel):
    video_id: str
    state: Literal["pending", "downloading", "decoding", "ready", "failed", "cancelled"]
    percent: float = 0
    message: str = ""
    error_message: str | None = None


class PreviewPrefetchResponse(ApiModel):
    items: list[PreviewPrefetchItem]


class ExportRequest(ApiModel):
    track_ids: list[int] = Field(min_length=1)
    destination: str
    chop_kit: bool = False


class ExportResponse(ApiModel):
    accepted: int
    destination: str
    message: str
