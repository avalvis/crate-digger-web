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
    progress_pct: float
    current_stage: str | None = None
    error_message: str | None = None
    track_id: int | None = None
    enable_stems: bool
    created_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None


class QueueRequest(ApiModel):
    source_url: HttpUrl
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
    timestamp: str


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
    sample_intensity: float = Field(default=0.6, ge=0, le=1)
    allow_compilations: bool = False
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
    sample_friendly: bool = True
    demo: bool = False


class DiscoveryResponse(ApiModel):
    items: list[Suggestion]
    demo: bool = False
    message: str | None = None


class Crate(ApiModel):
    id: int
    name: str
    description: str | None = None
    created_at: str | None = None
    track_count: int = 0


class CrateCreate(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)


class CrateTracks(ApiModel):
    track_ids: list[int] = Field(min_length=1)


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


class ExportRequest(ApiModel):
    track_ids: list[int] = Field(min_length=1)
    destination: str
    chop_kit: bool = False


class ExportResponse(ApiModel):
    accepted: int
    destination: str
    message: str

